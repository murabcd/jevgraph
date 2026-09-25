import type { Edge, Node } from "@xyflow/react";
import { z } from "zod";
import {
	defaultJevQuestion,
	type JevQuestion,
	jevQuestionSchema,
	questionOutputs,
} from "@/lib/jev-question";
import {
	DEFAULT_GOOGLE_MODEL,
	DEFAULT_OPENAI_MODEL,
	MAX_PROMPT_LENGTH,
	type NodeTiming,
	type StartField,
	startFieldsSchema,
	type WorkflowRoutes,
	workflowRoutesSchema,
} from "@/lib/routing";

export type NodeKind = "input" | "jev" | "google" | "openai";
export type CreatableNodeKind = "jev" | "model";
type NodeViewData = {
	active: boolean;
	hasRepeat?: boolean;
	fallbackConnected?: boolean;
	isBackup?: boolean;
	decision?: string;
	output?: string;
	usedBranches?: ReadonlySet<string>;
	step?: string;
	timing?: NodeTiming;
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
				question?: never;
				model?: never;
		  }
		| {
				kind: "jev";
				question: JevQuestion;
				maxRepeats?: number;
				variables?: string[];
				prompt?: never;
				model?: never;
		  }
		| {
				kind: "google" | "openai";
				model: string;
				prompt?: string;
				variables?: string[];
				question?: never;
		  }
	);

export type FlowNode = Node<NodeData, "route">;

export function defaultNodeData(
	kind: CreatableNodeKind,
	provider: "google" | "openai" = "openai",
): FlowNode["data"] {
	if (kind === "jev")
		return { kind, active: false, question: defaultJevQuestion() };
	return {
		kind: provider,
		active: false,
		model: provider === "google" ? DEFAULT_GOOGLE_MODEL : DEFAULT_OPENAI_MODEL,
	};
}
const startingNodes: FlowNode[] = [
	{
		id: "input",
		type: "route",
		position: { x: 0, y: 235 },
		data: { kind: "input", active: false, fields: [] },
	},
	{
		id: "jev",
		type: "route",
		position: { x: 355, y: 235 },
		data: { kind: "jev", active: false, question: defaultJevQuestion() },
	},
	{
		id: "google",
		type: "route",
		position: { x: 730, y: 65 },
		data: { kind: "google", active: false, model: DEFAULT_GOOGLE_MODEL },
	},
	{
		id: "openai",
		type: "route",
		position: { x: 730, y: 405 },
		data: { kind: "openai", active: false, model: DEFAULT_OPENAI_MODEL },
	},
];

const startingEdges: Edge[] = [
	{
		id: "input-jev",
		source: "input",
		target: "jev",
		type: "default",
	},
	{
		id: "jev-fast-google",
		source: "jev",
		sourceHandle: "fast",
		target: "google",
		type: "default",
	},
	{
		id: "jev-deep-openai",
		source: "jev",
		sourceHandle: "deep",
		target: "openai",
		type: "default",
	},
];

const persistedNodeSchema = z.object({
	id: z.string(),
	position: z.object({ x: z.number().finite(), y: z.number().finite() }),
	data: z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("input"),
			fields: startFieldsSchema,
		}),
		z.object({
			kind: z.literal("jev"),
			question: jevQuestionSchema,
			maxRepeats: z.number().int().min(1).max(5).optional(),
			variables: z.array(z.string()).optional(),
		}),
		z.object({
			kind: z.literal("google"),
			model: z.string().min(1),
			prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
			variables: z.array(z.string()).optional(),
		}),
		z.object({
			kind: z.literal("openai"),
			model: z.string().min(1),
			prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
			variables: z.array(z.string()).optional(),
		}),
	]),
});

