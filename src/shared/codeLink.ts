export interface CodeLink {
	path: string;
	start: number;
	end: number;
}

const CODE_LINK = /^(.+):(\d+)(?:-(\d+))?$/;

export function parseCodeLink(value: string): CodeLink | null {
	const match = CODE_LINK.exec(value.trim());
	if (!match) return null;
	const start = Number(match[2]);
	const end = match[3] === undefined ? start : Number(match[3]);
	if (start < 1 || end < start) return null;
	return { path: match[1], start, end };
}
