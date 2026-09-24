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
	source: "input" | "jev";
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
	const question = nodes.find((node) => node.id === "jev")?.data.question;
	const outputs = useMemo(
		() => (question ? questionOutputs(question) : []),
		[question],
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

	const onQuestionChange = useCallback(
		(nextQuestion: JevQuestion) => {
			const currentQuestion = nodes.find((node) => node.id === "jev")?.data
				.question;
			if (!currentQuestion) return;
			setNodes((current) =>
				current.map((node) =>
					node.id === "jev"
						? { ...node, data: { ...node.data, question: nextQuestion } }
						: node,
				),
			);
			setGraphEdges((current) =>
				remapQuestionEdges(currentQuestion, nextQuestion, current),
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

	const onRemoveNode = useCallback(
		(nodeId: string) => {
			setNodes((current) => current.filter((node) => node.id !== nodeId));
			setGraphEdges((current) =>
				current.filter(
					(edge) => edge.source !== nodeId && edge.target !== nodeId,
				),
			);
		},
		[setNodes, setGraphEdges],
	);

	const createNode = useCallback(
		(kind: CreatableNodeKind, position: { x: number; y: number }) => {
			const id =
				kind === "input"
					? "input"
					: kind === "jev"
						? "jev"
						: crypto.randomUUID();
			const nodeKind = kind === "model" ? "openai" : kind;
			setNodes((current) => {
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
		(branch: string, targetId: string, createdNode?: FlowNode) => {
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
					...current
						.filter((node) => node.id !== orphanedTarget)
						.map((node) => (createdNode ? { ...node, selected: false } : node)),
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
			if (!canConnectNodes(connection, nodes)) return;
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
			replaceBranch(branch, connection.target);
		},
		[nodes, replaceBranch, setGraphEdges],
	);

	const connectEnd = useCallback<OnConnectEnd>(
		(event, state) => {
			if (state.isValid || state.toNode) return;
			const source = state.fromNode?.id;
			if (source !== "input" && source !== "jev") return;
			const branch = state.fromHandle?.id;
			if (source === "jev" && !outputs.some((output) => output.id === branch))
				return;
			const point = "changedTouches" in event ? event.changedTouches[0] : event;
			const position = screenToFlowPosition({
				x: point.clientX,
				y: point.clientY,
			});
			setPendingConnection({
				source,
				branch: source === "jev" ? (branch ?? undefined) : undefined,
				position,
			});
		},
		[outputs, screenToFlowPosition],
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
				if (kind === "jev" && nodes.some((node) => node.id === "jev")) return;
				if (kind !== "jev" && kind !== "model") return;
				const targetId = kind === "jev" ? "jev" : crypto.randomUUID();
				if (kind === "jev") {
					createNode("jev", { x: position.x, y: position.y - 72 });
				} else {
					setNodes((current) => [
						...current.map((node) => ({ ...node, selected: false })),
						{
							id: targetId,
							type: "route",
							selected: true,
							position: { x: position.x, y: position.y - 72 },
							data: {
								kind: "openai",
								active: false,
								model: defaultConfig.openaiModel,
							},
						},
					]);
				}
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
			if (kind !== "model" || !branch) return;
			const id = crypto.randomUUID();
			const providerKind = outputs[0]?.id === branch ? "google" : "openai";
			const model =
				providerKind === "google"
					? defaultConfig.googleModel
					: defaultConfig.openaiModel;
			replaceBranch(branch, id, {
				id,
				type: "route",
				selected: true,
				position: { x: position.x, y: position.y - 72 },
				data: { kind: providerKind, active: false, model },
			});
			setPendingConnection(null);
		},
		[
			pendingConnection,
			outputs,
			replaceBranch,
			createNode,
			nodes,
			setNodes,
			setGraphEdges,
		],
	);

	return {
		nodes,
		outputs,
		graphEdges,
		onNodesChange,
		onEdgesChange,
		onModelChange,
		onQuestionChange,
		onDuplicateNode,
		onRemoveNode,
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
