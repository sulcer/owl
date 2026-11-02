import type { Comment } from "../comments.ts";
import { renderNotes } from "./overviewNotes.ts";
import { parseCodeLink } from "../shared/codeLink.ts";
import type { CodeLink } from "../shared/codeLink.ts";

export interface OpenLink extends CodeLink {
	old: boolean;
}

export interface OverviewHandlers {
	hasFile: (path: string) => boolean;
	onOpen: (link: OpenLink) => void;
	onOpenComment: (comment: Comment) => void;
	onKey: (event: KeyboardEvent) => void;
}

export interface OverviewFrame {
	render(html: string): void;
	show(): void;
	hide(): void;
	setReviews(reviews: Comment[]): void;
	stepNote(direction: 1 | -1): void;
}

const FLASH_MS = 1000;
const NOT_IN_VIEW = "not in this view";

function buildDocument(fragment: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/client/overview.css"></head><body><article class="ov">${fragment}</article></body></html>`;
}

export function createOverviewFrame(container: HTMLElement, handlers: OverviewHandlers): OverviewFrame {
	const frame = document.createElement("iframe");
	frame.setAttribute("sandbox", "allow-same-origin");
	frame.hidden = true;
	container.append(frame);
	let top = 0;
	let reviews: Comment[] = [];
	let loaded = false;
	let noteIndex = -1;

	frame.addEventListener("load", () => {
		const doc = frame.contentDocument;
		if (!doc) return;
		wireCodeLinks(doc, handlers);
		wireExternalLinks(doc);
		loaded = true;
		applyNotes();
		doc.addEventListener("keydown", handlers.onKey);
		frame.contentWindow?.scrollTo(0, top);
	});

	function render(html: string): void {
		if (!frame.hidden) top = frame.contentWindow?.scrollY ?? top;
		loaded = false;
		frame.srcdoc = buildDocument(html);
	}

	function applyNotes(): void {
		const doc = frame.contentDocument;
		if (!loaded || !doc) return;
		noteIndex = -1;
		renderNotes(doc, reviews, handlers);
	}

	function setReviews(next: Comment[]): void {
		reviews = next;
		applyNotes();
	}

	function stepNote(direction: 1 | -1): void {
		const notes = frame.contentDocument?.querySelectorAll<HTMLElement>(".rnote[data-owl]") ?? [];
		const next = noteIndex + direction;
		if (next < 0 || next >= notes.length) return;
		noteIndex = next;
		flashNote(notes[next]);
	}

	function show(): void {
		container.hidden = false;
		frame.hidden = false;
		frame.contentWindow?.scrollTo(0, top);
	}

	function hide(): void {
		if (frame.hidden) return;
		top = frame.contentWindow?.scrollY ?? top;
		frame.hidden = true;
		container.hidden = true;
	}

	return { render, show, hide, setReviews, stepNote };
}

function wireCodeLinks(doc: Document, handlers: OverviewHandlers): void {
	for (const element of doc.querySelectorAll<HTMLElement>("[data-at]")) {
		const link = parseCodeLink(element.dataset.at ?? "");
		if (!link || !handlers.hasFile(link.path)) {
			element.classList.add("off");
			element.title = NOT_IN_VIEW;
			continue;
		}
		const old = element.hasAttribute("data-old");
		element.addEventListener("click", () => handlers.onOpen({ ...link, old }));
	}
}

function flashNote(note: HTMLElement): void {
	note.scrollIntoView({ block: "center" });
	note.classList.add("flash");
	setTimeout(() => note.classList.remove("flash"), FLASH_MS);
}

function wireExternalLinks(doc: Document): void {
	doc.addEventListener("click", (event) => {
		const anchor = (event.target as Element).closest("a");
		if (!anchor) return;
		event.preventDefault();
		const href = anchor.getAttribute("href") ?? "";
		if (href.startsWith("http")) window.open(href, "_blank");
		else if (href.startsWith("#")) scrollToAnchor(doc, href.slice(1));
	});
}

function scrollToAnchor(doc: Document, id: string): void {
	doc.getElementById(decodeURIComponent(id))?.scrollIntoView();
}
