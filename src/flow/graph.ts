import type { Edge, Node } from "@xyflow/react";
import { jevRoleLabels } from "@/flow/node-meta";
import type {
	ContextDocument,
	ContextPolicy,
	NodeContextTrace,
} from "@/lib/context";
import {
	type GraphSnapshot,
	graphSnapshotSchema,
	MAX_GRAPH_EDGES,
	MAX_GRAPH_NODES,
} from "@/lib/graph-snapshot";
import {
	batchOutputs,
	defaultJevQuestion,
	type JevQuestion,
	stableQuestionOutputIds,
} from "@/lib/jev-question";
import { effectiveModelConfiguration } from "@/lib/model-configuration";
import type { ModelPlan, ModelRouting } from "@/lib/model-routing";
import type { ReasoningEffort } from "@/lib/models";
import type { NodeTimer } from "@/lib/node-timer";
import {
	DEFAULT_GOOGLE_MODEL,
	DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
	DEFAULT_OPENAI_MODEL,
	type ModelPromptMessage,
	type StartField,
	type WorkflowDecision,
	type WorkflowRoutes,
	workflowRoutesSchema,
} from "@/lib/routing";
import type { Pricing, ProviderCall } from "@/lib/usage";

export type NodeKind = "input" | "jev" | "google" | "openai";
export type CreatableNodeKind = "jev" | "model";
type NodeViewData = {
	active: boolean;
	hasRepeat?: boolean;
	fallbackConnected?: boolean;
	isBackup?: boolean;
	decision?: string;
	decisionDetails?: WorkflowDecision[];
	contexts?: NodeContextTrace[];
	calls?: ProviderCall[];
	modelPlans?: ModelPlan[];
	output?: string;
	usedBranches?: ReadonlySet<string>;
	step?: string;
	timing?: NodeTimer;
	onDuplicateNode?: (nodeId: string) => void;
	onRemoveNode?: (nodeId: string) => void;
	editingDisabled?: boolean;
	onInspectNode?: (nodeId: string) => void;
};

type NodeData = NodeViewData &
	(
		| {
				kind: "input";
				prompt?: never;
				fields: StartField[];
				documents?: ContextDocument[];
				questions?: never;
				model?: never;
		  }
		| {
				kind: "jev";
				questions: JevQuestion[];
				maxRepeats?: number;
				variables?: string[];
				context?: ContextPolicy;
				pricing?: Pricing;
				prompt?: never;
		  }
		| {
				kind: "google" | "openai";
				routing?: ModelRouting;
				model: string;
				prompt?: string;
				promptMessages?: ModelPromptMessage[];
				variables?: string[];
				context?: ContextPolicy;
				pricing?: Pricing;
				maxOutputTokens: number;
				reasoningEffort?: ReasoningEffort;
				questions?: never;
		  }
	);

export type FlowNode = Node<NodeData, "route">;
export type JevNodeSettings = Pick<
	Extract<FlowNode["data"], { kind: "jev" }>,
	"questions" | "variables" | "maxRepeats" | "context" | "pricing"
>;
type ModelNodeData = Extract<FlowNode["data"], { kind: "google" | "openai" }>;
export type ModelNodeSettings = Pick<
	ModelNodeData,
	| "model"
	| "maxOutputTokens"
	| "reasoningEffort"
	| "context"
	| "pricing"
	| "routing"
> &
	Required<Pick<ModelNodeData, "prompt" | "promptMessages" | "variables">>;

