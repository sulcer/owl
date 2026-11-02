import type { Comment } from "../comments.ts";
import { renderMarkdown } from "../shared/markdown.ts";
import { kindCountLabel, placeReviews } from "../shared/review-placement.ts";
import type { PlacementLink } from "../shared/review-placement.ts";
import { parseCodeLink } from "../shared/codeLink.ts";
import { REVIEW_KINDS } from "../shared/reviewKinds.ts";
import type { ReviewKind } from "../shared/reviewKinds.ts";
import { splitReviewText } from "../shared/reviewText.ts";

export interface NoteHandlers {
	hasFile: (path: string) => boolean;
	onOpenComment: (comment: Comment) => void;
}

interface LinkTarget {
	element: HTMLElement;
	link: PlacementLink;
}

const NOT_IN_VIEW = "not in this view";

export function renderNotes(doc: Document, reviews: Comment[], handlers: NoteHandlers): void {
	for (const old of doc.querySelectorAll("[data-owl]")) old.remove();
	const article = doc.querySelector<HTMLElement>("article.ov");
	if (!article || reviews.length === 0) return;
	const targets = pageLinkTargets(doc);
	const placed = placeReviews(
		targets.map((target) => target.link),
		reviews
	);
	for (const { review, placement } of placed) {
		const target = placement.how === "other" ? undefined : targets[placement.link];
		const block = target && blockOf(target.element, article);
		const container = block ? notesAfter(doc, block) : otherNotes(doc, article);
		container.append(createNote(doc, review, target, placement.how === "near", handlers));
	}
	addSectionBadges(doc, article);
	addSummaryLine(
		doc,
		article,
		placed.map((item) => item.review.kind as ReviewKind)
	);
}

function owlElement(doc: Document, tag: string, className = "", text = ""): HTMLElement {
	const created = doc.createElement(tag);
	created.dataset.owl = "";
	created.className = className;
	created.textContent = text;
	return created;
}

function pageLinkTargets(doc: Document): LinkTarget[] {
	return [...doc.querySelectorAll<HTMLElement>("[data-at]")].flatMap((element) => {
		const parsed = parseCodeLink(element.dataset.at ?? "");
		return parsed ? [{ element, link: { ...parsed, old: element.hasAttribute("data-old") } }] : [];
	});
}

function blockOf(link: HTMLElement, article: HTMLElement): HTMLElement | null {
	let node = link;
	while (node.parentElement && node.parentElement !== article && node.parentElement.tagName !== "SECTION") {
		node = node.parentElement;
	}
	return node.parentElement ? node : null;
}

function notesAfter(doc: Document, block: HTMLElement): HTMLElement {
	const next = block.nextElementSibling;
	if (next?.matches(".notes[data-owl]")) return next as HTMLElement;
	const notes = owlElement(doc, "div", "notes");
	block.after(notes);
	return notes;
}

function otherNotes(doc: Document, article: HTMLElement): HTMLElement {
	const existing = article.querySelector<HTMLElement>("section.other[data-owl] .notes");
	if (existing) return existing;
	const section = owlElement(doc, "section", "other");
	const notes = owlElement(doc, "div", "notes");
	section.append(owlElement(doc, "h2", "", "Other review notes"), notes);
	article.append(section);
	return notes;
}

function createNote(
	doc: Document,
	review: Comment,
	target: LinkTarget | undefined,
	isNear: boolean,
	handlers: NoteHandlers
): HTMLElement {
	const kind = review.kind as ReviewKind;
	const { title, body } = splitReviewText(review.text);
	const note = owlElement(doc, "div", `rnote ${kind}`);
	const head = owlElement(doc, "div", "rhead");
	head.append(owlElement(doc, "span", `kind ${kind}`, kind), owlElement(doc, "b", "", title));
	note.append(head);
	if (body) note.append(renderBody(doc, body));
	note.append(createFooter(doc, review, aboutText(review, target, isNear), handlers));
	return note;
}

function renderBody(doc: Document, body: string): HTMLElement {
	const element = owlElement(doc, "div", "body");
	element.innerHTML = renderMarkdown(body);
	return element;
}

function aboutText(review: Comment, target: LinkTarget | undefined, isNear: boolean): string {
	if (!target) return "";
	if (isNear) return `elsewhere in ${review.path.split("/").pop()}`;
	const card = target.element.closest(".card");
	const label = card?.querySelector("b")?.textContent ?? target.element.textContent;
	return `on “${(label ?? "").trim()}”`;
}

function createFooter(doc: Document, review: Comment, about: string, handlers: NoteHandlers): HTMLElement {
	const footer = owlElement(doc, "div", "rfoot");
	const range = review.end > review.start ? `${review.start}-${review.end}` : `${review.start}`;
	const link = owlElement(doc, "span", "", `${review.path.split("/").pop()}:${range}`);
	link.dataset.at = `${review.path}:${range}`;
	if (review.side === "old") link.dataset.old = "";
	if (handlers.hasFile(review.path)) link.addEventListener("click", () => handlers.onOpenComment(review));
	else {
		link.classList.add("off");
		link.title = NOT_IN_VIEW;
	}
	footer.append(link, owlElement(doc, "span", "about", about));
	return footer;
}

function addSectionBadges(doc: Document, article: HTMLElement): void {
	for (const section of article.querySelectorAll("section:not(.other)")) {
		const kinds = [...section.querySelectorAll(".rnote")].map((note) => noteKind(note));
		const worst = REVIEW_KINDS.find((kind) => kinds.includes(kind));
		if (worst) section.querySelector("h2")?.append(owlElement(doc, "span", `badge ${worst}`, String(kinds.length)));
	}
}

function noteKind(note: Element): ReviewKind | undefined {
	return REVIEW_KINDS.find((kind) => note.classList.contains(kind));
}

function addSummaryLine(doc: Document, article: HTMLElement, kinds: ReviewKind[]): void {
	const line = owlElement(doc, "div", "review-line");
	line.append(owlElement(doc, "b", "", "Review"));
	for (const kind of REVIEW_KINDS) {
		const count = kinds.filter((each) => each === kind).length;
		if (count) line.append(owlElement(doc, "span", `kind ${kind}`, kindCountLabel(kind, count)));
	}
	line.append(owlElement(doc, "span", "", "shown in the sections below · ] / [ step through them"));
	const lead = article.querySelector(".lead");
	if (lead) lead.after(line);
	else article.prepend(line);
}
