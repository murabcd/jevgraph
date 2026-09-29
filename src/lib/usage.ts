import { z } from "zod";

const rateSchema = z.number().finite().min(0).max(10000);
export const pricingSchema = z.strictObject({
	input: rateSchema,
	output: rateSchema,
	cachedInput: rateSchema.optional(),
	cacheWrite: rateSchema.optional(),
});
export type Pricing = z.infer<typeof pricingSchema>;

const usdCostFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 8,
});

export function formatCostUsd(cost: number): string {
	return usdCostFormatter.format(cost);
}
const tokenCountSchema = z.number().int().min(0).optional();
export const tokenUsageSchema = z.strictObject({
	inputTokens: tokenCountSchema,
	outputTokens: tokenCountSchema,
	cachedInputTokens: tokenCountSchema,
	cacheWriteTokens: tokenCountSchema,
	reasoningTokens: tokenCountSchema,
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export const providerCallSchema = z.strictObject({
	id: z.string(),
	nodeId: z.string(),
	purpose: z.enum([
		"model",
		"decision",
		"context",
		"summary",
		"embedding",
		"rerank",
	]),
	provider: z.enum(["openai", "google", "jev"]),
	model: z.string(),
	status: z.enum(["completed", "failed"]),
	durationMs: z.number().finite().min(0),
	usage: tokenUsageSchema.optional(),
	estimatedCostUsd: z.number().finite().min(0).optional(),
	error: z.string().optional(),
});
export type ProviderCall = z.infer<typeof providerCallSchema>;
export const workflowUsageSchema = tokenUsageSchema.extend({
	complete: z.boolean(),
	estimatedCostUsd: z.number().finite().min(0).optional(),
	costComplete: z.boolean(),
});
export type WorkflowUsage = z.infer<typeof workflowUsageSchema>;

export function estimateCost(
	usage: TokenUsage | undefined,
	pricing: Pricing | undefined,
): number | undefined {
	if (
		!pricing ||
		usage?.inputTokens === undefined ||
		usage.outputTokens === undefined
	)
		return undefined;
	const reads = usage.cachedInputTokens ?? 0;
	const writes = usage.cacheWriteTokens ?? 0;
	if (reads + writes > usage.inputTokens) return undefined;
	if (
		(reads > 0 && pricing.cachedInput === undefined) ||
		(writes > 0 && pricing.cacheWrite === undefined)
	)
		return undefined;
	return (
		((usage.inputTokens - reads - writes) * pricing.input +
			reads * (pricing.cachedInput ?? 0) +
			writes * (pricing.cacheWrite ?? 0) +
			usage.outputTokens * pricing.output) /
		1000000
	);
}

export function totalUsage(calls: ProviderCall[]): WorkflowUsage {
	const total: WorkflowUsage = {
		complete: calls.every(
			(call) =>
				call.usage?.inputTokens !== undefined &&
				call.usage.outputTokens !== undefined,
		),
		costComplete: calls.every((call) => call.estimatedCostUsd !== undefined),
	};
	const keys = [
		"inputTokens",
		"outputTokens",
		"cachedInputTokens",
		"cacheWriteTokens",
		"reasoningTokens",
	] as const;
	for (const key of keys) {
		const values = calls.flatMap((call) =>
			call.usage?.[key] === undefined ? [] : [call.usage[key]],
		);
		if (values.length)
			total[key] = values.reduce((sum, value) => sum + value, 0);
	}
	const costs = calls.flatMap((call) =>
		call.estimatedCostUsd === undefined ? [] : [call.estimatedCostUsd],
	);
	if (costs.length)
		total.estimatedCostUsd = costs.reduce((sum, cost) => sum + cost, 0);
	return total;
}
