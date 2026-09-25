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
import { CanvasControls } from "@/flow/canvas-controls";
import {
	type CanvasNode,
	useCanvasPresentation,
} from "@/flow/canvas-presentation";
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
} from "@/flow/graph";
import {
	NODE_PICKER_NODE_ID,
	NodeConnectionPicker,
} from "@/flow/node-connection-picker";
import { nodeMeta } from "@/flow/node-meta";
import { RouteNode } from "@/flow/route-node";
import { RouteNodePanel } from "@/flow/route-node-panel";
import type { useRoutingGraph } from "@/flow/use-routing-graph";
import type { NodeTiming, RouteTrace } from "@/lib/routing";

const nodeTypes = { route: RouteNode, "node-picker": NodeConnectionPicker };

type RoutingCanvasProps = {
	graph: ReturnType<typeof useRoutingGraph>;
	result: RouteTrace | null;
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
	const [panel, setPanel] = useState<{
		nodeId: string;
		view: "edit" | "inspect";
	} | null>(null);
	const [initialViewport] = useState(readCanvasViewport);
	const { screenToFlowPosition, fitView } = useReactFlow();
	const nodesInitialized = useNodesInitialized();
	const onInspectNode = useCallback(
		(nodeId: string) => setPanel({ nodeId, view: "inspect" }),
		[],
	);
	const {
		nodes,
		graphEdges,
		onNodesChange,
		onEdgesChange,
		connect,
		connectStart,
		connectEnd,
		createNode,
		measurePendingConnection,
	} = graph;
	const activePanel =
		panel && nodes.some((node) => node.id === panel.nodeId) ? panel : null;
	const { displayNodes, displayEdges } = useCanvasPresentation({
		graph,
		trace: result,
		timings,
		running,
		onDuplicateNode,
		onRemoveNode,
		onInspectNode,
	});
	const panelNode = activePanel
		? displayNodes.find(
				(node) => node.type === "route" && node.id === activePanel.nodeId,
			)
		: undefined;

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
				edges={displayEdges}
				nodeTypes={nodeTypes}
				onNodesChange={handleNodesChange}
				onNodeClick={(_, node) => {
					if (!running && node.id !== NODE_PICKER_NODE_ID)
						setPanel({ nodeId: node.id, view: "edit" });
				}}
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
			{panelNode?.type === "route" && activePanel && (
				<RouteNodePanel
					key={panelNode.id}
					id={panelNode.id}
					data={panelNode.data}
					title={nodeMeta[panelNode.data.kind].title}
					view={activePanel.view}
					onClose={() => setPanel(null)}
					actions={graph}
				/>
			)}
		</section>
	);
}
