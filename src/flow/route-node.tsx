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
	Maximize,
	MessageSquareText,
	Minus,
	Moon,
	MoreHorizontal,
	Pencil,
	Plus,
	SquareMousePointer,
	Sun,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { GoogleIcon, OpenAIIcon } from "@/components/icons/provider-icons";
import { useTheme } from "@/components/theme-provider";
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
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CreatableNodeKind, FlowNode, NodeKind } from "@/flow/graph";
import { InputPromptEditor } from "@/flow/input-prompt-editor";
import { JevQuestionEditor } from "@/flow/jev-question-editor";
import { JevQuestionPicker } from "@/flow/jev-question-picker";
import { ModelPicker } from "@/flow/model-picker";
import { NodeTypeCommand } from "@/flow/node-type-command";
import {
	defaultJevQuestion,
	questionOutputs,
	questionTypeLabels,
} from "@/lib/jev-question";
import { cn } from "@/lib/utils";

const nodeMeta = {
	input: {
		title: "Request",
		subtitle: "Prompt source",
		footerLabel: "PROMPT",
	},
	jev: {
		title: "Jev",
		subtitle: "Routing decision",
		footerLabel: "QUESTION",
	},
	google: {
		title: "Gemini",
		subtitle: "Select a model",
		footerLabel: "MODEL",
	},
	openai: {
		title: "OpenAI",
		subtitle: "Select a model",
		footerLabel: "MODEL",
	},
} satisfies Record<
	NodeKind,
	{ title: string; subtitle: string; footerLabel: string }
>;

