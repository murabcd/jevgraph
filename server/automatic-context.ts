import type {
	ContextChunk,
	ContextSelection,
	ContextSummaries,
	PreparationDecision,
} from "../src/lib/context.ts";
import { publishedRates } from "../src/lib/model-pricing.ts";
import { DEFAULT_OPENAI_MODEL, JEV_MODEL_ID } from "../src/lib/routing.ts";
import type { TokenUsage } from "../src/lib/usage.ts";
import { estimateCost } from "../src/lib/usage.ts";
import { mapConcurrent } from "./concurrency.ts";
import type { RelevanceResult } from "./context.ts";
import {
	contextAssessmentPacket,
	SUMMARY_INSTRUCTIONS,
	SUMMARY_MAX_OUTPUT,
	summaryPrompt,
} from "./context-providers.ts";
import { estimateInputTokens } from "./model-planner.ts";
import {
	contentFingerprint,
	type SessionMemory,
	type SummaryStore,
} from "./session-memory.ts";

export type SummaryRequest = {
	nodeId: string;
	chunk: ContextChunk;
	query: string;
	task: string;
};
export type SummaryResult = {
	summaries: ContextSummaries;
	model: string;
	usage?: TokenUsage;
};
export type ContextAssessmentRequest = {
	nodeId: string;
	query: string;
	task: string;
	sources: { id: string; full: string; summaries?: ContextSummaries }[];
};
export type AutomaticContextChoice = {
	chunk: ContextChunk;
	included: boolean;
	reason: ContextSelection["reason"];
	probability?: number;
	summaryCache?: ContextSelection["summaryCache"];
};
export type ContextOptimizer = (request: {
	nodeId: string;
	query: string;
	task: string;
	chunks: ContextChunk[];
	minimumConfidence: number;
	economics?: { minimumReturn: number };
	maxCharacters: number;
	price?: (chunks: ContextChunk[]) => number;
}) => Promise<{
	choices: AutomaticContextChoice[];
	preparation?: PreparationDecision;
}>;

/** Cold forecast includes summary output ceilings and the batch adequacy packet. */
export function estimatePreparationCost(
	request: Parameters<ContextOptimizer>[0],
): number | undefined {
	let total = 0;
	const sources = request.chunks.map((chunk) => {
		if (chunk.content.length <= 1600)
			return { id: chunk.id, full: chunk.content };
		const tokens = estimateInputTokens(
			SUMMARY_INSTRUCTIONS + summaryPrompt({ ...request, chunk }),
		);
		const cost = estimateCost(
			{ inputTokens: tokens, outputTokens: SUMMARY_MAX_OUTPUT },
			publishedRates("openai", DEFAULT_OPENAI_MODEL, tokens),
		);
		if (cost === undefined) total = NaN;
		else total += cost;
		return {
			id: chunk.id,
			full: chunk.content,
			summaries: { short: "x".repeat(600), detailed: "x".repeat(2400) },
		};
	});
	const packet = contextAssessmentPacket({ ...request, sources });
	const tokens = estimateInputTokens(JSON.stringify(packet));
	const assessment = estimateCost(
		{ inputTokens: tokens, outputTokens: 0 },
		publishedRates("jev", JEV_MODEL_ID, tokens),
	);
	return Number.isFinite(total) && assessment !== undefined
		? total + assessment
		: undefined;
}

