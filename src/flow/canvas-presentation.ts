import type { Edge } from "@xyflow/react";
import { useMemo } from "react";
import {
	type FlowNode,
	hasFallbackConnection,
	nodeStepLabels,
} from "@/flow/graph";
import {
	NODE_PICKER_NODE_ID,
	type NodePickerNode,
} from "@/flow/node-connection-picker";
import type { useRoutingGraph } from "@/flow/use-routing-graph";
import { questionOutputs } from "@/lib/jev-question";
import type { NodeTiming, RouteTrace } from "@/lib/routing";

export type CanvasNode = FlowNode | NodePickerNode;

function nodeDecision(node: FlowNode, trace: RouteTrace | null) {
	const step = trace?.jevSteps.findLast(
		(decision) => decision.nodeId === node.id,
	);
	if (!step) return undefined;
	const branch = step.branch;
	const label = node.data.question
		? (questionOutputs(node.data.question).find(
				(output) => output.id === branch,
			)?.label ?? branch)
		: branch;
	return `${label} · ${step.limitReached ? "repeat limit" : step.error ? "Jev unavailable" : `${Math.round((step.confidence ?? 0) * 100)}%`}`;
}

export function useCanvasPresentation({
	graph,
	trace,
	timings,
	running,
	onDuplicateNode,
	onRemoveNode,
	onInspectNode,
}: {
	graph: ReturnType<typeof useRoutingGraph>;
	trace: RouteTrace | null;
	timings: Record<string, NodeTiming>;
	running: boolean;
	onDuplicateNode: (nodeId: string) => void;
	onRemoveNode: (nodeId: string) => void;
	onInspectNode: (nodeId: string) => void;
}) {
	const {
		nodes,
		graphEdges,
		pendingConnection,
		createPendingNode,
		dismissPendingConnection,
	} = graph;
	const highlightedPaths = useMemo(() => {
		const nodeIds = new Set<string>();
		const edgeIds = new Set<string>();
		for (const step of trace?.path ?? []) nodeIds.add(step.nodeId);
		for (const edge of trace?.traversedEdges ?? []) edgeIds.add(edge.id);
		const branchesByNode = new Map<string, Set<string>>();
		for (const edge of graphEdges) {
			if (!edgeIds.has(edge.id) || !edge.sourceHandle) continue;
			const branches = branchesByNode.get(edge.source) ?? new Set<string>();
			branches.add(edge.sourceHandle);
			branchesByNode.set(edge.source, branches);
		}
		return { nodeIds, edgeIds, branchesByNode };
	}, [trace, graphEdges]);

	const displayNodes = useMemo<CanvasNode[]>(() => {
		const stepLabels = nodeStepLabels(nodes, graphEdges);
		const routeNodes = nodes.map((node) => ({
			...node,
			deletable: !running,
			data: {
				...node.data,
				hasRepeat: graphEdges.some(
					(edge) => edge.source === node.id && edge.data?.repeat,
				),
				fallbackConnected: hasFallbackConnection(node.id, graphEdges),
				isBackup: graphEdges.some(
					(edge) => edge.target === node.id && edge.sourceHandle === "fallback",
				),
				onDuplicateNode,
				onRemoveNode,
				onInspectNode,
				editingDisabled: running,
				active: highlightedPaths.nodeIds.has(node.id),
				usedBranches: highlightedPaths.branchesByNode.get(node.id),
				step: stepLabels.get(node.id),
				timing: timings[node.id],
				decision: nodeDecision(node, trace),
				output: trace?.outputs.findLast((output) => output.nodeId === node.id)
					?.text,
			},
		}));
		if (!pendingConnection) return routeNodes;
		return [
			...routeNodes,
			{
				id: NODE_PICKER_NODE_ID,
				type: "node-picker",
				position: pendingConnection.position,
				measured: pendingConnection.measured,
				origin: [0, 0.5],
				draggable: false,
				selectable: true,
				deletable: false,
				data: {
					available:
						pendingConnection.branch === "fallback"
							? ["model"]
							: ["jev", "model"],
					onSelect: createPendingNode,
					onDismiss: dismissPendingConnection,
				},
			},
		];
	}, [
		nodes,
		graphEdges,
		trace,
		highlightedPaths,
		timings,
		onDuplicateNode,
		onRemoveNode,
		onInspectNode,
		running,
		pendingConnection,
		createPendingNode,
		dismissPendingConnection,
	]);

	const displayEdges = useMemo<Edge[]>(() => {
		const muted = "var(--muted-foreground)";
		const routeEdges = graphEdges.map((edge) => {
			const onPath = highlightedPaths.edgeIds.has(edge.id);
			return {
				...edge,
				type: "default",
				deletable: !running,
				animated: running && onPath,
				style: {
					stroke: onPath ? "var(--route-accent)" : muted,
					strokeWidth: onPath ? 1.8 : 1.2,
					...(edge.data?.repeat ? { strokeDasharray: "5 4" } : {}),
				},
				...(edge.data?.repeat ? { label: "Repeat" } : {}),
			};
		});
		if (!pendingConnection) return routeEdges;
		return [
			...routeEdges,
			{
				id: "pending-node-connection",
				source: pendingConnection.source,
				sourceHandle: pendingConnection.branch,
				target: NODE_PICKER_NODE_ID,
				type: "default",
				selectable: false,
				style: { stroke: muted, strokeWidth: 1.2, strokeDasharray: "4 4" },
			},
		];
	}, [graphEdges, highlightedPaths, running, pendingConnection]);

	return { displayNodes, displayEdges };
}
