import type { ContextDocument } from "../src/lib/context.ts";
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
import {
	type ContextFilter,
	prepareContext,
	type RelevanceResult,
} from "./context.ts";
import { projectModelCost } from "./model-planner.ts";
import type { ProviderLedger } from "./provider-ledger.ts";
import type { SessionMemory } from "./session-memory.ts";

export type ContextProviders = {
	filter?: ContextFilter;
	automatic?: {
		summarize: (request: SummaryRequest) => Promise<SummaryResult>;
		assess: (request: ContextAssessmentRequest) => Promise<RelevanceResult>;
	};
};

/** Wires context policy to priced, accounted providers outside the graph scheduler. */
export function prepareNodeContext(
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
		availableModels,
		ledger,
		providers = {},
		signal,
	}: {
		memory: SessionMemory;
		availableModels: ReadonlySet<string>;
		ledger: ProviderLedger;
		providers?: ContextProviders;
		signal?: AbortSignal;
	},
) {
	const { automatic, filter } = providers;
	return prepareContext({
		nodeId: node.id,
		task: node.kind === "jev" ? node.question.instructions : node.prompt,
		callId,
		messages,
		inputs,
		documents,
		policy: node.context,
		signal,
		price:
			node.kind === "model" && node.routing
				? (context) =>
						projectModelCost(
							{
								target: modelTarget(node),
								context,
								variables: selectedVariables(variables, node.variables),
							},
							memory,
							availableModels,
						)
				: undefined,
		optimize: automatic
			? (request) =>
					chooseContextRepresentations(request, {
						memory,
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
}
