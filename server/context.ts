import {
	type ContextChunk,
	type ContextDocument,
	type ContextPolicy,
	type ContextSelection,
	DEFAULT_CONTEXT_POLICY,
	type NodeContextTrace,
} from "../src/lib/context.ts";
import type { ChatMessage, NodeOutput } from "../src/lib/routing.ts";
import type { TokenUsage } from "../src/lib/usage.ts";
import type { ContextOptimizer } from "./automatic-context.ts";
import type { RetrievalResult } from "./retrieval.ts";
import { formattedOutput } from "./upstream-context.ts";

export type RelevanceResult = {
	probabilities: Record<string, number>;
	model?: string;
	usage?: TokenUsage;
};
export type ContextFilter = (request: {
	nodeId: string;
	query: string;
	task: string;
	instructions: string;
	chunks: ContextChunk[];
}) => Promise<RelevanceResult>;
export type ContextContent = {
	messages: ChatMessage[];
	inputs: NodeOutput[];
	documents: ContextChunk[];
};
export type PreparedContext = ContextContent & { trace: NodeContextTrace };

function materializeContext(
	chunks: ContextChunk[],
	messages: ChatMessage[],
	inputs: NodeOutput[],
): ContextContent {
	const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
	return {
		messages: [
			...messages.slice(0, -1).flatMap((message, index) => {
				const chunk = byId.get(`message:${index}`);
				return chunk ? [{ ...message, content: chunk.content }] : [];
			}),
			...messages.slice(-1),
		],
		inputs: inputs.flatMap((output) => {
			const chunk = byId.get(`output:${output.nodeId}:${output.revision}`);
			return !chunk
				? []
				: [
						chunk.representation === "full"
							? output
							: { ...output, text: chunk.content },
					];
		}),
		documents: chunks.filter((chunk) => chunk.kind === "document"),
	};
}

