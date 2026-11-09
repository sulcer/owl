import type { FileDetail } from "../git.ts";
import type { GuideExcerpt } from "../guide.ts";
import { DIFF_SIGNS, excerptProblem, excerptRows, rowText } from "../shared/guide-tour.ts";
import type { ExcerptRow } from "../shared/guide-tour.ts";
import type { Side } from "../shared/scroll.ts";
import { escapeHtml } from "../shared/markdown.ts";
import { highlightLines } from "./highlight.ts";
import type { OpenLink } from "./overview.ts";

interface ExcerptMarker {
	line: number;
	letter: string;
	title: string;
}

const highlighted = new WeakMap<FileDetail, { old: string[]; new: string[] }>();

export function renderExcerptBody(
	box: HTMLElement,
	excerpt: GuideExcerpt,
	detail: FileDetail | null,
	markers: ExcerptMarker[],
	onOpen: (link: OpenLink) => void
): void {
	const open = (old: boolean, line: number): void => onOpen({ path: excerpt.path, start: line, end: line, old });
	if (detail === null) return box.replaceChildren(message(`${excerpt.path} could not be loaded.`));
	if ("binary" in detail) return box.replaceChildren(message(`${excerpt.path} is binary.`));
	if (!("chunks" in detail)) return box.replaceChildren(message(`${excerpt.path} is too large to show.`));
	const problem = excerptProblem(detail, excerpt);
	if (problem) {
		const lines = `Lines ${excerpt.start}–${excerpt.end}`;
		return box.replaceChildren(
			message(`${lines} no longer match this diff: they ${problem}. Open the file to read it as it is now.`)
		);
	}
	const rows = excerptRows(detail, excerpt);
	if (rows.length === 0)
		return box.replaceChildren(message(`Lines ${excerpt.start}–${excerpt.end} are not in the file.`));
	const lines = highlightedLines(detail);
	const code = document.createElement("div");
	code.className = "excerpt-code";
	code.innerHTML = rows.map((row) => rowHtml(row, lines, excerpt.side, markers)).join("");
	code.addEventListener("click", (event) => {
		const num = (event.target as Element).closest<HTMLElement>(".num[data-n]");
		if (num) open(num.dataset.side === "old", Number(num.dataset.n));
	});
	box.replaceChildren(code);
}

function highlightedLines(detail: FileDetail & { oldText: string; newText: string }): { old: string[]; new: string[] } {
	let lines = highlighted.get(detail);
	if (!lines) {
		lines = { old: highlightLines(detail.oldText, detail.oldPath), new: highlightLines(detail.newText, detail.path) };
		highlighted.set(detail, lines);
	}
	return lines;
}

function rowHtml(
	row: ExcerptRow,
	lines: { old: string[]; new: string[] },
	side: Side,
	markers: ExcerptMarker[]
): string {
	const tint = row.kind === "context" ? "" : ` k-${row.kind}`;
	const line = side === "old" ? row.oldLine : row.newLine;
	const marks = markers
		.filter((marker) => marker.line === line)
		.map((marker) => `<span class="note-marker" title="${escapeHtml(marker.title)}">${marker.letter}</span>`)
		.join("");
	return (
		`<div class="line${tint}">${number(row.oldLine, "old")}${number(row.newLine, "new")}` +
		`<span class="sign">${DIFF_SIGNS[row.kind]}</span><span class="code">${rowText(row, lines.old, lines.new)}</span>${marks}</div>`
	);
}

function number(line: number | null, side: Side): string {
	if (line === null) return `<span class="num"></span>`;
	return `<span class="num" data-side="${side}" data-n="${line}" title="open at line ${line}"></span>`;
}

function message(text: string): HTMLElement {
	const note = document.createElement("div");
	note.className = "excerpt-missing";
	note.textContent = text;
	return note;
}
