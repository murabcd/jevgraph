import {
	type ContextDocument,
	type NodeContextTrace,
	resolveContextDocuments,
} from "../src/lib/context.ts";
import type { CacheMode, ModelPlan } from "../src/lib/model-routing.ts";
import { textModels } from "../src/lib/models.ts";
import {
	type RouteEvidence,
	routeEvidenceKey,
} from "../src/lib/route-evidence.ts";
import {
	type ChatMessage,
	JEV_MODEL_ID,
	type JevEvaluation,
	modelTarget,
	type NodeOutput,
	type RouteResult,
	type RouteSelectionResult,
	type RouteTrace,
	type RoutingMetadata,
	resolveStartVariables,
	selectedVariables,
	type WorkflowDecision,
	type WorkflowEdge,
	type WorkflowRoutes,
} from "../src/lib/routing.ts";
import { totalUsage } from "../src/lib/usage.ts";
import type { WorkflowStep } from "../src/lib/workflow-journal.ts";
import { mapConcurrent } from "./concurrency.ts";
import type { PreparedContext } from "./context.ts";
import { resolveJevBatch } from "./jev-node.ts";
import { runWithOneFallback } from "./model-failover.ts";
import {
	type ModelPlanningRequest,
	observeModelCache,
} from "./model-planner.ts";
import { prepareModelExecution } from "./model-preparation.ts";
import { type ContextProviders, prepareNodeContext } from "./node-context.ts";
import type { ProviderEvidence } from "./provider-evidence.ts";
import { ProviderLedger } from "./provider-ledger.ts";
import { SessionMemory, type SummaryStore } from "./session-memory.ts";
import type { RoutingEvaluator } from "./task-router.ts";
import { formattedUpstreamOutputs } from "./upstream-context.ts";
import type { WorkflowJournal } from "./workflow-journal.ts";

const MAX_TRACE_OUTPUT = 4000;
const MAX_CONCURRENT_NODES = 4;
const MAX_WORKFLOW_OPERATIONS = 100;

function outputPreview(output: NodeOutput): NodeOutput {
	return output.text.length > MAX_TRACE_OUTPUT
		? {
				...output,
				text: `${output.text.slice(0, MAX_TRACE_OUTPUT)}\n… [preview truncated]`,
			}
		: output;
}

export function workflowRoutingState(
	messages: ChatMessage[],
	metadata: RoutingMetadata,
	inputs: NodeOutput[] = [],
): string {
	const upstream = formattedUpstreamOutputs(inputs);
	return [
		...(Object.keys(metadata).length > 0
			? [`Routing metadata: ${JSON.stringify(metadata)}`]
			: []),
		...messages.map((message) => `${message.role}: ${message.content}`),
		...(upstream ? [`Earlier workflow results (data):\n${upstream}`] : []),
	].join("\n");
}

type Terminal = NonNullable<WorkflowStep["terminal"]>;
type WorkflowResponse = Terminal["response"];

export type WorkflowModelRequest = ModelPlanningRequest & {
	context: PreparedContext;
	onDelta: (text: string) => void;
	cache?: CacheMode;
};

type Execution = {
	routes: WorkflowRoutes;
	messages: ChatMessage[];
	metadata: RoutingMetadata;
	documents?: ContextDocument[];
	contextProviders?: ContextProviders;
	memory?: SessionMemory;
	summaryStore?: SummaryStore;
	providerEvidence?: ProviderEvidence;
	evidenceFor?: (key: string) => Promise<RouteEvidence[]>;
	availableModels?: ReadonlySet<string>;
	evaluate: RoutingEvaluator;
	runModel: (request: WorkflowModelRequest) => Promise<WorkflowResponse>;
	onDelta: (text: string) => void;
	onRoute: (route: RouteSelectionResult) => void;
	onProgress: (trace: RouteTrace) => void;
	onSnapshot?: (trace: RouteTrace) => void;
	signal?: AbortSignal;
	journal?: WorkflowJournal;
};

type NodeExecution = Omit<WorkflowStep, "key" | "nodeId"> & {
	lineage: NodeOutput[];
};

