import { publishedRates } from "../src/lib/model-pricing.ts";
import type { ModelPlan, ModelQuote } from "../src/lib/model-routing.ts";
import { textModels } from "../src/lib/models.ts";
import type { RouteTarget, RoutingMetadata } from "../src/lib/routing.ts";
import { estimateCost, type TokenUsage } from "../src/lib/usage.ts";
import type { ContextContent } from "./context.ts";
import { modelPrompt, modelPromptPrefix } from "./model-prompt.ts";
import { contentFingerprint, type SessionMemory } from "./session-memory.ts";

export type ModelPlanningRequest = {
	target: RouteTarget;
	context: ContextContent;
	variables: RoutingMetadata;
};

/** A labelled estimate, not a tokenizer or a provider usage report. */
export function estimateInputTokens(value: string): number {
	return Math.ceil(new TextEncoder().encode(value).length / 4);
}

function prefixKey(
	target: Pick<RouteTarget, "model" | "reasoningEffort">,
	prefix: ReturnType<typeof modelPromptPrefix>,
): string {
	return contentFingerprint(
		JSON.stringify({
			model: target.model,
			reasoning: target.reasoningEffort,
			prefix,
		}),
	);
}

export function prefixIdentity(
	target: RouteTarget,
	context: ContextContent,
): { key: string; tokens: number } {
	const prefix = modelPromptPrefix(target, context.documents);
	return {
		key: prefixKey(target, prefix),
		tokens: estimateInputTokens(JSON.stringify(prefix)),
	};
}

export function quoteModels(
	{ target, context, variables }: ModelPlanningRequest,
	memory: SessionMemory,
	available: ReadonlySet<string>,
): ModelQuote[] {
	const routing = target.routing;
	const requests = routing?.expectedRequests ?? 1;
	const output = routing?.expectedOutputTokens ?? target.maxOutputTokens;
	const prefix = modelPromptPrefix(target, context.documents);
	const prefixTokens = estimateInputTokens(JSON.stringify(prefix));
	const inputTokens = Math.max(
		prefixTokens,
		estimateInputTokens(
			JSON.stringify(
				modelPrompt(
					context.messages,
					target,
					context.inputs,
					variables,
					context.documents,
				),
			),
		),
	);
	return (routing?.models ?? [target.model]).map((id): ModelQuote => {
		const model = textModels.find((model) => model.id === id);
		if (!model) throw new Error("Unsupported model candidate");
		const rates =
			id === target.model && target.pricing
				? target.pricing
				: publishedRates(model.provider, id, inputTokens);
		const known = Math.min(
			prefixTokens,
			memory.cachedTokens(prefixKey({ ...target, model: id }, prefix)),
		);
		const quote: ModelQuote = {
			model: id,
			provider: model.provider,
			inputTokens,
			prefixTokens,
			expectedOutputTokens: output,
			expectedCachedTokens: 0,
			cache: model.provider === "google" ? "implicit" : "uncached",
		};
		if (!available.has(id)) return { ...quote, excluded: "unavailable" };
		if (!rates) return { ...quote, excluded: "unknown-price" };
		const ordinary = estimateCost({ inputTokens, outputTokens: output }, rates);
		if (ordinary === undefined) return { ...quote, excluded: "unknown-price" };
		quote.estimatedCostUsd = ordinary;
		quote.estimatedTotalUsd = ordinary * requests;
		if (
			known > 0 &&
			prefixTokens >= (model.provider === "openai" ? 1024 : 4096) &&
			rates.cachedInput !== undefined
		) {
			quote.expectedCachedTokens = known;
			quote.cache = model.provider === "openai" ? "reuse" : "implicit";
			quote.estimatedCostUsd = estimateCost(
				{ inputTokens, outputTokens: output, cachedInputTokens: known },
				rates,
			);
			quote.estimatedTotalUsd = (quote.estimatedCostUsd ?? ordinary) * requests;
		} else if (
			model.provider === "openai" &&
			prefixTokens >= 1024 &&
			requests > 1 &&
			rates.cacheWrite !== undefined &&
			rates.cachedInput !== undefined
		) {
			const write = estimateCost(
				{ inputTokens, outputTokens: output, cacheWriteTokens: prefixTokens },
				rates,
			);
			const read = estimateCost(
				{ inputTokens, outputTokens: output, cachedInputTokens: prefixTokens },
				rates,
			);
			if (
				write !== undefined &&
				read !== undefined &&
				write + read * (requests - 1) < quote.estimatedTotalUsd
			) {
				quote.cache = "write";
				quote.estimatedCostUsd = write;
				quote.estimatedTotalUsd = write + read * (requests - 1);
			}
		}
		return quote;
	});
}

function cheapestQuote(candidates: ModelQuote[]): ModelQuote | undefined {
	let selected: ModelQuote | undefined;
	for (const candidate of candidates) {
		if (candidate.excluded || candidate.estimatedTotalUsd === undefined)
			continue;
		if (
			!selected ||
			candidate.estimatedTotalUsd < (selected.estimatedTotalUsd ?? Infinity)
		)
			selected = candidate;
	}
	return selected;
}

export function projectModelCost(
	request: ModelPlanningRequest,
	memory: SessionMemory,
	available: ReadonlySet<string>,
): number {
	return (
		cheapestQuote(quoteModels(request, memory, available))?.estimatedTotalUsd ??
		Infinity
	);
}

export function planModel(
	request: ModelPlanningRequest,
	memory: SessionMemory,
	available: ReadonlySet<string>,
	callId: string,
) {
	const candidates = quoteModels(request, memory, available);
	const selected = cheapestQuote(candidates);
	if (!selected) throw new Error("No available model has a known price");
	const plan: ModelPlan = {
		nodeId: request.target.nodeId,
		callId,
		selectedModel: selected.model,
		expectedRequests: request.target.routing?.expectedRequests ?? 1,
		estimation: "utf8-estimate",
		candidates,
	};
	return {
		plan,
		quote: selected,
		target: {
			...request.target,
			provider: selected.provider,
			model: selected.model,
			pricing:
				selected.model === request.target.model
					? request.target.pricing
					: undefined,
		},
	};
}

export function observeModelCache(
	target: RouteTarget,
	context: ContextContent,
	memory: SessionMemory,
	quote: ModelQuote,
	usage?: TokenUsage,
) {
	if (!usage) return;
	const prefix = prefixIdentity(target, context);
	// An observed miss replaces old evidence. Never infer a hit from a repeated string alone.
	const reported =
		(usage.cachedInputTokens ?? 0) +
		(target.provider === "openai" ? (usage.cacheWriteTokens ?? 0) : 0);
	memory.observePrefix(
		prefix.key,
		Math.min(prefix.tokens, reported),
		quote.cache === "uncached"
			? 0
			: target.provider === "openai"
				? 30 * 60 * 1000
				: 5 * 60 * 1000,
	);
}
