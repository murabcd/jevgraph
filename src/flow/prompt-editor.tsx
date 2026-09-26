import { useState } from "react";
import { GoogleIcon, OpenAIIcon } from "@/components/icons/provider-icons";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import type { ModelNodeSettings } from "@/flow/graph";
import {
	type DraftPromptMessage,
	ModelMessagesEditor,
} from "@/flow/model-messages-editor";
import {
	ModelThinkingField,
	parseThinkingDraft,
	thinkingDraftForModel,
} from "@/flow/model-thinking-field";
import { StartVariableBinding } from "@/flow/start-variable-binding";
import { textModels } from "@/lib/models";
import {
	MAX_PROMPT_LENGTH,
	type ModelPromptMessage,
	maxOutputTokensSchema,
	modelPromptMessagesSchema,
	type StartField,
} from "@/lib/routing";

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
	promptMessages: ModelPromptMessage[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (settings: ModelNodeSettings) => void;
	title: string;
	id: string;
	modelId: string;
	maxOutputTokens: number;
	reasoningEffort?: ModelNodeSettings["reasoningEffort"];
	thinkingBudget?: number;
	fields: StartField[];
	variables: string[];
};

export function PromptEditor({
	value,
	promptMessages,
	open,
	onOpenChange,
	onSave,
	title,
	id,
	modelId,
	maxOutputTokens,
	reasoningEffort,
	thinkingBudget,
	fields,
	variables,
}: Props) {
	const [draft, setDraft] = useState(value);
	const [messagesDraft, setMessagesDraft] = useState<DraftPromptMessage[]>(() =>
		promptMessages.map((message) => ({ ...message, id: crypto.randomUUID() })),
	);
	const [draftModel, setDraftModel] = useState(modelId);
	const [variablesDraft, setVariablesDraft] = useState(variables);
	const [outputTokensDraft, setOutputTokensDraft] = useState(
		String(maxOutputTokens),
	);
	const [thinkingDraft, setThinkingDraft] = useState(() => {
		const model = textModels.find((item) => item.id === modelId);
		return model
			? thinkingDraftForModel(model, { reasoningEffort, thinkingBudget })
			: { kind: "none" as const };
	});
	const [error, setError] = useState("");
	const selectedModel = textModels.find((model) => model.id === draftModel);
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
				<ScrollArea
					className="min-h-0 flex-1"
					viewportClassName="scroll-fade-b"
				>
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
										if (!value) return;
										const nextModel = textModels.find(
											(model) => model.id === value,
										);
										if (!nextModel || value === draftModel) return;
										setDraftModel(value);
										setThinkingDraft(thinkingDraftForModel(nextModel));
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
								htmlFor={`${id}-max-output`}
								className="text-xs text-muted-foreground"
							>
								Maximum output tokens
							</FieldLabel>
							<Input
								id={`${id}-max-output`}
								type="text"
								inputMode="numeric"
								value={outputTokensDraft}
								onChange={(event) => setOutputTokensDraft(event.target.value)}
							/>
						</Field>
						{selectedModel && (
							<ModelThinkingField
								id={id}
								model={selectedModel}
								draft={thinkingDraft}
								onChange={setThinkingDraft}
							/>
						)}
						<StartVariableBinding
							fields={fields}
							selected={variablesDraft}
							onChange={setVariablesDraft}
						/>
						<Field>
							<FieldLabel
								htmlFor={id}
								className="text-xs text-muted-foreground"
							>
								System
							</FieldLabel>
							<Textarea
								id={id}
								className="min-h-[132px] max-h-52"
								placeholder="How should this model behave?"
								maxLength={MAX_PROMPT_LENGTH}
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								rows={2}
								autoFocus
							/>
						</Field>
						<ModelMessagesEditor
							messages={messagesDraft}
							onMessagesChange={setMessagesDraft}
						/>
						{error && <FieldError>{error}</FieldError>}
					</FieldGroup>
				</ScrollArea>
				<SheetFooter>
					<Button
						onClick={() => {
							const parsed = maxOutputTokensSchema.safeParse(
								outputTokensDraft.trim() === ""
									? NaN
									: Number(outputTokensDraft),
							);
							if (!parsed.success) {
								setError("Maximum output tokens must be between 1 and 8192.");
								return;
							}
							if (!selectedModel) {
								setError("Select a model.");
								return;
							}
							const thinking = parseThinkingDraft(
								selectedModel,
								thinkingDraft,
								parsed.data,
							);
							if (!thinking.success) {
								setError(
									"Choose a supported thinking setting below maximum output tokens.",
								);
								return;
							}
							const promptMessages = modelPromptMessagesSchema.safeParse(
								messagesDraft.map(({ role, content }) => ({ role, content })),
							);
							if (!promptMessages.success) {
								setError("Each added message needs content.");
								return;
							}
							onSave({
								model: draftModel,
								prompt: draft,
								promptMessages: promptMessages.data,
								variables: variablesDraft,
								maxOutputTokens: parsed.data,
								reasoningEffort: undefined,
								thinkingBudget: undefined,
								...thinking.settings,
							});
							onOpenChange(false);
						}}
					>
						Save
					</Button>
					<SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