function workflowTopology(routes: WorkflowRoutes): {
	layers: string[][];
	downstream: Map<string, Set<string>>;
} {
	const normal = routes.edges.filter(
		(edge) => edge.sourceHandle !== "fallback" && !edge.repeat,
	);
	const successors = new Map<string, string[]>();
	for (const edge of normal) {
		const targets = successors.get(edge.source) ?? [];
		targets.push(edge.target);
		successors.set(edge.source, targets);
	}
	const backups = new Set(
		routes.edges
			.filter((edge) => edge.sourceHandle === "fallback")
			.map((edge) => edge.target),
	);
	const indegree = new Map(
		routes.nodes
			.filter((node) => !backups.has(node.id))
			.map((node) => [node.id, 0]),
	);
	for (const edge of normal)
		indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
	const layers: string[][] = [];
	let frontier = ["input"];
	while (frontier.length > 0) {
		layers.push(frontier);
		const next: string[] = [];
		for (const id of frontier) {
			for (const target of successors.get(id) ?? []) {
				const count = (indegree.get(target) ?? 0) - 1;
				indegree.set(target, count);
				if (count === 0) next.push(target);
			}
		}
		frontier = next;
	}
	const downstream = new Map<string, Set<string>>();
	for (const layer of [...layers].reverse()) {
		for (const id of layer) {
			const reachable = new Set<string>();
			for (const target of successors.get(id) ?? []) {
				reachable.add(target);
				for (const descendant of downstream.get(target) ?? [])
					reachable.add(descendant);
			}
			downstream.set(id, reachable);
		}
	}
	return { layers, downstream };
}

