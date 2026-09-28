import type {
	ContextChunk,
	ContextSelection,
	ContextSummaries,
} from "../src/lib/context.ts";
import { DEFAULT_OPENAI_MODEL } from "../src/lib/routing.ts";
import type { TokenUsage } from "../src/lib/usage.ts";
import { mapConcurrent } from "./concurrency.ts";
import type { RelevanceResult } from "./context.ts";
import {
	contentFingerprint,
	type SessionMemory,
	type SummaryStore,
} from "./session-memory.ts";

export type SummaryRequest = { nodeId: string; chunk: ContextChunk };
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
	price?: (chunks: ContextChunk[]) => number;
}) => Promise<AutomaticContextChoice[]>;

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
): Promise<AutomaticContextChoice[]> {
	const sources = await mapConcurrent(request.chunks, 2, async (chunk) => {
		signal?.throwIfAborted();
		if (chunk.content.length <= 1600)
			return { chunk, summaries: undefined, cache: undefined };
		try {
			const cached = await memory.summarize(
				contentFingerprint(
					`summaries:v1:${DEFAULT_OPENAI_MODEL}:none:${chunk.kind}:${chunk.content}`,
				),
				async () => {
					const result = await summarize({ nodeId: request.nodeId, chunk });
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
			!valid(probabilities[`${chunk.id}:useful`])
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
	return choices;
}
