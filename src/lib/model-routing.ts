import { z } from "zod";
import {
	MAX_MODEL_CONFIGURATIONS,
	modelConfigurationKey,
	modelConfigurationSchema,
} from "./model-configuration.ts";
import { qualityPolicySchema, routeEvidenceSchema } from "./route-evidence.ts";

export const routingCandidateSchema = modelConfigurationSchema.safeExtend({
	criteria: z.string().trim().min(1).max(500),
});
export const modelRoutingSchema = z.strictObject({
	mode: z.enum(["evaluate", "automatic"]),
	quality: qualityPolicySchema,
	minimumConfidence: z.number().finite().min(0.5).max(1),
	candidates: z
		.array(routingCandidateSchema)
		.min(1)
		.max(MAX_MODEL_CONFIGURATIONS)
		.refine(
			(values) =>
				new Set(values.map(modelConfigurationKey)).size === values.length,
			"Configurations must be unique",
		),
	expectedOutputTokens: z.number().int().min(1).max(8192),
	expectedRequests: z.number().int().min(1).max(20),
});
export type ModelRouting = z.infer<typeof modelRoutingSchema>;

export const cacheModeSchema = z.enum([
	"uncached",
	"write",
	"reuse",
	"implicit",
]);
export type CacheMode = z.infer<typeof cacheModeSchema>;
export const modelQuoteSchema = modelConfigurationSchema.safeExtend({
	provider: z.enum(["openai", "google"]),
	inputTokens: z.number().int().min(0),
	prefixTokens: z.number().int().min(0),
	expectedCachedTokens: z.number().int().min(0),
	expectedOutputTokens: z.number().int().min(1),
	cache: cacheModeSchema,
	estimatedCostUsd: z.number().finite().min(0).optional(),
	estimatedTotalUsd: z.number().finite().min(0).optional(),
	evidence: routeEvidenceSchema.optional(),
	taskProbability: z.number().finite().min(0).max(1).optional(),
	estimatedRouteCostUsd: z.number().finite().min(0).optional(),
	estimatedCostPerPassUsd: z.number().finite().min(0).optional(),
	excluded: z
		.enum([
			"unavailable",
			"unknown-price",
			"missing-evidence",
			"insufficient-cases",
			"unreviewed",
			"quality",
			"latency",
			"incomplete-cost",
			"different-cases",
			"task",
		])
		.optional(),
});
export type ModelQuote = z.infer<typeof modelQuoteSchema>;
export const modelPlanSchema = z.strictObject({
	nodeId: z.string(),
	callId: z.string(),
	selectedModel: z.string(),
	selectedReasoningEffort: modelConfigurationSchema.shape.reasoningEffort,
	mode: z.enum(["evaluate", "automatic"]),
	expectedRequests: z.number().int().min(1).max(20),
	preparationCostUsd: z.number().finite().min(0).optional(),
	estimation: z.literal("utf8-estimate"),
	candidates: z.array(modelQuoteSchema).min(1).max(MAX_MODEL_CONFIGURATIONS),
});
export type ModelPlan = z.infer<typeof modelPlanSchema>;
