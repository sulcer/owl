import type { Comment } from "../comments.ts";
import type { ChangedFile, FileDetail, PrInfo, Sources } from "../git.ts";
import { commentForChunk, countByPath, nextCommentIndex, worstKindByPath } from "../shared/comment-layout.ts";
import { buildTree, treeFiles } from "../shared/tree.ts";
import { createCommentLayer } from "./comments.ts";
import { createDiffView } from "./diff-view.ts";
import { createOverviewFrame } from "./overview.ts";
import type { OpenLink } from "./overview.ts";
import type { ScrollPosition } from "./diff-view.ts";
import { setupResize } from "./resize.ts";
import { renderHeader, renderSources, renderTree, sourceIds } from "./panel.ts";

interface ApiError {
	error: string;
}

interface FilesResponse {
	files: ChangedFile[];
	pr?: PrInfo;
}

interface OpenOptions {
	startAt?: "first" | "last";
	restore?: ScrollPosition;
}

function byId<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) throw new Error(`missing #${id}`);
	return found as T;
}

const sourcesEl = byId("sources");
const treeEl = byId("tree");
const filterEl = byId<HTMLInputElement>("filter");
const headerEl = byId("header");
const helpEl = byId("help");

const view = createDiffView(
	{
		panes: byId("panes"),
		note: byId("note"),
		oldScroller: byId("oldPane"),
		newScroller: byId("newPane"),
		strip: byId("strip") as unknown as SVGSVGElement
	},
	() => drawHeader()
);

setupResize({
	left: byId("left"),
	sources: sourcesEl,
	leftHandle: byId("leftHandle"),
	splitHandle: byId("splitHandle"),
	oldPane: byId("oldPane"),
	newPane: byId("newPane"),
	strip: byId("strip") as unknown as SVGSVGElement
});

const overviewFrame = createOverviewFrame(byId("overview"), {
	hasFile: (path) => files.some((file) => file.path === path),
	onOpen: (link) => void openCodeLink(link),
	onOpenComment: (comment) => void openComment(comment),
	onKey: (event) => handleKey(event)
});

const commentLayer = createCommentLayer({
	panes: byId("panes"),
	scrollers: { old: byId("oldPane"), new: byId("newPane") }
});

let sources: Sources | null = null;
let sourcesError: string | null = null;
let source = "working";
let files: ChangedFile[] = [];
let pr: PrInfo | undefined;
let filesError: string | null = null;
let selectedPath: string | null = null;
let currentDetail: FileDetail | null = null;
let filterText: string | null = null;
let comments: Comment[] = [];
let commentIndex = -1;
let generation = 0;
let overviewHtml: string | null = null;
let overviewOpen = false;
let fileScroll: ScrollPosition | undefined;
const collapsed = new Set<string>();

async function getJson<T>(url: string): Promise<T | ApiError> {
	try {
		return (await (await fetch(url)).json()) as T | ApiError;
	} catch (error) {
		return { error: String(error) };
	}
}

function isError<T>(response: T | ApiError): response is ApiError {
	return typeof response === "object" && response !== null && "error" in response;
}

async function loadSources(): Promise<void> {
	const response = await getJson<Sources>("/api/sources");
	sources = isError(response) ? null : response;
	sourcesError = isError(response) ? response.error : null;
	drawSources();
}

async function loadComments(): Promise<void> {
	const response = await getJson<{ comments: Comment[] }>("/api/comments");
	comments = isError(response) ? [] : response.comments;
	drawTree();
	drawComments();
	syncReviews();
}

function syncReviews(): void {
	overviewFrame.setReviews(sourceComments().filter((comment) => comment.kind));
}

function sourceComments(): Comment[] {
	return comments.filter((comment) => comment.source === source);
}

function drawComments(): void {
	commentLayer.render(sourceComments().filter((comment) => comment.path === selectedPath));
}

function focusChangeComment(): void {
	const chunk = view.currentChunk();
	const inFile = sourceComments().filter((comment) => comment.path === selectedPath);
	commentLayer.focus((chunk && commentForChunk(inFile, chunk)?.id) ?? null);
}

async function goToComment(direction: 1 | -1): Promise<void> {
	const list = sourceComments();
	const hasFile = (comment: Comment): boolean => files.some((file) => file.path === comment.path);
	const index = nextCommentIndex(list, commentIndex, direction, hasFile);
	if (index === commentIndex) return;
	commentIndex = index;
	const target = list[index];
	await openComment(target);
}

async function openComment(target: Comment): Promise<void> {
	if (overviewOpen || target.path !== selectedPath) await openFile(target.path);
	if (target.path !== selectedPath) return;
	commentLayer.reveal(target.id);
	view.goToLine(target.side, target.start);
}

async function loadFiles(force = false): Promise<void> {
	const response = await getJson<FilesResponse>(`/api/files?source=${source}${force ? "&refresh=1" : ""}`);
	files = isError(response) ? [] : response.files;
	pr = isError(response) ? undefined : response.pr;
	filesError = isError(response) ? response.error : null;
	drawSources();
	drawTree();
}

