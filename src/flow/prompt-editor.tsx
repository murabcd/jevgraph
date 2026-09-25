import { useState } from "react";
import { GoogleIcon, OpenAIIcon } from "@/components/icons/provider-icons";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { textModels } from "@/lib/models";
import { MAX_PROMPT_LENGTH } from "@/lib/routing";

function ModelOption({ model }: { model: (typeof textModels)[number] }) {
	return (
		<span className="flex items-center gap-2">
			{model.provider === "openai" ? (
				<OpenAIIcon className="size-4" />
			) : (
				<GoogleIcon className="size-4" />
			)}
			{model.label}
		</span>
	);
}

type Props = {
	value: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (value: string) => void;
	title: string;
	id: string;
	modelId?: string;
	onModelChange?: (modelId: string) => void;
};

export function PromptEditor({
	value,
	open,
	onOpenChange,
	onSave,
	title,
	id,
	modelId,
	onModelChange,
}: Props) {
	const [draft, setDraft] = useState(value);
	const [draftModel, setDraftModel] = useState(modelId ?? "");
	return (
		<Sheet
			modal={false}
			disablePointerDismissal
			open={open}
			onOpenChange={onOpenChange}
		>
			<SheetContent variant="floating">
				<SheetHeader>
					<SheetTitle>{title}</SheetTitle>
				</SheetHeader>
				<ScrollArea className="min-h-0 flex-1">
					<FieldGroup className="px-4 pb-4">
						{modelId && (
							<Field>
								<FieldLabel
									htmlFor={`model-select-${id}`}
									className="text-xs text-muted-foreground"
								>
									Model
								</FieldLabel>
								<Select
									value={draftModel}
									onValueChange={(value) => {
										if (value) setDraftModel(value);
									}}
								>
									<SelectTrigger id={`model-select-${id}`} className="w-full">
										<SelectValue>
											{(selected: string | null) => {
												const model = textModels.find(
													(item) => item.id === selected,
												);
												return model ? (
													<ModelOption model={model} />
												) : (
													"Select a model"
												);
											}}
										</SelectValue>
									</SelectTrigger>
									<SelectContent
										alignItemWithTrigger={false}
										className="max-h-80"
									>
										{(["openai", "google"] as const).map((provider) => (
											<SelectGroup key={provider}>
												<SelectLabel>
													{provider === "openai" ? "OpenAI" : "Gemini"}
												</SelectLabel>
												{textModels
													.filter((model) => model.provider === provider)
													.map((model) => (
														<SelectItem key={model.id} value={model.id}>
															<ModelOption model={model} />
														</SelectItem>
													))}
											</SelectGroup>
										))}
									</SelectContent>
								</Select>
							</Field>
						)}
						<Field>
							<FieldLabel
								htmlFor={id}
								className="text-xs text-muted-foreground"
							>
								Prompt
							</FieldLabel>
							<Textarea
								id={id}
								className="min-h-[60dvh] max-h-[75dvh]"
								placeholder="Write a prompt..."
								maxLength={MAX_PROMPT_LENGTH}
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								autoFocus
							/>
						</Field>
					</FieldGroup>
				</ScrollArea>
				<SheetFooter>
					<Button
						onClick={() => {
							onSave(draft);
							if (modelId && draftModel !== modelId)
								onModelChange?.(draftModel);
							onOpenChange(false);
						}}
					>
						{modelId ? "Save changes" : "Save prompt"}
					</Button>
					<SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
