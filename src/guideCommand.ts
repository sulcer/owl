import { readStdin } from "./commentCommand.ts";
import type { ViewCommand } from "./viewArgs.ts";
import { findRepoRoot, readFileDetail, resolveSource } from "./git.ts";
import type { ChangedFile, FileDetail, ResolvedSource } from "./git.ts";
import { clearGuide, parseGuide, writeGuide } from "./guide.ts";
import type { Guide } from "./guide.ts";
import { lineCount } from "./shared/diff.ts";
import { countOf, excerptProblem, isSameHead } from "./shared/guide-tour.ts";

export async function runGuide(command: ViewCommand, gitDir: string): Promise<string> {
	if (command.kind === "clear") {
		const existed = await clearGuide(gitDir, command.source);
		return `${existed ? "guide cleared" : "no guide"}: ${command.source}`;
	}
	const root = await findRepoRoot(process.cwd());
	if (root === null) throw new Error("not a git repository");
	return saveGuide(root, gitDir, command.source, await readStdin());
}

export async function saveGuide(root: string, gitDir: string, source: string, input: string): Promise<string> {
	const guide = parseGuide(input);
	const resolved = await resolveSource(root, source);
	const current = isSameHead(guide.headSha, resolved.head);
	if (current) await checkAgainstDiff(guide, root, resolved);
	await writeGuide(gitDir, source, guide);
	const written = `guide written: ${source} (${countOf(guide.stops.length, "stop")})`;
	if (current) return written;
	const [then, now] = [guide.headSha.slice(0, 7), resolved.head.slice(0, 7)];
	return `${written}, written for ${then} but the view is at ${now}: shown as stale`;
}

async function checkAgainstDiff(guide: Guide, root: string, resolved: ResolvedSource): Promise<void> {
	const details = new Map<string, Promise<FileDetail>>();
	const detail = (file: ChangedFile): Promise<FileDetail> => {
		if (!details.has(file.path)) details.set(file.path, readFileDetail(root, resolved, file));
		return details.get(file.path)!;
	};
	const inView = (where: string, path: string): ChangedFile => {
		const file = resolved.files.find((candidate) => candidate.path === path);
		if (!file) throw new Error(`${where}: ${path} is not in this view`);
		return file;
	};
	for (const [stopIndex, stop] of guide.stops.entries()) {
		const at = (item: string, index: number): string => `stop ${stopIndex + 1}, ${item} ${index + 1}`;
		for (const [index, excerpt] of stop.excerpts.entries()) {
			const shown = await detail(inView(at("excerpt", index), excerpt.path));
			const problem = "chunks" in shown ? excerptProblem(shown, excerpt) : null;
			if (problem)
				throw new Error(`${at("excerpt", index)}: lines ${excerpt.start}-${excerpt.end} of ${excerpt.path} ${problem}`);
		}
		for (const [index, file] of stop.files.entries()) inView(at("file", index), file.path);
		for (const [index, note] of stop.notes.entries()) {
			const shown = await detail(inView(at("note", index), note.path));
			if (!("chunks" in shown)) continue;
			const lines = Math.max(lineCount(shown.oldText), lineCount(shown.newText));
			if (note.line > lines)
				throw new Error(
					`${at("note", index)}: line ${note.line} is past the end of ${note.path} (${countOf(lines, "line")})`
				);
		}
	}
}
