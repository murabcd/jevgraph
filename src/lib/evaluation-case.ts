import { z } from "zod";
import { contentHash } from "./content-identity.ts";
import {
	EVALUATION_VERSIONS,
	evaluationVersionsSchema,
} from "./evaluation-version.ts";
import { retrievalSourceSchema } from "./retrieval.ts";
import { routeRequestSchema } from "./routing.ts";

export const evaluationInputSchema = z.strictObject({
	messages: routeRequestSchema.shape.messages,
	metadata: routeRequestSchema.shape.metadata,
});
export const frozenCaseSchema = evaluationInputSchema.extend({
	versions: evaluationVersionsSchema,
	history: z.strictObject({
		conversationId: z.string().min(1).max(100),
		sources: z.array(retrievalSourceSchema).max(200),
		limited: z.boolean(),
	}),
});
export type FrozenCase = z.infer<typeof frozenCaseSchema>;

export function canonicalEvaluationInput(
	input: z.infer<typeof evaluationInputSchema>,
) {
	const parsed = evaluationInputSchema.parse({
		messages: input.messages,
		metadata: input.metadata,
	});
	return {
		...parsed,
		metadata: Object.fromEntries(
			Object.entries(parsed.metadata ?? {}).sort(([a], [b]) =>
				a.localeCompare(b),
			),
		),
	};
}

export function frozenCaseKey(input: FrozenCase) {
	const canonical = frozenCaseSchema.parse(input);
	return contentHash(
		JSON.stringify({ ...canonical, ...canonicalEvaluationInput(canonical) }),
	);
}

export function assertCurrentCase(input: FrozenCase) {
	if (JSON.stringify(input.versions) !== JSON.stringify(EVALUATION_VERSIONS))
		throw new Error("This case uses a different runtime or evaluator version");
}