export function defaultNodeData(
	kind: CreatableNodeKind,
	provider: "google" | "openai" = "openai",
): FlowNode["data"] {
	if (kind === "jev")
		return {
			kind,
			active: false,
			questions: [defaultJevQuestion()],
		};
	const model =
		provider === "google" ? DEFAULT_GOOGLE_MODEL : DEFAULT_OPENAI_MODEL;
	const { reasoningEffort } = effectiveModelConfiguration({ model });
	return {
		kind: provider,
		active: false,
		model,
		maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
		reasoningEffort,
	};
}
function persistedNodeData(data: FlowNode["data"]) {
	if (data.kind === "input")
		return { kind: data.kind, fields: data.fields, documents: data.documents };
	if (data.kind === "jev")
		return {
			kind: data.kind,
			questions: data.questions,
			maxRepeats: data.maxRepeats,
			variables: data.variables,
			context: data.context,
			pricing: data.pricing,
		};
	return {
		kind: data.kind,
		model: data.model,
		routing: data.routing,
		maxOutputTokens: data.maxOutputTokens,
		reasoningEffort: data.reasoningEffort,
		prompt: data.prompt,
		promptMessages: data.promptMessages,
		variables: data.variables,
		context: data.context,
		pricing: data.pricing,
	};
}

export function duplicateModelNode(
	nodes: FlowNode[],
	nodeId: string,
	id: string,
): FlowNode[] {
	if (nodes.length >= MAX_GRAPH_NODES) return nodes;
	const original = nodes.find((node) => node.id === nodeId);
	if (
		!original ||
		(original.data.kind !== "google" && original.data.kind !== "openai")
	)
		return nodes;
	return [
		...nodes.map((node) => ({ ...node, selected: false })),
		{
			id,
			type: "route",
			position: duplicatePosition(original, nodes),
			selected: true,
			data: { ...persistedNodeData(original.data), active: false },
		},
	];
}

export function reachesNode(
	start: string,
	target: string,
	edges: Edge[],
): boolean {
	const seen = new Set<string>();
	const pending = [start];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || seen.has(current)) continue;
		if (current === target) return true;
		seen.add(current);
		pending.push(
			...edges
				.filter((edge) => edge.source === current && !edge.data?.repeat)
				.map((edge) => edge.target),
		);
	}
	return false;
}

