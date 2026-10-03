import type { LanguageModelUsage } from "ai";
import { type TokenUsage, tokenUsageSchema } from "../src/lib/usage.ts";

export function languageModelUsage(
	usage: LanguageModelUsage,
): TokenUsage | undefined {
	return tokenUsageSchema.safeParse({
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
		cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
		reasoningTokens: usage.outputTokenDetails.reasoningTokens,
	}).data;
}

export class ProviderUsageError extends Error {
	readonly usage: TokenUsage | undefined;
	readonly model: string | undefined;
	constructor(cause: unknown, usage: TokenUsage | undefined, model?: string) {
		super(cause instanceof Error ? cause.message : "Provider call failed", {
			cause,
		});
		this.usage = usage;
		this.model = model;
	}
}

export function evaluationUsage(
	usage: Pick<TokenUsage, "inputTokens" | "outputTokens">,
): TokenUsage | undefined {
	return tokenUsageSchema.safeParse({
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
	}).data;
}
