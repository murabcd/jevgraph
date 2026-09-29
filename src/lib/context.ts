import { z } from "zod";
import { conditionalInstructionsSchema } from "./conditional-instructions.ts";
import { retrievalPolicySchema, retrievalTraceSchema } from "./retrieval.ts";
import { pricingSchema } from "./usage.ts";

const sourceIdSchema = z.string().min(1).max(100);
export const contextDocumentSchema = z.strictObject({
	id: sourceIdSchema,
	name: z.string().trim().min(1).max(100),
	content: z.string().trim().min(1).max(120000),
	summary: z.string().trim().min(1).max(12000).optional(),
});
export const contextDocumentsSchema = z
	.array(contextDocumentSchema)
	.max(20)
	.refine(
		(documents) =>
			new Set(documents.map(({ id }) => id)).size === documents.length,
	)
	.refine(
		(documents) =>
			documents.reduce(
				(total, document) =>
					total + document.content.length + (document.summary?.length ?? 0),
				0,
			) <= 240000,
	);
export type ContextDocument = z.infer<typeof contextDocumentSchema>;

export const contextPolicySchema = z
	.strictObject({
		retrieval: retrievalPolicySchema.optional(),
		instructions: conditionalInstructionsSchema.optional(),
		historyMessages: z.number().int().min(0).max(29),
		maxCharacters: z.number().int().min(1000).max(120000),
		upstream: z.enum(["all", "selected", "none"]),
		outputNodeIds: z
			.array(sourceIdSchema)
			.max(100)
			.refine((ids) => new Set(ids).size === ids.length),
		documents: z
			.array(
				z.strictObject({
					id: sourceIdSchema,
					representation: z.enum(["full", "summary"]),
				}),
			)
			.max(20)
			.refine(
				(documents) =>
					new Set(documents.map(({ id }) => id)).size === documents.length,
			),
		automatic: z
			.strictObject({
				minimumConfidence: z.number().min(0.5).max(1),
				economics: z
					.strictObject({ minimumReturn: z.number().min(1).max(10) })
					.optional(),
			})
			.optional(),
		relevance: z
			.strictObject({
				instructions: z.string().trim().min(1).max(500),
				minimumConfidence: z.number().min(0.5).max(1),
				pricing: pricingSchema.optional(),
			})
			.optional(),
	})
	.refine(
		(policy) => !policy.automatic || !policy.relevance,
		"Automatic selection includes relevance filtering",
	);
export type ContextPolicy = z.infer<typeof contextPolicySchema>;

/** Prune instructions when their explicitly selected inputs are removed. */
export function retainBoundInstructions(
	policy: ContextPolicy,
	variables: string[],
	upstreamIds: string[],
): ContextPolicy {
	const selectedVariables = new Set(variables);
	const availableOutputs = new Set(upstreamIds);
	const selectedOutputs = new Set(policy.outputNodeIds);
	return {
		...policy,
		instructions: policy.instructions?.filter(({ condition }) =>
			condition.kind === "variable"
				? selectedVariables.has(condition.name)
				: policy.upstream === "all"
					? availableOutputs.has(condition.nodeId)
					: policy.upstream === "selected" &&
						selectedOutputs.has(condition.nodeId) &&
						availableOutputs.has(condition.nodeId),
		),
	};
}
export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
	historyMessages: 6,
	maxCharacters: 24000,
	upstream: "all",
	outputNodeIds: [],
	documents: [],
};

export const contextSelectionSchema = z.strictObject({
	id: z.string(),
	sourceId: z.string(),
	kind: z.enum(["message", "output", "document"]),
	label: z.string(),
	representation: z.enum(["full", "summary", "short", "detailed"]),
	characters: z.number().int().min(0),
	included: z.boolean(),
	reason: z.enum([
		"selected",
		"binding",
		"history",
		"budget",
		"irrelevant",
		"uncertain",
		"unavailable",
		"automatic",
	]),
	summaryCache: z.enum(["created", "reused", "unavailable"]).optional(),
	probability: z.number().min(0).max(1).optional(),
	preview: z.string().max(600).optional(),
	previewTruncated: z.boolean().optional(),
	passage: z
		.object({ start: z.number().int().min(0), end: z.number().int().min(1) })
		.optional(),
});
export type ContextSelection = z.infer<typeof contextSelectionSchema>;
export type ContextChunk = Pick<
	ContextSelection,
	"id" | "sourceId" | "kind" | "label" | "representation" | "passage"
> & { content: string };
export const preparationDecisionSchema = z.strictObject({
	status: z.enum([
		"prepare",
		"retain-full",
		"budget-required",
		"unknown-price",
	]),
	estimatedCostUsd: z.number().finite().min(0).optional(),
	optimisticSavingsUsd: z.number().finite().min(0).optional(),
	minimumReturn: z.number().min(1).max(10),
	estimation: z.literal("cold-utf8-estimate"),
});
export type PreparationDecision = z.infer<typeof preparationDecisionSchema>;
export const nodeContextTraceSchema = z.strictObject({
	nodeId: z.string(),
	callId: z.string(),
	characters: z.number().int().min(0),
	chunks: z.array(contextSelectionSchema),
	retrieval: retrievalTraceSchema.optional(),
	preparation: preparationDecisionSchema.optional(),
	instructions: z
		.array(z.object({ id: z.string(), name: z.string(), active: z.boolean() }))
		.max(8)
		.optional(),
});
export type NodeContextTrace = z.infer<typeof nodeContextTraceSchema>;

export const contextSummariesSchema = z.strictObject({
	short: z.string().trim().min(1).max(600),
	detailed: z.string().trim().min(1).max(2400),
});
export type ContextSummaries = z.infer<typeof contextSummariesSchema>;

export function resolveContextDocuments(
	defaults: ContextDocument[],
	supplied: ContextDocument[] = [],
): ContextDocument[] {
	const overrides = new Map(
		supplied.map((document) => [document.id, document]),
	);
	if (
		supplied.some((document) => !defaults.some(({ id }) => id === document.id))
	)
		throw new Error("Context documents must be declared in Start");
	// Replace the whole document so a new body never inherits a stale summary.
	return contextDocumentsSchema.parse(
		defaults.map((document) => overrides.get(document.id) ?? document),
	);
}
