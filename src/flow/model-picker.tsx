import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { GoogleIcon, OpenAIIcon } from "@/components/icons/provider-icons";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { ModelCommand } from "@/flow/model-command";
import { textModels } from "@/lib/models";

type Props = {
	nodeId: string;
	modelId: string;
	onChange?: (nodeId: string, model: string) => void;
};

export function ModelPicker({ nodeId, modelId, onChange }: Props) {
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
