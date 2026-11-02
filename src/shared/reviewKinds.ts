export const REVIEW_KINDS = ["fix", "question", "nit"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
