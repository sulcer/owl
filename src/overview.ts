import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./atomicWrite.ts";
import { commentsDir } from "./comments.ts";

export const MAX_OVERVIEW_BYTES = 300 * 1024;
export const OVERVIEW_FILE_PATTERN = /^overview-(working|branch|pr-\d{1,7})\.html$/;

function overviewPath(gitDir: string, source: string): string {
	return join(commentsDir(gitDir), `overview-${source}.html`);
}

export async function readOverview(gitDir: string, source: string): Promise<string | null> {
	try {
		return await readFile(overviewPath(gitDir, source), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export async function writeOverview(gitDir: string, source: string, html: string): Promise<void> {
	if (html.trim() === "") throw new Error("overview is empty");
	if (Buffer.byteLength(html) > MAX_OVERVIEW_BYTES)
		throw new Error(`overview is larger than ${MAX_OVERVIEW_BYTES / 1024} KB`);
	await writeFileAtomic(overviewPath(gitDir, source), html);
}

export async function clearOverview(gitDir: string, source: string): Promise<boolean> {
	if ((await readOverview(gitDir, source)) === null) return false;
	await rm(overviewPath(gitDir, source), { force: true });
	return true;
}
