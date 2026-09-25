import { useReactFlow } from "@xyflow/react";
import {
	Maximize,
	Minus,
	Moon,
	Plus,
	SquareMousePointer,
	Sun,
} from "lucide-react";
import { useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CreatableNodeKind } from "@/flow/graph";
import { NodeTypeCommand } from "@/flow/node-type-command";

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
