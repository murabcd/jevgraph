import {
	Handle,
	type NodeProps,
	NodeToolbar,
	Position,
	useReactFlow,
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
	Plus,
	Sun,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { GoogleIcon, OpenAIIcon } from "@/components/icons/provider-icons";
import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
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
import type { FlowNode, NodeKind } from "@/flow/graph";
import { textModels } from "@/lib/models";
import { JEV_MODEL_ID } from "@/lib/routing";
import { cn } from "@/lib/utils";

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
				<Command>
					<CommandInput placeholder="Search models…" autoFocus />
					<CommandList>
						<CommandEmpty>No matching models.</CommandEmpty>
						{(["openai", "google"] as const).map((provider) => (
							<CommandGroup
								key={provider}
								heading={provider === "openai" ? "OpenAI" : "Gemini"}
							>
								{textModels
									.filter((model) => model.provider === provider)
									.map((model) => (
										<CommandItem
											key={model.id}
											value={`${model.label} ${model.id} ${provider}`}
											data-checked={model.id === modelId}
											onSelect={() => {
												onChange?.(nodeId, model.id);
												setOpen(false);
											}}
										>
											{provider === "openai" ? (
												<OpenAIIcon className="size-4" />
											) : (
												<GoogleIcon className="size-4" />
											)}
											<span className="min-w-0 flex-1 truncate">
												{model.label}
											</span>
											<span className="truncate font-mono text-[11px] text-muted-foreground">
												{model.id}
											</span>
										</CommandItem>
									))}
							</CommandGroup>
						))}
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
		step: "01 / INPUT",
	},
	jev: {
		title: "Jev",
		subtitle: "Routing decision",
		footerLabel: "CHOICE",
		step: "02 / ROUTER",
	},
	google: {
		title: "Gemini",
		subtitle: "Select a model",
		footerLabel: "MODEL",
		step: "03 / MODEL",
	},
	openai: {
		title: "OpenAI",
		subtitle: "Select a model",
		footerLabel: "MODEL",
		step: "03 / MODEL",
	},
} satisfies Record<
	NodeKind,
	{ title: string; subtitle: string; footerLabel: string; step: string }
>;

function nodeFooterValue(data: FlowNode["data"]) {
	if (data.kind === "input") return data.prompt || "Waiting for input";
	if (data.kind === "jev") return data.decision || "Fast or deep";
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
			{data.kind === "jev" && (
				<Badge
					variant="outline"
					className="h-8 w-[200px] justify-start gap-2 rounded-full px-3 text-xs font-medium"
					title={JEV_MODEL_ID}
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
					<span>Jev Latest</span>
				</Badge>
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
					{isModel && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuItem
									variant="destructive"
									disabled={data.editingDisabled}
									onClick={() => data.onRemoveNode?.(id)}
								>
									<Trash2 /> Remove model
								</DropdownMenuItem>
							</DropdownMenuGroup>
						</>
					)}
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
				<>
					<Handle
						className={cn(
							"route-handle",
							(selected || data.usedBranch === "fast") &&
								"route-handle--accent",
						)}
						type="source"
						id="fast"
						position={Position.Right}
						style={{ top: "32%" }}
					/>
					<Handle
						className={cn(
							"route-handle",
							(selected || data.usedBranch === "deep") &&
								"route-handle--accent",
						)}
						type="source"
						id="deep"
						position={Position.Right}
						style={{ top: "68%" }}
					/>
				</>
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
	const { title, subtitle, footerLabel, step } = nodeMeta[data.kind];
	const footerValue = nodeFooterValue(data);
	return (
		<div
			className={cn(
				"route-node",
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
					{step}
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

export function CanvasControls() {
	const { zoomIn, zoomOut, fitView } = useReactFlow();
	const { theme, setTheme } = useTheme();
	return (
		<Card size="sm" className="canvas-controls flex-row gap-0 p-1 shadow-sm">
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Zoom in"
				title="Zoom in"
				onClick={() => void zoomIn()}
			>
				<Plus />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Zoom out"
				title="Zoom out"
				onClick={() => void zoomOut()}
			>
				<Minus />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Fit canvas"
				title="Fit canvas"
				onClick={() => void fitView({ padding: 0.12 })}
			>
				<Maximize />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={
					theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
				}
				title={theme === "dark" ? "Light theme" : "Dark theme"}
				onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
			>
				{theme === "dark" ? <Sun /> : <Moon />}
			</Button>
		</Card>
	);
}
