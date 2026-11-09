import assert from "node:assert/strict";
import { test } from "node:test";
import { parseViewArgs } from "../src/viewArgs.ts";
import { errorMessage } from "./helpers.ts";

test("owl overview and owl guide take a view and --clear", () => {
	const actual = [[], ["--branch"], ["627"], ["--clear"], ["--clear", "--branch"], ["12", "--clear"]].map(
		parseViewArgs
	);
	assert.deepEqual(actual, [
		{ kind: "write", source: "working" },
		{ kind: "write", source: "branch" },
		{ kind: "write", source: "pr-627" },
		{ kind: "clear", source: "working" },
		{ kind: "clear", source: "branch" },
		{ kind: "clear", source: "pr-12" }
	]);
});

test("bad view args are errors", () => {
	assert.deepEqual(
		[["--nope"], ["1", "2"], ["abc"], ["--branch", "5"]].map((args) => errorMessage(() => parseViewArgs(args))),
		["unknown flag: --nope", "too many arguments", "bad PR number: abc", "use either --branch or a PR number, not both"]
	);
});
