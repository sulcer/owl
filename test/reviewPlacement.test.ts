import assert from "node:assert/strict";
import { test } from "node:test";
import { kindCountLabel, placeReviews } from "../src/shared/review-placement.ts";
import type { PlacementLink, PlacementReview } from "../src/shared/review-placement.ts";
import { splitReviewText } from "../src/shared/reviewText.ts";

function link(path: string, start: number, end: number, old = false): PlacementLink {
	return { path, start, end, old };
}

function review(
	path: string,
	start: number,
	end: number,
	kind: PlacementReview["kind"] = "fix",
	side: "old" | "new" = "new"
) {
	return { path, start, end, kind, side };
}

test("a review lands on the smallest overlapping link", () => {
	const links = [link("a.ts", 1, 100), link("a.ts", 10, 20)];
	assert.deepEqual(placeReviews(links, [review("a.ts", 12, 14)])[0].placement, { how: "on", link: 1 });
});

test("equal sizes go to the earlier link", () => {
	const links = [link("a.ts", 10, 20), link("a.ts", 12, 22)];
	assert.deepEqual(placeReviews(links, [review("a.ts", 15, 16)])[0].placement, { how: "on", link: 0 });
});

test("a side mismatch is not an overlap, so the review goes near", () => {
	const links = [link("a.ts", 10, 20, true)];
	assert.deepEqual(placeReviews(links, [review("a.ts", 12, 14)])[0].placement, { how: "near", link: 0 });
});

test("near picks the closest link on the same path, ties to the earlier", () => {
	const links = [link("b.ts", 50, 51), link("a.ts", 1, 5), link("a.ts", 21, 25), link("a.ts", 11, 15)];
	assert.deepEqual(placeReviews(links, [review("a.ts", 16, 16)])[0].placement, { how: "near", link: 3 });
	assert.deepEqual(placeReviews(links, [review("a.ts", 13, 13, "fix", "old")])[0].placement, { how: "near", link: 3 });
	const tied = [link("a.ts", 1, 5), link("a.ts", 15, 19)];
	assert.deepEqual(placeReviews(tied, [review("a.ts", 10, 10)])[0].placement, { how: "near", link: 0 });
});

test("no link on the path means other", () => {
	assert.deepEqual(placeReviews([link("b.ts", 1, 2)], [review("a.ts", 1, 2)])[0].placement, { how: "other" });
	assert.deepEqual(placeReviews([], [review("a.ts", 1, 2)])[0].placement, { how: "other" });
});

test("reviews are ordered by kind, then by given order; explanations are ignored", () => {
	const nit = review("a.ts", 1, 1, "nit");
	const fixOne = review("a.ts", 2, 2, "fix");
	const question = review("a.ts", 3, 3, "question");
	const fixTwo = review("a.ts", 4, 4, "fix");
	const explanation = { ...review("a.ts", 5, 5), kind: undefined };
	const placed = placeReviews([], [nit, fixOne, question, explanation, fixTwo]);
	assert.deepEqual(
		placed.map((item) => item.review),
		[fixOne, fixTwo, question, nit]
	);
});

test("kind labels pluralize", () => {
	assert.equal(kindCountLabel("fix", 1), "1 fix");
	assert.equal(kindCountLabel("fix", 2), "2 fixes");
	assert.equal(kindCountLabel("question", 2), "2 questions");
	assert.equal(kindCountLabel("nit", 1), "1 nit");
});

test("review text splits into title and body", () => {
	assert.deepEqual(splitReviewText("Title\n\nMore `code`\nlines"), { title: "Title", body: "More `code`\nlines" });
	assert.deepEqual(splitReviewText("  Only title "), { title: "Only title", body: "" });
});