async function fetchOverview(): Promise<string | null> {
	const response = await getJson<{ html: string | null }>(`/api/overview?source=${source}`);
	return isError(response) ? null : response.html;
}

function setOverview(html: string | null, forceRender: boolean): void {
	const changed = html !== overviewHtml;
	overviewHtml = html;
	if (html === null) leaveOverview();
	else if (changed || forceRender) overviewFrame.render(html);
	drawTree();
}

async function reloadOverview(): Promise<void> {
	const html = await fetchOverview();
	const wasOpen = overviewOpen;
	setOverview(html, false);
	if (wasOpen && html === null) return openFirstOrPreferred();
	drawHeader();
}

function showOverview(): void {
	generation++;
	if (!overviewOpen) fileScroll = view.scrollPosition();
	overviewOpen = true;
	byId("panes").hidden = true;
	byId("note").hidden = true;
	overviewFrame.show();
	writeHash();
	drawTree();
	drawHeader();
}

function leaveOverview(): void {
	overviewOpen = false;
	overviewFrame.hide();
}

function toggleOverview(): void {
	if (overviewHtml === null) return;
	if (!overviewOpen) return showOverview();
	const path = selectedPath ?? files[0]?.path;
	if (path) void openFile(path, { restore: fileScroll });
}

async function openCodeLink(link: OpenLink): Promise<void> {
	await openFile(link.path);
	if (selectedPath !== link.path) return;
	view.goToLine(link.old ? "old" : "new", link.start);
}

async function selectSource(id: string, preferred: { file?: string; overview?: boolean } = {}): Promise<void> {
	const mine = ++generation;
	source = id;
	selectedPath = null;
	commentIndex = -1;
	syncReviews();
	leaveOverview();
	overviewHtml = null;
	await loadFiles();
	const html = await fetchOverview();
	if (mine !== generation) return;
	setOverview(html, true);
	if (html !== null && (preferred.overview || !preferred.file)) return showOverview();
	await openFirstOrPreferred(preferred.file);
}

async function openFirstOrPreferred(preferredPath?: string): Promise<void> {
	const target = files.find((file) => file.path === preferredPath) ?? files[0];
	if (target) return openFile(target.path);
	leaveOverview();
	selectedPath = null;
	currentDetail = null;
	view.showMessage(filesError ?? "No changes.");
	drawComments();
	writeHash();
	drawHeader();
}

async function openFile(path: string, options: OpenOptions = {}): Promise<void> {
	const mine = ++generation;
	leaveOverview();
	selectedPath = path;
	expandAncestors(path);
	drawTree();
	writeHash();
	const detail = await getJson<FileDetail>(`/api/file?source=${source}&path=${encodeURIComponent(path)}`);
	if (mine !== generation) return;
	if (isError(detail)) {
		currentDetail = null;
		view.showMessage(detail.error);
	} else {
		currentDetail = detail;
		view.showFile(detail, options.restore);
		if (options.startAt === "first") view.goToChange(0);
		if (options.startAt === "last") view.goToChange(view.changeCount() - 1);
	}
	drawComments();
	if (options.startAt) focusChangeComment();
	drawHeader();
}

async function refresh(forceFiles: boolean): Promise<void> {
	void loadComments();
	await loadSources();
	const mine = ++generation;
	if (forceFiles || source === "working" || source === "branch") await loadFiles(forceFiles);
	const html = await fetchOverview();
	if (mine !== generation) return;
	const lostOverview = overviewOpen && html === null;
	setOverview(html, forceFiles);
	if (overviewOpen) return drawHeader();
	const stillThere = files.some((file) => file.path === selectedPath);
	if (lostOverview || !stillThere) return openFirstOrPreferred();
	await openFile(selectedPath ?? "", { restore: view.scrollPosition() });
}

function orderedFiles(): ChangedFile[] {
	return treeFiles(buildTree(files));
}

function matchingFiles(): ChangedFile[] {
	if (!filterText) return files;
	const needle = filterText.toLowerCase();
	return files.filter((file) => file.path.toLowerCase().includes(needle));
}

function expandAncestors(path: string): void {
	for (const folder of collapsed) if (path.startsWith(`${folder}/`)) collapsed.delete(folder);
}

function writeHash(): void {
	const params = new URLSearchParams({ source });
	if (overviewOpen) params.set("overview", "1");
	else if (selectedPath) params.set("file", selectedPath);
	history.replaceState(null, "", `#${params}`);
}

function drawSources(): void {
	renderSources(sourcesEl, sources, sourcesError, source, (id) => void selectSource(id));
}

