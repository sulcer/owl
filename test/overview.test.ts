import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { commentsDir } from "../src/comments.ts";
import { MAX_OVERVIEW_BYTES, clearOverview, readOverview, writeOverview } from "../src/overview.ts";
import { makeTempDir } from "./helpers.ts";

test("missing overview reads as null", async () => {
	assert.equal(await readOverview(makeTempDir(), "working"), null);
});

test("write then read returns the page, and leaves no temp file", async () => {
	const gitDir = makeTempDir();
	await writeOverview(gitDir, "working", "<h1>hi</h1>");
	assert.equal(await readOverview(gitDir, "working"), "<h1>hi</h1>");
	assert.deepEqual(readdirSync(commentsDir(gitDir)), ["overview-working.html"]);
});

test("write replaces the earlier page", async () => {
	const gitDir = makeTempDir();
	await writeOverview(gitDir, "branch", "one");
	await writeOverview(gitDir, "branch", "two");
	assert.equal(await readOverview(gitDir, "branch"), "two");
});

test("sources are stored separately", async () => {
	const gitDir = makeTempDir();
	await writeOverview(gitDir, "working", "w");
	await writeOverview(gitDir, "pr-7", "p");
	assert.equal(await readOverview(gitDir, "working"), "w");
	assert.equal(await readOverview(gitDir, "pr-7"), "p");
	assert.equal(await readOverview(gitDir, "branch"), null);
});

test("clear removes the page and reports whether one existed", async () => {
	const gitDir = makeTempDir();
	await writeOverview(gitDir, "working", "x");
	assert.equal(await clearOverview(gitDir, "working"), true);
	assert.equal(existsSync(commentsDir(gitDir) + "/overview-working.html"), false);
	assert.equal(await clearOverview(gitDir, "working"), false);
});

test("empty and whitespace-only input is refused", async () => {
	const gitDir = makeTempDir();
	await assert.rejects(writeOverview(gitDir, "working", ""), /empty/);
	await assert.rejects(writeOverview(gitDir, "working", " \n\t "), /empty/);
	assert.equal(await readOverview(gitDir, "working"), null);
});

test("input over 300 KB is refused, measured in bytes", async () => {
	const gitDir = makeTempDir();
	await writeOverview(gitDir, "working", "a".repeat(MAX_OVERVIEW_BYTES));
	await assert.rejects(writeOverview(gitDir, "working", "a".repeat(MAX_OVERVIEW_BYTES + 1)), /300 KB/);
	await assert.rejects(writeOverview(gitDir, "working", "é".repeat(MAX_OVERVIEW_BYTES / 2 + 1)), /300 KB/);
});