export async function chooseContextRepresentations(
	request: Parameters<ContextOptimizer>[0],
	{
		memory,
		summarize,
		assess,
		signal,
		summaryStore,
	}: {
		memory: SessionMemory;
		summaryStore?: SummaryStore;
		summarize: (request: SummaryRequest) => Promise<SummaryResult>;
		assess: (request: ContextAssessmentRequest) => Promise<RelevanceResult>;
		signal?: AbortSignal;
	},
): ReturnType<ContextOptimizer> {
	signal?.throwIfAborted();
	let preparation: PreparationDecision | undefined;
	if (request.economics) {
		const estimatedCostUsd = estimatePreparationCost(request);
		const full = request.price?.(request.chunks);
		const empty = request.price?.([]);
		const optimisticSavingsUsd =
			full !== undefined &&
			empty !== undefined &&
			Number.isFinite(full) &&
			Number.isFinite(empty)
				? Math.max(0, full - empty)
				: undefined;
		const budgetRequired =
			request.chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) >
			request.maxCharacters;
		const status = budgetRequired
			? "budget-required"
			: estimatedCostUsd === undefined || optimisticSavingsUsd === undefined
				? "unknown-price"
				: optimisticSavingsUsd >=
						estimatedCostUsd * request.economics.minimumReturn
					? "prepare"
					: "retain-full";
		preparation = {
			status,
			estimatedCostUsd,
			optimisticSavingsUsd,
			minimumReturn: request.economics.minimumReturn,
			estimation: "cold-utf8-estimate",
		};
		if (status === "retain-full" || status === "unknown-price")
			return {
				preparation,
				choices: request.chunks.map((chunk) => ({
					chunk,
					included: true,
					reason: "selected",
				})),
			};
	}
	const sources = await mapConcurrent(request.chunks, 2, async (chunk) => {
		signal?.throwIfAborted();
		if (chunk.content.length <= 1600)
			return { chunk, summaries: undefined, cache: undefined };
		try {
			const cached = await memory.summarize(
				contentFingerprint(
					JSON.stringify([
						"summaries:v2",
						DEFAULT_OPENAI_MODEL,
						"none",
						chunk.kind,
						chunk.content,
						request.query,
						request.task,
					]),
				),
				async () => {
					const result = await summarize({
						nodeId: request.nodeId,
						chunk,
						query: request.query,
						task: request.task,
					});
					signal?.throwIfAborted();
					return result.summaries;
				},
				summaryStore,
			);
			return { chunk, summaries: cached.value, cache: cached.cache };
		} catch {
			signal?.throwIfAborted();
			return { chunk, summaries: undefined, cache: "unavailable" as const };
		}
	});
	let probabilities: Record<string, number> = {};
	try {
		const result = await assess({
			nodeId: request.nodeId,
			query: request.query,
			task: request.task,
			sources: sources.map(({ chunk, summaries }) => ({
				id: chunk.id,
				full: chunk.content,
				summaries,
			})),
		});
		probabilities = result.probabilities;
	} catch {
		signal?.throwIfAborted();
	}
	signal?.throwIfAborted();
	const valid = (value: number | undefined) =>
		value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1;
	const choices: AutomaticContextChoice[] = sources.map(({ chunk, cache }) => {
		const useful = probabilities[`${chunk.id}:useful`];
		return {
			chunk,
			included: !valid(useful) || 1 - useful < request.minimumConfidence,
			reason: !valid(useful)
				? "unavailable"
				: 1 - useful >= request.minimumConfidence
					? "irrelevant"
					: useful < request.minimumConfidence
						? "uncertain"
						: "automatic",
			probability: valid(useful) ? useful : undefined,
			summaryCache: cache,
		};
	});
	for (const [index, { chunk, summaries }] of sources.entries()) {
		const choice = choices[index];
		if (
			!choice.included ||
			!summaries ||
			!valid(probabilities[`${chunk.id}:useful`]) ||
			probabilities[`${chunk.id}:useful`] < request.minimumConfidence
		)
			continue;
		const candidates: { chunk: ContextChunk; probability?: number }[] = [
			{ chunk, probability: choice.probability },
		];
		for (const representation of ["short", "detailed"] as const) {
			const probability = probabilities[`${chunk.id}:${representation}`];
			if (
				valid(probability) &&
				probability >= request.minimumConfidence &&
				summaries[representation].length < chunk.content.length
			) {
				candidates.push({
					chunk: {
						...chunk,
						content: summaries[representation],
						representation,
					},
					probability,
				});
			}
		}
		const cost = (candidate: ContextChunk) =>
			request.price
				? request.price(
						choices.flatMap((item, i) =>
							item.included ? [i === index ? candidate : item.chunk] : [],
						),
					)
				: candidate.content.length;
		const selected = candidates
			.map((candidate) => ({ ...candidate, cost: cost(candidate.chunk) }))
			.toSorted(
				(a, b) =>
					a.cost - b.cost || a.chunk.content.length - b.chunk.content.length,
			)[0];
		choice.chunk = selected.chunk;
		choice.probability = selected.probability;
		if (selected.chunk.representation !== chunk.representation)
			choice.reason = "automatic";
	}
	return { choices, preparation };
}
