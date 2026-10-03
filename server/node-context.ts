import type { ContextDocument } from "../src/lib/context.ts";
import { EMBEDDING_MODEL } from "../src/lib/retrieval.ts";
import {
	type ChatMessage,
	DEFAULT_OPENAI_MODEL,
	JEV_MODEL_ID,
	modelTarget,
	type NodeOutput,
	type RoutingMetadata,
	selectedVariables,
	type WorkflowNode,
} from "../src/lib/routing.ts";
import {
	type ContextAssessmentRequest,
	chooseContextRepresentations,
	type SummaryRequest,
	type SummaryResult,
} from "./automatic-context.ts";
import { resolveInstructions } from "./conditional-instructions.ts";
import {
	type ContextFilter,
	prepareContext,
	type RelevanceResult,
} from "./context.ts";
import { projectModelCost } from "./model-planner.ts";
import type { ProviderLedger } from "./provider-ledger.ts";
import type { ContextRetriever, RetrievalRequest } from "./retrieval.ts";
import type { SessionMemory, SummaryStore } from "./session-memory.ts";

export type ContextProviders = {
	retrieval?: {
		retrieve: ContextRetriever;
	} & Pick<RetrievalRequest, "embed" | "rerank">;
	filter?: ContextFilter;
	automatic?: {
		summarize: (request: SummaryRequest) => Promise<SummaryResult>;
		assess: (request: ContextAssessmentRequest) => Promise<RelevanceResult>;
	};
};

/** Wires context policy to priced, accounted providers outside the graph scheduler. */
export async function prepareNodeContext(
	{
		node,
		callId,
		messages,
		inputs,
		documents,
		variables,
	}: {
		node: Exclude<WorkflowNode, { kind: "input" }>;
		callId: string;
		messages: ChatMessage[];
		inputs: NodeOutput[];
		documents: ContextDocument[];
		variables: RoutingMetadata;
	},
	{
		memory,
		summaryStore,
		availableModels,
		ledger,
		providers = {},
		signal,
	}: {
		memory: SessionMemory;
		summaryStore?: SummaryStore;
		availableModels: ReadonlySet<string>;
		ledger: ProviderLedger;
		providers?: ContextProviders;
		signal?: AbortSignal;
	},
) {
	const { automatic, filter, retrieval } = providers;
	const retrievalPolicy = node.context?.retrieval;
	const selected = selectedVariables(variables, node.variables);
	const effective = resolveInstructions({
		base:
			node.kind === "jev"
				? node.questions
						.map(({ name, instructions }) => `${name}: ${instructions}`)
						.join("\n\n")
				: (node.prompt ?? ""),
		policy: node.context,
		variables: selected,
		inputs,
	});
	const task = [
		effective.instructions,
		Object.keys(selected).length
			? `Selected Start values (data): ${JSON.stringify(selected)}`
			: "",
	]
		.filter(Boolean)
		.join("\n\n");
	const prepared = await prepareContext({
		nodeId: node.id,
		task,
		callId,
		messages,
		inputs,
		documents,
		policy: node.context,
		signal,
		retrieve:
			retrieval && retrievalPolicy
				? (request) =>
						retrieval.retrieve({
							...request,
							policy: retrievalPolicy,
							signal,
							embed: (values) =>
								ledger.run(
									{
										nodeId: node.id,
										purpose: "embedding",
										provider: "openai",
										model: EMBEDDING_MODEL,
									},
									undefined,
									ledger.nextId(),
									() => retrieval.embed(values),
								),
							rerank: (request) =>
								ledger.run(
									{
										nodeId: node.id,
										purpose: "rerank",
										provider: "jev",
										model: JEV_MODEL_ID,
									},
									undefined,
									ledger.nextId(),
									() => retrieval.rerank(request),
								),
						})
				: undefined,
		price:
			node.kind === "model" &&
			(node.routing || node.context?.automatic?.economics)
				? (context) =>
						projectModelCost(
							{
								target: {
									...modelTarget(node),
									prompt: effective.instructions,
								},
								context,
								variables: selected,
							},
							memory,
							availableModels,
						)
				: undefined,
		optimize: automatic
			? (request) =>
					chooseContextRepresentations(request, {
						memory,
						summaryStore,
						signal,
						summarize: (summary) =>
							ledger.run(
								{
									nodeId: node.id,
									purpose: "summary",
									provider: "openai",
									model: DEFAULT_OPENAI_MODEL,
								},
								undefined,
								ledger.nextId(),
								() => automatic.summarize(summary),
							),
						assess: (assessment) =>
							ledger.run(
								{
									nodeId: node.id,
									purpose: "context",
									provider: "jev",
									model: JEV_MODEL_ID,
								},
								undefined,
								ledger.nextId(),
								() => automatic.assess(assessment),
							),
					})
			: undefined,
		filter: filter
			? (request) =>
					ledger.run(
						{
							nodeId: node.id,
							purpose: "context",
							provider: "jev",
							model: JEV_MODEL_ID,
						},
						node.context?.relevance?.pricing,
						ledger.nextId(),
						() => filter(request),
					)
			: undefined,
	});
	return {
		...prepared,
		instructions: effective.instructions,
		activeInstructions: effective.activeInstructions,
		trace: {
			...prepared.trace,
			instructions: effective.trace.length ? effective.trace : undefined,
		},
	};
}
