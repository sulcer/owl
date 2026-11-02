import { REVIEW_KINDS } from "./reviewKinds.ts";
import type { ReviewKind } from "./reviewKinds.ts";

export interface PlacementLink {
	path: string;
	start: number;
	end: number;
	old: boolean;
}

export interface PlacementReview {
	path: string;
	side: "old" | "new";
	start: number;
	end: number;
	kind?: ReviewKind;
}

export type Placement = { how: "on" | "near"; link: number } | { how: "other" };

export interface PlacedReview<T> {
	review: T;
	placement: Placement;
}

const KIND_NAMES: Record<ReviewKind, [string, string]> = {
	fix: ["fix", "fixes"],
	question: ["question", "questions"],
	nit: ["nit", "nits"]
};

export function placeReviews<T extends PlacementReview>(links: PlacementLink[], comments: T[]): PlacedReview<T>[] {
	return comments
		.filter((comment) => comment.kind !== undefined)
		.sort((a, b) => kindRank(a) - kindRank(b))
		.map((review) => ({ review, placement: placeReview(links, review) }));
}

export function kindCountLabel(kind: ReviewKind, count: number): string {
	return `${count} ${KIND_NAMES[kind][count === 1 ? 0 : 1]}`;
}

function kindRank(review: PlacementReview): number {
	return review.kind ? REVIEW_KINDS.indexOf(review.kind) : REVIEW_KINDS.length;
}

function placeReview(links: PlacementLink[], review: PlacementReview): Placement {
	const on = bestIndex(links, (link) => (overlaps(review, link) ? link.end - link.start : null));
	if (on !== -1) return { how: "on", link: on };
	const near = bestIndex(links, (link) => (link.path === review.path ? distance(review, link) : null));
	if (near !== -1) return { how: "near", link: near };
	return { how: "other" };
}

function overlaps(review: PlacementReview, link: PlacementLink): boolean {
	if (link.path !== review.path || link.old !== (review.side === "old")) return false;
	return review.start <= link.end && link.start <= review.end;
}

function distance(review: PlacementReview, link: PlacementLink): number {
	return Math.max(link.start - review.end, review.start - link.end, 0);
}

function bestIndex(links: PlacementLink[], score: (link: PlacementLink) => number | null): number {
	let best = -1;
	let bestScore = Infinity;
	links.forEach((link, index) => {
		const value = score(link);
		if (value !== null && value < bestScore) {
			best = index;
			bestScore = value;
		}
	});
	return best;
}
