// stopPaths, stopSubline, stepStop and the attention labels follow T3 Code's review guide tour
// (github.com/pingdotgg/t3code, packages/client-runtime/src/reviewGuideTour.ts and GuideStop.tsx).
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import type { AttentionKind, Guide, GuideNote, GuideStop } from "../guide.ts";
import type { CardComment } from "./comment-layout.ts";
import { lineCount, touchesChunk } from "./diff.ts";
import type { Chunk, ChunkKind } from "./diff.ts";
import { mapLine } from "./scroll.ts";
import type { Side } from "./scroll.ts";

export interface DiffText {
	oldText: string;
	newText: string;
	chunks: Chunk[];
}

export interface LineRange {
	side: Side;
	start: number;
	end: number;
}

const MIN_SHORT_SHA = 7;

export function isSameHead(guideHead: string, head: string): boolean {
	return guideHead === head || (guideHead.length >= MIN_SHORT_SHA && head.startsWith(guideHead));
}

export function isStale(guide: Guide, head: string): boolean {
	return head !== "" && !isSameHead(guide.headSha, head);
}

export function excerptProblem(file: DiffText, range: LineRange): string | null {
	const lines = lineCount(range.side === "old" ? file.oldText : file.newText);
	if (range.end > lines) return `are past the end of the ${range.side} side (${countOf(lines, "line")})`;
	const touched = file.chunks.some((chunk) => touchesChunk(chunk, range.side, range.start, range.end));
	if (!touched) return `touch no change on the ${range.side} side`;
	return null;
}

export const ATTENTION_LABELS: Record<AttentionKind, string> = {
	tradeoff: "A tradeoff to weigh",
	contract: "A contract to check",
	product: "A product call",
	risk: "A risk to judge",
	accessibility: "An accessibility call"
};

export function stopPaths(stop: GuideStop): string[] {
	return [...new Set([...stop.excerpts.map((excerpt) => excerpt.path), ...stop.files.map((file) => file.path)])];
}

export function stopSubline(stop: GuideStop): string {
	const count = stopPaths(stop).length;
	return count === 0 ? "Context, no code" : countOf(count, "file");
}

