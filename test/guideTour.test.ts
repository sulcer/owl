import assert from "node:assert/strict";
import { test } from "node:test";
import type { Chunk } from "../src/shared/diff.ts";
import type { GuideStop } from "../src/guide.ts";
import {
	excerptDiff,
	excerptProblem,
	excerptRows,
	guideNoteCards,
	isSameHead,
	isStale,
	noteLetter,
	noteSide,
	stepStop,
	stopPaths,
	stopPrompt,
	stopSubline,
	uncoveredFiles
} from "../src/shared/guide-tour.ts";

const TEN = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
const MODIFIED: Chunk = { kind: "modified", oldStart: 3, oldEnd: 5, newStart: 3, newEnd: 4 };
const DELETED: Chunk = { kind: "deleted", oldStart: 7, oldEnd: 8, newStart: 6, newEnd: 6 };
const FILE = { oldText: TEN, newText: TEN.split("\n").slice(1).join("\n"), chunks: [MODIFIED, DELETED] };

test("an excerpt on changed lines, or with context around them, has no problem", () => {
	const problems = [
		excerptProblem(FILE, { side: "new", start: 4, end: 4 }),
		excerptProblem(FILE, { side: "new", start: 1, end: 6 }),
		excerptProblem(FILE, { side: "old", start: 4, end: 5 }),
		excerptProblem(FILE, { side: "old", start: 8, end: 8 })
	];
	assert.deepEqual(problems, [null, null, null, null]);
});

test("a range around a pure deletion touches it on the new side", () => {
	assert.equal(excerptProblem(FILE, { side: "new", start: 7, end: 7 }), null);
});

test("an excerpt on unchanged lines only says so", () => {
	assert.equal(excerptProblem(FILE, { side: "new", start: 1, end: 3 }), "touch no change on the new side");
});

test("an excerpt past the end of its side says how long that side is", () => {
	assert.equal(excerptProblem(FILE, { side: "new", start: 8, end: 12 }), "are past the end of the new side (9 lines)");
});

test("an abbreviated head of 7 or more characters matches the full one", () => {
	const head = "51836f2a9c0d4e1b8f7a6c5d4e3b2a1f0e9d8c7b";
	assert.deepEqual(
		[isSameHead(head, head), isSameHead("51836f2", head), isSameHead("51836f", head), isSameHead("15dbb9f", head)],
		[true, true, false, false]
	);
});

const EMPTY_STOP: GuideStop = {
	title: "t",
	summary: "",
	attention: null,
	excerpts: [],
	files: [],
	notes: [],
	questions: []
};

function excerptAt(path: string) {
	return { path, side: "new" as const, start: 1, end: 1, caption: "" };
}

test("a stop's paths are its excerpt and file paths, once each, in order", () => {
	const stop = {
		...EMPTY_STOP,
		excerpts: [excerptAt("b.ts"), excerptAt("a.ts"), excerptAt("b.ts")],
		files: [{ path: "c.md" }, { path: "a.ts" }]
	};
	assert.deepEqual(stopPaths(stop), ["b.ts", "a.ts", "c.md"]);
});

test("a stop's subline counts its files, or says it has no code", () => {
	assert.deepEqual(
		[
			stopSubline(EMPTY_STOP),
			stopSubline({ ...EMPTY_STOP, files: [{ path: "a" }] }),
			stopSubline({ ...EMPTY_STOP, excerpts: [excerptAt("a"), excerptAt("b")] })
		],
		["Context, no code", "1 file", "2 files"]
	);
});

test("note letters run A to Z, then numbers", () => {
	assert.deepEqual([noteLetter(0), noteLetter(25), noteLetter(26)], ["A", "Z", "27"]);
});

test("stepping stops stays inside the tour", () => {
	assert.deepEqual(
		[stepStop(0, -1, 5), stepStop(0, 1, 5), stepStop(4, 1, 5), stepStop(2, -1, 5), stepStop(0, 1, 0)],
		[0, 1, 4, 1, 0]
	);
});

