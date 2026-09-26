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
import { StartVariableBinding } from "@/flow/start-variable-binding";
import { textModels } from "@/lib/models";
import {
	MAX_PROMPT_LENGTH,
	maxOutputTokensSchema,
	modelSupportsReasoningEffort,
	type ReasoningEffort,
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
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (settings: {
		model: string;
		prompt: string;
		variables: string[];
		maxOutputTokens: number;
		reasoningEffort?: ReasoningEffort;
	}) => void;
	title: string;
	id: string;
	modelId: string;
	maxOutputTokens: number;
	reasoningEffort?: ReasoningEffort;
	fields: StartField[];
	variables: string[];
};

export function PromptEditor({
	value,
	open,
	onOpenChange,
	onSave,
	title,
	id,
	modelId,
	maxOutputTokens,
	reasoningEffort,
	fields,
	variables,
}: Props) {
	const [draft, setDraft] = useState(value);
	const [draftModel, setDraftModel] = useState(modelId);
	const [variablesDraft, setVariablesDraft] = useState(variables);
	const [outputTokensDraft, setOutputTokensDraft] = useState(
		String(maxOutputTokens),
	);
	const [effortDraft, setEffortDraft] = useState<ReasoningEffort | "default">(
		reasoningEffort ?? "default",
	);
	const [error, setError] = useState("");
	const selectedModel = textModels.find((model) => model.id === draftModel);
	const supportsReasoningEffort = selectedModel
		? modelSupportsReasoningEffort(selectedModel.provider, draftModel)
		: false;
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
										if (value) {
											if (value !== draftModel) setEffortDraft("default");
											setDraftModel(value);
										}
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
						{supportsReasoningEffort && (
							<Field>
								<FieldLabel
									htmlFor={`${id}-reasoning`}
									className="text-xs text-muted-foreground"
								>
									Reasoning effort
								</FieldLabel>
								<Select
									value={effortDraft}
									onValueChange={(value) => {
										if (
											value === "default" ||
											value === "minimal" ||
											value === "low" ||
											value === "medium" ||
											value === "high"
										)
											setEffortDraft(value);
									}}
								>
									<SelectTrigger id={`${id}-reasoning`} className="w-full">
										<SelectValue>
											{(selected: string | null) =>
												selected === "default" ? "Provider default" : selected
											}
										</SelectValue>
									</SelectTrigger>
									<SelectContent alignItemWithTrigger={false}>
										<SelectItem value="default">Provider default</SelectItem>
										{(["minimal", "low", "medium", "high"] as const).map(
											(effort) => (
												<SelectItem key={effort} value={effort}>
													{effort}
												</SelectItem>
											),
										)}
									</SelectContent>
								</Select>
							</Field>
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
								Instructions
							</FieldLabel>
							<Textarea
								id={id}
								className="min-h-[132px] max-h-52"
								placeholder="Write instructions..."
								maxLength={MAX_PROMPT_LENGTH}
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								rows={2}
								autoFocus
							/>
						</Field>
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
							onSave({
								model: draftModel,
								prompt: draft,
								variables: variablesDraft,
								maxOutputTokens: parsed.data,
								reasoningEffort:
									supportsReasoningEffort && effortDraft !== "default"
										? effortDraft
										: undefined,
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
