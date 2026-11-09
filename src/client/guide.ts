import type { ChangedFile, FileDetail } from "../git.ts";
import type { Guide, GuideNote, GuideStop } from "../guide.ts";
import {
	ATTENTION_LABELS,
	countOf,
	excerptDiff,
	isStale,
	noteLetter,
	noteSide,
	stepStop,
	stopPrompt,
	stopSubline,
	uncoveredFiles
} from "../shared/guide-tour.ts";
import { renderInlineMarkdown, renderMarkdown } from "../shared/markdown.ts";
import { renderExcerptBody } from "./guideExcerpt.ts";
import type { OpenLink } from "./overview.ts";

export interface GuideContext {
	source: string;
	files: ChangedFile[];
	head: string;
	label: string;
}

export interface GuideHandlers {
	onOpen: (link: OpenLink) => void;
	onOpenFile: (path: string) => void;
	onStopChange: () => void;
	onShowStop: (stop: number) => void;
	loadFile: (path: string) => Promise<FileDetail | null>;
}

export interface GuideView {
	stopList: HTMLElement;
	setGuide(guide: Guide | null, context: GuideContext): void;
	show(stop?: number): void;
	hide(): void;
	step(delta: 1 | -1): void;
	stop(): number;
	stopCount(): number;
	firstPath(): string | undefined;
	copyStop(): Promise<void>;
	reloadFiles(): void;
}

const READ_KEY = "owl.guideRead";
const FLASH_MS = 1500;
const MAX_REMEMBERED_GUIDES = 50;

export function createGuideView(container: HTMLElement, handlers: GuideHandlers): GuideView {
	const stopList = element("nav", "guide-stops");
	const pane = element("div", "stop-pane");
	container.append(pane);
	let guide: Guide | null = null;
	let context: GuideContext = { source: "", files: [], head: "", label: "" };
	let index = 0;
	let read = new Set<number>();
	let details = new Map<string, Promise<FileDetail | null>>();
	let shownKey = "";
	let excerptLoaders: (() => void)[] = [];
	let loadRound = 0;
	let listSelected: number | null = null;

	function setGuide(next: Guide | null, nextContext: GuideContext): void {
		const key = JSON.stringify([next, nextContext]);
		if (key === shownKey) return;
		shownKey = key;
		const sameGuide = guide !== null && next !== null && guide.headSha === next.headSha;
		guide = next;
		context = nextContext;
		details = new Map();
		read = next === null ? new Set() : loadRead(readKey());
		if (!sameGuide) index = 0;
		index = Math.min(index, Math.max(stopCount() - 1, 0));
		if (container.hidden) drawStopList();
		else render();
	}

	function show(stop = index): void {
		index = Math.max(0, Math.min(stop, stopCount() - 1));
		container.hidden = false;
		render();
	}

	function hide(): void {
		if (container.hidden) return;
		container.hidden = true;
		drawStopList();
	}

	function drawStopList(): void {
		if (!guide) return stopList.replaceChildren();
		const selected = container.hidden ? null : index;
		renderStopList(stopList, guide, selected, read, offTour().length, pick);
		// The list shares the tree's scroller: scroll only when the selection moves, not on every redraw.
		if (selected !== null && selected !== listSelected)
			stopList.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
		listSelected = selected;
	}

	function pick(stop: number): void {
		if (container.hidden) handlers.onShowStop(stop);
		else goTo(stop);
	}

	function goTo(next: number): void {
		if (next === index) return;
		index = next;
		render();
		pane.scrollTop = 0;
		handlers.onStopChange();
	}

	function step(delta: 1 | -1): void {
		goTo(stepStop(index, delta, stopCount()));
	}

	function stopCount(): number {
		if (!guide) return 0;
		return guide.stops.length + (offTour().length > 0 ? 1 : 0);
	}

	function offTour(): ChangedFile[] {
		return guide ? uncoveredFiles(context.files, guide) : [];
	}

	function readKey(): string {
		return `${context.source}@${guide?.headSha ?? ""}`;
	}

	function render(): void {
		excerptLoaders = [];
		loadRound++;
		if (!guide) return;
		const left = offTour();
		if (!container.hidden && index < guide.stops.length && !read.has(index)) {
			read.add(index);
			saveRead(readKey(), read);
		}
		drawStopList();
		const page = renderPage(guide, left);
		if (isStale(guide, context.head)) page.prepend(staleBanner(guide.headSha, context.head));
		pane.replaceChildren(page);
	}

	function renderPage(shown: Guide, left: ChangedFile[]): HTMLElement {
		const stop = shown.stops[index];
		if (index === shown.stops.length && left.length > 0) return offTourPane(left, handlers);
		if (!stop) return element("div", "empty", "This guide has no stops.");
		const nextTitle = shown.stops[index + 1]?.title ?? (left.length > 0 ? "Not on the tour" : null);
		const page = renderStop({
			stop,
			guide: shown,
			index,
			context,
			handlers,
			step,
			detail,
			nextTitle,
			excerptLoaders,
			loadRound: () => loadRound
		});
		const copy = button("Copy stop", "Copy this stop as a prompt for an agent (y)", false, () => void copyStop());
		copy.classList.add("copy");
		page.querySelector(".buttons")?.append(copy);
		return page;
	}

	// Files on disk can change while the file list stays the same, so the working view's refresh drops the cached
	// files and reloads the shown excerpts in place; a load that started before the latest reload is ignored.
	function reloadFiles(): void {
		details = new Map();
		loadRound++;
		if (!container.hidden) for (const load of excerptLoaders) load();
	}

	function detail(path: string): Promise<FileDetail | null> {
		if (!details.has(path)) details.set(path, handlers.loadFile(path));
		return details.get(path)!;
	}

	async function copyStop(): Promise<void> {
		const shown = guide;
		const at = index;
		const label = context.label;
		const stop = shown?.stops[at];
		if (!shown || !stop) return;
		const diffs = await Promise.all(
			stop.excerpts.map(async (excerpt) => {
				if (!context.files.some((file) => file.path === excerpt.path)) return null;
				const loaded = await detail(excerpt.path);
				return loaded && "chunks" in loaded ? excerptDiff(loaded, excerpt) : null;
			})
		);
		const copy = pane.querySelector<HTMLButtonElement>("button.copy");
		try {
			await navigator.clipboard.writeText(stopPrompt(shown, at, label, diffs));
			flash(copy, "Copied");
		} catch {
			flash(copy, "Copy failed");
		}
	}

	return {
		stopList,
		setGuide,
		show,
		hide,
		step,
		stop: () => index,
		stopCount,
		copyStop,
		reloadFiles,
		firstPath: () => {
			const stop = guide?.stops[index];
			return stop?.excerpts[0]?.path ?? stop?.files[0]?.path;
		}
	};
}