function drawTree(): void {
	const emptyText = filesError ?? (filterText ? "No matching files." : "No changes.");
	const handlers = {
		onFile: (path: string) => void openFile(path),
		onToggle: (folder: string) => {
			if (!collapsed.delete(folder)) collapsed.add(folder);
			drawTree();
		},
		onOverview: showOverview
	};
	renderTree(
		treeEl,
		buildTree(matchingFiles()),
		overviewOpen ? null : selectedPath,
		collapsed,
		countByPath(comments, source),
		worstKindByPath(comments, source),
		overviewHtml === null
			? null
			: { selected: overviewOpen, subtitle: source.startsWith("pr-") ? "what this PR does" : "" },
		handlers,
		emptyText
	);
}

function drawHeader(): void {
	renderHeader(headerEl, {
		detail: currentDetail,
		pr,
		changeIndex: view.currentChange(),
		changeCount: view.changeCount(),
		fileIndex: orderedFiles().findIndex((file) => file.path === selectedPath),
		fileCount: files.length,
		overviewOpen
	});
}

function openFirstFile(): void {
	const first = orderedFiles()[0];
	if (first) void openFile(first.path);
}

function stepChange(direction: 1 | -1): void {
	if (overviewOpen) return openFirstFile();
	const next = view.currentChange() + direction;
	if (next >= 0 && next < view.changeCount()) {
		view.goToChange(next);
		return focusChangeComment();
	}
	moveFile(direction, direction === 1 ? "first" : "last");
}

function moveFile(direction: 1 | -1, startAt?: "first" | "last"): void {
	const ordered = orderedFiles();
	const index = ordered.findIndex((file) => file.path === selectedPath);
	const next = ordered[index + direction];
	if (next) void openFile(next.path, { startAt });
}

function stepReview(direction: 1 | -1): void {
	if (overviewOpen) return overviewFrame.stepNote(direction);
	void goToComment(direction);
}

function nextFile(): void {
	if (overviewOpen) return openFirstFile();
	moveFile(1);
}

function previousFile(): void {
	const isFirstFile = orderedFiles()[0]?.path === selectedPath;
	if (!overviewOpen && isFirstFile && overviewHtml !== null) return showOverview();
	moveFile(-1);
}

function moveSource(direction: 1 | -1): void {
	if (!sources) return;
	const ids = sourceIds(sources);
	const next = ids[ids.indexOf(source) + direction];
	if (next) void selectSource(next);
}

function openFilter(): void {
	filterText = "";
	filterEl.value = "";
	filterEl.hidden = false;
	filterEl.focus();
	drawTree();
}

function closeFilter(): void {
	filterText = null;
	filterEl.hidden = true;
	filterEl.blur();
	drawTree();
}

function openFirstMatch(): void {
	const first = treeFiles(buildTree(matchingFiles()))[0];
	closeFilter();
	if (first) void openFile(first.path);
}

function toggleHelp(): void {
	helpEl.hidden = !helpEl.hidden;
}

function closeHelp(): void {
	helpEl.hidden = true;
}

const KEY_ACTIONS: Record<string, () => void> = {
	"n": () => stepChange(1),
	"F7": () => stepChange(1),
	"p": () => stepChange(-1),
	"Shift+F7": () => stepChange(-1),
	"j": nextFile,
	"k": previousFile,
	"o": toggleOverview,
	"J": () => moveSource(1),
	"K": () => moveSource(-1),
	"c": () => commentLayer.toggleCards(),
	"v": () => commentLayer.toggleStyle(),
	"]": () => stepReview(1),
	"[": () => stepReview(-1),
	"/": openFilter,
	"r": () => void refresh(true),
	"?": toggleHelp,
	"Escape": closeHelp
};

function handleKey(event: KeyboardEvent): void {
	if (event.ctrlKey || event.metaKey || event.altKey || event.target === filterEl) return;
	const name = event.shiftKey && event.key === "F7" ? "Shift+F7" : event.key;
	if (!helpEl.hidden && name !== "?" && name !== "Escape") return;
	const action = KEY_ACTIONS[name];
	if (!action) return;
	event.preventDefault();
	action();
}

document.addEventListener("keydown", handleKey);

filterEl.addEventListener("keydown", (event) => {
	if (event.key === "Enter") openFirstMatch();
	if (event.key === "Escape") closeFilter();
});

filterEl.addEventListener("input", () => {
	filterText = filterEl.value;
	drawTree();
});

window.addEventListener("focus", () => void refresh(false));

async function start(): Promise<void> {
	const params = new URLSearchParams(location.hash.slice(1));
	await Promise.all([loadSources(), loadComments()]);
	await selectSource(params.get("source") ?? "working", {
		file: params.get("file") ?? undefined,
		overview: params.get("overview") === "1"
	});
}

const events = new EventSource("/api/events");
events.addEventListener("comments", () => void loadComments());
events.addEventListener("overview", (event) => {
	const changed = JSON.parse((event as MessageEvent<string>).data) as { source: string };
	if (changed.source === source) void reloadOverview();
});
void start();
