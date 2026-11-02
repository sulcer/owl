import { parseSource, readStdin } from "./commentCommand.ts";
import { clearOverview, writeOverview } from "./overview.ts";

export interface OverviewCommand {
	kind: "write" | "clear";
	source: string;
}

const FLAGS = new Set(["--branch", "--clear"]);

export function parseOverviewArgs(args: string[]): OverviewCommand {
	const unknown = args.find((arg) => arg.startsWith("--") && !FLAGS.has(arg));
	if (unknown) throw new Error(`unknown flag: ${unknown}`);
	const flags = new Set(args.filter((arg) => FLAGS.has(arg)));
	const positional = args.filter((arg) => !FLAGS.has(arg));
	if (positional.length > 1) throw new Error("too many arguments");
	const source = parseSource(flags, positional[0]);
	return { kind: flags.has("--clear") ? "clear" : "write", source };
}

export async function runOverview(command: OverviewCommand, gitDir: string): Promise<string> {
	if (command.kind === "clear") {
		const existed = await clearOverview(gitDir, command.source);
		return `${existed ? "overview cleared" : "no overview"}: ${command.source}`;
	}
	await writeOverview(gitDir, command.source, await readStdin());
	return `overview written: ${command.source}`;
}
