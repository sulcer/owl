import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./atomicWrite.ts";
import { commentsDir, parsePath } from "./comments.ts";
import type { Side } from "./shared/scroll.ts";

// The shape of T3 Code's PullRequestReviewGuide (MIT, github.com/pingdotgg/t3code), so a T3 guide loads as-is.
const ATTENTION_KINDS = ["tradeoff", "contract", "product", "risk", "accessibility"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export interface GuideExcerpt {
	path: string;
	side: Side;
	start: number;
	end: number;
	caption: string;
}

interface GuideFile {
	path: string;
	note?: string;
}

export interface GuideNote {
	path: string;
	line: number;
	title: string;
	body: string;
}

export interface GuideStop {
	title: string;
	summary: string;
	attention: { kind: AttentionKind; note: string } | null;
	excerpts: GuideExcerpt[];
	files: GuideFile[];
	notes: GuideNote[];
	questions: string[];
}

export interface Guide {
	headSha: string;
	generatedAt?: string;
	modelSelection?: unknown;
	stops: GuideStop[];
}

export const MAX_GUIDE_BYTES = 300 * 1024;
export const GUIDE_FILE_PATTERN = /^guide-(working|branch|pr-\d{1,7})\.json$/;

type Fields = Record<string, unknown>;

export function parseGuide(input: string): Guide {
	if (Buffer.byteLength(input) > MAX_GUIDE_BYTES) throw new Error(`guide is larger than ${MAX_GUIDE_BYTES / 1024} KB`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(input);
	} catch {
		throw new Error("guide is not valid JSON");
	}
	const outer = object(parsed, "guide ");
	const fields = "guide" in outer ? object(outer.guide, "guide ") : outer;
	const headSha = text(fields.headSha, "headSha");
	const stops = array(fields.stops, "stops").map((value, index) => parseStop(value, `stop ${index + 1}`));
	return {
		headSha,
		...(typeof fields.generatedAt === "string" ? { generatedAt: fields.generatedAt } : {}),
		...(fields.modelSelection === undefined ? {} : { modelSelection: fields.modelSelection }),
		stops
	};
}

export async function readGuide(gitDir: string, source: string): Promise<Guide | null> {
	try {
		return JSON.parse(await readFile(guidePath(gitDir, source), "utf8")) as Guide;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export async function writeGuide(gitDir: string, source: string, guide: Guide): Promise<void> {
	await writeFileAtomic(guidePath(gitDir, source), JSON.stringify(guide, null, "\t"));
}

export async function clearGuide(gitDir: string, source: string): Promise<boolean> {
	try {
		await rm(guidePath(gitDir, source));
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function guidePath(gitDir: string, source: string): string {
	return join(commentsDir(gitDir), `guide-${source}.json`);
}

function parseStop(value: unknown, where: string): GuideStop {
	const field = <T>(parse: () => T): T => within(where, parse);
	const fields = field(() => object(value, ""));
	return {
		title: field(() => text(fields.title, "title")),
		summary: field(() => string(fields.summary, "summary")),
		attention: field(() => (fields.attention === null ? null : parseAttention(fields.attention))),
		excerpts: list(fields.excerpts, where, "excerpts", "excerpt", parseExcerpt),
		files: list(fields.files, where, "files", "file", parseFile),
		notes: list(fields.notes, where, "notes", "note", parseNote),
		questions: list(fields.questions, where, "questions", "question", (question) => text(question, "question", ""))
	};
}

function parseAttention(value: unknown): GuideStop["attention"] {
	const fields = object(value, "attention ");
	const kind = ATTENTION_KINDS.find((candidate) => candidate === fields.kind);
	if (!kind) throw new Error(`attention kind must be one of ${ATTENTION_KINDS.join(", ")}`);
	return { kind, note: text(fields.note, "attention note") };
}

function parseExcerpt(value: unknown): GuideExcerpt {
	const fields = object(value, "");
	if (fields.side !== "old" && fields.side !== "new") throw new Error('side must be "old" or "new"');
	const start = lineNumber(fields.start, "start");
	const end = lineNumber(fields.end, "end");
	if (end < start) throw new Error("end is before start");
	return { path: path(fields.path), side: fields.side, start, end, caption: string(fields.caption, "caption") };
}

function parseFile(value: unknown): GuideFile {
	const fields = object(value, "");
	if (fields.note === undefined) return { path: path(fields.path) };
	return { path: path(fields.path), note: string(fields.note, "note") };
}

function parseNote(value: unknown): GuideNote {
	const fields = object(value, "");
	return {
		path: path(fields.path),
		line: lineNumber(fields.line, "line"),
		title: text(fields.title, "title"),
		body: string(fields.body, "body")
	};
}

function list<T>(value: unknown, where: string, name: string, item: string, parse: (value: unknown) => T): T[] {
	const entries = within(where, () => array(value, name));
	return entries.map((entry, index) => within(`${where}, ${item} ${index + 1}`, () => parse(entry)));
}

function within<T>(where: string, parse: () => T): T {
	try {
		return parse();
	} catch (error) {
		throw new Error(`${where}: ${(error as Error).message}`);
	}
}

function object(value: unknown, label: string): Fields {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}must be an object`);
	return value as Fields;
}

function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
	return value;
}

function string(value: unknown, name: string): string {
	if (typeof value !== "string") throw new Error(`${name} must be a string`);
	return value;
}

function text(value: unknown, name: string, label = `${name} `): string {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${label}must be a non-empty string`);
	return value;
}

function lineNumber(value: unknown, name: string): number {
	if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${name} must be a positive whole number`);
	return value as number;
}

function path(value: unknown): string {
	return parsePath(string(value, "path"));
}
