import { z } from "zod";
import { reasoningEfforts, textModels } from "./models.ts";

export function routingReasoningEfforts(models: string[]) {
	return reasoningEfforts.filter((effort) =>
		models.every((id) =>
			textModels
				.find((model) => model.id === id)
				?.reasoning.efforts.includes(effort),
		),
	);
}

export const modelRoutingSchema = z.strictObject({
	models: z
		.array(z.string())
		.min(1)
		.max(2)
		.refine(
			(models) =>
				new Set(models).size === models.length &&
				models.every((id) => textModels.some((model) => model.id === id)),
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
export const modelQuoteSchema = z.strictObject({
	model: z.string(),
	provider: z.enum(["openai", "google"]),
	inputTokens: z.number().int().min(0),
	prefixTokens: z.number().int().min(0),
	expectedCachedTokens: z.number().int().min(0),
	expectedOutputTokens: z.number().int().min(1),
	cache: cacheModeSchema,
	estimatedCostUsd: z.number().finite().min(0).optional(),
	estimatedTotalUsd: z.number().finite().min(0).optional(),
	excluded: z.enum(["unavailable", "unknown-price"]).optional(),
});
export type ModelQuote = z.infer<typeof modelQuoteSchema>;
export const modelPlanSchema = z.strictObject({
	nodeId: z.string(),
	callId: z.string(),
	selectedModel: z.string(),
	expectedRequests: z.number().int().min(1).max(20),
	preparationCostUsd: z.number().finite().min(0).optional(),
	estimation: z.literal("utf8-estimate"),
	candidates: z.array(modelQuoteSchema).min(1).max(2),
});
export type ModelPlan = z.infer<typeof modelPlanSchema>;