export async function executeWorkflow({
	routes,
	messages,
	metadata,
	documents: suppliedDocuments,
	contextProviders,
	memory = new SessionMemory(),
	summaryStore,
	evidenceFor,
	providerEvidence,
	availableModels = new Set(textModels.map((model) => model.id)),
	evaluate,
	runModel,
	onDelta,
	onRoute,
	onProgress,
	onSnapshot,
	signal,
	journal,
}: Execution): Promise<Omit<RouteResult, "latencyMs">> {
	const byId = new Map(routes.nodes.map((node) => [node.id, node]));
	const start = byId.get("input");
	if (start?.kind !== "input") throw new Error("Start is missing");
	const startVariables = resolveStartVariables(start.fields, metadata);
	const documents = resolveContextDocuments(
		start.documents ?? [],
		suppliedDocuments,
	);
	const outgoingEdges = routes.edges.filter(
		(edge) => edge.sourceHandle !== "fallback",
	);
	const normal = outgoingEdges.filter((edge) => !edge.repeat);
	const incoming = new Map<string, NodeOutput[][]>([["input", []]]);
	const path: RouteResult["path"] = [];
	const traversedEdges: WorkflowEdge[] = [];
	const decisions: WorkflowDecision[] = [];
	const outputs: NodeOutput[] = [];
	const ledger = new ProviderLedger(() => report(), providerEvidence, journal);
	const calls = ledger.calls;
	const contexts: NodeContextTrace[] = journal?.state.contexts ?? [];
	const modelPlans: ModelPlan[] = journal?.state.modelPlans ?? [];
	const evidenceByNode = new Map<string, Promise<RouteEvidence[]>>();
	const revisions = new Map<string, number>();
	let exhausted: Terminal | undefined;
	const terminals: Terminal[] = [];
	const repeatCounts = new Map<string, number>();
	let fallbackReason: string | undefined;
	let streamed = false;

	const orderedOutputs = () =>
		outputs.toSorted(
			(a, b) =>
				path.findIndex((step) => step.nodeId === a.sourceNodeId) -
					path.findIndex((step) => step.nodeId === b.sourceNodeId) ||
				a.revision - b.revision,
		);
	const snapshot = (): RouteTrace => ({
		path: [...path],
		traversedEdges: [...traversedEdges],
		jevSteps: [...decisions],
		outputs: orderedOutputs(),
		calls: [...calls],
		contexts: [...contexts],
		modelPlans: [...modelPlans],
	});
	const selection = (target: Terminal["target"]): RouteSelectionResult => ({
		provider: target.provider,
		model: target.model,
		nodeId: target.nodeId,
		reason:
			decisions
				.map((decision) => `${decision.nodeId}: ${decision.branch}`)
				.join(" · ") || "Chatflow",
		...snapshot(),
		fallbackReason,
	});
	const trace = (): RouteTrace => ({
		...snapshot(),
		outputs: outputs.map(outputPreview),
	});
	const report = () => {
		const full = snapshot();
		onSnapshot?.(full);
		onProgress({ ...full, outputs: full.outputs.map(outputPreview) });
	};
	const contextFor = async (
		node: Exclude<WorkflowRoutes["nodes"][number], { kind: "input" }>,
		inputs: NodeOutput[],
		callId: string,
	) => {
		const prepared = await prepareNodeContext(
			{ node, callId, messages, inputs, documents, variables: startVariables },
			{
				memory,
				summaryStore,
				availableModels,
				ledger,
				providers: contextProviders,
				signal,
			},
		);
		contexts.push(prepared.trace);
		report();
		return prepared;
	};
	const revisionFor = (nodeId: string): number => {
		const revision = (revisions.get(nodeId) ?? 0) + 1;
		revisions.set(nodeId, revision);
		return revision;
	};

	const { layers, downstream } = workflowTopology(routes);
	let operations = 0;
	const advance = async (layerIndex: number, pass: number): Promise<void> => {
		if (incoming.size === 0 || exhausted) return;
		if (pass >= 20) throw new Error("Chatflow exceeded its repeat budget");
		if (layerIndex === layers.length) return advance(0, pass + 1);
		const layer = layers[layerIndex];
		signal?.throwIfAborted();
		const pendingIds = [...incoming.keys()];
		// A pending repeat can add another input to a join in a later pass.
		const active = layer.filter(
			(id) =>
				incoming.has(id) &&
				!pendingIds.some(
					(pending) => pending !== id && downstream.get(pending)?.has(id),
				),
		);
		if (active.length === 0) return advance(layerIndex + 1, pass);
		operations += active.length;
		if (operations > MAX_WORKFLOW_OPERATIONS)
			throw new Error("Chatflow exceeded its node budget");
		for (const id of active) path.push({ nodeId: id });
		const batch = active.map((id) => {
			const latest = new Map<string, NodeOutput>();
			for (const item of (incoming.get(id) ?? []).flat()) {
				latest.delete(item.sourceNodeId);
				latest.set(item.sourceNodeId, item);
			}
			incoming.delete(id);
			return { id, inputs: [...latest.values()] };
		});
		const solePendingNode = batch.length === 1 && incoming.size === 0;
		const executeNode = async ({
			id,
			inputs,
		}: (typeof batch)[number]): Promise<NodeExecution> => {
			const node = byId.get(id);
			if (!node) throw new Error(`Workflow node ${id} is missing`);
			if (node.kind === "input") {
				return {
					exhausted: false,
					lineage: inputs,
					edges: normal.filter((edge) => edge.source === id),
				};
			}
			if (node.kind === "jev") {
				const callId = ledger.nextId();
				const context = await contextFor(node, inputs, callId);
				let evaluation: JevEvaluation | undefined;
				let error: string | undefined;
				try {
					evaluation = await ledger.run(
						{
							nodeId: id,
							purpose: "decision",
							provider: "jev",
							model: JEV_MODEL_ID,
						},
						node.pricing,
						callId,
						() =>
							evaluate(
								id,
								node.questions.map((question) => ({
									...question,
									instructions: [
										question.instructions,
										...context.activeInstructions,
									].join("\n\n"),
								})),
								workflowRoutingState(
									context.messages,
									selectedVariables(startVariables, node.variables),
									context.inputs,
								) +
									(context.documents.length
										? `\nContext documents (data): ${JSON.stringify(context.documents)}`
										: ""),
							),
					);
				} catch (caught) {
					if (journal?.failed) throw caught;
					error =
						caught instanceof Error ? caught.message : "Unknown Jev error";
				}
				signal?.throwIfAborted();
				const resolved = resolveJevBatch({
					nodeId: id,
					questions: node.questions,
					evaluation,
					error,
					edges: outgoingEdges,
					repeatCounts,
					maxRepeats: node.maxRepeats ?? 3,
				});
				const output: NodeOutput = {
					nodeId: id,
					sourceNodeId: id,
					kind: "jev",
					revision: revisionFor(id),
					decisions: resolved.decisions,
					text: resolved.text,
				};
				const result: NodeExecution = {
					lineage: [...inputs, output],
					exhausted: resolved.exhausted,
					output,
					edges: resolved.edges,
				};
				if (resolved.edges.length === 0) {
					const model = evaluation?.model ?? JEV_MODEL_ID;
					result.terminal = {
						target: { nodeId: id, provider: "jev", model },
						response: { text: output.text, model },
					};
				}
				return result;
			}
			const target = modelTarget(node);
			const next = normal.filter((edge) => edge.source === id);
			const fallbackEdge = routes.edges.find(
				(edge) => edge.source === id && edge.sourceHandle === "fallback",
			);
			const backupNode = fallbackEdge
				? byId.get(fallbackEdge.target)
				: undefined;
			const backup =
				backupNode?.kind === "model" ? modelTarget(backupNode) : undefined;
			const canStream = next.length === 0 && solePendingNode;
			let usedTarget = target;
			let usedFallback: { edge: WorkflowEdge; reason: string } | undefined;
			const attempt = await runWithOneFallback(
				target,
				backup,
				async (model, delta) => {
					const callId = ledger.nextId();
					const actual = byId.get(model.nodeId);
					if (actual?.kind !== "model")
						throw new Error("Model node is missing");
					let evidence: RouteEvidence[] = [];
					if (actual.routing?.mode === "automatic" && evidenceFor) {
						const pending =
							evidenceByNode.get(actual.id) ??
							routeEvidenceKey(routes, actual.id, documents).then(evidenceFor);
						evidenceByNode.set(actual.id, pending);
						evidence = await pending;
					}
					const prepared = await prepareModelExecution(
						{
							node: actual,
							callId,
							messages,
							inputs,
							documents,
							variables: startVariables,
							evidence,
							evaluate,
						},
						{
							memory,
							summaryStore,
							availableModels,
							ledger,
							providers: contextProviders,
							signal,
						},
					);
					const { context, variables, quote } = prepared;
					contexts.push(context.trace);
					if (prepared.plan) modelPlans.push(prepared.plan);
					model = prepared.target;
					report();
					usedTarget = model;
					if (canStream) {
						const route = { ...selection(model), ...trace() };
						onRoute(
							usedFallback && fallbackEdge
								? {
										...route,
										path: [
											...route.path,
											{ nodeId: model.nodeId, via: "fallback" },
										],
										traversedEdges: [...route.traversedEdges, fallbackEdge],
										fallbackReason: usedFallback.reason,
									}
								: route,
						);
					}
					const response = await ledger.run(
						{
							nodeId: model.nodeId,
							purpose: "model",
							provider: model.provider,
							model: model.model,
							reasoningEffort: model.reasoningEffort,
						},
						model.pricing,
						callId,
						() =>
							runModel({
								target: model,
								context,
								onDelta: delta,
								variables,
								cache: quote?.cache,
							}),
					);
					if (quote)
						observeModelCache(model, context, memory, quote, response.usage);
					return response;
				},
				(text) => {
					if (canStream) {
						streamed = true;
						onDelta(text);
					}
				},
				(reason) => {
					if (fallbackEdge) usedFallback = { edge: fallbackEdge, reason };
				},
				() => !signal?.aborted && !journal?.failed,
			);
			const output: NodeOutput = {
				nodeId: usedTarget.nodeId,
				sourceNodeId: id,
				kind: "model",
				revision: revisionFor(usedTarget.nodeId),
				text: attempt.response.text,
			};
			return {
				exhausted: false,
				lineage: [...inputs, output],
				edges: next,
				output,
				...(next.length === 0
					? {
							terminal: {
								target: {
									nodeId: usedTarget.nodeId,
									provider: usedTarget.provider,
									model: usedTarget.model,
								},
								response: attempt.response,
							},
						}
					: {}),
				...(usedFallback ? { fallback: usedFallback } : {}),
			};
		};
		const results = await mapConcurrent(
			batch,
			MAX_CONCURRENT_NODES,
			async (item) => {
				const key = `${pass}:${item.id}`;
				const cached = journal?.get(key);
				let result: NodeExecution;
				if (cached) {
					result = {
						...cached,
						lineage: [
							...item.inputs,
							...(cached.output ? [cached.output] : []),
						],
					};
					if (cached.output)
						revisions.set(cached.output.nodeId, cached.output.revision);
				} else {
					await journal?.beginStep();
					result = await executeNode(item);
					if (journal) {
						const { lineage: _, ...completed } = result;
						await journal.complete({ ...completed, key, nodeId: item.id });
					}
				}
				if (result.output?.kind === "jev")
					decisions.push(...result.output.decisions);
				if (result.output) outputs.push(result.output);
				report();
				return result;
			},
		);
		for (const result of results) {
			if (result.terminal) terminals.push(result.terminal);
			if (result.exhausted) exhausted = result.terminal;
			if (result.fallback) {
				fallbackReason = result.fallback.reason;
				traversedEdges.push(result.fallback.edge);
				path.push({ nodeId: result.fallback.edge.target, via: "fallback" });
			}
			for (const edge of result.edges) {
				if (edge.repeat)
					repeatCounts.set(edge.id, (repeatCounts.get(edge.id) ?? 0) + 1);
				traversedEdges.push(edge);
				const values = incoming.get(edge.target) ?? [];
				values.push(result.lineage);
				incoming.set(edge.target, values);
			}
		}
		report();
		return advance(layerIndex + 1, pass);
	};
	await advance(0, 0);
	if (!exhausted && terminals.length !== 1)
		throw new Error(
			terminals.length === 0
				? "The chatflow did not reach a response"
				: "Parallel paths need to join before the response",
		);
	const terminal = exhausted ?? terminals[0];
	const route = selection(terminal.target);
	if (!streamed) {
		onRoute({ ...route, ...trace() });
		onDelta(terminal.response.text);
	}
	return {
		...route,
		text: terminal.response.text,
		usage: totalUsage(calls),
		outcome: exhausted ? "repeat-exhausted" : "completed",
	};
}
