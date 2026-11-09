import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { git, makeTempDir, makeWorkingRepo } from "./helpers.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

function runCli(cwd: string, ...args: string[]) {
	return spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, ...args], { cwd, encoding: "utf8" });
}

test("outside a git repo exits 1 with the message", () => {
	const actual = runCli(makeTempDir(), "--no-open");
	assert.equal(actual.status, 1);
	assert.equal(actual.stderr, "owl: not a git repository\n");
});

test("unknown arguments print usage and exit 1", () => {
	const actual = runCli(makeTempDir(), "--nope");
	assert.equal(actual.status, 1);
	assert.match(actual.stderr, /^usage: owl/);
});

test("--help prints usage and exits 0", () => {
	const actual = runCli(makeTempDir(), "--help");
	assert.equal(actual.status, 0);
	assert.match(actual.stdout, /^usage: owl/);
});

test("runs from inside node_modules, where Node refuses to strip types", () => {
	const root = join(import.meta.dirname, "..");
	const installed = join(makeTempDir(), "node_modules", "owl");
	mkdirSync(installed, { recursive: true });
	for (const name of ["bin", "src", "package.json"])
		cpSync(join(root, name), join(installed, name), { recursive: true });
	const actual = spawnSync("node", [join(installed, "bin", "owl.js"), "--help"], {
		cwd: makeTempDir(),
		encoding: "utf8"
	});
	assert.equal(actual.status, 0);
	assert.match(actual.stdout, /^usage: owl/);
});

test("overview writes from stdin, then clears, in a real repo", () => {
	const repo = makeWorkingRepo();
	const written = spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "overview"], {
		cwd: repo,
		input: "<p>hello</p>",
		encoding: "utf8"
	});
	assert.equal(written.stdout, "overview written: working\n");
	assert.equal(runCli(repo, "overview", "--clear").stdout, "overview cleared: working\n");
	const again = runCli(repo, "overview", "--clear");
	assert.equal(again.status, 0);
	assert.equal(again.stdout, "no overview: working\n");
});

test("overview with bad args prints usage and exits 1; outside a repo says so", () => {
	const bad = runCli(makeTempDir(), "overview", "--nope");
	assert.equal(bad.status, 1);
	assert.match(bad.stderr, /usage: owl/);
	const outside = runCli(makeTempDir(), "overview", "--clear");
	assert.equal(outside.status, 1);
	assert.equal(outside.stderr, "owl: not a git repository\n");
});

test("guide writes from stdin, rejects a bad one with exit 1, then clears, in a real repo", () => {
	const repo = makeWorkingRepo();
	const guide = (input: string) =>
		spawnSync("node", ["--disable-warning=ExperimentalWarning", CLI, "guide"], { cwd: repo, input, encoding: "utf8" });
	const written = guide(JSON.stringify({ headSha: git(repo, "rev-parse", "HEAD").trim(), stops: [] }));
	const bad = guide("{}");
	assert.deepEqual(
		[written.stdout, bad.status, bad.stderr, runCli(repo, "guide", "--clear").stdout],
		["guide written: working (0 stops)\n", 1, "owl: headSha must be a non-empty string\n", "guide cleared: working\n"]
	);
});