// old: a b c d e f g h      new: a B C d f g X h
// chunks: modified b-c -> B-C, deleted e, added X after g
const ROWS_FILE = {
	oldText: "a\nb\nc\nd\ne\nf\ng\nh\n",
	newText: "a\nB\nC\nd\nf\ng\nX\nh\n",
	chunks: [
		{ kind: "modified", oldStart: 1, oldEnd: 3, newStart: 1, newEnd: 3 },
		{ kind: "deleted", oldStart: 4, oldEnd: 5, newStart: 4, newEnd: 4 },
		{ kind: "added", oldStart: 7, oldEnd: 7, newStart: 6, newEnd: 7 }
	] satisfies Chunk[]
};

test("a new-side excerpt pulls in the removed lines just before its changes", () => {
	assert.deepEqual(excerptRows(ROWS_FILE, { side: "new", start: 1, end: 5 }), [
		{ kind: "context", oldLine: 1, newLine: 1 },
		{ kind: "deleted", oldLine: 2, newLine: null },
		{ kind: "deleted", oldLine: 3, newLine: null },
		{ kind: "modified", oldLine: null, newLine: 2 },
		{ kind: "modified", oldLine: null, newLine: 3 },
		{ kind: "context", oldLine: 4, newLine: 4 },
		{ kind: "deleted", oldLine: 5, newLine: null },
		{ kind: "context", oldLine: 6, newLine: 5 }
	]);
});

test("a new-side excerpt starting inside a change still shows what it replaced", () => {
	assert.deepEqual(excerptRows(ROWS_FILE, { side: "new", start: 3, end: 3 }), [
		{ kind: "deleted", oldLine: 2, newLine: null },
		{ kind: "deleted", oldLine: 3, newLine: null },
		{ kind: "modified", oldLine: null, newLine: 3 }
	]);
});

test("an old-side excerpt follows each change with what replaced it", () => {
	assert.deepEqual(excerptRows(ROWS_FILE, { side: "old", start: 2, end: 8 }), [
		{ kind: "deleted", oldLine: 2, newLine: null },
		{ kind: "deleted", oldLine: 3, newLine: null },
		{ kind: "modified", oldLine: null, newLine: 2 },
		{ kind: "modified", oldLine: null, newLine: 3 },
		{ kind: "context", oldLine: 4, newLine: 4 },
		{ kind: "deleted", oldLine: 5, newLine: null },
		{ kind: "context", oldLine: 6, newLine: 5 },
		{ kind: "context", oldLine: 7, newLine: 6 },
		{ kind: "added", oldLine: null, newLine: 7 },
		{ kind: "context", oldLine: 8, newLine: 8 }
	]);
});

test("an old-side excerpt ending inside a change leaves out its replacement", () => {
	assert.deepEqual(excerptRows(ROWS_FILE, { side: "old", start: 2, end: 2 }), [
		{ kind: "deleted", oldLine: 2, newLine: null }
	]);
});

test("an excerpt past the end of its side stops at the last line", () => {
	assert.deepEqual(excerptRows(ROWS_FILE, { side: "new", start: 8, end: 20 }), [
		{ kind: "context", oldLine: 8, newLine: 8 }
	]);
});

test("a note takes the side of the excerpt holding its line, new when both or neither do", () => {
	const old = { path: "a.ts", side: "old" as const, start: 650, end: 665, caption: "" };
	const fresh = { path: "a.ts", side: "new" as const, start: 650, end: 651, caption: "" };
	const note = (line: number, path = "a.ts") => ({ path, line, title: "t", body: "" });
	const stop = { ...EMPTY_STOP, excerpts: [old, fresh] };
	assert.deepEqual(
		[
			noteSide(stop, note(650)),
			noteSide(stop, note(660)),
			noteSide(stop, note(700)),
			noteSide(stop, note(660, "b.ts"))
		],
		["new", "old", "new", "new"]
	);
});

test("files no stop names by excerpt, file or note are not on the tour, in the view's order", () => {
	const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map((path) => ({ path, status: "modified" as const }));
	const guide = {
		headSha: "h",
		stops: [
			{ ...EMPTY_STOP, excerpts: [excerptAt("b.ts")] },
			{ ...EMPTY_STOP, files: [{ path: "d.ts" }], notes: [{ path: "a.ts", line: 1, title: "t", body: "" }] }
		]
	};
	assert.deepEqual(uncoveredFiles(files, guide), [
		{ path: "c.ts", status: "modified" },
		{ path: "e.ts", status: "modified" }
	]);
});

