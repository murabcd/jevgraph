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
	duplicatePosition,
	type FlowNode,
	openPosition,
	readGraph,
	remapQuestionEdges,
	removeGraphNode,
	routesFromGraph,
	saveGraph,
} from "@/flow/graph";
import {
	defaultJevQuestion,
	type JevQuestion,
	questionOutputs,
} from "@/lib/jev-question";
import { providerForModel } from "@/lib/models";
import { defaultConfig } from "@/lib/routing";

type PendingConnection = {
	source: string;
	sourceKind: "input" | "jev" | "model";
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
	const requestPrompt =
		nodes.find((node) => node.id === "input" && node.data.kind === "input")
			?.data.prompt ?? "";
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

	const onPromptChange = useCallback(
		(prompt: string) => {
			setNodes((current) =>
				current.map((node) =>
					node.id === "input" && node.data.kind === "input"
						? { ...node, data: { ...node.data, prompt } }
						: node,
				),
			);
		},
		[setNodes],
	);

	const onQuestionChange = useCallback(
		(nodeId: string, nextQuestion: JevQuestion) => {
			const currentQuestion = nodes.find((node) => node.id === nodeId)?.data
				.question;
			if (!currentQuestion) return;
			setNodes((current) =>
				current.map((node) =>
					node.id === nodeId
						? { ...node, data: { ...node.data, question: nextQuestion } }
						: node,
				),
			);
			setGraphEdges((current) =>
				remapQuestionEdges(currentQuestion, nextQuestion, current, nodeId),
			);
			setPendingConnection(null);
		},
		[nodes, setNodes, setGraphEdges],
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
			const nodeKind = kind === "model" ? "openai" : kind;
			setNodes((current) => {
				const id =
					kind === "input"
						? "input"
						: kind === "jev" && !current.some((node) => node.id === "jev")
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
							kind: nodeKind,
							active: false,
							...(current.length === 0 && kind !== "input"
								? { entry: true }
								: {}),
							...(kind === "model" ? { model: defaultConfig.openaiModel } : {}),
							...(kind === "jev" ? { question: defaultJevQuestion() } : {}),
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
			if (createdNode)
				setNodes((current) => [
					...current.map((node) => ({ ...node, selected: false })),
					createdNode,
				]);
			setGraphEdges((current) => [
				...current.filter(
					(edge) => !(edge.source === source && edge.sourceHandle === branch),
				),
				{
					id: `${source}-${branch}-${targetId}`,
					source,
					sourceHandle: branch,
					target: targetId,
					type: "default",
				},
			]);
		},
		[setNodes, setGraphEdges],
	);

	const connect = useCallback(
		(connection: Connection) => {
			if (!canConnectNodes(connection, nodes, graphEdges)) return;
			if (connection.source === "input") {
				setPendingConnection(null);
				setGraphEdges((current) => [
					...current.filter((edge) => edge.source !== "input"),
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
			if (sourceKind === "model" && branch !== "fallback") return;
			const point = "changedTouches" in event ? event.changedTouches[0] : event;
			const position = screenToFlowPosition({
				x: point.clientX,
				y: point.clientY,
			});
			setPendingConnection({
				source,
				sourceKind,
				branch: branch ?? undefined,
				position,
			});
		},
		[nodes, screenToFlowPosition],
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
			const { source, sourceKind, branch, position } = pendingConnection;
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
						data:
							kind === "jev"
								? { kind: "jev", active: false, question: defaultJevQuestion() }
								: {
										kind: "openai",
										active: false,
										model: defaultConfig.openaiModel,
									},
					},
				]);
				setGraphEdges((current) => [
					...current.filter((edge) => edge.source !== "input"),
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
				(kind !== "model" && !(kind === "jev" && sourceKind === "jev"))
			)
				return;
			const id = crypto.randomUUID();
			const sourceQuestion = nodes.find((node) => node.id === source)?.data
				.question;
			const providerKind =
				sourceQuestion && questionOutputs(sourceQuestion)[0]?.id === branch
					? "google"
					: "openai";
			const model =
				providerKind === "google"
					? defaultConfig.googleModel
					: defaultConfig.openaiModel;
			replaceBranch(source, branch, id, {
				id,
				type: "route",
				selected: true,
				position: { x: position.x, y: position.y - 72 },
				data:
					kind === "jev"
						? { kind: "jev", active: false, question: defaultJevQuestion() }
						: { kind: providerKind, active: false, model },
			});
			setPendingConnection(null);
		},
		[pendingConnection, replaceBranch, nodes, setNodes, setGraphEdges],
	);

	return {
		nodes,
		requestPrompt,
		graphEdges,
		onNodesChange,
		onEdgesChange,
		onModelChange,
		onPromptChange,
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
