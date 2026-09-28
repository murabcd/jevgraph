import {
	type Connection,
	type Edge,
	type OnConnectEnd,
	type OnConnectStart,
	useEdgesState,
	useNodesState,
	useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type CreatableNodeKind,
	canConnectNodes,
	defaultNodeData,
	duplicateModelNode,
	type FlowNode,
	hasFallbackConnection,
	type JevNodeSettings,
	type ModelNodeSettings,
	openPosition,
	reachesNode,
	readGraph,
	removeGraphNode,
	retainQuestionEdges,
	routesFromGraph,
	saveGraph,
} from "@/flow/graph";
import type { ContextDocument } from "@/lib/context";
import { questionOutputs } from "@/lib/jev-question";
import { providerForModel } from "@/lib/models";
import type { StartField } from "@/lib/routing";

type PendingConnection = {
	source: string;
	branch?: string;
	position: { x: number; y: number };
	measured?: { width: number; height: number };
};

export function useRoutingGraph() {
	const { screenToFlowPosition } = useReactFlow();
	const [initialGraph] = useState(readGraph);
	const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(
		initialGraph.nodes,
	);
	const [graphEdges, setGraphEdges, onEdgesChange] = useEdgesState<Edge>(
		initialGraph.edges,
	);
	const [pendingConnection, setPendingConnection] =
		useState<PendingConnection | null>(null);
	useEffect(() => {
		saveGraph(nodes, graphEdges);
	}, [nodes, graphEdges]);

	const onModelSettingsChange = useCallback(
		(nodeId: string, settings: ModelNodeSettings) => {
			const provider = providerForModel(settings.model);
			if (!provider) return;
			setNodes((current) =>
				current.map((node) =>
					node.id === nodeId &&
					(node.data.kind === "google" || node.data.kind === "openai")
						? {
								...node,
								data: { ...node.data, kind: provider, ...settings },
							}
						: node,
				),
			);
		},
		[setNodes],
	);

	const onStartFieldsChange = useCallback(
		(fields: StartField[], documents: ContextDocument[]) => {
			const names = new Set(fields.map((field) => field.name));
			const documentIds = new Set(documents.map(({ id }) => id));
			setNodes((current) =>
				current.map((node) => {
					if (node.data.kind === "input")
						return { ...node, data: { ...node.data, fields, documents } };
					if (
						node.data.kind === "jev" ||
						node.data.kind === "google" ||
						node.data.kind === "openai"
					)
						return {
							...node,
							data: {
								...node.data,
								context: node.data.context
									? {
											...node.data.context,
											documents: node.data.context.documents.filter(({ id }) =>
												documentIds.has(id),
											),
										}
									: undefined,
								variables: node.data.variables?.filter((name) =>
									names.has(name),
								),
							},
						};
					return node;
				}),
			);
		},
		[setNodes],
	);

	const onQuestionChange = useCallback(
		(nodeId: string, settings: JevNodeSettings) => {
			const nextQuestion = settings.question;
			const currentQuestion = nodes.find((node) => node.id === nodeId)?.data
				.question;
			if (!currentQuestion) return;
			setNodes((current) =>
				current.map((node) =>
					node.id === nodeId && node.data.kind === "jev"
						? {
								...node,
								data: {
									...node.data,
									...settings,
									fallbackOutputId: questionOutputs(nextQuestion).some(
										(output) => output.id === settings.fallbackOutputId,
									)
										? settings.fallbackOutputId
										: undefined,
								},
							}
						: node,
				),
			);
			setGraphEdges((current) =>
				retainQuestionEdges(currentQuestion, nextQuestion, current, nodeId),
			);
			setPendingConnection(null);
		},
		[nodes, setNodes, setGraphEdges],
	);

	const onDuplicateNode = useCallback(
		(nodeId: string) => {
			const id = crypto.randomUUID();
			setNodes((current) => duplicateModelNode(current, nodeId, id));
		},
		[setNodes],
	);

	const onRemoveNodes = useCallback(
		(nodeIds: string[]) => {
			const next = nodeIds.reduce(
				(graph, nodeId) => removeGraphNode(graph.nodes, graph.edges, nodeId),
				{ nodes, edges: graphEdges },
			);
			setNodes(next.nodes);
			setGraphEdges(next.edges);
		},
		[nodes, graphEdges, setNodes, setGraphEdges],
	);
	const onRemoveNode = useCallback(
		(nodeId: string) => onRemoveNodes([nodeId]),
		[onRemoveNodes],
	);

	const createNode = useCallback(
		(kind: CreatableNodeKind, position: { x: number; y: number }) => {
			setNodes((current) => {
				const id =
					kind === "jev" && !current.some((node) => node.id === "jev")
						? "jev"
						: crypto.randomUUID();
				if (current.some((node) => node.id === id)) return current;
				return [
					...current.map((node) => ({ ...node, selected: false })),
					{
						id,
						type: "route",
						position: openPosition(position, current),
						selected: true,
						data: {
							...defaultNodeData(kind),
						},
					},
				];
			});
		},
		[setNodes],
	);

	const routes = useMemo(
		() => routesFromGraph(nodes, graphEdges),
		[nodes, graphEdges],
	);

	const replaceBranch = useCallback(
		(
			source: string,
			branch: string,
			targetId: string,
			createdNode?: FlowNode,
		) => {
			if (branch === "fallback" && hasFallbackConnection(source, graphEdges))
				return;
			if (createdNode)
				setNodes((current) => [
					...current.map((node) => ({ ...node, selected: false })),
					createdNode,
				]);
			setGraphEdges((current) => [
				...current.filter((edge) =>
					branch === "next" || source === "input"
						? true
						: !(edge.source === source && edge.sourceHandle === branch),
				),
				{
					id: `${source}-${branch}-${targetId}`,
					source,
					sourceHandle: branch,
					target: targetId,
					...(nodes.find((node) => node.id === source)?.data.kind === "jev" &&
					reachesNode(targetId, source, current)
						? { data: { repeat: true } }
						: {}),
					type: "default",
				},
			]);
		},
		[setNodes, setGraphEdges, nodes, graphEdges],
	);

	const connect = useCallback(
		(connection: Connection) => {
			if (!canConnectNodes(connection, nodes, graphEdges)) return;
			if (connection.source === "input") {
				setPendingConnection(null);
				setGraphEdges((current) => [
					...current,
					{
						id: `input-${connection.target}`,
						source: "input",
						target: connection.target,
						type: "default",
					},
				]);
				return;
			}
			const branch = connection.sourceHandle;
			if (!branch) return;
			setPendingConnection(null);
			replaceBranch(connection.source, branch, connection.target);
		},
		[nodes, graphEdges, replaceBranch, setGraphEdges],
	);

	const connectEnd = useCallback<OnConnectEnd>(
		(event, state) => {
			if (state.isValid || state.toNode) return;
			const source = state.fromNode?.id;
			const sourceNode = nodes.find((node) => node.id === source);
			if (!source || !sourceNode) return;
			const sourceKind =
				sourceNode.data.kind === "openai" || sourceNode.data.kind === "google"
					? "model"
					: sourceNode.data.kind;
			const branch = state.fromHandle?.id;
			if (
				sourceKind === "jev" &&
				(!sourceNode.data.question ||
					!questionOutputs(sourceNode.data.question).some(
						(output) => output.id === branch,
					))
			)
				return;
			if (sourceKind === "model" && branch !== "fallback" && branch !== "next")
				return;
			if (branch === "fallback" && hasFallbackConnection(source, graphEdges))
				return;
			const point = "changedTouches" in event ? event.changedTouches[0] : event;
			const position = screenToFlowPosition({
				x: point.clientX,
				y: point.clientY,
			});
			setPendingConnection({
				source,
				branch: branch ?? undefined,
				position,
			});
		},
		[nodes, graphEdges, screenToFlowPosition],
	);

	const connectStart = useCallback<OnConnectStart>(() => {
		setPendingConnection(null);
	}, []);

	const dismissPendingConnection = useCallback(() => {
		setPendingConnection(null);
	}, []);

	const measurePendingConnection = useCallback(
		(measured: { width: number; height: number }) => {
			setPendingConnection((current) => {
				if (
					!current ||
					(current.measured?.width === measured.width &&
						current.measured.height === measured.height)
				)
					return current;
				return { ...current, measured };
			});
		},
		[],
	);

	const createPendingNode = useCallback(
		(kind: CreatableNodeKind) => {
			if (!pendingConnection) return;
			const { source, branch, position } = pendingConnection;
			if (source === "input") {
				if (kind !== "jev" && kind !== "model") return;
				const targetId =
					kind === "jev" && !nodes.some((node) => node.id === "jev")
						? "jev"
						: crypto.randomUUID();
				setNodes((current) => [
					...current.map((node) => ({ ...node, selected: false })),
					{
						id: targetId,
						type: "route",
						selected: true,
						position: { x: position.x, y: position.y - 72 },
						data: defaultNodeData(kind),
					},
				]);
				setGraphEdges((current) => [
					...current,
					{
						id: `input-${targetId}`,
						source: "input",
						target: targetId,
						type: "default",
					},
				]);
				setPendingConnection(null);
				return;
			}
			if (
				!branch ||
				(kind !== "model" && kind !== "jev") ||
				(branch === "fallback" && kind !== "model")
			)
				return;
			if (branch === "fallback" && hasFallbackConnection(source, graphEdges)) {
				setPendingConnection(null);
				return;
			}
			const id = crypto.randomUUID();
			const sourceQuestion = nodes.find((node) => node.id === source)?.data
				.question;
			const providerKind =
				sourceQuestion && questionOutputs(sourceQuestion)[0]?.id === branch
					? "google"
					: "openai";
			replaceBranch(source, branch, id, {
				id,
				type: "route",
				selected: true,
				position: { x: position.x, y: position.y - 72 },
				data: defaultNodeData(kind, providerKind),
			});
			setPendingConnection(null);
		},
		[
			pendingConnection,
			replaceBranch,
			nodes,
			graphEdges,
			setNodes,
			setGraphEdges,
		],
	);

	return {
		nodes,
		graphEdges,
		onNodesChange,
		onEdgesChange,
		onModelSettingsChange,
		onStartFieldsChange,
		onQuestionChange,
		onDuplicateNode,
		onRemoveNode,
		onRemoveNodes,
		createNode,
		routes,
		connect,
		connectStart,
		connectEnd,
		pendingConnection,
		createPendingNode,
		dismissPendingConnection,
		measurePendingConnection,
	};
}
