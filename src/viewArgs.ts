export interface ViewCommand {
	kind: "write" | "clear";
	source: string;
}

const VIEW_FLAGS = new Set(["--branch", "--clear"]);
const PR_PATTERN = /^\d{1,7}$/;

export function parseViewArgs(args: string[]): ViewCommand {
	const unknown = args.find((arg) => arg.startsWith("--") && !VIEW_FLAGS.has(arg));
	if (unknown) throw new Error(`unknown flag: ${unknown}`);
	const flags = new Set(args.filter((arg) => VIEW_FLAGS.has(arg)));
	const positional = args.filter((arg) => !VIEW_FLAGS.has(arg));
	if (positional.length > 1) throw new Error("too many arguments");
	return { kind: flags.has("--clear") ? "clear" : "write", source: parseSource(flags, positional[0]) };
}

export function parseSource(flags: Set<string>, pr: string | undefined): string {
	if (flags.has("--branch") && pr !== undefined) throw new Error("use either --branch or a PR number, not both");
	if (pr !== undefined) {
		if (!PR_PATTERN.test(pr)) throw new Error(`bad PR number: ${pr}`);
		return `pr-${Number(pr)}`;
	}
	return flags.has("--branch") ? "branch" : "working";
}
