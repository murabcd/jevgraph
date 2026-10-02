import {
	Handle,
	type NodeProps,
	NodeToolbar,
	Position,
	useReactFlow,
	useUpdateNodeInternals,
} from "@xyflow/react";
import {
	Copy,
	Eye,
	GitFork,
	MessageSquareText,
	MoreHorizontal,
	Play,
	Shuffle,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { GoogleIcon, OpenAIIcon } from "@/components/icons/provider-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FlowNode, NodeKind } from "@/flow/graph";
import { nodeFooterValue, nodeMeta, nodeTitle } from "@/flow/node-meta";
import { NodeTimerLabel } from "@/flow/node-timer-label";
import { batchOutputs } from "@/lib/jev-question";
import type { NodeTimer } from "@/lib/node-timer";
import { cn } from "@/lib/utils";

function RouteNodeToolbar({
	id,
	data,
	selected,
	title,
}: {
	id: string;
	data: FlowNode["data"];
	selected: boolean;
	title: string;
}) {
	const { fitView } = useReactFlow();
	const [menuOpen, setMenuOpen] = useState(false);
	const isModel = data.kind === "google" || data.kind === "openai";
	return (
		<NodeToolbar
			isVisible={selected || menuOpen}
			position={Position.Bottom}
			className="nodrag nopan flex items-center gap-1 rounded-full border border-border bg-background p-1.5 shadow-sm"
			onClick={(event) => event.stopPropagation()}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							className="rounded-full"
							aria-label={`Options for ${title} node`}
							title="Node options"
						/>
					}
				>
					<MoreHorizontal />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="center" sideOffset={8} className="min-w-40">
					<DropdownMenuGroup>
						{(data.output ||
							data.decision ||
							data.timing ||
							(isModel && data.routing)) && (
							<DropdownMenuItem onClick={() => data.onInspectNode?.(id)}>
								<MessageSquareText /> Inspect last turn
							</DropdownMenuItem>
						)}
						<DropdownMenuItem
							onClick={() =>
								void fitView({
									nodes: [{ id }],
									padding: 0.8,
									maxZoom: 1.25,
									duration: 250,
								})
							}
						>
							<Eye /> Focus node
						</DropdownMenuItem>
						{isModel && (
							<DropdownMenuItem
								disabled={data.editingDisabled}
								onClick={() => data.onDuplicateNode?.(id)}
							>
								<Copy /> Duplicate model
							</DropdownMenuItem>
						)}
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuItem
							variant="destructive"
							disabled={data.editingDisabled}
							onClick={() => data.onRemoveNode?.(id)}
						>
							<Trash2 /> Remove node
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</NodeToolbar>
	);
}

function RouteNodeAvatar({
	kind,
	automatic = false,
}: {
	kind: NodeKind;
	automatic?: boolean;
}) {
	return (
		<Avatar
			className={cn(
				"size-9 after:hidden",
				kind === "input"
					? "items-center justify-center rounded-full"
					: "rounded-lg",
			)}
		>
			{kind === "input" && (
				<AvatarFallback className="size-7 rounded-full bg-primary text-primary-foreground">
					<Play className="size-4 fill-current" />
				</AvatarFallback>
			)}
			{kind === "jev" && (
				<AvatarImage
					src="/brands/typesafe.png"
					alt=""
					className="rounded-lg object-contain p-1"
				/>
			)}
			{kind !== "input" && (
				<AvatarFallback
					className={cn(
						"rounded-lg",
						kind === "google" || kind === "openai"
							? "bg-transparent text-foreground"
							: "bg-muted",
					)}
				>
					{automatic ? (
						<Shuffle className="size-6" />
					) : (
						{
							google: <GoogleIcon className="size-6" />,
							openai: <OpenAIIcon className="size-6" />,
							jev: <GitFork className="size-5" strokeWidth={1.8} />,
							input: null,
						}[kind]
					)}
				</AvatarFallback>
			)}
		</Avatar>
	);
}

function RouteNodeHandles({ data }: { data: FlowNode["data"] }) {
	return (
		<>
			{data.kind !== "input" && (
				<Handle
					className={cn("route-handle", data.active && "route-handle--accent")}
					type="target"
					position={Position.Left}
				/>
			)}
			{data.kind === "input" && (
				<Handle
					className={cn("route-handle", data.active && "route-handle--accent")}
					type="source"
					position={Position.Right}
				/>
			)}
		</>
	);
}

function JevOutputRows({
	outputs,
	usedBranches,
}: {
	outputs: ReturnType<typeof batchOutputs>;
	usedBranches?: ReadonlySet<string>;
}) {
	return (
		<CardContent className="grid gap-1 px-0">
			{outputs.map((output) => (
				<div
					key={output.id}
					className="relative flex min-h-8 items-center justify-end px-3 py-1"
				>
					<span className="min-w-0 wrap-break-word text-right text-xs font-medium">
						{output.label}
					</span>
					<Handle
						className={cn(
							"route-handle",
							usedBranches?.has(output.id) && "route-handle--accent",
						)}
						type="source"
						id={output.id}
						position={Position.Right}
						title="Connect to continue; unconnected answers remain available as data"
					/>
				</div>
			))}
		</CardContent>
	);
}

