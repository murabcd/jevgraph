import type { Edge, Node } from "@xyflow/react";
import { z } from "zod";
import {
	defaultJevQuestion,
	type JevQuestion,
	jevQuestionSchema,
	questionOutputs,
} from "@/lib/jev-question";
import { defaultConfig, type JevRoutes, type Routes } from "@/lib/routing";

export type NodeKind = "input" | "jev" | "google" | "openai";
export type CreatableNodeKind = "input" | "jev" | "model";
export type FlowNode = Node<
	{
		kind: NodeKind;
		active: boolean;
		model?: string;
		question?: JevQuestion;
		prompt?: string;
		draft?: string;
		decision?: string;
		usedBranch?: string;
		step?: string;
		onModelChange?: (nodeId: string, model: string) => void;
		onPromptChange?: (prompt: string) => void;
		onQuestionChange?: (question: JevQuestion) => void;
		onDuplicateNode?: (nodeId: string) => void;
		onRemoveNode?: (nodeId: string) => void;
		editingDisabled?: boolean;
	},
	"route"
>;
const startingNodes: FlowNode[] = [
	{
		id: "input",
		type: "route",
		position: { x: 0, y: 235 },
		data: { kind: "input", active: false },
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
		data: { kind: "google", active: false, model: defaultConfig.googleModel },
	},
	{
		id: "openai",
		type: "route",
		position: { x: 730, y: 405 },
		data: { kind: "openai", active: false, model: defaultConfig.openaiModel },
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
		z.object({ kind: z.literal("input") }),
		z.object({ kind: z.literal("jev"), question: jevQuestionSchema }),
		z.object({ kind: z.literal("google"), model: z.string().optional() }),
		z.object({ kind: z.literal("openai"), model: z.string().optional() }),
	]),
});

const persistedEdgeSchema = z.object({
	id: z.string(),
	source: z.string(),
	sourceHandle: z.string().nullish(),
	target: z.string(),
});

export function canConnectNodes(
	connection: { source: string; sourceHandle?: string | null; target: string },
	nodes: FlowNode[],
) {
	const source = nodes.find((node) => node.id === connection.source);
	const target = nodes.find((node) => node.id === connection.target);
	if (!source || !target || source.id === target.id) return false;
	if (source.data.kind === "input") {
		return (
			target.data.kind === "jev" ||
			target.data.kind === "google" ||
			target.data.kind === "openai"
		);
	}
	return (
		source.data.kind === "jev" &&
		Boolean(
			source.data.question &&
				questionOutputs(source.data.question).some(
					(output) => output.id === connection.sourceHandle,
				),
		) &&
		(target.data.kind === "google" || target.data.kind === "openai")
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
			return { nodes, edges };
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
					model: node.data.model,
					question: node.data.question,
				},
			})),
			edges: edges.map((edge) => ({
				id: edge.id,
				source: edge.source,
				sourceHandle: edge.sourceHandle,
				target: edge.target,
				type: "default",
			})),
		}),
	);
}

export function nodeStepLabels(nodes: FlowNode[], edges: Edge[]) {
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const targetsBySource = new Map<string, string[]>();
	const connectedTargets = new Set<string>();
	for (const edge of edges) {
		const targets = targetsBySource.get(edge.source) ?? [];
		targets.push(edge.target);
		targetsBySource.set(edge.source, targets);
		connectedTargets.add(edge.target);
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

	visit("input");
	for (const node of nodes) visit(node.id);

	return new Map(
		ordered.map((node, index) => {
			const type =
				node.data.kind === "input"
					? "INPUT"
					: node.data.kind === "jev"
						? "ROUTER"
						: connectedTargets.has(node.id)
							? "OUTPUT"
							: "MODEL";
			return [node.id, `${String(index + 1).padStart(2, "0")} / ${type}`];
		}),
	);
}

export function routesFromGraph(
	nodes: FlowNode[],
	edges: Edge[],
): Routes | null {
	if (!nodes.some((node) => node.id === "input" && node.data.kind === "input"))
		return null;
	const inputEdges = edges.filter((edge) => edge.source === "input");
	if (inputEdges.length !== 1) return null;
	const targetFor = (nodeId: string | undefined) => {
		const node = nodes.find((entry) => entry.id === nodeId);
		if (
			!node ||
			(node.data.kind !== "google" && node.data.kind !== "openai") ||
			!node.data.model
		)
			return null;
		return {
			nodeId: node.id,
			provider: node.data.kind,
			model: node.data.model,
		};
	};
	if (inputEdges[0].target !== "jev") {
		const target = targetFor(inputEdges[0].target);
		return target ? { kind: "direct", target } : null;
	}
	const question = nodes.find(
		(node) => node.id === "jev" && node.data.kind === "jev",
	)?.data.question;
	if (!question) return null;
	const targets: JevRoutes["targets"] = {};
	for (const output of questionOutputs(question)) {
		const edge = edges.find(
			(entry) => entry.source === "jev" && entry.sourceHandle === output.id,
		);
		const target = targetFor(edge?.target);
		if (!target) return null;
		targets[output.id] = target;
	}
	return { kind: "jev", question, targets };
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
): Edge[] {
	const previousOutputs = questionOutputs(previousQuestion);
	const nextOutputs = questionOutputs(nextQuestion);
	const otherEdges = edges.filter((edge) => edge.source !== "jev");
	const oldBranchEdges = edges.filter((edge) => edge.source === "jev");
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
						id: `jev-${output.id}-${previous.target}`,
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
