import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOverviewArgs } from "../src/overviewCommand.ts";

test("defaults to the working source and writes", () => {
	assert.deepEqual(parseOverviewArgs([]), { kind: "write", source: "working" });
});

test("--branch and a PR number pick the source", () => {
	assert.deepEqual(parseOverviewArgs(["--branch"]), { kind: "write", source: "branch" });
	assert.deepEqual(parseOverviewArgs(["627"]), { kind: "write", source: "pr-627" });
});

test("--clear works with every source", () => {
	assert.deepEqual(parseOverviewArgs(["--clear"]), { kind: "clear", source: "working" });
	assert.deepEqual(parseOverviewArgs(["--clear", "--branch"]), { kind: "clear", source: "branch" });
	assert.deepEqual(parseOverviewArgs(["12", "--clear"]), { kind: "clear", source: "pr-12" });
});

test("bad args are errors", () => {
	assert.throws(() => parseOverviewArgs(["--nope"]), /unknown flag/);
	assert.throws(() => parseOverviewArgs(["1", "2"]), /too many/);
	assert.throws(() => parseOverviewArgs(["abc"]), /bad PR number/);
	assert.throws(() => parseOverviewArgs(["--branch", "5"]), /not both/);
});