export function countOf(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function stepStop(current: number, delta: 1 | -1, count: number): number {
	return Math.max(Math.min(current + delta, count - 1), 0);
}

export interface ExcerptRow {
	kind: "context" | ChunkKind;
	oldLine: number | null;
	newLine: number | null;
}

// owl has both full texts, so an excerpt is drawn from them, not from diff hunks: the lines of the range
// on its side, with each change's other side placed where git would show it in a unified diff.
export function excerptRows(file: DiffText, { side, start, end }: LineRange): ExcerptRow[] {
	const last = Math.min(end, lineCount(side === "old" ? file.oldText : file.newText));
	const rows: ExcerptRow[] = [];
	for (let line = start; line <= last; line++) {
		if (side === "new") rows.push(...newSideRows(file.chunks, line - 1, line === start));
		else rows.push(...oldSideRows(file.chunks, line - 1));
	}
	return rows;
}

function newSideRows(chunks: Chunk[], index: number, isFirst: boolean): ExcerptRow[] {
	const rows: ExcerptRow[] = [];
	for (const chunk of chunks) {
		const startsHere = chunk.newStart === index || (isFirst && chunk.newStart < index && index < chunk.newEnd);
		if (startsHere) rows.push(...span(chunk.oldStart, chunk.oldEnd, (i) => removed(i)));
	}
	const inside = chunks.find((chunk) => chunk.newStart <= index && index < chunk.newEnd);
	if (inside) return [...rows, { kind: inside.kind, oldLine: null, newLine: index + 1 }];
	return [...rows, { kind: "context", oldLine: mapLine(chunks, index, "new") + 1, newLine: index + 1 }];
}

function oldSideRows(chunks: Chunk[], index: number): ExcerptRow[] {
	const rows: ExcerptRow[] = [];
	for (const chunk of chunks) {
		if (chunk.oldStart === index && chunk.oldEnd === index) rows.push(...replacement(chunk));
	}
	const inside = chunks.find((chunk) => chunk.oldStart <= index && index < chunk.oldEnd);
	if (!inside) return [...rows, { kind: "context", oldLine: index + 1, newLine: mapLine(chunks, index, "old") + 1 }];
	rows.push(removed(index));
	if (index === inside.oldEnd - 1) rows.push(...replacement(inside));
	return rows;
}

function replacement(chunk: Chunk): ExcerptRow[] {
	return span(chunk.newStart, chunk.newEnd, (i) => ({ kind: chunk.kind, oldLine: null, newLine: i + 1 }));
}

function removed(index: number): ExcerptRow {
	return { kind: "deleted", oldLine: index + 1, newLine: null };
}

function span<T>(from: number, to: number, make: (index: number) => T): T[] {
	return Array.from({ length: Math.max(0, to - from) }, (_, i) => make(from + i));
}

export function noteSide(stop: GuideStop, note: GuideNote): Side {
	const holding = stop.excerpts.filter(
		(excerpt) => excerpt.path === note.path && excerpt.start <= note.line && note.line <= excerpt.end
	);
	return holding.length > 0 && holding.every((excerpt) => excerpt.side === "old") ? "old" : "new";
}

export function uncoveredFiles<T extends { path: string }>(files: T[], guide: Guide): T[] {
	const named = new Set(guide.stops.flatMap((stop) => [...stopPaths(stop), ...stop.notes.map((note) => note.path)]));
	return files.filter((file) => !named.has(file.path));
}

export function guideNoteCards(guide: Guide, source: string, now: string): CardComment[] {
	return guide.stops.flatMap((stop, stopIndex) =>
		stop.notes.map((note, index) => {
			const title = `**${noteLetter(index)}. ${note.title}**`;
			return {
				id: `guide-${stopIndex + 1}-${index + 1}`,
				source,
				path: note.path,
				side: noteSide(stop, note),
				start: note.line,
				end: note.line,
				text: note.body.trim() ? `${title}\n\n${note.body}` : title,
				createdAt: guide.generatedAt ?? now,
				byline: `guide · stop ${stopIndex + 1}`
			};
		})
	);
}

export function noteLetter(index: number): string {
	return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

export const DIFF_SIGNS: Record<ExcerptRow["kind"], string> = { context: " ", added: "+", modified: "+", deleted: "-" };

// A row's text from per-line arrays of either side, plain or highlighted.
export function rowText(row: ExcerptRow, oldLines: string[], newLines: string[]): string {
	if (row.newLine !== null) return newLines[row.newLine - 1] ?? "";
	if (row.oldLine !== null) return oldLines[row.oldLine - 1] ?? "";
	return "";
}

export function excerptDiff(file: DiffText, range: LineRange): string | null {
	if (excerptProblem(file, range)) return null;
	const oldLines = file.oldText.split("\n");
	const newLines = file.newText.split("\n");
	return excerptRows(file, range)
		.map((row) => `${DIFF_SIGNS[row.kind]} ${rowText(row, oldLines, newLines)}`)
		.join("\n");
}

// The text "Copy stop" puts on the clipboard: everything an agent needs to discuss one stop, as plain Markdown.
export function stopPrompt(guide: Guide, index: number, view: string, excerptDiffs: (string | null)[]): string {
	const stop = guide.stops[index];
	const lines = [
		`I'm reviewing ${view} with a review guide written for commit ${guide.headSha.slice(0, 7)}.`,
		`This is stop ${index + 1} of ${guide.stops.length}. Help me review it: check what it claims against the code, and answer its questions.`,
		"",
		`## ${stop.title}`
	];
	if (stop.summary.trim()) lines.push("", stop.summary.trim());
	if (stop.attention) {
		const label = ATTENTION_LABELS[stop.attention.kind];
		lines.push("", `Look closely, ${label[0].toLowerCase()}${label.slice(1)}: ${stop.attention.note}`);
	}
	if (stop.excerpts.length > 0) lines.push("", "### Excerpts");
	stop.excerpts.forEach((excerpt, i) => {
		const head = `${excerpt.path}, ${excerpt.side} lines ${excerpt.start}-${excerpt.end}`;
		const caption = excerpt.caption.trim();
		const diff = excerptDiffs[i] ?? null;
		lines.push("", caption ? `${head}: ${caption}` : head);
		if (diff === null) lines.push("(not shown: these lines no longer match the diff)");
		else lines.push("```diff", diff, "```");
	});
	if (stop.notes.length > 0) lines.push("", "### Notes");
	stop.notes.forEach((note, i) => {
		lines.push("", `${noteLetter(i)}. ${note.path}:${note.line} ${note.title}`);
		if (note.body.trim()) lines.push(note.body.trim());
	});
	if (stop.files.length > 0) lines.push("", "### Files", "");
	for (const file of stop.files)
		lines.push(file.note?.trim() ? `- ${file.path}: ${file.note.trim()}` : `- ${file.path}`);
	if (stop.questions.length > 0) lines.push("", "### Questions", "");
	for (const question of stop.questions) lines.push(`- ${question}`);
	return lines.join("\n");
}