function renderStopList(
	list: HTMLElement,
	guide: Guide,
	selected: number | null,
	read: Set<number>,
	offTourCount: number,
	pick: (i: number) => void
): void {
	const rows = guide.stops.map((stop, i) => {
		const row = element("button", `stop-row${i === selected ? " selected" : ""}${read.has(i) ? " read" : ""}`);
		row.type = "button";
		const bullet = element("span", "bullet", read.has(i) ? "✓" : String(i + 1));
		const meta = element("div", "meta");
		if (stop.attention) meta.append(element("span", "kind look", "Look closely"));
		meta.append(element("span", "", stopSubline(stop)));
		const text = element("div", "text");
		text.append(html("div", "title", renderInlineMarkdown(stop.title)), meta);
		row.append(bullet, text);
		row.onclick = () => pick(i);
		return row;
	});
	const readCount = guide.stops.filter((_, i) => read.has(i)).length;
	if (offTourCount > 0) {
		const row = element("button", `stop-row off-tour${selected === guide.stops.length ? " selected" : ""}`);
		row.type = "button";
		const text = element("div", "text");
		text.append(element("div", "title", "Not on the tour"), element("div", "meta", countOf(offTourCount, "file")));
		row.append(element("span", "bullet", "…"), text);
		row.onclick = () => pick(guide.stops.length);
		rows.push(row);
	}
	list.replaceChildren(element("div", "read-count", `${readCount} of ${guide.stops.length} read`), ...rows);
}

interface StopPage {
	stop: GuideStop;
	guide: Guide;
	index: number;
	context: GuideContext;
	handlers: GuideHandlers;
	step: (delta: 1 | -1) => void;
	detail: (path: string) => Promise<FileDetail | null>;
	nextTitle: string | null;
	excerptLoaders: (() => void)[];
	loadRound: () => number;
}

