import { z } from "zod";
import { contentHash } from "./content-identity";
import { EVALUATION_VERSIONS } from "./evaluation-version";
import { retrievalSourceSchema } from "./retrieval";
import { routeRequestSchema } from "./routing";

export const evaluationInputSchema = z.strictObject({
	messages: routeRequestSchema.shape.messages,
	metadata: routeRequestSchema.shape.metadata,
});
export const frozenCaseSchema = evaluationInputSchema.extend({
	versions: z.strictObject({
		runtime: z.string(),
		prompts: z.string(),
		evaluator: z.string(),
		retrieval: z.string(),
	}),
	history: z.strictObject({
		conversationId: z.string().min(1).max(100),
		sources: z.array(retrievalSourceSchema).max(200),
		limited: z.boolean(),
	}),
});
export type FrozenCase = z.infer<typeof frozenCaseSchema>;

export function frozenCaseKey(input: FrozenCase) {
	const canonical = frozenCaseSchema.parse(input);
	return contentHash(
		JSON.stringify({
			...canonical,
			metadata: Object.fromEntries(
				Object.entries(canonical.metadata ?? {}).sort(([a], [b]) =>
					a.localeCompare(b),
				),
			),
		}),
	);
}

export function assertCurrentCase(input: FrozenCase) {
	if (JSON.stringify(input.versions) !== JSON.stringify(EVALUATION_VERSIONS))
		throw new Error("This case uses a different runtime or evaluator version");
}
