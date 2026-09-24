import {
	Handle,
	type NodeProps,
	NodeToolbar,
	Position,
	useReactFlow,
	useUpdateNodeInternals,
} from "@xyflow/react";
import {
	ChevronDown,
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
import { useEffect, useRef, useState } from "react";
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
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CreatableNodeKind, FlowNode, NodeKind } from "@/flow/graph";
import { JevQuestionEditor } from "@/flow/jev-question-editor";
import { ModelCommand } from "@/flow/model-command";
import { NodeTypeCommand } from "@/flow/node-type-command";
import {
	defaultJevQuestion,
	type JevQuestion,
	jevQuestionTypes,
	questionOutputs,
} from "@/lib/jev-question";
import { textModels } from "@/lib/models";
import { cn } from "@/lib/utils";

const questionTypeLabels = {
	choice: "Choice",
	noul: "Noul",
	score: "Score",
} satisfies Record<JevQuestion["type"], string>;

function ModelPicker({
	nodeId,
	modelId,
	onChange,
}: {
	nodeId: string;
	modelId: string;
	onChange?: (nodeId: string, model: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const current = textModels.find((model) => model.id === modelId);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						className="nodrag nopan w-[200px] min-w-0 justify-between gap-2 rounded-full"
						aria-label={`Select model, current ${current?.label ?? modelId}`}
					/>
				}
			>
				{current?.provider === "google" ? (
					<GoogleIcon className="shrink-0" />
				) : (
					<OpenAIIcon className="shrink-0" />
				)}
				<span className="truncate">{current?.label ?? modelId}</span>
				<ChevronDown className="shrink-0" />
			</DialogTrigger>
			<DialogContent
				className="w-[min(440px,calc(100vw-2rem))] gap-0 p-0"
				showCloseButton={false}
			>
				<DialogHeader className="sr-only">
					<DialogTitle>Select a model</DialogTitle>
				</DialogHeader>
				<ModelCommand
					modelId={modelId}
					onSelect={(selectedModel) => {
						onChange?.(nodeId, selectedModel);
						setOpen(false);
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}

function JevQuestionPicker({
	question,
	onChange,
}: {
	question: JevQuestion;
	onChange?: (question: JevQuestion) => void;
}) {
	const [open, setOpen] = useState(false);
	const label = questionTypeLabels[question.type];
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						className="nodrag nopan w-[200px] min-w-0 justify-between gap-2 rounded-full"
						aria-label={`Jev question type: ${label}`}
					/>
				}
			>
				<Avatar className="size-4 rounded-sm after:hidden">
					<AvatarImage
						src="/brands/typesafe.png"
						alt=""
						className="object-contain"
					/>
					<AvatarFallback className="bg-transparent">
						<GitFork />
					</AvatarFallback>
				</Avatar>
				<span className="truncate">{label}</span>
				<ChevronDown className="shrink-0" />
			</DialogTrigger>
			<DialogContent
				className="w-[min(440px,calc(100vw-2rem))] gap-0 p-0"
				showCloseButton={false}
			>
				<DialogHeader className="sr-only">
					<DialogTitle>Select Jev question type</DialogTitle>
				</DialogHeader>
				<Command>
					<CommandInput placeholder="Search question types…" autoFocus />
					<CommandList>
						<CommandEmpty>No matching types.</CommandEmpty>
						<CommandGroup heading="Jev question types">
							{jevQuestionTypes.map((type) => (
								<CommandItem
									key={type}
									value={type}
									data-checked={type === question.type}
									onSelect={() => {
										if (type !== question.type)
											onChange?.(defaultJevQuestion(type));
										setOpen(false);
									}}
								>
									<Avatar className="size-4 rounded-sm after:hidden">
										<AvatarImage src="/brands/typesafe.png" alt="" />
										<AvatarFallback className="bg-transparent">
											<GitFork />
										</AvatarFallback>
									</Avatar>
									<span className="min-w-0 flex-1 truncate">
										{questionTypeLabels[type]}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}

const nodeMeta = {
	input: {
		title: "Your request",
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

function PromptEditor({ data }: { data: FlowNode["data"] }) {
	const promptRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => promptRef.current?.focus(), []);
	return (
		<CardContent className="min-h-0 flex-1">
			<Textarea
				ref={promptRef}
				className="nodrag nopan nowheel h-full min-h-0 resize-none rounded-none border-0 bg-transparent px-1 py-0.5 text-xs shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
				aria-label="Prompt"
				placeholder="Write a prompt..."
				value={data.draft ?? ""}
				onChange={(event) => data.onPromptChange?.(event.target.value)}
			/>
		</CardContent>
	);
}

function routeNodeHeight(data: FlowNode["data"]) {
	if (data.kind !== "jev") return undefined;
	return Math.max(
		144,
		questionOutputs(data.question ?? defaultJevQuestion()).length * 54,
	);
}

function footerDisplay(
	data: FlowNode["data"],
	editingPrompt: boolean,
	value: string,
) {
	if (!editingPrompt) return value;
	return data.draft?.trim() ? "Ready to send" : "Waiting for input";
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
			{data.kind === "jev" && data.question && editOpen && (
				<JevQuestionEditor
					key={data.question.type}
					question={data.question}
					open={editOpen}
					onOpenChange={setEditOpen}
					onSave={(question) => data.onQuestionChange?.(question)}
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
						{data.kind === "jev" && (
							<DropdownMenuItem onClick={() => setEditOpen(true)}>
								<Pencil /> Edit question
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
			{data.kind === "jev" ? (
				questionOutputs(data.question ?? defaultJevQuestion()).map(
					(output, index, all) => (
						<Handle
							key={output.id}
							className={cn(
								"route-handle",
								(selected || data.usedBranch === output.id) &&
									"route-handle--accent",
							)}
							type="source"
							id={output.id}
							position={Position.Right}
							style={{ top: `${((index + 1) / (all.length + 1)) * 100}%` }}
						/>
					),
				)
			) : data.kind === "input" ? (
				<Handle
					className={cn(
						"route-handle",
						(selected || data.active) && "route-handle--accent",
					)}
					type="source"
					position={Position.Right}
				/>
			) : null}
		</>
	);
}

export function RouteNode({ id, data, selected }: NodeProps<FlowNode>) {
	const updateNodeInternals = useUpdateNodeInternals();
	const outputIds =
		data.kind === "jev" && data.question
			? questionOutputs(data.question)
					.map(({ id }) => id)
					.join("|")
			: "";
	const { title, subtitle, footerLabel } = nodeMeta[data.kind];
	const footerValue = nodeFooterValue(data);
	const editingPrompt = selected && data.kind === "input";
	const height = routeNodeHeight(data);
	useEffect(() => {
		if (outputIds) updateNodeInternals(id);
	}, [outputIds, id, updateNodeInternals]);
	return (
		<div
			className={cn(
				"route-node",
				editingPrompt && "route-node--editing",
				data.active && "route-node--active",
				selected && "route-node--selected",
			)}
			style={height ? { height } : undefined}
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
					"h-full justify-between bg-card shadow-sm",
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
				{editingPrompt && <PromptEditor data={data} />}
				<CardFooter className="min-w-0 justify-between gap-2 py-3">
					<span className="shrink-0 font-mono text-[10px] tracking-wider text-muted-foreground">
						{footerLabel}
					</span>
					<span
						className="min-w-0 truncate text-right text-xs font-medium"
						title={editingPrompt ? undefined : footerValue}
					>
						{footerDisplay(data, editingPrompt, footerValue)}
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
