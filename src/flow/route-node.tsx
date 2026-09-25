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
import { formatNodeDuration } from "@/flow/node-duration";
import { nodeFooterValue, nodeMeta } from "@/flow/node-meta";
import { questionOutputs } from "@/lib/jev-question";
import type { NodeTiming } from "@/lib/routing";
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
						{(data.output || data.decision || data.timing) && (
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

function RouteNodeAvatar({ kind }: { kind: NodeKind }) {
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
				<AvatarImage
					src="https://avatar.vercel.sh/your-request.svg?size=72&rounded=36"
					alt=""
					className="size-6 rounded-full"
				/>
			)}
			{kind === "jev" && (
				<AvatarImage
					src="/brands/typesafe.png"
					alt=""
					className="rounded-lg object-contain p-1"
				/>
			)}
			<AvatarFallback
				className={cn(
					kind === "input" ? "rounded-full" : "rounded-lg",
					kind === "google" || kind === "openai"
						? "bg-transparent text-foreground"
						: "bg-muted",
				)}
			>
				{kind === "google" ? (
					<GoogleIcon className="size-6" />
				) : kind === "openai" ? (
					<OpenAIIcon className="size-6" />
				) : kind === "jev" ? (
					<GitFork className="size-5" strokeWidth={1.8} />
				) : (
					<MessageSquareText className="size-5" strokeWidth={1.8} />
				)}
			</AvatarFallback>
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
	outputs: ReturnType<typeof questionOutputs>;
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
	timing?: NodeTiming;
}) {
	return (
		<div className="route-node__eyebrow">
			<Badge
				variant="outline"
				className="bg-background text-[10px] tracking-wider"
			>
				{step}
			</Badge>
			{timing && (
				<span
					className={cn(
						"font-mono text-[10px] tabular-nums",
						timing.status === "failed"
							? "text-destructive"
							: "text-muted-foreground",
					)}
					title={`${timing.status === "failed" ? "Failed" : "Completed"} in ${formatNodeDuration(timing.durationMs)}`}
				>
					{formatNodeDuration(timing.durationMs)}
					{timing.attempts && timing.attempts > 1 ? ` ×${timing.attempts}` : ""}
				</span>
			)}
		</div>
	);
}

export function RouteNode({ id, data, selected }: NodeProps<FlowNode>) {
	const updateNodeInternals = useUpdateNodeInternals();
	const outputs = data.kind === "jev" ? questionOutputs(data.question) : [];
	const outputIds = outputs.map(({ id }) => id).join("|");
	const { title, subtitle, footerLabel } = nodeMeta[data.kind];
	const isModel = data.kind === "google" || data.kind === "openai";
	const footerValue = nodeFooterValue(data);
	useEffect(() => {
		if (outputIds) updateNodeInternals(id);
	}, [outputIds, id, updateNodeInternals]);
	return (
		<div
			className={cn(
				"route-node",
				data.kind === "jev" && "route-node--jev",
				isModel && !data.isBackup && "route-node--model",
				data.isBackup && "route-node--backup",
				data.active && "route-node--active",
				selected && "route-node--selected",
			)}
		>
			<RouteNodeToolbar id={id} data={data} selected={selected} title={title} />
			<RouteNodeStatus step={data.step} timing={data.timing} />

			<Card
				size="sm"
				className={cn(
					data.kind === "jev" ? "min-h-36" : "h-full",
					"justify-between overflow-visible bg-card shadow-sm",
					data.active ? "ring-[var(--route-accent)]" : selected && "ring-ring",
				)}
			>
				<CardHeader className="grid grid-cols-[36px_1fr] items-center gap-x-3">
					<RouteNodeAvatar kind={data.kind} />
					<div className="min-w-0">
						<CardTitle className="truncate text-base">{title}</CardTitle>
						<CardDescription className="truncate text-xs">
							{data.isBackup ? "Runs if primary fails" : subtitle}
						</CardDescription>
					</div>
				</CardHeader>
				{data.kind === "jev" && (
					<JevOutputRows outputs={outputs} usedBranches={data.usedBranches} />
				)}
				{isModel && !data.isBackup && (
					<ModelOutputRows
						usedBranches={data.usedBranches}
						fallbackConnected={data.fallbackConnected}
					/>
				)}
				<CardFooter className="h-11 min-w-0 shrink-0 justify-between gap-2 px-3 py-0">
					<span className="shrink-0 font-mono text-[10px] tracking-wider text-muted-foreground">
						{footerLabel}
					</span>
					<span
						className="min-w-0 truncate text-right text-xs font-medium"
						title={footerValue}
					>
						{footerValue}
					</span>
				</CardFooter>
			</Card>
			<RouteNodeHandles data={data} />
		</div>
	);
}
