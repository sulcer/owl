export interface ReviewText {
	title: string;
	body: string;
}

export function splitReviewText(text: string): ReviewText {
	const trimmed = text.trimStart();
	const lineEnd = trimmed.indexOf("\n");
	if (lineEnd === -1) return { title: trimmed.trim(), body: "" };
	return { title: trimmed.slice(0, lineEnd).trim(), body: trimmed.slice(lineEnd + 1).trim() };
}
