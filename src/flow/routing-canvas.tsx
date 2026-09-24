import {
	Background,
	ConnectionLineType,
	type Edge,
	type NodeChange,
	type OnNodesChange,
	ReactFlow,
	useReactFlow,
} from "@xyflow/react";
import { Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import "@xyflow/react/dist/style.css";
import type { ChatTurn } from "@/chat/types";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PopoverTrigger } from "@/components/ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	type CreatableNodeKind,
	canConnectNodes,
	type FlowNode,
	nodeStepLabels,
} from "@/flow/graph";
import {
	NODE_PICKER_NODE_ID,
	NodeConnectionPicker,
	type NodePickerNode,
} from "@/flow/node-connection-picker";
import { CanvasControls, RouteNode } from "@/flow/route-node";
import type { useRoutingGraph } from "@/flow/use-routing-graph";
import { questionOutputs } from "@/lib/jev-question";
import type { RouteResult } from "@/lib/routing";

type CanvasNode = FlowNode | NodePickerNode;
const nodeTypes = { route: RouteNode, "node-picker": NodeConnectionPicker };

type RoutingCanvasProps = {
	graph: ReturnType<typeof useRoutingGraph>;
	result: RouteResult | null;
	running: boolean;
	messages: ChatTurn[];
	draft: string;
	onDraftChange: (value: string) => void;
	chatOpen: boolean;
	onDuplicateNode: (nodeId: string) => void;
	onRemoveNode: (nodeId: string) => void;
	onNodesDeleted: (nodeId: string) => void;
};

