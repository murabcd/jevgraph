import {
	type Connection,
	type Edge,
	type OnConnectEnd,
	useEdgesState,
	useNodesState,
	useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	duplicatePosition,
	type FlowNode,
	readGraph,
	routesFromGraph,
	saveGraph,
} from "@/flow/graph";
import { providerForModel } from "@/lib/models";
import { defaultConfig } from "@/lib/routing";

export function useRoutingGraph() {
	const { screenToFlowPosition } = useReactFlow();
	const [initialGraph] = useState(readGraph);
	const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(
		initialGraph.nodes,
	);
	const [graphEdges, setGraphEdges, onEdgesChange] = useEdgesState<Edge>(
		initialGraph.edges,
	);
	useEffect(() => {
		saveGraph(nodes, graphEdges);
	}, [nodes, graphEdges]);

	const onModelChange = useCallback(
		(nodeId: string, model: string) => {
			const provider = providerForModel(model);
			if (!provider) return;
			setNodes((current) =>
				current.map((node) =>
					node.id === nodeId
						? { ...node, data: { ...node.data, kind: provider, model } }
						: node,
				),
			);
		},
		[setNodes],
	);

	const onDuplicateNode = useCallback(
		(nodeId: string) => {
			const id = crypto.randomUUID();
			setNodes((current) => {
				const original = current.find((node) => node.id === nodeId);
				if (
					!original ||
					(original.data.kind !== "google" && original.data.kind !== "openai")
				)
					return current;
				return [
					...current.map((node) => ({ ...node, selected: false })),
					{
						id,
						type: "route",
						position: duplicatePosition(original, current),
						selected: true,
						data: {
							kind: original.data.kind,
							active: false,
							model: original.data.model,
						},
					},
				];
			});
		},
		[setNodes],
	);

	const onRemoveNode = useCallback(
		(nodeId: string) => {
			setNodes((current) =>
				current.filter(
					(node) =>
						node.id !== nodeId ||
						(node.data.kind !== "google" && node.data.kind !== "openai"),
				),
			);
			setGraphEdges((current) =>
				current.filter(
					(edge) => edge.source !== nodeId && edge.target !== nodeId,
				),
			);
		},
		[setNodes, setGraphEdges],
	);

	const routes = useMemo(
		() => routesFromGraph(nodes, graphEdges),
		[nodes, graphEdges],
	);

	const replaceBranch = useCallback(
		(branch: "fast" | "deep", targetId: string, createdNode?: FlowNode) => {
			const previousTarget = graphEdges.find(
				(edge) => edge.source === "jev" && edge.sourceHandle === branch,
			)?.target;
			const orphanedTarget =
				previousTarget &&
				previousTarget !== targetId &&
				!graphEdges.some(
					(edge) =>
						edge.target === previousTarget && edge.sourceHandle !== branch,
				)
					? previousTarget
					: undefined;
			if (orphanedTarget || createdNode) {
				setNodes((current) => [
					...current.filter((node) => node.id !== orphanedTarget),
					...(createdNode ? [createdNode] : []),
				]);
			}
			setGraphEdges((current) => [
				...current.filter(
					(edge) => !(edge.source === "jev" && edge.sourceHandle === branch),
				),
				{
					id: `jev-${branch}-${targetId}`,
					source: "jev",
					sourceHandle: branch,
					target: targetId,
					type: "default",
				},
			]);
		},
		[graphEdges, setNodes, setGraphEdges],
	);

	const connect = useCallback(
		(connection: Connection) => {
			if (
				connection.source !== "jev" ||
				(connection.sourceHandle !== "fast" &&
					connection.sourceHandle !== "deep")
			)
				return;
			const target = nodes.find((node) => node.id === connection.target);
			if (
				!target ||
				(target.data.kind !== "google" && target.data.kind !== "openai")
			)
				return;
			replaceBranch(connection.sourceHandle, target.id);
		},
		[nodes, replaceBranch],
	);

	const connectEnd = useCallback<OnConnectEnd>(
		(event, state) => {
			if (state.isValid || state.toNode || state.fromNode?.id !== "jev") return;
			const branch = state.fromHandle?.id;
			if (branch !== "fast" && branch !== "deep") return;
			const point = "changedTouches" in event ? event.changedTouches[0] : event;
			const position = screenToFlowPosition({
				x: point.clientX,
				y: point.clientY,
			});
			const id = crypto.randomUUID();
			const provider = branch === "fast" ? "google" : "openai";
			const model =
				branch === "fast"
					? defaultConfig.googleModel
					: defaultConfig.openaiModel;
			replaceBranch(branch, id, {
				id,
				type: "route",
				position: { x: position.x, y: position.y - 72 },
				data: { kind: provider, active: false, model },
			});
		},
		[screenToFlowPosition, replaceBranch],
	);

	return {
		nodes,
		graphEdges,
		onNodesChange,
		onEdgesChange,
		onModelChange,
		onDuplicateNode,
		onRemoveNode,
		routes,
		connect,
		connectEnd,
	};
}
