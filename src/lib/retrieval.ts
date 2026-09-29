import { z } from "zod";
import { contentHash } from "./content-identity.ts";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 512;
export const MAX_SOURCE_CHUNKS = 80;
export const MAX_RETRIEVAL_CHUNKS = 512;
export const RETRIEVAL_VERSION = "passages:v1";

export const retrievalPolicySchema = z
	.strictObject({
		historyMessages: z.number().int().min(0).max(200),
		candidates: z.number().int().min(4).max(32),
		maxResults: z.number().int().min(1).max(16),
		minimumConfidence: z.number().min(0.5).max(1),
	})
	.refine(
		(policy) => policy.maxResults <= policy.candidates,
		"Results must fit the candidate limit",
	);
export type RetrievalPolicy = z.infer<typeof retrievalPolicySchema>;
export const DEFAULT_RETRIEVAL_POLICY: RetrievalPolicy = {
	historyMessages: 0,
	candidates: 16,
	maxResults: 6,
	minimumConfidence: 0.9,
};

export const retrievalSourceSchema = z.strictObject({
	id: z.string().min(1).max(100),
	label: z.string().min(1).max(200),
	kind: z.enum(["document", "message"]),
	content: z.string().min(1).max(120000),
});
export type RetrievalSource = z.infer<typeof retrievalSourceSchema>;

/** Include the exact source version and embedding settings, independent of property order. */
export async function retrievalSourceKey(
	identity: string,
	source: RetrievalSource,
): Promise<string> {
	const { id, label, kind, content } = source;
	return `${identity}:${await contentHash(
		JSON.stringify([
			RETRIEVAL_VERSION,
			EMBEDDING_MODEL,
			EMBEDDING_DIMENSIONS,
			{ id, label, kind, content },
		]),
	)}`;
}
export const passageSchema = z.strictObject({
	start: z.number().int().min(0),
	end: z.number().int().min(1),
	text: z.string().min(1).max(2400),
});
export type Passage = z.infer<typeof passageSchema>;
export const retrievalCandidateSchema = passageSchema.extend({
	id: z.string(),
	sourceId: z.string(),
	label: z.string(),
	kind: z.enum(["document", "message"]),
	rank: z.number().int().min(1),
});
export type RetrievalCandidate = z.infer<typeof retrievalCandidateSchema>;
export const retrievalTraceSchema = z.strictObject({
	query: z.string().max(14000),
	sources: z.number().int().min(0),
	historyLimited: z.boolean(),
	reranking: z.enum(["completed", "uncertain", "unavailable", "empty"]),
	error: z.string().optional(),
	candidates: z
		.array(
			z.strictObject({
				id: z.string(),
				sourceId: z.string(),
				label: z.string(),
				start: z.number().int().min(0),
				end: z.number().int().min(1),
				rank: z.number().int().min(1),
				selected: z.boolean(),
				grade: z.number().min(0).max(3).optional(),
				confidence: z.number().min(0).max(1).optional(),
			}),
		)
		.max(32),
});
export type RetrievalTrace = z.infer<typeof retrievalTraceSchema>;

/** Overlapping source slices keep exact offsets and never rewrite evidence. */
export function splitPassages(content: string): Passage[] {
	const result: Passage[] = [];
	let start = 0;
	while (start < content.length) {
		let end = Math.min(start + 2400, content.length);
		if (end < content.length) {
			const boundary = content.lastIndexOf("\n", end - 1);
			if (boundary > start + 1200) end = boundary + 1;
			if (end > start && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
		}
		const text = content.slice(start, end);
		if (text.trim()) result.push({ start, end, text });
		if (end === content.length) break;
		start = end - 200;
		if (/[\uDC00-\uDFFF]/.test(content[start])) start++;
	}
	if (result.length > MAX_SOURCE_CHUNKS)
		throw new Error("Source has too many passages");
	return result;
}
