import {
	effectiveModelConfiguration,
	modelConfigurationKey,
} from "../src/lib/model-configuration.ts";
import { publishedRates } from "../src/lib/model-pricing.ts";
import type { ModelPlan, ModelQuote } from "../src/lib/model-routing.ts";
import { textModels } from "../src/lib/models.ts";
import type { RouteEvidence } from "../src/lib/route-evidence.ts";
import type { RouteTarget, RoutingMetadata } from "../src/lib/routing.ts";
import { estimateCost, type TokenUsage } from "../src/lib/usage.ts";
import type { ContextContent } from "./context.ts";
import { modelPrompt, modelPromptPrefix } from "./model-prompt.ts";
import { contentFingerprint, type SessionMemory } from "./session-memory.ts";

export type ModelPlanningRequest = {
	target: RouteTarget;
	context: ContextContent;
	variables: RoutingMetadata;
	evidence?: RouteEvidence[];
	assessment?: {
		probabilities: ReadonlyMap<string, number>;
		costUsd: number | undefined;
	};
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
	{ target, context, variables, evidence }: ModelPlanningRequest,
	memory: SessionMemory,
	available: ReadonlySet<string>,
): ModelQuote[] {
	const routing = target.routing;
	const requests = routing?.expectedRequests ?? 1;
	const expectedOutput =
		routing?.expectedOutputTokens ?? target.maxOutputTokens;
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
	return (routing?.candidates ?? [effectiveModelConfiguration(target)]).map(
		(candidate): ModelQuote => {
			const id = candidate.model;
			const measured = evidence?.find(
				(row) =>
					modelConfigurationKey(row) === modelConfigurationKey(candidate),
			);
			const output = Math.max(
				1,
				Math.ceil(measured?.meanOutputTokens ?? expectedOutput),
			);
			const model = textModels.find((model) => model.id === id);
			if (!model) throw new Error("Unsupported model candidate");
			const rates =
				id === target.model && target.pricing
					? target.pricing
					: publishedRates(model.provider, id, inputTokens);
			const known = Math.min(
				prefixTokens,
				memory.cachedTokens(prefixKey({ ...target, ...candidate }, prefix)),
			);
			const quote: ModelQuote = {
				model: id,
				reasoningEffort: candidate.reasoningEffort,
				provider: model.provider,
				inputTokens,
				prefixTokens,
				expectedOutputTokens: output,
				expectedCachedTokens: 0,
				cache: model.provider === "google" ? "implicit" : "uncached",
			};
			if (!available.has(id)) return { ...quote, excluded: "unavailable" };
			if (!rates) return { ...quote, excluded: "unknown-price" };
			const ordinary = estimateCost(
				{ inputTokens, outputTokens: output },
				rates,
			);
			if (ordinary === undefined)
				return { ...quote, excluded: "unknown-price" };
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
				quote.estimatedTotalUsd =
					(quote.estimatedCostUsd ?? ordinary) * requests;
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
					{
						inputTokens,
						outputTokens: output,
						cachedInputTokens: prefixTokens,
					},
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
		},
	);
}

function cheapestQuote(candidates: ModelQuote[]): ModelQuote | undefined {
	let selected: ModelQuote | undefined;
	for (const candidate of candidates) {
		if (candidate.excluded || candidate.estimatedTotalUsd === undefined)
			continue;
		if (
			!selected ||
			(candidate.estimatedCostPerPassUsd ?? candidate.estimatedTotalUsd) <
				(selected.estimatedCostPerPassUsd ??
					selected.estimatedTotalUsd ??
					Infinity)
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
	const routing = request.target.routing;
	if (!routing) throw new Error("Model routing settings required");
	const evidenceByModel = new Map(
		request.evidence?.map((item) => [modelConfigurationKey(item), item]),
	);
	if (routing.mode === "automatic") {
		for (const quote of candidates) {
			if (quote.excluded) continue;
			const evidence = evidenceByModel.get(modelConfigurationKey(quote));
			quote.evidence = evidence;
			if (!evidence) quote.excluded = "missing-evidence";
			else if (evidence.cases < routing.quality.minimumCases)
				quote.excluded = "insufficient-cases";
			else if (evidence.reviewed !== evidence.attempts)
				quote.excluded = "unreviewed";
			else if (
				evidence.passRate < routing.quality.minimumPassRate ||
				!evidence.passed
			)
				quote.excluded = "quality";
			else if (evidence.p95LatencyMs > routing.quality.maximumLatencyMs)
				quote.excluded = "latency";
			else if (
				evidence.meanCostUsd === undefined ||
				evidence.meanGenerationCostUsd === undefined ||
				(request.assessment && request.assessment.costUsd === undefined)
			)
				quote.excluded = "incomplete-cost";
			else {
				// Reprice this node; measured overhead includes the rest of the complete route.
				quote.estimatedRouteCostUsd =
					Math.max(0, evidence.meanCostUsd - evidence.meanGenerationCostUsd) +
					(quote.estimatedCostUsd ?? 0) * evidence.meanModelAttempts +
					(request.assessment?.costUsd ?? 0);
				quote.estimatedCostPerPassUsd =
					quote.estimatedRouteCostUsd / evidence.passRate;
			}
		}
	}
	const eligible = candidates.filter((quote) => !quote.excluded);
	if (
		routing.mode === "automatic" &&
		new Set(eligible.map((quote) => quote.evidence?.caseDistribution)).size > 1
	) {
		for (const quote of eligible) quote.excluded = "different-cases";
	}
	if (request.assessment) {
		for (const quote of candidates) {
			if (quote.excluded) continue;
			const probability = request.assessment.probabilities.get(
				modelConfigurationKey(quote),
			);
			if (
				probability === undefined ||
				!Number.isFinite(probability) ||
				probability < 0 ||
				probability > 1
			)
				throw new Error("Jev returned an invalid routing assessment");
			quote.taskProbability = probability;
			if (probability < routing.minimumConfidence) quote.excluded = "task";
		}
	}
	const selected =
		routing.mode === "evaluate"
			? candidates.find(
					(quote) =>
						quote.model === request.target.model &&
						quote.reasoningEffort ===
							effectiveModelConfiguration(request.target).reasoningEffort &&
						!quote.excluded,
				)
			: cheapestQuote(candidates);
	if (!selected)
		throw new Error(
			routing.mode === "evaluate"
				? "The evaluation model must be selected and available"
				: request.assessment
					? "No reviewed model and reasoning configuration meets this task’s routing criteria."
					: "No model meets the reviewed quality, latency, and cost requirements. Run evaluation mode and review its results.",
		);
	const plan: ModelPlan = {
		nodeId: request.target.nodeId,
		callId,
		selectedModel: selected.model,
		selectedReasoningEffort: selected.reasoningEffort,
		mode: routing.mode,
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
			reasoningEffort: selected.reasoningEffort,
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