export function RoutingCanvas({
	graph,
	result,
	running,
	messages,
	draft,
	onDraftChange,
	chatOpen,
	onDuplicateNode,
	onRemoveNode,
	onNodesDeleted,
}: RoutingCanvasProps) {
	const { theme } = useTheme();
	const canvasRef = useRef<HTMLElement>(null);
	const shouldFitAfterAdd = useRef(false);
	const { screenToFlowPosition, fitView } = useReactFlow();
	const {
		nodes,
		graphEdges,
		onNodesChange,
		onEdgesChange,
		onModelChange,
		onQuestionChange,
		connect,
		connectStart,
		connectEnd,
		pendingConnection,
		createPendingNode,
		createNode,
		dismissPendingConnection,
		measurePendingConnection,
	} = graph;
	const displayNodes = useMemo<CanvasNode[]>(() => {
		const stepLabels = nodeStepLabels(nodes, graphEdges);
		const routeNodes = nodes.map((node) => ({
			...node,
			deletable: !running,
			data: {
				...node.data,
				onModelChange,
				onQuestionChange,
				onPromptChange: onDraftChange,
				draft: node.id === "input" ? draft : undefined,
				onDuplicateNode,
				onRemoveNode,
				editingDisabled: running,
				active: Boolean(
					result &&
						(node.id === "input" ||
							(node.id === "jev" && result.mode === "jev") ||
							node.id === result.nodeId),
				),
				usedBranch: node.id === "jev" ? result?.finalBranch : undefined,
				step: stepLabels.get(node.id),
				prompt:
					node.id === "input"
						? draft.trim() ||
							messages.findLast((message) => message.role === "user")?.content
						: undefined,
				decision:
					node.id === "jev" && result?.jev
						? `${node.data.question ? (questionOutputs(node.data.question).find((output) => output.id === result.jev?.branch)?.label ?? result.jev.branch) : result.jev.branch} · ${Math.round(result.jev.confidence * 100)}%`
						: undefined,
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
						pendingConnection.source === "input"
							? nodes.some((node) => node.id === "jev")
								? ["model"]
								: ["jev", "model"]
							: ["model"],
					onSelect: createPendingNode,
					onDismiss: dismissPendingConnection,
				},
			},
		];
	}, [
		nodes,
		graphEdges,
		result,
		onModelChange,
		onQuestionChange,
		onDuplicateNode,
		onRemoveNode,
		running,
		messages,
		draft,
		onDraftChange,
		pendingConnection,
		createPendingNode,
		dismissPendingConnection,
	]);

	const handleNodesChange = useCallback<OnNodesChange<CanvasNode>>(
		(changes) => {
			for (const change of changes) {
				if (
					change.type === "dimensions" &&
					change.id === NODE_PICKER_NODE_ID &&
					change.dimensions
				) {
					measurePendingConnection(change.dimensions);
				}
			}
			const graphChanges = changes.filter(
				(change): change is NodeChange<FlowNode> =>
					change.type !== "add" &&
					change.type !== "replace" &&
					change.id !== NODE_PICKER_NODE_ID,
			);
			onNodesChange(graphChanges);
		},
		[onNodesChange, measurePendingConnection],
	);

	const edges = useMemo<Edge[]>(() => {
		const active = "var(--route-accent)";
		const muted = "var(--muted-foreground)";
		const routeEdges = graphEdges.map((edge) => {
			const onPath =
				edge.source === "input"
					? Boolean(result)
					: result?.finalBranch === edge.sourceHandle &&
						result?.nodeId === edge.target;
			return {
				...edge,
				type: "default",
				deletable: !running,
				animated:
					running &&
					(edge.source === "input" ||
						edge.sourceHandle === result?.finalBranch),
				style: {
					stroke: onPath ? active : muted,
					strokeWidth: onPath ? 1.8 : 1.2,
				},
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
				style: {
					stroke: muted,
					strokeWidth: 1.2,
					strokeDasharray: "4 4",
				},
			},
		];
	}, [graphEdges, result, running, pendingConnection]);

	const availableNodeTypes = useMemo<CreatableNodeKind[]>(
		() => [
			...(!nodes.some((node) => node.id === "input")
				? (["input"] as const)
				: []),
			...(!nodes.some((node) => node.id === "jev") ? (["jev"] as const) : []),
			"model",
		],
		[nodes],
	);

	const addNodeAtCenter = useCallback(
		(kind: CreatableNodeKind) => {
			const bounds = canvasRef.current?.getBoundingClientRect();
			if (!bounds) return;
			const position = screenToFlowPosition({
				x: bounds.left + bounds.width / 2,
				y: bounds.top + bounds.height / 2,
			});
			shouldFitAfterAdd.current = true;
			createNode(kind, { x: position.x - 140, y: position.y - 70 });
		},
		[screenToFlowPosition, createNode],
	);
	useEffect(() => {
		if (!shouldFitAfterAdd.current || nodes.length === 0) return;
		shouldFitAfterAdd.current = false;
		const frame = requestAnimationFrame(() => {
			void fitView({ padding: 0.15, duration: 250 });
		});
		return () => cancelAnimationFrame(frame);
	}, [nodes.length, fitView]);

	return (
		<section
			ref={canvasRef}
			className="canvas-shell"
			aria-label="Routing canvas"
		>
			<Card
				size="sm"
				className="canvas-chat-launcher flex-row gap-0 p-1 shadow-sm"
			>
				<Tooltip>
					<TooltipTrigger
						render={
							<PopoverTrigger
								render={
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={chatOpen ? "Close chat" : "Open chat"}
									/>
								}
							/>
						}
					>
						<Zap />
					</TooltipTrigger>
					<TooltipContent>
						{chatOpen ? "Close chat" : "Open chat"}
					</TooltipContent>
				</Tooltip>
			</Card>
			<ReactFlow<CanvasNode, Edge>
				nodes={displayNodes}
				edges={edges}
				nodeTypes={nodeTypes}
				onNodesChange={handleNodesChange}
				onEdgesChange={onEdgesChange}
				onNodesDelete={(deleted) => {
					for (const node of deleted) onNodesDeleted(node.id);
				}}
				onConnect={connect}
				onConnectStart={connectStart}
				onConnectEnd={connectEnd}
				nodesConnectable={!running}
				isValidConnection={(connection) => canConnectNodes(connection, nodes)}
				connectionLineType={ConnectionLineType.Bezier}
				panOnDrag={false}
				panOnScroll
				selectionOnDrag
				zoomOnDoubleClick={false}
				fitView
				fitViewOptions={{ padding: 0.12 }}
				minZoom={0.4}
				maxZoom={1.5}
				proOptions={{ hideAttribution: true }}
			>
				<Background
					bgColor={theme === "dark" ? "var(--background)" : "var(--secondary)"}
					color="color-mix(in oklch, var(--foreground) 25%, transparent)"
				/>
				<CanvasControls
					available={availableNodeTypes}
					onAddNode={addNodeAtCenter}
					addingDisabled={running}
				/>
			</ReactFlow>
		</section>
	);
}