const persistedEdgeSchema = z.object({
	id: z.string(),
	source: z.string(),
	sourceHandle: z.string().nullish(),
	target: z.string(),
	data: z.object({ repeat: z.boolean() }).optional(),
});

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
			source.data.question &&
				questionOutputs(source.data.question).some(
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

export function readGraph(): { nodes: FlowNode[]; edges: Edge[] } {
	try {
		const savedGraph: unknown = JSON.parse(
			localStorage.getItem("router:graph:v2") ?? "null",
		);
		if (
			typeof savedGraph === "object" &&
			savedGraph !== null &&
			"nodes" in savedGraph &&
			"edges" in savedGraph &&
			Array.isArray(savedGraph.nodes) &&
			Array.isArray(savedGraph.edges)
		) {
			const nodes: FlowNode[] = savedGraph.nodes.flatMap((value) => {
				const parsed = persistedNodeSchema.safeParse(value);
				return parsed.success
					? [
							{
								...parsed.data,
								type: "route" as const,
								data: { ...parsed.data.data, active: false },
							},
						]
					: [];
			});
			const ids = new Set(nodes.map((node) => node.id));
			const edges: Edge[] = savedGraph.edges.flatMap((value) => {
				const parsed = persistedEdgeSchema.safeParse(value);
				return parsed.success &&
					ids.has(parsed.data.source) &&
					ids.has(parsed.data.target)
					? [{ ...parsed.data, type: "default" as const }]
					: [];
			});
			return nodes.some(
				(node) => node.id === "input" && node.data.kind === "input",
			)
				? { nodes, edges }
				: { nodes: startingNodes, edges: startingEdges };
		}
		return { nodes: startingNodes, edges: startingEdges };
	} catch {
		return { nodes: startingNodes, edges: startingEdges };
	}
}

export function saveGraph(nodes: FlowNode[], edges: Edge[]) {
	localStorage.setItem(
		"router:graph:v2",
		JSON.stringify({
			nodes: nodes.map((node) => ({
				id: node.id,
				type: "route",
				position: node.position,
				data: {
					kind: node.data.kind,
					...(node.data.kind === "input" ? { fields: node.data.fields } : {}),
					...(node.data.kind === "google" || node.data.kind === "openai"
						? { prompt: node.data.prompt }
						: {}),
					...(node.data.kind === "jev" && node.data.maxRepeats
						? { maxRepeats: node.data.maxRepeats }
						: {}),
					...(node.data.kind !== "input"
						? { variables: node.data.variables }
						: {}),
					model: node.data.model,
					question: node.data.question,
				},
			})),
			edges: edges.map((edge) => ({
				id: edge.id,
				source: edge.source,
				sourceHandle: edge.sourceHandle,
				target: edge.target,
				data: edge.data?.repeat ? { repeat: true } : undefined,
				type: "default",
			})),
		}),
	);
}

export function removeGraphNode(
	nodes: FlowNode[],
	edges: Edge[],
	nodeId: string,
) {
	if (nodeId === "input") return { nodes, edges };
	return {
		nodes: nodes.filter((node) => node.id !== nodeId),
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
			const type =
				node.data.kind === "input"
					? "START"
					: node.data.kind === "jev"
						? "ROUTER"
						: backupTargets.has(node.id)
							? "BACKUP"
							: edges.some(
										(edge) =>
											edge.source === node.id && edge.sourceHandle === "next",
									)
								? "MODEL"
								: "OUTPUT";
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
						};
					if (node.data.kind === "jev")
						return {
							id: node.id,
							kind: "jev" as const,
							question: node.data.question,
							...(node.data.variables?.length
								? { variables: node.data.variables }
								: {}),
							...(node.data.maxRepeats
								? { maxRepeats: node.data.maxRepeats }
								: {}),
						};
					return {
						id: node.id,
						kind: "model" as const,
						provider: node.data.kind,
						model: node.data.model,
						...(node.data.variables?.length
							? { variables: node.data.variables }
							: {}),
						...(node.data.prompt ? { prompt: node.data.prompt } : {}),
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

type OutputTier = "low" | "high";

function outputTier(question: JevQuestion, id: string): OutputTier | undefined {
	if (question.type === "noul") return id === "no" ? "low" : "high";
	if (question.type === "score") {
		const index = question.levels.findIndex((level) => level.id === id);
		if (index < 0) return undefined;
		return index < question.levels.length / 2 ? "low" : "high";
	}
	const index = question.options.findIndex((option) => option.id === id);
	if (index === 0) return "low";
	if (index === question.options.length - 1) return "high";
	return undefined;
}

export function remapQuestionEdges(
	previousQuestion: JevQuestion,
	nextQuestion: JevQuestion,
	edges: Edge[],
	sourceId = "jev",
): Edge[] {
	const previousOutputs = questionOutputs(previousQuestion);
	const nextOutputs = questionOutputs(nextQuestion);
	const otherEdges = edges.filter((edge) => edge.source !== sourceId);
	const oldBranchEdges = edges.filter((edge) => edge.source === sourceId);
	const branchEdges = nextOutputs.flatMap((output) => {
		const previousId =
			previousQuestion.type === nextQuestion.type
				? output.id
				: previousOutputs.find(
						(candidate) =>
							outputTier(previousQuestion, candidate.id) ===
							outputTier(nextQuestion, output.id),
					)?.id;
		const previous = oldBranchEdges.find(
			(edge) => edge.sourceHandle === previousId,
		);
		return previous
			? [
					{
						...previous,
						id: `${sourceId}-${output.id}-${previous.target}`,
						sourceHandle: output.id,
					},
				]
			: [];
	});
	return [...otherEdges, ...branchEdges];
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