test("guide notes become comment cards on the note's side, labeled with their stop", () => {
	const guide = {
		headSha: "h",
		generatedAt: "2026-11-07T17:06:07.016Z",
		stops: [
			{ ...EMPTY_STOP },
			{
				...EMPTY_STOP,
				excerpts: [{ path: "a.ts", side: "old" as const, start: 5, end: 9, caption: "" }],
				notes: [
					{ path: "a.ts", line: 7, title: "Removed write", body: "It raced." },
					{ path: "b.ts", line: 2, title: "Plain", body: "" }
				]
			}
		]
	};
	assert.deepEqual(guideNoteCards(guide, "pr-12", "2026-11-08T00:00:00.000Z"), [
		{
			id: "guide-2-1",
			source: "pr-12",
			path: "a.ts",
			side: "old",
			start: 7,
			end: 7,
			text: "**A. Removed write**\n\nIt raced.",
			createdAt: "2026-11-07T17:06:07.016Z",
			byline: "guide · stop 2"
		},
		{
			id: "guide-2-2",
			source: "pr-12",
			path: "b.ts",
			side: "new",
			start: 2,
			end: 2,
			text: "**B. Plain**",
			createdAt: "2026-11-07T17:06:07.016Z",
			byline: "guide · stop 2"
		}
	]);
});

test("a guide is stale only when the view's head is known and differs", () => {
	const guide = { headSha: "51836f2a9c0d4e1b8f7a6c5d4e3b2a1f0e9d8c7b", stops: [] };
	assert.deepEqual(
		[isStale(guide, ""), isStale(guide, guide.headSha), isStale(guide, "15dbb9fe859433c41747266a0e365036c21fb07d")],
		[false, false, true]
	);
});

test("an excerpt's diff text marks removed and added lines on either side, null when it no longer matches", () => {
	assert.deepEqual(
		[
			excerptDiff(ROWS_FILE, { side: "new", start: 1, end: 2 }),
			excerptDiff(ROWS_FILE, { side: "old", start: 7, end: 8 }),
			excerptDiff(ROWS_FILE, { side: "new", start: 1, end: 1 })
		],
		["  a\n- b\n- c\n+ B", "  g\n+ X\n  h", null]
	);
});

test("a stop becomes a prompt with its text, excerpts, notes, files and questions", () => {
	const stop: GuideStop = {
		title: "The parser refuses bad lines",
		summary: "It returns `null` now.",
		attention: { kind: "risk", note: "Callers see fewer rows." },
		excerpts: [
			{ path: "src/rates.ts", side: "new", start: 2, end: 3, caption: "The check" },
			{ path: "src/old.ts", side: "old", start: 4, end: 4, caption: "" }
		],
		files: [{ path: "README.md", note: "One sentence" }, { path: "test/a.ts" }],
		notes: [{ path: "src/rates.ts", line: 3, title: "Empty currency", body: "It is falsy." }],
		questions: ["Report bad lines?"]
	};
	const guide = { headSha: "51836f2a9c0d", stops: [EMPTY_STOP, stop] };
	const actual = stopPrompt(guide, 1, "PR #12 fix: skip bad lines", ["- a\n+ b", null]);
	assert.equal(
		actual,
		[
			"I'm reviewing PR #12 fix: skip bad lines with a review guide written for commit 51836f2.",
			"This is stop 2 of 2. Help me review it: check what it claims against the code, and answer its questions.",
			"",
			"## The parser refuses bad lines",
			"",
			"It returns `null` now.",
			"",
			"Look closely, a risk to judge: Callers see fewer rows.",
			"",
			"### Excerpts",
			"",
			"src/rates.ts, new lines 2-3: The check",
			"```diff",
			"- a",
			"+ b",
			"```",
			"",
			"src/old.ts, old lines 4-4",
			"(not shown: these lines no longer match the diff)",
			"",
			"### Notes",
			"",
			"A. src/rates.ts:3 Empty currency",
			"It is falsy.",
			"",
			"### Files",
			"",
			"- README.md: One sentence",
			"- test/a.ts",
			"",
			"### Questions",
			"",
			"- Report bad lines?"
		].join("\n")
	);
});