function renderStop(page: StopPage): HTMLElement {
	const { stop, guide, index, context, handlers, step, nextTitle } = page;
	const article = element("article", "stop");
	const head = element("div", "stop-head");
	const buttons = element("div", "buttons");
	buttons.append(
		button("↑", "Previous stop (k)", index === 0, () => step(-1)),
		button("↓", "Next stop (j)", nextTitle === null, () => step(1))
	);
	head.append(element("span", "position", `Stop ${index + 1} of ${guide.stops.length}`), buttons);
	article.append(head, html("h1", "", renderInlineMarkdown(stop.title)));
	if (stop.summary.trim()) article.append(html("div", "summary", renderMarkdown(stop.summary)));
	if (stop.attention) article.append(attentionBlock(stop.attention));
	if (stop.excerpts.length > 0) article.append(excerptList(page));
	if (stop.notes.length > 0) article.append(notesSection(stop, handlers));
	const excerptPaths = new Set(stop.excerpts.map((excerpt) => excerpt.path));
	const otherFiles = stop.files.filter((file) => !excerptPaths.has(file.path));
	if (otherFiles.length > 0) {
		const title = stop.excerpts.length > 0 ? "Also in this stop" : "Files in this stop";
		article.append(filesSection(title, otherFiles, context.files, handlers));
	}
	if (stop.questions.length > 0) article.append(questionsSection(stop.questions));
	if (nextTitle !== null) {
		const foot = element("div", "stop-foot");
		const nextButton = html("button", "next", `Next: ${renderInlineMarkdown(nextTitle)} →`);
		nextButton.onclick = () => step(1);
		foot.append(nextButton);
		article.append(foot);
	}
	return article;
}

function offTourPane(files: ChangedFile[], handlers: GuideHandlers): HTMLElement {
	const article = element("article", "stop");
	article.append(
		element("div", "stop-head", "After the tour"),
		element("h1", "", "Not on the tour"),
		element(
			"p",
			"summary",
			`No stop names ${files.length === 1 ? "this changed file" : `these ${files.length} changed files`}. Read them on your own.`
		)
	);
	const list = element("ul", "file-list");
	for (const file of files) list.append(fileRow(file.path, undefined, files, handlers));
	article.append(list);
	return article;
}

function staleBanner(guideHead: string, head: string): HTMLElement {
	const banner = element("div", "note stale");
	banner.append(
		element("b", "", "Written for an older version. "),
		`This guide was written for ${guideHead.slice(0, 7)}; the view is now at ${head.slice(0, 7)}. Excerpts that no longer match the diff are hidden.`
	);
	return banner;
}

function flash(target: HTMLButtonElement | null, text: string): void {
	if (!target) return;
	const original = target.textContent;
	target.textContent = text;
	setTimeout(() => (target.textContent = original), FLASH_MS);
}

function attentionBlock(attention: NonNullable<GuideStop["attention"]>): HTMLElement {
	const block = element("div", "note attention");
	const title = element("div", "attention-title");
	title.append(element("span", "kind look", attention.kind), element("b", "", ATTENTION_LABELS[attention.kind]));
	block.append(title, html("div", "", renderMarkdown(attention.note)));
	return block;
}

function excerptList({ stop, context, handlers, detail, excerptLoaders, loadRound }: StopPage): HTMLElement {
	const list = element("div", "excerpts");
	for (const excerpt of stop.excerpts) {
		const figure = element("figure", "excerpt");
		if (excerpt.caption.trim()) figure.append(html("figcaption", "", renderInlineMarkdown(excerpt.caption)));
		const head = element("div", "excerpt-head");
		const open = element("button", "open", "open ↗");
		open.type = "button";
		open.title = "open in the file view";
		open.onclick = () =>
			handlers.onOpen({ path: excerpt.path, start: excerpt.start, end: excerpt.end, old: excerpt.side === "old" });
		const side = excerpt.side === "old" ? "removed code, old " : "";
		head.append(
			element("span", "path", excerpt.path),
			element("span", "lines", `${side}lines ${excerpt.start}–${excerpt.end}`),
			open
		);
		const body = element("div", "excerpt-body", `Loading ${excerpt.path}…`);
		figure.append(head, body);
		list.append(figure);
		const isShownHere = (note: GuideNote): boolean =>
			note.path === excerpt.path && note.line >= excerpt.start && note.line <= excerpt.end;
		const markers = stop.notes
			.map((note, i) => ({ note, letter: noteLetter(i) }))
			.filter(({ note }) => isShownHere(note) && noteSide(stop, note) === excerpt.side)
			.map(({ note, letter }) => ({ line: note.line, letter, title: note.title }));
		if (!context.files.some((file) => file.path === excerpt.path)) {
			body.textContent = `${excerpt.path} is not in this view.`;
			continue;
		}
		const load = (): void => {
			const round = loadRound();
			void detail(excerpt.path).then((loaded) => {
				if (round === loadRound()) renderExcerptBody(body, excerpt, loaded, markers, handlers.onOpen);
			});
		};
		excerptLoaders.push(load);
		load();
	}
	return list;
}

