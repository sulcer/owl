import { readStdin } from "./commentCommand.ts";
import type { ViewCommand } from "./viewArgs.ts";
import { clearOverview, writeOverview } from "./overview.ts";

export async function runOverview(command: ViewCommand, gitDir: string): Promise<string> {
	if (command.kind === "clear") {
		const existed = await clearOverview(gitDir, command.source);
		return `${existed ? "overview cleared" : "no overview"}: ${command.source}`;
	}
	await writeOverview(gitDir, command.source, await readStdin());
	return `overview written: ${command.source}`;
}
