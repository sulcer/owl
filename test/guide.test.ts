import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { commentsDir } from "../src/comments.ts";
import { MAX_GUIDE_BYTES, clearGuide, parseGuide, readGuide, writeGuide } from "../src/guide.ts";
import type { Guide } from "../src/guide.ts";
import { errorMessage, makeTempDir } from "./helpers.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "guides");

const MINIMAL: Guide = {
	headSha: "abc123",
	stops: [
		{
			title: "Context",
			summary: "",
			attention: null,
			excerpts: [],
			files: [],
			notes: [],
			questions: []
		}
	]
};

function stop(fields: Record<string, unknown>): string {
	return JSON.stringify({ headSha: "abc", stops: [{ ...MINIMAL.stops[0], ...fields }] });
}

test("every T3-shaped guide fixture parses unchanged", () => {
	for (const name of readdirSync(FIXTURES)) {
		const raw = readFileSync(join(FIXTURES, name), "utf8");
		assert.deepEqual(parseGuide(raw), JSON.parse(raw), name);
	}
});

test("a minimal guide with only headSha and stops parses", () => {
	assert.deepEqual(parseGuide(JSON.stringify(MINIMAL)), MINIMAL);
});

test("an empty tour parses", () => {
	assert.deepEqual(parseGuide('{"headSha":"abc","stops":[]}'), { headSha: "abc", stops: [] });
});

test("the read_pull_request_guide result is unwrapped", () => {
	const wrapped = JSON.stringify({ host: "github.com", guide: MINIMAL, run: null, currentHeadSha: "abc123" });
	assert.deepEqual(parseGuide(wrapped), MINIMAL);
});

test("unknown keys are dropped, T3's generatedAt and modelSelection are kept", () => {
	const input = { ...MINIMAL, generatedAt: "2026-11-07T17:00:00.000Z", modelSelection: { model: "m" }, extra: 1 };
	assert.deepEqual(parseGuide(JSON.stringify(input)), {
		...MINIMAL,
		generatedAt: "2026-11-07T17:00:00.000Z",
		modelSelection: { model: "m" }
	});
});

test("a ./ prefix on a path is removed", () => {
	const actual = parseGuide(stop({ files: [{ path: "./a.ts" }] }));
	assert.deepEqual(actual, { headSha: "abc", stops: [{ ...MINIMAL.stops[0], files: [{ path: "a.ts" }] }] });
});

test("bad input names the stop and the item, counting from 1", () => {
	const excerpt = { path: "a.ts", side: "new", start: 1, end: 2, caption: "" };
	const inputs = [
		"nope",
		"[]",
		'{"stops":[]}',
		'{"headSha":"a"}',
		'{"headSha":"a","stops":[1]}',
		stop({ title: " " }),
		stop({ summary: 3 }),
		stop({ attention: { kind: "vibes", note: "x" } }),
		stop({ attention: { kind: "risk", note: "" } }),
		stop({ excerpts: [{ ...excerpt, side: "both" }] }),
		stop({ excerpts: [{ ...excerpt, start: 5 }] }),
		stop({ excerpts: [{ ...excerpt, start: 0 }] }),
		stop({ excerpts: [{ ...excerpt, caption: undefined }] }),
		stop({ files: [{ path: "../etc/passwd" }] }),
		stop({ files: [{ path: "/abs" }] }),
		stop({ files: [{ path: "a.ts", note: 1 }] }),
		stop({ notes: [{ path: "a.ts", line: 1.5, title: "t", body: "" }] }),
		stop({ notes: [{ path: "a.ts", line: 1, title: "", body: "" }] }),
		stop({ questions: [""] }),
		stop({ questions: "why" }),
		JSON.stringify({ ...MINIMAL, pad: "é".repeat(MAX_GUIDE_BYTES / 2) })
	];
	assert.deepEqual(
		inputs.map((input) => errorMessage(() => parseGuide(input))),
		[
			"guide is not valid JSON",
			"guide must be an object",
			"headSha must be a non-empty string",
			"stops must be an array",
			"stop 1: must be an object",
			"stop 1: title must be a non-empty string",
			"stop 1: summary must be a string",
			"stop 1: attention kind must be one of tradeoff, contract, product, risk, accessibility",
			"stop 1: attention note must be a non-empty string",
			'stop 1, excerpt 1: side must be "old" or "new"',
			"stop 1, excerpt 1: end is before start",
			"stop 1, excerpt 1: start must be a positive whole number",
			"stop 1, excerpt 1: caption must be a string",
			'stop 1, file 1: path must not contain "..": ../etc/passwd',
			"stop 1, file 1: path must be relative: /abs",
			"stop 1, file 1: note must be a string",
			"stop 1, note 1: line must be a positive whole number",
			"stop 1, note 1: title must be a non-empty string",
			"stop 1, question 1: must be a non-empty string",
			"stop 1: questions must be an array",
			"guide is larger than 300 KB"
		]
	);
});

test("missing guide reads as null", async () => {
	assert.equal(await readGuide(makeTempDir(), "working"), null);
});

test("write then read returns the guide, per source, and leaves no temp file", async () => {
	const gitDir = makeTempDir();
	await writeGuide(gitDir, "pr-7", MINIMAL);
	assert.deepEqual(
		{
			pr: await readGuide(gitDir, "pr-7"),
			branch: await readGuide(gitDir, "branch"),
			files: readdirSync(commentsDir(gitDir))
		},
		{ pr: MINIMAL, branch: null, files: ["guide-pr-7.json"] }
	);
});

test("clear removes the guide and reports whether one existed", async () => {
	const gitDir = makeTempDir();
	await writeGuide(gitDir, "working", MINIMAL);
	assert.deepEqual(
		[await clearGuide(gitDir, "working"), await clearGuide(gitDir, "working"), await readGuide(gitDir, "working")],
		[true, false, null]
	);
});

test("clear removes a guide file that is not valid JSON", async () => {
	const gitDir = makeTempDir();
	mkdirSync(commentsDir(gitDir), { recursive: true });
	writeFileSync(join(commentsDir(gitDir), "guide-working.json"), "{bad");
	assert.deepEqual([await clearGuide(gitDir, "working"), readdirSync(commentsDir(gitDir))], [true, []]);
});
