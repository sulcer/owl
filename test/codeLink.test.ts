import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCodeLink } from "../src/shared/codeLink.ts";

test("parses a single line", () => {
	assert.deepEqual(parseCodeLink("src/a.ts:12"), { path: "src/a.ts", start: 12, end: 12 });
});

test("parses a range", () => {
	assert.deepEqual(parseCodeLink("src/a.ts:12-20"), { path: "src/a.ts", start: 12, end: 20 });
});

test("keeps colons inside the path", () => {
	assert.deepEqual(parseCodeLink("a:b/c.ts:3"), { path: "a:b/c.ts", start: 3, end: 3 });
});

test("rejects a missing line, zero, a backwards range and an empty path", () => {
	for (const bad of ["src/a.ts", "src/a.ts:0", "src/a.ts:9-3", ":5", "src/a.ts:x", ""]) {
		assert.equal(parseCodeLink(bad), null, bad);
	}
});