function nodeFooterValue(data: FlowNode["data"]) {
	if (data.kind === "input") return data.prompt || "Waiting for input";
	if (data.kind === "jev")
		return data.question
			? questionTypeLabels[data.question.type]
			: "Select question";
	return data.model ?? "";
}

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
	const [editOpen, setEditOpen] = useState(false);
	const isModel = data.kind === "google" || data.kind === "openai";
	return (
		<NodeToolbar
			isVisible={selected || menuOpen}
			position={Position.Bottom}
			className="nodrag nopan flex items-center gap-1 rounded-full border border-border bg-background p-1.5 shadow-sm"
		>
			{data.kind === "input" && editOpen && (
				<InputPromptEditor
					value={data.draft ?? ""}
					open={editOpen}
					onOpenChange={setEditOpen}
					onSave={(prompt) => data.onPromptChange?.(prompt)}
				/>
			)}
			{data.kind === "jev" && data.question && editOpen && (
				<JevQuestionEditor
					question={data.question}
					open={editOpen}
					onOpenChange={setEditOpen}
					onSave={(question) => data.onQuestionChange?.(question)}
				/>
			)}
			{isModel && (
				<ModelPicker
					nodeId={id}
					modelId={data.model ?? ""}
					onChange={data.onModelChange}
				/>
			)}
			{data.kind === "jev" && data.question && (
				<JevQuestionPicker
					question={data.question}
					onChange={data.onQuestionChange}
				/>
			)}
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
						{!isModel && (
							<DropdownMenuItem onClick={() => setEditOpen(true)}>
								<Pencil /> Edit
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

function RouteNodeHandles({
	data,
	selected,
}: {
	data: FlowNode["data"];
	selected: boolean;
}) {
	return (
		<>
			{data.kind !== "input" && (
				<Handle
					className={cn(
						"route-handle",
						(selected || data.active) && "route-handle--accent",
					)}
					type="target"
					position={Position.Left}
				/>
			)}
			{data.kind === "input" && (
				<Handle
					className={cn(
						"route-handle",
						(selected || data.active) && "route-handle--accent",
					)}
					type="source"
					position={Position.Right}
				/>
			)}
		</>
	);
}

function JevOutputRows({
	outputs,
	selected,
	usedBranch,
}: {
	outputs: ReturnType<typeof questionOutputs>;
	selected: boolean;
	usedBranch?: string;
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
							(selected || usedBranch === output.id) && "route-handle--accent",
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

export function RouteNode({ id, data, selected }: NodeProps<FlowNode>) {
	const updateNodeInternals = useUpdateNodeInternals();
	const outputs =
		data.kind === "jev"
			? questionOutputs(data.question ?? defaultJevQuestion())
			: [];
	const outputIds = outputs.map(({ id }) => id).join("|");
	const { title, subtitle, footerLabel } = nodeMeta[data.kind];
	const footerValue = nodeFooterValue(data);
	useEffect(() => {
		if (outputIds) updateNodeInternals(id);
	}, [outputIds, id, updateNodeInternals]);
	return (
		<div
			className={cn(
				"route-node",
				data.kind === "jev" && "route-node--jev",
				data.active && "route-node--active",
				selected && "route-node--selected",
			)}
		>
			<RouteNodeToolbar id={id} data={data} selected={selected} title={title} />
			<div className="route-node__eyebrow">
				<Badge
					variant="outline"
					className="bg-background text-[10px] tracking-wider"
				>
					{data.step}
				</Badge>
				{data.active && (
					<Badge variant="secondary" className="text-[10px]">
						On path
					</Badge>
				)}
			</div>

			<Card
				size="sm"
				className={cn(
					data.kind === "jev" ? "min-h-36 overflow-visible" : "h-full",
					"justify-between bg-card shadow-sm",
					(selected || data.active) && "ring-[var(--route-accent)]",
				)}
			>
				<CardHeader className="grid grid-cols-[36px_1fr] items-center gap-x-3">
					<RouteNodeAvatar kind={data.kind} />
					<div className="min-w-0">
						<CardTitle className="truncate text-base">{title}</CardTitle>
						<CardDescription className="truncate text-xs">
							{subtitle}
						</CardDescription>
					</div>
				</CardHeader>
				{data.kind === "jev" && (
					<JevOutputRows
						outputs={outputs}
						selected={selected}
						usedBranch={data.usedBranch}
					/>
				)}
				<CardFooter className="min-w-0 justify-between gap-2 py-3">
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
			<RouteNodeHandles data={data} selected={selected} />
		</div>
	);
}

export function CanvasControls({
	available,
	onAddNode,
	addingDisabled,
}: {
	available: CreatableNodeKind[];
	onAddNode: (kind: CreatableNodeKind) => void;
	addingDisabled: boolean;
}) {
	const { zoomIn, zoomOut, fitView } = useReactFlow();
	const { theme, setTheme } = useTheme();
	const [addOpen, setAddOpen] = useState(false);
	return (
		<Card size="sm" className="canvas-controls flex-row gap-0 p-1 shadow-sm">
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Zoom in"
							onClick={() => void zoomIn()}
						/>
					}
				>
					<Plus />
				</TooltipTrigger>
				<TooltipContent>Zoom in</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Zoom out"
							onClick={() => void zoomOut()}
						/>
					}
				>
					<Minus />
				</TooltipTrigger>
				<TooltipContent>Zoom out</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Fit canvas"
							onClick={() => void fitView({ padding: 0.12 })}
						/>
					}
				>
					<Maximize />
				</TooltipTrigger>
				<TooltipContent>Fit canvas</TooltipContent>
			</Tooltip>
			<Separator orientation="vertical" className="mx-1 my-1" />
			<Dialog open={addOpen} onOpenChange={setAddOpen}>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Add node"
								disabled={addingDisabled}
								onClick={() => setAddOpen(true)}
							/>
						}
					>
						<SquareMousePointer />
					</TooltipTrigger>
					<TooltipContent>Add node</TooltipContent>
				</Tooltip>
				<DialogContent
					className="w-[min(360px,calc(100vw-2rem))] gap-0 p-0"
					showCloseButton={false}
				>
					<DialogHeader className="sr-only">
						<DialogTitle>Add node</DialogTitle>
					</DialogHeader>
					<NodeTypeCommand
						available={available}
						onSelect={(kind) => {
							onAddNode(kind);
							setAddOpen(false);
						}}
					/>
				</DialogContent>
			</Dialog>
			<Separator orientation="vertical" className="mx-1 my-1" />
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={
								theme === "dark"
									? "Switch to light theme"
									: "Switch to dark theme"
							}
							onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
						/>
					}
				>
					{theme === "dark" ? <Sun /> : <Moon />}
				</TooltipTrigger>
				<TooltipContent>
					{theme === "dark" ? "Light theme" : "Dark theme"}
				</TooltipContent>
			</Tooltip>
		</Card>
	);
}