function ModelOutputRows({
	usedBranches,
	fallbackConnected,
}: {
	usedBranches?: ReadonlySet<string>;
	fallbackConnected?: boolean;
}) {
	return (
		<CardContent className="grid gap-1 px-0">
			{[
				{
					id: "next",
					label: "Continue",
					title:
						"Continue with another node; connect several for parallel work",
				},
				{
					id: "fallback",
					label: "On error",
					title: "Connect a backup model for failures before text starts",
				},
			].map((output) => (
				<div
					key={output.id}
					className="relative flex min-h-7 items-center justify-end px-3 py-1"
				>
					<span className="text-xs font-medium">{output.label}</span>
					<Handle
						className={cn(
							"route-handle",
							usedBranches?.has(output.id) && "route-handle--accent",
							output.id === "fallback" &&
								fallbackConnected &&
								"route-handle--occupied",
						)}
						type="source"
						id={output.id}
						position={Position.Right}
						isConnectableStart={output.id !== "fallback" || !fallbackConnected}
						onMouseDown={
							output.id === "fallback" && fallbackConnected
								? (event) => event.stopPropagation()
								: undefined
						}
						onTouchStart={
							output.id === "fallback" && fallbackConnected
								? (event) => event.stopPropagation()
								: undefined
						}
						title={
							output.id === "fallback" && fallbackConnected
								? "Remove the current backup connection before adding another"
								: output.title
						}
					/>
				</div>
			))}
		</CardContent>
	);
}

function RouteNodeStatus({
	step,
	timing,
}: {
	step?: string;
	timing?: NodeTimer;
}) {
	return (
		<div className="route-node__eyebrow">
			<Badge
				variant="outline"
				className="bg-background text-[10px] tracking-wider"
			>
				{step}
			</Badge>
			{timing && <NodeTimerLabel timer={timing} />}
		</div>
	);
}

function RouteCardHeader({ data }: { data: FlowNode["data"] }) {
	const { subtitle } = nodeMeta[data.kind];
	const title = nodeTitle(data);
	return (
		<CardHeader className="grid grid-cols-[36px_1fr] items-center gap-x-3">
			<RouteNodeAvatar
				kind={data.kind}
				automatic={
					(data.kind === "openai" || data.kind === "google") &&
					data.routing?.mode === "automatic"
				}
			/>
			<div className="min-w-0">
				<CardTitle className="truncate text-base">{title}</CardTitle>
				<CardDescription className="truncate text-xs">
					{data.isBackup ? "Runs if primary fails" : subtitle}
				</CardDescription>
			</div>
		</CardHeader>
	);
}

function RouteCardOutputs({
	data,
	outputs,
}: {
	data: FlowNode["data"];
	outputs: ReturnType<typeof batchOutputs>;
}) {
	if (data.kind === "jev") {
		return <JevOutputRows outputs={outputs} usedBranches={data.usedBranches} />;
	}
	if (data.kind === "input" || data.isBackup) return null;
	return (
		<ModelOutputRows
			usedBranches={data.usedBranches}
			fallbackConnected={data.fallbackConnected}
		/>
	);
}

function RouteCardFooter({ data }: { data: FlowNode["data"] }) {
	const { footerLabel } = nodeMeta[data.kind];
	const footerValue = nodeFooterValue(data);
	return (
		<CardFooter className="h-11 min-w-0 shrink-0 justify-between gap-2 px-3 py-0">
			<span className="shrink-0 font-mono text-[10px] tracking-wider text-muted-foreground">
				{footerLabel}
			</span>
			{footerValue && (
				<span
					className="min-w-0 truncate text-right text-xs font-medium"
					title={footerValue}
				>
					{footerValue}
				</span>
			)}
		</CardFooter>
	);
}

function RouteNodeCard({
	data,
	selected,
	outputs,
}: {
	data: FlowNode["data"];
	selected: boolean;
	outputs: ReturnType<typeof batchOutputs>;
}) {
	return (
		<Card
			size="sm"
			className={cn(
				data.kind === "jev" ? "min-h-36" : "h-full",
				"justify-between overflow-visible bg-card shadow-sm",
				data.active ? "ring-[var(--route-accent)]" : selected && "ring-ring",
			)}
		>
			<RouteCardHeader data={data} />
			<RouteCardOutputs data={data} outputs={outputs} />
			<RouteCardFooter data={data} />
		</Card>
	);
}

export function RouteNode({ id, data, selected }: NodeProps<FlowNode>) {
	const updateNodeInternals = useUpdateNodeInternals();
	const outputs = data.kind === "jev" ? batchOutputs(data.questions) : [];
	const outputIds = outputs.map(({ id }) => id).join("|");
	useEffect(() => {
		if (outputIds) updateNodeInternals(id);
	}, [outputIds, id, updateNodeInternals]);
	return (
		<div
			className={cn(
				"route-node",
				data.kind === "jev" && "route-node--jev",
				(data.kind === "google" || data.kind === "openai") &&
					!data.isBackup &&
					"route-node--model",
				data.isBackup && "route-node--backup",
				data.active && "route-node--active",
				selected && "route-node--selected",
			)}
		>
			{data.kind !== "input" && (
				<RouteNodeToolbar
					id={id}
					data={data}
					selected={selected}
					title={nodeTitle(data)}
				/>
			)}
			<RouteNodeStatus step={data.step} timing={data.timing} />
			<RouteNodeCard data={data} selected={selected} outputs={outputs} />
			<RouteNodeHandles data={data} />
		</div>
	);
}
