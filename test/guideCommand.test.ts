import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_FILE_LINES, findGitDir } from "../src/git.ts";
import { readGuide } from "../src/guide.ts";
import { saveGuide } from "../src/guideCommand.ts";
import { git, makeWorkingRepo, write } from "./helpers.ts";

interface Outcome {
	message: string;
	stored: unknown;
}

async function save(repo: string, guide: unknown): Promise<Outcome> {
	const gitDir = (await findGitDir(repo))!;
	let message: string;
	try {
		message = await saveGuide(repo, gitDir, "working", typeof guide === "string" ? guide : JSON.stringify(guide));
	} catch (error) {
		message = `error: ${(error as Error).message}`;
	}
	return { message, stored: await readGuide(gitDir, "working") };
}

function onHead(repo: string, stop: Record<string, unknown>): unknown {
	const empty = { title: "t", summary: "", attention: null, excerpts: [], files: [], notes: [], questions: [] };
	return { headSha: git(repo, "rev-parse", "HEAD").trim(), stops: [{ ...empty, ...stop }] };
}

test("a malformed guide writes nothing", async () => {
	const repo = makeWorkingRepo();
	assert.deepEqual(await save(repo, '{"headSha":"a"}'), { message: "error: stops must be an array", stored: null });
});

test("a guide for the current head that fits the diff is written", async () => {
	const repo = makeWorkingRepo();
	const guide = onHead(repo, {
		excerpts: [
			{ path: "mod.txt", side: "new", start: 1, end: 3, caption: "" },
			{ path: "del.txt", side: "old", start: 1, end: 1, caption: "" }
		],
		files: [{ path: "new.txt" }],
		notes: [{ path: "mod.txt", line: 2, title: "B", body: "" }]
	});
	assert.deepEqual(await save(repo, guide), { message: "guide written: working (1 stop)", stored: guide });
});

test("a guide for the current head is checked against the diff and refused whole", async () => {
	const repo = makeWorkingRepo();
	const cases: Record<string, unknown>[] = [
		{ files: [{ path: "nope.txt" }] },
		{ excerpts: [{ path: "mod.txt", side: "new", start: 1, end: 1, caption: "" }] },
		{ excerpts: [{ path: "new.txt", side: "new", start: 1, end: 5, caption: "" }] },
		{ notes: [{ path: "mod.txt", line: 9, title: "t", body: "" }] }
	];
	const outcomes: Outcome[] = [];
	for (const stop of cases) outcomes.push(await save(repo, onHead(repo, stop)));
	assert.deepEqual(outcomes, [
		{ message: "error: stop 1, file 1: nope.txt is not in this view", stored: null },
		{ message: "error: stop 1, excerpt 1: lines 1-1 of mod.txt touch no change on the new side", stored: null },
		{
			message: "error: stop 1, excerpt 1: lines 1-5 of new.txt are past the end of the new side (2 lines)",
			stored: null
		},
		{ message: "error: stop 1, note 1: line 9 is past the end of mod.txt (3 lines)", stored: null }
	]);
});

test("excerpts and notes on a binary file are not checked against its lines", async () => {
	const repo = makeWorkingRepo();
	write(repo, "blob.bin", "abc\0def");
	const guide = onHead(repo, {
		excerpts: [{ path: "blob.bin", side: "new", start: 40, end: 50, caption: "" }],
		notes: [{ path: "blob.bin", line: 99, title: "t", body: "" }]
	});
	assert.deepEqual(await save(repo, guide), { message: "guide written: working (1 stop)", stored: guide });
});

test("excerpts on a file too large to show are not checked against its lines", async () => {
	const repo = makeWorkingRepo();
	write(repo, "big.txt", "x\n".repeat(MAX_FILE_LINES + 1));
	const range = { start: MAX_FILE_LINES + 100, end: MAX_FILE_LINES + 101 };
	const guide = onHead(repo, { excerpts: [{ path: "big.txt", side: "new", ...range, caption: "" }] });
	assert.deepEqual(await save(repo, guide), { message: "guide written: working (1 stop)", stored: guide });
});

test("a guide for another head is written without the diff check, with a warning", async () => {
	const repo = makeWorkingRepo();
	const head = git(repo, "rev-parse", "HEAD").trim();
	const guide = { headSha: "15dbb9fe859433c41747266a0e365036c21fb07d", stops: [] };
	assert.deepEqual(await save(repo, guide), {
		message: `guide written: working (0 stops), written for 15dbb9f but the view is at ${head.slice(0, 7)}: shown as stale`,
		stored: guide
	});
});
