import type { ContextChunk, ContextDocument } from "../src/lib/context.ts";
import {
	MAX_RETRIEVAL_CHUNKS,
	type Passage,
	type RetrievalCandidate,
	type RetrievalPolicy,
	type RetrievalSource,
	type RetrievalTrace,
	retrievalSourceKey,
	splitPassages,
} from "../src/lib/retrieval.ts";
import type { TokenUsage } from "../src/lib/usage.ts";
import { mapConcurrent } from "./concurrency.ts";

export type EmbeddingResult = {
	embeddings: number[][];
	model: string;
	usage?: TokenUsage;
};
export type RerankResult = {
	grades: Record<string, { grade: number; confidence: number }>;
	model: string;
	usage?: TokenUsage;
};
export type RetrievalStore = {
	identity: string;
	history: (
		limit: number,
	) => Promise<{ sources: RetrievalSource[]; limited: boolean }>;
	cached: (keys: string[]) => Promise<string[]>;
	put: (
		key: string,
		source: RetrievalSource,
		chunks: (Passage & { embedding: number[] })[],
	) => Promise<void>;
	search: (request: {
		keys: string[];
		vector: number[];
		text: string;
		limit: number;
	}) => Promise<RetrievalCandidate[]>;
};
export type RetrievalRequest = {
	query: string;
	task: string;
	documents: ContextDocument[];
	policy: RetrievalPolicy;
	embed: (values: string[]) => Promise<EmbeddingResult>;
	rerank: (request: {
		query: string;
		task: string;
		candidates: RetrievalCandidate[];
	}) => Promise<RerankResult>;
	signal?: AbortSignal;
};
export type RetrievalResult = { chunks: ContextChunk[]; trace: RetrievalTrace };
export type ContextRetriever = (
	request: RetrievalRequest,
) => Promise<RetrievalResult>;

/** One turn shares pending indexing work; persistent source identity survives restarts. */
export function createContextRetriever(
	store: RetrievalStore,
): ContextRetriever {
	const pending = new Map<string, Promise<void>>();
	return async ({ query, task, documents, policy, embed, rerank, signal }) => {
		signal?.throwIfAborted();
		const history = policy.historyMessages
			? await store.history(policy.historyMessages)
			: { sources: [], limited: false };
		signal?.throwIfAborted();
		const sources: RetrievalSource[] = [
			...documents.map((document) => ({
				id: document.id,
				label: document.name,
				kind: "document" as const,
				content: document.content,
			})),
			...history.sources,
		];
		const entries = await Promise.all(
			sources.map(async (source) => ({
				source,
				key: await retrievalSourceKey(store.identity, source),
			})),
		);
		if (
			sources.reduce(
				(count, source) => count + splitPassages(source.content).length,
				0,
			) > MAX_RETRIEVAL_CHUNKS
		)
			throw new Error(
				"Selected retrieval sources exceed 512 passages. Reduce documents or history.",
			);
		const queryText = `${task.slice(0, 1800)}\n\n${query}`.trim();
		const trace: RetrievalTrace = {
			query: queryText,
			sources: sources.length,
			historyLimited: history.limited,
			reranking: "empty",
			candidates: [],
		};
		if (!entries.length) return { chunks: [], trace };
		const cached = new Set(await store.cached(entries.map(({ key }) => key)));
		signal?.throwIfAborted();
		const owned = entries.filter(
			({ key }) => !cached.has(key) && !pending.has(key),
		);
		let producer: Promise<void> | undefined;
		if (owned.length) {
			producer = (async () => {
				const plans = owned.map((entry) => {
					const chunks: (Passage & { embedding: number[] })[] = [];
					return {
						...entry,
						passages: splitPassages(entry.source.content),
						chunks,
					};
				});
				const passages = plans.flatMap((plan) =>
					plan.passages.map((passage) => ({ plan, passage })),
				);
				// Batch across source boundaries, including individual history messages.
				const batches = Array.from(
					{ length: Math.ceil(passages.length / 16) },
					(_, index) => passages.slice(index * 16, (index + 1) * 16),
				);
				await mapConcurrent(batches, 1, async (batch) => {
					signal?.throwIfAborted();
					const result = await embed(batch.map(({ passage }) => passage.text));
					if (result.embeddings.length !== batch.length)
						throw new Error("Embedding count does not match source passages");
					for (const [index, { plan, passage }] of batch.entries())
						plan.chunks.push({
							...passage,
							embedding: result.embeddings[index],
						});
				});
				await mapConcurrent(plans, 4, async (plan) => {
					signal?.throwIfAborted();
					await store.put(plan.key, plan.source, plan.chunks);
				});
			})();
			for (const { key } of owned) pending.set(key, producer);
		}
		try {
			const results = await Promise.allSettled([
				...new Set(
					entries
						.filter(({ key }) => !cached.has(key))
						.map(({ key }) => pending.get(key)),
				),
			]);
			for (const result of results)
				if (result.status === "rejected") throw result.reason;
		} finally {
			for (const { key } of owned)
				if (pending.get(key) === producer) pending.delete(key);
		}

		signal?.throwIfAborted();
		const embedded = await embed([queryText]);
		if (embedded.embeddings.length !== 1)
			throw new Error("Query embedding unavailable");
		signal?.throwIfAborted();
		const candidates = await store.search({
			keys: entries.map(({ key }) => key),
			vector: embedded.embeddings[0],
			text: query,
			limit: policy.candidates,
		});
		signal?.throwIfAborted();
		let grades: RerankResult["grades"] = {};
		if (candidates.length) {
			try {
				grades = (await rerank({ query, task, candidates })).grades;
				trace.reranking = candidates.every((candidate) => {
					const result = grades[candidate.id];
					return (
						result &&
						Number.isFinite(result.grade) &&
						result.grade >= 0 &&
						result.grade <= 3 &&
						Number.isFinite(result.confidence) &&
						result.confidence >= policy.minimumConfidence &&
						result.confidence <= 1
					);
				})
					? "completed"
					: "uncertain";
			} catch (error) {
				signal?.throwIfAborted();
				trace.reranking = "unavailable";
				trace.error =
					error instanceof Error ? error.message : "Jev reranking unavailable";
			}
		}
		signal?.throwIfAborted();
		// Partial confidence cannot safely reorder the complete evidence set.
		const ranked =
			trace.reranking === "completed"
				? candidates
						.filter((candidate) => Math.round(grades[candidate.id].grade) > 0)
						.toSorted(
							(a, b) =>
								grades[b.id].grade - grades[a.id].grade || a.rank - b.rank,
						)
				: candidates;
		const chosen = ranked.slice(0, policy.maxResults);
		const selected = new Set(chosen.map(({ id }) => id));
		trace.candidates = candidates.map(
			({ id, sourceId, label, start, end, rank }) => ({
				id,
				sourceId,
				label,
				start,
				end,
				rank,
				selected: selected.has(id),
				...(trace.reranking === "completed" ? grades[id] : {}),
			}),
		);
		return {
			trace,
			chunks: chosen.map(
				(candidate): ContextChunk => ({
					id: `passage:${candidate.id}`,
					sourceId: candidate.sourceId,
					kind: "document",
					label: `${candidate.label} · ${candidate.start}–${candidate.end}`,
					content: candidate.text,
					representation: "full",
					passage: { start: candidate.start, end: candidate.end },
				}),
			),
		};
	};
}