export async function prepareContext({
	nodeId,
	task = "",
	callId,
	messages,
	inputs,
	documents,
	policy = DEFAULT_CONTEXT_POLICY,
	filter,
	optimize,
	price,
	signal,
	retrieve,
}: {
	nodeId: string;
	task?: string;
	callId: string;
	messages: ChatMessage[];
	inputs: NodeOutput[];
	documents: ContextDocument[];
	policy?: ContextPolicy;
	filter?: ContextFilter;
	optimize?: ContextOptimizer;
	price?: (context: ContextContent) => number;
	signal?: AbortSignal;
	retrieve?: (request: {
		query: string;
		task: string;
		documents: ContextDocument[];
	}) => Promise<RetrievalResult>;
}): Promise<PreparedContext> {
	const current = messages.at(-1);
	if (current?.role !== "user")
		throw new Error("Context needs a current user query");
	const history = messages.slice(0, -1).map(
		(message, index): ContextChunk => ({
			id: `message:${index}`,
			sourceId: String(index),
			kind: "message",
			label: `${message.role} ${index + 1}`,
			content: message.content,
			representation: "full",
		}),
	);
	const upstream = inputs.map(
		(output): ContextChunk => ({
			id: `output:${output.nodeId}:${output.revision}`,
			sourceId: output.sourceNodeId,
			kind: "output",
			label: output.nodeId,
			content: formattedOutput(output),
			representation: "full",
		}),
	);
	const documentBindings = new Map(
		policy.documents.map((binding) => [binding.id, binding]),
	);
	if (policy.retrieval && !retrieve)
		throw new Error("Retrieval is unavailable");
	const retrieved =
		policy.retrieval && retrieve
			? await retrieve({
					query: current.content,
					task,
					documents: documents.filter((document) =>
						documentBindings.has(document.id),
					),
				})
			: undefined;
	signal?.throwIfAborted();
	const documentChunks =
		retrieved?.chunks ??
		documents.map((document): ContextChunk => {
			const binding = policy.automatic
				? undefined
				: documentBindings.get(document.id);
			if (binding?.representation === "summary" && !document.summary)
				throw new Error(`Document ${document.name} needs a summary`);
			return {
				id: `document:${document.id}`,
				sourceId: document.id,
				kind: "document",
				label: document.name,
				content:
					binding?.representation === "summary"
						? (document.summary ?? "")
						: document.content,
				representation: binding?.representation ?? "full",
			};
		});
	const chunks = [...history, ...upstream, ...documentChunks];
	const boundSources = {
		message: new Set(
			history
				.slice(Math.max(0, history.length - policy.historyMessages))
				.map((chunk) => chunk.sourceId),
		),
		output: new Set(
			policy.upstream === "all"
				? upstream.map((chunk) => chunk.sourceId)
				: policy.upstream === "selected"
					? policy.outputNodeIds
					: [],
		),
		document: new Set([
			...documentBindings.keys(),
			...(retrieved?.chunks.map((chunk) => chunk.sourceId) ?? []),
		]),
	};
	const selections = new Map<string, ContextSelection>();
	const select = (
		chunk: ContextChunk,
		included: boolean,
		reason: ContextSelection["reason"],
		probability?: number,
	) => {
		const { content, ...source } = chunk;
		selections.set(chunk.id, {
			...selections.get(chunk.id),
			...source,
			characters: content.length,
			included,
			reason,
			probability,
		});
	};
	for (const chunk of chunks) {
		const bound = boundSources[chunk.kind].has(chunk.sourceId);
		select(
			chunk,
			bound,
			bound ? "selected" : chunk.kind === "message" ? "history" : "binding",
		);
	}
	// Prefer explicit workflow/documents, then newest history. Never cut a chunk in half.
	const priority = [...upstream, ...documentChunks, ...history.toReversed()];
	const enforceBudget = (limit: number) => {
		let characters = 0;
		for (const chunk of priority) {
			if (!selections.get(chunk.id)?.included) continue;
			if (characters + chunk.content.length > limit)
				select(chunk, false, "budget");
			else characters += chunk.content.length;
		}
	};
	let preparation: NodeContextTrace["preparation"];
	// Bound the source bodies sent for automatic assessment, before compression.
	enforceBudget(policy.automatic ? 120000 : policy.maxCharacters);
	if (policy.automatic) {
		const candidates = chunks.filter(
			(chunk) => selections.get(chunk.id)?.included,
		);
		if (candidates.length && optimize) {
			const optimized = await optimize({
				nodeId,
				task,
				query: current.content,
				chunks: candidates,
				minimumConfidence: policy.automatic.minimumConfidence,
				economics: policy.automatic.economics,
				maxCharacters: policy.maxCharacters,
				price: price
					? (selected) => price(materializeContext(selected, messages, inputs))
					: undefined,
			});
			preparation = optimized.preparation;
			const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
			for (const choice of optimized.choices) {
				const chunk = byId.get(choice.chunk.id);
				if (!chunk) continue;
				Object.assign(chunk, choice.chunk);
				select(chunk, choice.included, choice.reason, choice.probability);
				const selection = selections.get(chunk.id);
				if (selection) selection.summaryCache = choice.summaryCache;
			}
		} else for (const chunk of candidates) select(chunk, true, "unavailable");
		enforceBudget(policy.maxCharacters);
	}
	const candidates = chunks.filter(
		(chunk) => selections.get(chunk.id)?.included,
	);
	if (policy.relevance && candidates.length) {
		let probabilities: Record<string, number> | undefined;
		try {
			if (!filter) throw new Error("Context relevance is unavailable");
			({ probabilities } = await filter({
				nodeId,
				task,
				query: current.content,
				instructions: policy.relevance.instructions,
				chunks: candidates,
			}));
		} catch {
			signal?.throwIfAborted();
		}
		for (const chunk of candidates) {
			const probability = probabilities?.[chunk.id];
			if (
				probability === undefined ||
				!Number.isFinite(probability) ||
				probability < 0 ||
				probability > 1
			)
				select(chunk, true, "unavailable");
			else if (1 - probability >= policy.relevance.minimumConfidence)
				select(chunk, false, "irrelevant", probability);
			else
				select(
					chunk,
					true,
					probability >= policy.relevance.minimumConfidence
						? "selected"
						: "uncertain",
					probability,
				);
		}
	}
	signal?.throwIfAborted();
	const included = (id: string) => selections.get(id)?.included;
	let previewBudget = 4000;
	for (const chunk of chunks) {
		const selection = selections.get(chunk.id);
		if (!selection?.included) continue;
		const preview = chunk.content.slice(0, Math.min(600, previewBudget));
		previewBudget -= preview.length;
		selection.preview = preview;
		selection.previewTruncated = preview.length < chunk.content.length;
	}
	return {
		...materializeContext(
			chunks.filter((chunk) => included(chunk.id)),
			messages,
			inputs,
		),
		trace: {
			retrieval: retrieved?.trace,
			preparation,
			nodeId,
			callId,
			characters: chunks.reduce(
				(sum, chunk) => sum + (included(chunk.id) ? chunk.content.length : 0),
				0,
			),
			chunks: [...selections.values()],
		},
	};
}
