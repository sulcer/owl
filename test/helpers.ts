import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function makeTempDir(): string {
	return mkdtempSync(join(tmpdir(), "owl-test-"));
}

export function git(cwd: string, ...args: string[]): string {
	const env = {
		...process.env,
		GIT_AUTHOR_NAME: "t",
		GIT_AUTHOR_EMAIL: "t@t",
		GIT_COMMITTER_NAME: "t",
		GIT_COMMITTER_EMAIL: "t@t"
	};
	return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env, encoding: "utf8" });
}

export function write(repo: string, path: string, content: string): void {
	mkdirSync(dirname(join(repo, path)), { recursive: true });
	writeFileSync(join(repo, path), content);
}

export function commitAll(repo: string, message: string): void {
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", message);
}

export function makeRepoWithOrigin(): { seed: string; clone: string } {
	const root = makeTempDir();
	const origin = join(root, "origin.git");
	const seed = join(root, "seed");
	const clone = join(root, "clone");
	git(root, "init", "-q", "--bare", "-b", "main", origin);
	git(root, "init", "-q", "-b", "main", seed);
	write(seed, "a.txt", "one\ntwo\nthree\n");
	commitAll(seed, "first");
	git(seed, "remote", "add", "origin", origin);
	git(seed, "push", "-q", "origin", "main");
	git(root, "clone", "-q", origin, clone);
	return { seed, clone };
}

export function makeWorkingRepo(): string {
	const repo = makeTempDir();
	git(repo, "init", "-q", "-b", "main");
	const body = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") + "\n";
	write(repo, "mod.txt", "a\nb\nc\n");
	write(repo, "del.txt", "gone\n");
	write(repo, "old.txt", body);
	commitAll(repo, "first");
	write(repo, "mod.txt", "a\nB\nc\n");
	git(repo, "rm", "-q", "del.txt");
	git(repo, "mv", "old.txt", "renamed.txt");
	write(repo, "new.txt", "x\ny\n");
	return repo;
}

export const WORKING_FILES = [
	{ path: "del.txt", status: "deleted", additions: 0, deletions: 1 },
	{ path: "mod.txt", status: "modified", additions: 1, deletions: 1 },
	{ path: "new.txt", status: "added", additions: 2, deletions: 0 },
	{ path: "renamed.txt", oldPath: "old.txt", status: "renamed", additions: 0, deletions: 0 }
];

export function errorMessage(run: () => unknown): string {
	try {
		run();
		return "no error";
	} catch (error) {
		return (error as Error).message;
	}
}