export function canConnectNodes(
	connection: { source: string; sourceHandle?: string | null; target: string },
	nodes: FlowNode[],
	edges: Edge[] = [],
) {
	if (edges.length >= MAX_GRAPH_EDGES) return false;
	const source = nodes.find((node) => node.id === connection.source);
	const target = nodes.find((node) => node.id === connection.target);
	if (!source || !target || source.id === target.id) return false;
	if (
		connection.sourceHandle === "fallback" &&
		hasFallbackConnection(source.id, edges)
	)
		return false;
	if (
		connection.sourceHandle !== "fallback" &&
		edges.some(
			(edge) =>
				edge.sourceHandle === "fallback" &&
				(edge.target === target.id || edge.target === source.id),
		)
	)
		return false;
	if (
		edges.some(
			(edge) =>
				edge.source === connection.source &&
				(edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
				edge.target === connection.target,
		)
	)
		return false;
	const createsCycle = reachesNode(target.id, source.id, edges);
	if (
		createsCycle &&
		(source.data.kind !== "jev" ||
			source.data.questions.length !== 1 ||
			(target.data.kind !== "google" && target.data.kind !== "openai") ||
			edges.some(
				(edge) =>
					edge.source === source.id &&
					edge.data?.repeat &&
					edge.sourceHandle !== connection.sourceHandle,
			))
	)
		return false;
	if (source.data.kind === "input") {
		return (
			target.data.kind === "jev" ||
			target.data.kind === "google" ||
			target.data.kind === "openai"
		);
	}
	const targetIsModel =
		target.data.kind === "google" || target.data.kind === "openai";
	if (source.data.kind === "jev")
		return Boolean(
			source.data.questions &&
				batchOutputs(source.data.questions).some(
					(output) => output.id === connection.sourceHandle,
				) &&
				(targetIsModel || target.data.kind === "jev"),
		);
	if (connection.sourceHandle === "next")
		return targetIsModel || target.data.kind === "jev";
	return (
		(source.data.kind === "google" || source.data.kind === "openai") &&
		targetIsModel &&
		connection.sourceHandle === "fallback" &&
		!edges.some(
			(edge) => edge.source === target.id || edge.target === target.id,
		)
	);
}

export function hasFallbackConnection(
	sourceId: string,
	edges: Edge[],
): boolean {
	return edges.some(
		(edge) => edge.source === sourceId && edge.sourceHandle === "fallback",
	);
}

export function graphSnapshot(nodes: FlowNode[], edges: Edge[]): GraphSnapshot {
	return graphSnapshotSchema.parse({
		nodes: nodes.map((node) => ({
			id: node.id,
			position: node.position,
			data: persistedNodeData(node.data),
		})),
		edges: edges.map((edge) => ({
			id: edge.id,
			source: edge.source,
			sourceHandle: edge.sourceHandle,
			target: edge.target,
			data: edge.data?.repeat ? { repeat: true } : undefined,
		})),
	});
}

export function restoreGraph(snapshot: GraphSnapshot): {
	nodes: FlowNode[];
	edges: Edge[];
} {
	return {
		nodes: snapshot.nodes.map((node) => ({
			...node,
			type: "route",
			data: { ...node.data, active: false },
		})),
		edges: snapshot.edges.map((edge) => ({ ...edge, type: "default" })),
	};
}

/** Remove the node, its edges, and dependent context references. */
export function removeGraphNode(
	nodes: FlowNode[],
	edges: Edge[],
	nodeId: string,
) {
	if (nodeId === "input") return { nodes, edges };
	return {
		nodes: nodes
			.filter((node) => node.id !== nodeId)
			.map((node) =>
				node.data.kind !== "input" && node.data.context
					? {
							...node,
							data: {
								...node.data,
								context: {
									...node.data.context,
									outputNodeIds: node.data.context.outputNodeIds.filter(
										(id) => id !== nodeId,
									),
									instructions: node.data.context.instructions?.filter(
										({ condition }) =>
											condition.kind !== "decision" ||
											condition.nodeId !== nodeId,
									),
								},
							},
						}
					: node,
			),
		edges: edges.filter(
			(edge) => edge.source !== nodeId && edge.target !== nodeId,
		),
	};
}

function graphEntryNodes(nodes: FlowNode[]): FlowNode[] {
	const system = nodes.find(
		(node) => node.id === "input" && node.data.kind === "input",
	);
	return system ? [system] : [];
}

export function nodeStepLabels(nodes: FlowNode[], edges: Edge[]) {
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const targetsBySource = new Map<string, string[]>();
	const backupTargets = new Set<string>();
	for (const edge of edges) {
		const targets = targetsBySource.get(edge.source) ?? [];
		targets.push(edge.target);
		targetsBySource.set(edge.source, targets);
		if (edge.sourceHandle === "fallback") backupTargets.add(edge.target);
	}

	const ordered: FlowNode[] = [];
	const visited = new Set<string>();
	function visit(id: string) {
		const node = nodesById.get(id);
		if (!node || visited.has(id)) return;
		visited.add(id);
		ordered.push(node);
		for (const target of targetsBySource.get(id) ?? []) visit(target);
	}

	for (const entry of graphEntryNodes(nodes)) visit(entry.id);
	for (const node of nodes) visit(node.id);

	return new Map(
		ordered.map((node, index) => {
			let type = "OUTPUT";
			if (node.data.kind === "input") type = "START";
			else if (node.data.kind === "jev")
				type = (
					node.data.questions.length === 1
						? jevRoleLabels[node.data.questions[0].type]
						: "Decisions"
				).toUpperCase();
			else if (backupTargets.has(node.id)) type = "BACKUP";
			else if (
				edges.some(
					(edge) => edge.source === node.id && edge.sourceHandle === "next",
				)
			)
				type = "MODEL";
			return [node.id, `${String(index + 1).padStart(2, "0")} / ${type}`];
		}),
	);
}

export function routesFromGraph(
	nodes: FlowNode[],
	edges: Edge[],
): WorkflowRoutes | null {
	const entries = graphEntryNodes(nodes);
	if (entries.length !== 1 || entries[0].id !== "input") return null;
	const reachable = new Set<string>();
	const visit = (id: string) => {
		if (reachable.has(id)) return;
		reachable.add(id);
		for (const edge of edges.filter((candidate) => candidate.source === id))
			visit(edge.target);
	};
	for (const entry of entries) visit(entry.id);
	const workflow = {
		kind: "workflow" as const,
		nodes: [
			...nodes
				.filter((node) => reachable.has(node.id))
				.map((node) => {
					if (node.data.kind === "input")
						return {
							id: "input" as const,
							kind: "input" as const,
							fields: node.data.fields,
							documents: node.data.documents,
						};
					if (node.data.kind === "jev")
						return {
							id: node.id,
							kind: "jev" as const,
							questions: node.data.questions,
							context: node.data.context,
							pricing: node.data.pricing,
							...(node.data.variables?.length
								? { variables: node.data.variables }
								: {}),
							...(node.data.maxRepeats
								? { maxRepeats: node.data.maxRepeats }
								: {}),
						};
					const { reasoningEffort } = effectiveModelConfiguration(node.data);
					return {
						id: node.id,
						kind: "model" as const,
						provider: node.data.kind,
						model: node.data.model,
						routing: node.data.routing,
						context: node.data.context,
						pricing: node.data.pricing,
						maxOutputTokens: node.data.maxOutputTokens,
						reasoningEffort,
						...(node.data.variables?.length
							? { variables: node.data.variables }
							: {}),
						...(node.data.prompt ? { prompt: node.data.prompt } : {}),
						...(node.data.promptMessages?.length
							? { promptMessages: node.data.promptMessages }
							: {}),
					};
				}),
		],
		edges: [
			...edges
				.filter((edge) => reachable.has(edge.source))
				.map((edge) => ({
					id: edge.id,
					source: edge.source,
					...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
					...(edge.data?.repeat ? { repeat: true } : {}),
					target: edge.target,
				})),
		],
	};
	const parsed = workflowRoutesSchema.safeParse(workflow);
	return parsed.success ? parsed.data : null;
}

export function retainQuestionEdges(
	previousQuestions: JevQuestion[],
	nextQuestions: JevQuestion[],
	edges: Edge[],
	sourceId = "jev",
): Edge[] {
	const outputIds = stableQuestionOutputIds(previousQuestions, nextQuestions);
	return edges.filter(
		(edge) =>
			edge.source !== sourceId || outputIds.has(edge.sourceHandle ?? ""),
	);
}

export function duplicatePosition(node: FlowNode, nodes: FlowNode[]) {
	const offsets = [
		{ x: 0, y: 240 },
		{ x: 0, y: -240 },
		{ x: -300, y: 0 },
		{ x: -450, y: -65 },
		{ x: 300, y: 0 },
		{ x: -300, y: 240 },
		{ x: 300, y: 240 },
		{ x: 0, y: 480 },
	];
	for (const offset of offsets) {
		const position = {
			x: node.position.x + offset.x,
			y: node.position.y + offset.y,
		};
		if (position.x < 0 || position.y < 0) continue;
		if (!overlapsExistingNode(position, nodes)) return position;
	}
	return { x: node.position.x + 300, y: node.position.y + 480 };
}

export function openPosition(
	preferred: { x: number; y: number },
	nodes: FlowNode[],
) {
	for (const offset of [
		{ x: 0, y: 0 },
		{ x: 340, y: 0 },
		{ x: 0, y: 240 },
		{ x: 340, y: 240 },
		{ x: -340, y: 0 },
		{ x: -340, y: 240 },
		{ x: 680, y: 0 },
		{ x: 680, y: 240 },
	]) {
		const position = {
			x: preferred.x + offset.x,
			y: preferred.y + offset.y,
		};
		if (!overlapsExistingNode(position, nodes)) return position;
	}
	return { x: preferred.x, y: preferred.y + (nodes.length + 1) * 240 };
}

function overlapsExistingNode(
	position: { x: number; y: number },
	nodes: FlowNode[],
) {
	return nodes.some(
		(node) =>
			position.x < node.position.x + 280 &&
			position.x + 280 > node.position.x &&
			position.y < node.position.y + 176 &&
			position.y + 176 > node.position.y,
	);
}
