import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_FILE_CHARS, MAX_FILE_LINES, readFileDetail, readSources, resolveSource } from "../src/git.ts";
import { WORKING_FILES, commitAll, git, makeRepoWithOrigin, makeWorkingRepo, write } from "./helpers.ts";

function byPath(files: { path: string }[]): string[] {
	return files.map((file) => file.path).sort();
}

test("branch view lists only the branch's files, even when origin main moved on", async () => {
	const { seed, clone } = makeRepoWithOrigin();
	git(clone, "checkout", "-q", "-b", "feature");
	write(clone, "a.txt", "one\nTWO\nthree\n");
	write(clone, "b.txt", "new\n");
	commitAll(clone, "feature work");
	write(seed, "c.txt", "newer\n");
	commitAll(seed, "main moved");
	git(seed, "push", "-q", "origin", "main");
	git(clone, "fetch", "-q", "origin");

	const actual = await resolveSource(clone, "branch");

	assert.deepEqual(byPath(actual.files), ["a.txt", "b.txt"]);
	assert.equal(actual.commitCount, 1);
	const sources = await readSources(clone);
	assert.equal(sources.defaultBranch, "main");
	assert.deepEqual(sources.branchView, { commitCount: 1, fileCount: 2 });
	assert.ok(sources.prError);
});

test("branch view is empty on the default branch", async () => {
	const { clone } = makeRepoWithOrigin();
	const actual = await resolveSource(clone, "branch");
	assert.deepEqual(actual.files, []);
});

test("branch view file detail has chunks and word ranges", async () => {
	const { clone } = makeRepoWithOrigin();
	git(clone, "checkout", "-q", "-b", "feature");
	write(clone, "a.txt", "one\nTWO\nthree\n");
	commitAll(clone, "feature work");
	const source = await resolveSource(clone, "branch");

	const actual = await readFileDetail(clone, source, source.files[0]);

	assert.ok("chunks" in actual);
	assert.deepEqual(actual.chunks, [
		{ kind: "modified", oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 2, oldWords: [[1, 0, 3]], newWords: [[1, 0, 3]] }
	]);
});

test("working view details: untracked is all added, deleted is all deleted, modified has a chunk", async () => {
	const repo = makeWorkingRepo();
	const source = await resolveSource(repo, "working");
	const detail = (path: string) =>
		readFileDetail(
			repo,
			source,
			source.files.find((file) => file.path === path)!
		);

	const added = await detail("new.txt");
	const deleted = await detail("del.txt");
	const modified = await detail("mod.txt");
	const renamed = await detail("renamed.txt");

	assert.ok("chunks" in added && "chunks" in deleted && "chunks" in modified && "chunks" in renamed);
	assert.deepEqual(added.chunks, [{ kind: "added", oldStart: 0, oldEnd: 0, newStart: 0, newEnd: 2 }]);
	assert.deepEqual(deleted.chunks, [{ kind: "deleted", oldStart: 0, oldEnd: 1, newStart: 0, newEnd: 0 }]);
	assert.equal(modified.chunks[0].kind, "modified");
	assert.equal(modified.newText, "a\nB\nc\n");
	assert.equal(renamed.oldPath, "old.txt");
	assert.deepEqual(renamed.chunks, []);
});

test("binary file is flagged", async () => {
	const repo = makeWorkingRepo();
	write(repo, "blob.bin", "abc\0def");
	const source = await resolveSource(repo, "working");

	const actual = await readFileDetail(repo, source, { path: "blob.bin", status: "added" });

	assert.ok("binary" in actual && actual.binary);
});

test("too large file is flagged with line counts", async () => {
	const repo = makeWorkingRepo();
	write(repo, "big.txt", "x\n".repeat(MAX_FILE_LINES + 1));
	const source = await resolveSource(repo, "working");

	const actual = await readFileDetail(repo, source, { path: "big.txt", status: "added" });

	assert.deepEqual(actual, {
		path: "big.txt",
		oldPath: "big.txt",
		status: "added",
		tooLarge: { oldLines: 0, newLines: MAX_FILE_LINES + 1 }
	});
});

test("symlink in the working view shows the link target, not the target's content", async () => {
	const repo = makeWorkingRepo();
	symlinkSync("mod.txt", join(repo, "link"));
	const source = await resolveSource(repo, "working");

	const actual = await readFileDetail(repo, source, { path: "link", status: "added" });

	assert.ok("newText" in actual);
	assert.equal(actual.newText, "mod.txt");
});

function onHead(repo: string): { oldRef: string; newRef: null; head: string } {
	return { oldRef: "HEAD", newRef: null, head: git(repo, "rev-parse", "HEAD").trim() };
}

function sortedByPath<T extends { files: { path: string }[] }>(source: T): T {
	return { ...source, files: [...source.files].sort((a, b) => a.path.localeCompare(b.path)) };
}

test("working view compares HEAD with the disk, and its head is the HEAD commit", async () => {
	const repo = makeWorkingRepo();
	const actual = await resolveSource(repo, "working");
	assert.deepEqual(sortedByPath(actual), { ...onHead(repo), files: WORKING_FILES });
});

test("branch view counts lines per file and its head is HEAD", async () => {
	const { clone } = makeRepoWithOrigin();
	const base = git(clone, "rev-parse", "HEAD").trim();
	git(clone, "checkout", "-q", "-b", "feature");
	write(clone, "a.txt", "one\nTWO\nthree\nfour\n");
	write(clone, "b.txt", "new\nfile\n");
	commitAll(clone, "feature work");
	const head = git(clone, "rev-parse", "HEAD").trim();

	const actual = await resolveSource(clone, "branch");

	assert.deepEqual(actual, {
		oldRef: base,
		newRef: head,
		head,
		commitCount: 1,
		files: [
			{ path: "a.txt", status: "modified", additions: 2, deletions: 1 },
			{ path: "b.txt", status: "added", additions: 2, deletions: 0 }
		]
	});
});

test("a binary file has no line counts", async () => {
	const repo = makeWorkingRepo();
	write(repo, "blob.bin", "abc\0def");
	write(repo, "mod.txt", "a\0b\n");
	const actual = await resolveSource(repo, "working");
	assert.deepEqual(sortedByPath(actual), {
		...onHead(repo),
		files: [
			{ path: "blob.bin", status: "added" },
			WORKING_FILES[0],
			{ path: "mod.txt", status: "modified" },
			...WORKING_FILES.slice(2)
		]
	});
});

test("an untracked file that can't be read, like a nested repo, is listed without line counts", async () => {
	const repo = makeWorkingRepo();
	const nested = join(repo, "sub");
	git(repo, "init", "-q", nested);
	write(nested, "x.txt", "x\n");
	commitAll(nested, "nested");

	const actual = await resolveSource(repo, "working");

	assert.deepEqual(sortedByPath(actual), {
		...onHead(repo),
		files: [...WORKING_FILES, { path: "sub/", status: "added" }]
	});
});

test("an untracked file too big to ever show is listed without line counts, unread", async () => {
	const repo = makeWorkingRepo();
	write(repo, "huge.txt", "x".repeat(3 * MAX_FILE_CHARS + 1));

	const actual = await resolveSource(repo, "working");

	assert.deepEqual(sortedByPath(actual), {
		...onHead(repo),
		files: [...WORKING_FILES.slice(0, 1), { path: "huge.txt", status: "added" }, ...WORKING_FILES.slice(1)]
	});
});
