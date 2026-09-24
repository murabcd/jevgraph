import type { Edge, Node } from "@xyflow/react";
import { defaultConfig, type Routes } from "@/lib/routing";

export type NodeKind = "input" | "jev" | "google" | "openai";
export type FlowNode = Node<
	{
		kind: NodeKind;
		active: boolean;
		model?: string;
		prompt?: string;
		decision?: string;
		usedBranch?: "fast" | "deep";
		onModelChange?: (nodeId: string, model: string) => void;
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
		data: { kind: "jev", active: false },
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
		deletable: false,
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

export function readGraph(): { nodes: FlowNode[]; edges: Edge[] } {
	try {
		const savedGraph = JSON.parse(
			localStorage.getItem("router:graph:v1") ?? "null",
		) as { nodes?: FlowNode[]; edges?: Edge[] } | null;
		if (
			savedGraph &&
			Array.isArray(savedGraph.nodes) &&
			Array.isArray(savedGraph.edges)
		) {
			const nodes = savedGraph.nodes.filter(
				(node) =>
					node &&
					typeof node.id === "string" &&
					node.position &&
					Number.isFinite(node.position.x) &&
					Number.isFinite(node.position.y) &&
					(node.data?.kind === "input" ||
						node.data?.kind === "jev" ||
						node.data?.kind === "google" ||
						node.data?.kind === "openai"),
			);
			if (
				nodes.some((node) => node.id === "input") &&
				nodes.some((node) => node.id === "jev")
			) {
				const ids = new Set(nodes.map((node) => node.id));
				const edges = savedGraph.edges.filter(
					(edge) =>
						edge &&
						typeof edge.id === "string" &&
						ids.has(edge.source) &&
						ids.has(edge.target),
				);
				return { nodes, edges };
			}
		}
		return { nodes: startingNodes, edges: startingEdges };
	} catch {
		return { nodes: startingNodes, edges: startingEdges };
	}
}

export function saveGraph(nodes: FlowNode[], edges: Edge[]) {
	localStorage.setItem(
		"router:graph:v1",
		JSON.stringify({
			nodes: nodes.map((node) => ({
				id: node.id,
				type: "route",
				position: node.position,
				data: { kind: node.data.kind, active: false, model: node.data.model },
				deletable: node.deletable,
			})),
			edges: edges.map((edge) => ({
				id: edge.id,
				source: edge.source,
				sourceHandle: edge.sourceHandle,
				target: edge.target,
				type: "default",
				deletable: edge.deletable,
			})),
		}),
	);
}

export function routesFromGraph(
	nodes: FlowNode[],
	edges: Edge[],
): Routes | null {
	const routeFor = (branch: "fast" | "deep") => {
		const edge = edges.find(
			(entry) => entry.source === "jev" && entry.sourceHandle === branch,
		);
		const node = nodes.find((entry) => entry.id === edge?.target);
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
	const fast = routeFor("fast");
	const deep = routeFor("deep");
	return fast && deep ? { fast, deep } : null;
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
		const overlaps = nodes.some(
			(other) =>
				position.x < other.position.x + 280 &&
				position.x + 280 > other.position.x &&
				position.y < other.position.y + 176 &&
				position.y + 176 > other.position.y,
		);
		if (!overlaps) return position;
	}
	return { x: node.position.x + 300, y: node.position.y + 480 };
}