function notesSection(stop: GuideStop, handlers: GuideHandlers): HTMLElement {
	const section = sectionWithTitle(stop.notes.length === 1 ? "Note on this stop" : "Notes on this stop");
	const list = element("ol", "guide-notes");
	stop.notes.forEach((note, i) => {
		const item = element("li", "");
		const head = element("div", "note-head");
		const link = codeLink(`${note.path.split("/").pop()}:${note.line}`);
		link.title = note.path;
		const old = noteSide(stop, note) === "old";
		link.onclick = () => handlers.onOpen({ path: note.path, start: note.line, end: note.line, old });
		head.append(element("span", "note-marker", noteLetter(i)), html("b", "", renderInlineMarkdown(note.title)), link);
		item.append(head);
		if (note.body.trim()) item.append(html("div", "note-body", renderMarkdown(note.body)));
		list.append(item);
	});
	section.append(list);
	return section;
}

function filesSection(
	title: string,
	files: GuideStop["files"],
	changed: ChangedFile[],
	handlers: GuideHandlers
): HTMLElement {
	const section = sectionWithTitle(title);
	const list = element("ul", "file-list");
	for (const file of files) list.append(fileRow(file.path, file.note, changed, handlers));
	section.append(list);
	return section;
}

function fileRow(path: string, note: string | undefined, changed: ChangedFile[], handlers: GuideHandlers): HTMLElement {
	const item = element("li", "");
	const row = element("button", "file-row");
	row.type = "button";
	const status = changed.find((file) => file.path === path);
	row.append(element("span", `path${status ? ` status-${status.status}` : " missing"}`, path));
	row.append(html("span", "file-note", note ? renderInlineMarkdown(note) : ""));
	if (status?.additions !== undefined) row.append(element("span", "added", `+${status.additions}`));
	if (status?.deletions !== undefined) row.append(element("span", "removed", `-${status.deletions}`));
	if (status) row.onclick = () => handlers.onOpenFile(path);
	else row.title = "not in this view";
	item.append(row);
	return item;
}

function questionsSection(questions: string[]): HTMLElement {
	const section = sectionWithTitle("Questions to consider");
	const list = element("ul", "questions");
	for (const question of questions) list.append(html("li", "", renderInlineMarkdown(question)));
	section.append(list);
	return section;
}

function sectionWithTitle(title: string): HTMLElement {
	const section = element("section", "");
	section.append(element("h2", "", title));
	return section;
}

function codeLink(text: string): HTMLElement {
	const link = element("button", "code-link", text);
	link.type = "button";
	return link;
}

function button(text: string, title: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
	const created = element("button", "icon", text);
	created.type = "button";
	created.title = title;
	created.disabled = disabled;
	created.onclick = onClick;
	return created;
}

function loadRead(key: string): Set<number> {
	try {
		const all = JSON.parse(localStorage.getItem(READ_KEY) ?? "{}") as Record<string, number[]>;
		return new Set(all[key] ?? []);
	} catch {
		return new Set();
	}
}

function saveRead(key: string, read: Set<number>): void {
	try {
		const all = JSON.parse(localStorage.getItem(READ_KEY) ?? "{}") as Record<string, number[]>;
		delete all[key];
		const kept = Object.entries(all).slice(-(MAX_REMEMBERED_GUIDES - 1));
		localStorage.setItem(READ_KEY, JSON.stringify(Object.fromEntries([...kept, [key, [...read]]])));
	} catch {}
}

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	text = ""
): HTMLElementTagNameMap[K] {
	const created = document.createElement(tag);
	created.className = className;
	created.textContent = text;
	return created;
}

function html<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	markup: string
): HTMLElementTagNameMap[K] {
	const created = element(tag, className);
	created.innerHTML = markup;
	return created;
}
