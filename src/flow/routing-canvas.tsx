import {
	Background,
	ConnectionLineType,
	type Edge,
	type NodeChange,
	type OnNodesChange,
	ReactFlow,
	useNodesInitialized,
	useReactFlow,
} from "@xyflow/react";
import { Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
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
	maxCanvasZoom,
	minCanvasZoom,
	readCanvasViewport,
	saveCanvasViewport,
} from "@/flow/canvas-viewport";
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
import type { NodeTiming, RouteResult } from "@/lib/routing";

type CanvasNode = FlowNode | NodePickerNode;
const nodeTypes = { route: RouteNode, "node-picker": NodeConnectionPicker };

function nodeDecision(
	node: FlowNode,
	result: RouteResult | null,
): string | undefined {
	const step = result?.jevSteps?.find(
		(decision) => decision.nodeId === node.id,
	);
	const legacy =
		result?.mode === "jev" && result.path[1]?.nodeId === node.id
			? result.jev
			: undefined;
	const branch = step?.branch ?? legacy?.branch;
	if (!branch) return undefined;
	const label = node.data.question
		? (questionOutputs(node.data.question).find(
				(output) => output.id === branch,
			)?.label ?? branch)
		: branch;
	const confidence = step?.confidence ?? legacy?.confidence ?? 0;
	return `${label} · ${step?.error ? "Jev unavailable" : `${Math.round(confidence * 100)}%`}`;
}

type RoutingCanvasProps = {
	graph: ReturnType<typeof useRoutingGraph>;
	result: RouteResult | null;
	timings: Record<string, NodeTiming>;
	running: boolean;
	chatOpen: boolean;
	onDuplicateNode: (nodeId: string) => void;
	onRemoveNode: (nodeId: string) => void;
	onNodesDeleted: (nodeIds: string[]) => void;
};

export function RoutingCanvas({
	graph,
	result,
	timings,
	running,
	chatOpen,
	onDuplicateNode,
	onRemoveNode,
	onNodesDeleted,
}: RoutingCanvasProps) {
	const { theme } = useTheme();
	const canvasRef = useRef<HTMLElement>(null);
	const shouldFitAfterAdd = useRef(false);
	const [initialViewport] = useState(readCanvasViewport);
	const { screenToFlowPosition, fitView } = useReactFlow();
	const nodesInitialized = useNodesInitialized();
	const {
		nodes,
		graphEdges,
		onNodesChange,
		onEdgesChange,
		onModelChange,
		onPromptChange,
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
				onPromptChange,
				onDuplicateNode,
				onRemoveNode,
				editingDisabled: running,
				active: Boolean(result?.path.some((step) => step.nodeId === node.id)),
				usedBranch: result?.path.find(
					(_, index) => index > 0 && result.path[index - 1].nodeId === node.id,
				)?.via,
				step: stepLabels.get(node.id),
				timing: timings[node.id],
				decision: nodeDecision(node, result),
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
						pendingConnection.sourceKind === "model"
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
		result,
		timings,
		onModelChange,
		onQuestionChange,
		onDuplicateNode,
		onRemoveNode,
		running,
		onPromptChange,
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
			const onPath = Boolean(
				result?.path.some(
					(step, index) =>
						index > 0 &&
						result.path[index - 1].nodeId === edge.source &&
						step.nodeId === edge.target &&
						(step.via ?? null) === (edge.sourceHandle ?? null),
				),
			);
			return {
				...edge,
				type: "default",
				deletable: !running,
				animated: running && onPath,
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
			"jev",
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
		if (!shouldFitAfterAdd.current || !nodesInitialized || nodes.length === 0)
			return;
		const frame = requestAnimationFrame(() => {
			shouldFitAfterAdd.current = false;
			void fitView({ padding: 0.15, duration: 250 });
		});
		return () => cancelAnimationFrame(frame);
	}, [nodesInitialized, nodes.length, fitView]);

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
				onNodesDelete={(deleted) =>
					onNodesDeleted(deleted.map((node) => node.id))
				}
				onConnect={connect}
				onConnectStart={connectStart}
				onConnectEnd={connectEnd}
				nodesConnectable={!running}
				isValidConnection={(connection) =>
					canConnectNodes(connection, nodes, graphEdges)
				}
				connectionLineType={ConnectionLineType.Bezier}
				panOnDrag={false}
				panOnScroll
				selectionOnDrag
				zoomOnDoubleClick={false}
				defaultViewport={initialViewport ?? undefined}
				fitView={!initialViewport}
				fitViewOptions={{ padding: 0.12 }}
				minZoom={minCanvasZoom}
				maxZoom={maxCanvasZoom}
				onMoveEnd={(_, viewport) => saveCanvasViewport(viewport)}
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
