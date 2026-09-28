import { useState } from "react";
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
import {
	ContextPolicyFields,
	type ContextSourceOption,
} from "@/flow/context-policy-fields";
import type { ModelNodeSettings } from "@/flow/graph";
import {
	type DraftPromptMessage,
	ModelMessagesEditor,
} from "@/flow/model-messages-editor";
import { ModelOption } from "@/flow/model-option";
import { ModelRoutingFields } from "@/flow/model-routing-fields";
import { ModelThinkingField } from "@/flow/model-thinking-field";
import { PricingFields } from "@/flow/pricing-fields";
import { StartVariableBinding } from "@/flow/start-variable-binding";
import {
	type ContextDocument,
	type ContextPolicy,
	contextPolicySchema,
	DEFAULT_CONTEXT_POLICY,
} from "@/lib/context";
import { publishedPricing } from "@/lib/model-pricing";
import {
	type ModelRouting,
	modelRoutingSchema,
	routingReasoningEfforts,
} from "@/lib/model-routing";
import { textModels } from "@/lib/models";
import {
	MAX_PROMPT_LENGTH,
	type ModelPromptMessage,
	maxOutputTokensSchema,
	modelPromptMessagesSchema,
	modelReasoningEffort,
	type StartField,
} from "@/lib/routing";
import { type Pricing, pricingSchema } from "@/lib/usage";

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
	fields: StartField[];
	variables: string[];
	context?: ContextPolicy;
	pricing?: Pricing;
	routing?: ModelRouting;
	contextSources: ContextSourceOption[];
	documents: ContextDocument[];
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
	fields,
	variables,
	context,
	pricing,
	routing,
	contextSources,
	documents,
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
	const [reasoningDraft, setReasoningDraft] = useState(() => {
		const model = textModels.find((item) => item.id === modelId);
		if (routing) return reasoningEffort ?? "medium";
		return model
			? modelReasoningEffort(model.provider, model.id, reasoningEffort)
			: undefined;
	});
	const [error, setError] = useState("");
	const [contextDraft, setContextDraft] = useState(
		context ?? DEFAULT_CONTEXT_POLICY,
	);
	const [pricingDraft, setPricingDraft] = useState(pricing);
	const [routingDraft, setRoutingDraft] = useState(routing);
	const allowedEfforts = routingDraft
		? routingReasoningEfforts(routingDraft.models)
		: undefined;
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
										setPricingDraft(undefined);
										setReasoningDraft(nextModel.reasoning.defaultEffort);
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
						<ModelRoutingFields
							id={id}
							value={routingDraft}
							maxOutputTokens={Number(outputTokensDraft)}
							onChange={(routing) => {
								setRoutingDraft(routing);
								const efforts = routing
									? routingReasoningEfforts(routing.models)
									: selectedModel?.reasoning.efforts;
								if (reasoningDraft && !efforts?.includes(reasoningDraft))
									setReasoningDraft("medium");
							}}
						/>
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
								efforts={allowedEfforts}
								value={reasoningDraft ?? selectedModel.reasoning.defaultEffort}
								onChange={setReasoningDraft}
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
						<ContextPolicyFields
							id={id}
							value={contextDraft}
							onChange={setContextDraft}
							sources={contextSources}
							documents={documents}
						/>
						<PricingFields
							id={id}
							value={pricingDraft}
							onChange={setPricingDraft}
							published={
								selectedModel &&
								publishedPricing(selectedModel.provider, selectedModel.id)
							}
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
							if (
								reasoningDraft === undefined ||
								!(allowedEfforts ?? selectedModel.reasoning.efforts).includes(
									reasoningDraft,
								)
							) {
								setError("Choose a supported reasoning effort.");
								return;
							}
							const promptMessages = modelPromptMessagesSchema.safeParse(
								messagesDraft.map(({ role, content }) => ({ role, content })),
							);
							if (!promptMessages.success) {
								setError("Each added message needs content.");
								return;
							}
							const parsedContext = contextPolicySchema.safeParse(contextDraft);
							const parsedPricing = pricingSchema
								.optional()
								.safeParse(pricingDraft);
							if (!parsedContext.success || !parsedPricing.success) {
								setError(
									"Check context settings: budget 1,000–120,000, probability 50–100%, and nonnegative pricing rates.",
								);
								return;
							}
							const parsedRouting = modelRoutingSchema
								.optional()
								.safeParse(routingDraft);
							if (
								!parsedRouting.success ||
								(parsedRouting.data &&
									parsedRouting.data.expectedOutputTokens > parsed.data)
							) {
								setError(
									"Choose at least one model, expected output within the output limit, and 1–20 requests.",
								);
								return;
							}
							onSave({
								model: draftModel,
								routing: parsedRouting.data,
								prompt: draft,
								promptMessages: promptMessages.data,
								variables: variablesDraft,
								context: parsedContext.data,
								pricing: parsedPricing.data,
								maxOutputTokens: parsed.data,
								reasoningEffort: reasoningDraft,
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
