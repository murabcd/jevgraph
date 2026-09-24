import {
	Background,
	ConnectionLineType,
	type Edge,
	ReactFlow,
} from "@xyflow/react";
import { PanelRight } from "lucide-react";
import { useMemo } from "react";
import "@xyflow/react/dist/style.css";
import type { ChatTurn } from "@/chat/types";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import type { FlowNode } from "@/flow/graph";
import { CanvasControls, RouteNode } from "@/flow/route-node";
import type { useRoutingGraph } from "@/flow/use-routing-graph";
import type { RouteResult } from "@/lib/routing";

const nodeTypes = { route: RouteNode };

type RoutingCanvasProps = {
	graph: ReturnType<typeof useRoutingGraph>;
	result: RouteResult | null;
	running: boolean;
	messages: ChatTurn[];
	draft: string;
	chatOpen: boolean;
	onOpenChat: () => void;
	onDuplicateNode: (nodeId: string) => void;
	onRemoveNode: (nodeId: string) => void;
};

export function RoutingCanvas({
	graph,
	result,
	running,
	messages,
	draft,
	chatOpen,
	onOpenChat,
	onDuplicateNode,
	onRemoveNode,
}: RoutingCanvasProps) {
	const { theme } = useTheme();
	const {
		nodes,
		graphEdges,
		onNodesChange,
		onEdgesChange,
		onModelChange,
		connect,
		connectEnd,
	} = graph;
	const displayNodes = useMemo(
		() =>
			nodes.map((node) => ({
				...node,
				deletable: node.id !== "input" && node.id !== "jev",
				data: {
					...node.data,
					onModelChange,
					onDuplicateNode,
					onRemoveNode,
					editingDisabled: running,
					active: Boolean(
						result &&
							(node.id === "input" ||
								node.id === "jev" ||
								node.id === result.nodeId),
					),
					usedBranch: node.id === "jev" ? result?.finalBranch : undefined,
					prompt:
						node.id === "input"
							? (messages.findLast((message) => message.role === "user")
									?.content ?? draft.trim())
							: undefined,
					decision:
						node.id === "jev" && result?.jev
							? `${result.jev.choice === "fast" ? "Fast" : "Deep"} · ${Math.round(result.jev.confidence * 100)}%`
							: undefined,
				},
			})),
		[
			nodes,
			result,
			onModelChange,
			onDuplicateNode,
			onRemoveNode,
			running,
			messages,
			draft,
		],
	);

	const edges = useMemo<Edge[]>(() => {
		const active = "var(--route-accent)";
		const muted = "var(--muted-foreground)";
		return graphEdges.map((edge) => {
			const onPath =
				edge.source === "input"
					? Boolean(result)
					: result?.finalBranch === edge.sourceHandle &&
						result?.nodeId === edge.target;
			return {
				...edge,
				type: "default",
				animated:
					running &&
					(edge.source === "input" ||
						edge.sourceHandle === result?.finalBranch),
				label: edge.sourceHandle ? edge.sourceHandle.toUpperCase() : undefined,
				labelStyle: {
					fill: onPath ? active : muted,
					fontSize: 10,
					fontWeight: 700,
				},
				labelBgStyle: { fill: "var(--muted)" },
				style: {
					stroke: onPath ? active : muted,
					strokeWidth: onPath ? 1.8 : 1.2,
				},
			};
		});
	}, [graphEdges, result, running]);

	return (
		<section className="canvas-shell" aria-label="Routing canvas">
			{!chatOpen && (
				<div className="canvas-actions">
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Open chat"
						title="Open chat"
						onClick={onOpenChat}
					>
						<PanelRight />
					</Button>
				</div>
			)}
			<ReactFlow<FlowNode, Edge>
				nodes={displayNodes}
				edges={edges}
				nodeTypes={nodeTypes}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onConnect={connect}
				onConnectEnd={connectEnd}
				isValidConnection={(connection) =>
					connection.source === "jev" &&
					(connection.sourceHandle === "fast" ||
						connection.sourceHandle === "deep") &&
					nodes.some(
						(node) =>
							node.id === connection.target &&
							(node.data.kind === "google" || node.data.kind === "openai"),
					)
				}
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
				<CanvasControls />
			</ReactFlow>
		</section>
	);
}
