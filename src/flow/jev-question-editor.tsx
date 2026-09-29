import { Plus, Repeat2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
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
import type { JevNodeSettings } from "@/flow/graph";
import { PricingFields } from "@/flow/pricing-fields";
import { StartVariableBinding } from "@/flow/start-variable-binding";
import {
	type ContextDocument,
	type ContextPolicy,
	contextPolicySchema,
	DEFAULT_CONTEXT_POLICY,
	retainBoundInstructions,
} from "@/lib/context";
import {
	configuredJevQuestionSchema,
	defaultJevQuestion,
	type JevQuestion,
	type JevQuestionType,
	jevQuestionTypes,
	questionOutputs,
	questionTypeLabels,
} from "@/lib/jev-question";
import { JEV_PUBLISHED_PRICING } from "@/lib/model-pricing";
import { confidenceThresholdSchema, type StartField } from "@/lib/routing";
import { type Pricing, pricingSchema } from "@/lib/usage";
import { cn } from "@/lib/utils";

type ChoiceQuestion = Extract<JevQuestion, { type: "choice" }>;
type NoulQuestion = Extract<JevQuestion, { type: "noul" }>;
type ScoreQuestion = Extract<JevQuestion, { type: "score" }>;
type FieldsProps<T extends JevQuestion> = {
	question: T;
	onChange: (question: T) => void;
};

const editorTextareaSize = "min-h-[132px] max-h-52";
const sectionFrameClassName =
	"relative min-h-[132px] gap-1 rounded-lg border border-input bg-transparent px-3 py-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30";
const sectionTextareaClassName =
	"min-h-20 max-h-52 rounded-none border-0 bg-transparent px-0 py-0 text-sm leading-6 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent";
const choiceValue = (id: string) => `choice:${id}`;

function QuestionTypeOption({ type }: { type: JevQuestionType }) {
	return (
		<span className="flex items-center gap-2">
			<img
				src="/brands/typesafe.png"
				alt=""
				className="size-4 object-contain"
			/>
			{questionTypeLabels[type]}
		</span>
	);
}

function RepeatOption({ limit }: { limit: number }) {
	return (
		<span className="flex items-center gap-2">
			<Repeat2 className="size-4" />
			{limit} {limit === 1 ? "repeat" : "repeats"}
		</span>
	);
}

function ChoiceFields({ question, onChange }: FieldsProps<ChoiceQuestion>) {
	const updateOption = (
		id: string,
		patch: Partial<ChoiceQuestion["options"][number]>,
	) =>
		onChange({
			...question,
			options: question.options.map((option) =>
				option.id === id ? { ...option, ...patch } : option,
			),
		});
	return (
		<FieldGroup className="gap-2">
			<div className="flex items-center justify-between">
				<FieldTitle className="text-xs text-muted-foreground">
					Sections
				</FieldTitle>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={question.options.length >= 255}
					onClick={() =>
						onChange({
							...question,
							options: [
								...question.options,
								{ id: crypto.randomUUID(), label: "", description: "" },
							],
						})
					}
				>
					<Plus /> Add choice
				</Button>
			</div>
			{question.options.map((option, index) => (
				<FieldSet key={option.id} className={sectionFrameClassName}>
					<FieldLegend className="sr-only">Choice {index + 1}</FieldLegend>
					<Field>
						<FieldLabel
							htmlFor={`jev-choice-${option.id}-label`}
							className="sr-only"
						>
							Choice {index + 1} name
						</FieldLabel>
						<Input
							id={`jev-choice-${option.id}-label`}
							className={cn(
								"h-7 rounded-none border-0 bg-transparent px-0 py-0 text-base shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent",
								question.options.length > 2 && "pr-8",
							)}
							placeholder="Choice name"
							value={option.label}
							onChange={(event) =>
								updateOption(option.id, { label: event.target.value })
							}
						/>
					</Field>
					<Field>
						<FieldLabel
							htmlFor={`jev-choice-${option.id}-criteria`}
							className="sr-only"
						>
							{option.label || `Choice ${index + 1}`} criteria
						</FieldLabel>
						<Textarea
							id={`jev-choice-${option.id}-criteria`}
							className={sectionTextareaClassName}
							placeholder="When to choose this output"
							value={option.description}
							onChange={(event) =>
								updateOption(option.id, { description: event.target.value })
							}
							rows={2}
						/>
					</Field>
					{question.options.length > 2 && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="absolute right-2 top-2 text-muted-foreground"
							aria-label={`Remove ${option.label || `choice ${index + 1}`}`}
							onClick={() =>
								onChange({
									...question,
									options: question.options.filter(
										(item) => item.id !== option.id,
									),
								})
							}
						>
							<X />
						</Button>
					)}
				</FieldSet>
			))}
		</FieldGroup>
	);
}

function NoulFields({ question, onChange }: FieldsProps<NoulQuestion>) {
	return (
		<FieldGroup>
			<Field>
				<FieldLabel htmlFor="jev-yes" className="text-xs text-muted-foreground">
					Yes
				</FieldLabel>
				<Textarea
					id="jev-yes"
					className={editorTextareaSize}
					placeholder="When the answer is Yes"
					value={question.yesDescription}
					onChange={(event) =>
						onChange({ ...question, yesDescription: event.target.value })
					}
					rows={2}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor="jev-no" className="text-xs text-muted-foreground">
					No
				</FieldLabel>
				<Textarea
					id="jev-no"
					className={editorTextareaSize}
					placeholder="When the answer is No"
					value={question.noDescription}
					onChange={(event) =>
						onChange({ ...question, noDescription: event.target.value })
					}
					rows={2}
				/>
			</Field>
		</FieldGroup>
	);
}

function ScoreFields({ question, onChange }: FieldsProps<ScoreQuestion>) {
	const removeLevel = (id: string) => {
		onChange({
			...question,
			levels: question.levels.filter((level) => level.id !== id),
		});
	};
	const addLevel = () => {
		onChange({
			...question,
			levels: [
				...question.levels,
				{ id: crypto.randomUUID(), description: "" },
			],
		});
	};
	return (
		<FieldGroup className="gap-2">
			<div className="flex items-center justify-between">
				<FieldTitle className="text-xs text-muted-foreground">
					Score levels (0 to {question.levels.length - 1})
				</FieldTitle>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={question.levels.length >= 10}
					onClick={addLevel}
				>
					<Plus /> Add level
				</Button>
			</div>
			{question.levels.map((level, index) => (
				<FieldSet key={level.id} className={sectionFrameClassName}>
					<FieldLegend className="sr-only">Level {index}</FieldLegend>
					<FieldTitle className="w-full pr-8">Level {index}</FieldTitle>
					<Field>
						<FieldLabel htmlFor={`jev-score-${level.id}`} className="sr-only">
							Level {index}
						</FieldLabel>
						<Textarea
							id={`jev-score-${level.id}`}
							className={sectionTextareaClassName}
							placeholder="Describe this level"
							value={level.description}
							onChange={(event) =>
								onChange({
									...question,
									levels: question.levels.map((item) =>
										item.id === level.id
											? { ...item, description: event.target.value }
											: item,
									),
								})
							}
							rows={2}
						/>
					</Field>
					{question.levels.length > 2 && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="absolute right-2 top-2 text-muted-foreground"
							aria-label={`Remove score level ${index}`}
							onClick={() => removeLevel(level.id)}
						>
							<X />
						</Button>
					)}
				</FieldSet>
			))}
		</FieldGroup>
	);
}

type Props = {
	title: string;
	question: JevQuestion;
	confidenceThreshold: number;
	fallbackOutputId?: string;
	fields: StartField[];
	variables: string[];
	context?: ContextPolicy;
	pricing?: Pricing;
	contextSources: ContextSourceOption[];
	documents: ContextDocument[];
	hasRepeat?: boolean;
	maxRepeats: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (settings: JevNodeSettings) => void;
};

export function JevQuestionEditor({
	title,
	question,
	confidenceThreshold,
	fallbackOutputId,
	fields,
	variables,
	context,
	pricing,
	contextSources,
	documents,
	hasRepeat,
	maxRepeats,
	open,
	onOpenChange,
	onSave,
}: Props) {
	const [draft, setDraft] = useState<JevQuestion>(question);
	const [confidenceDraft, setConfidenceDraft] = useState(
		String(confidenceThreshold * 100),
	);
	const [fallbackDraft, setFallbackDraft] = useState(
		fallbackOutputId ? choiceValue(fallbackOutputId) : "error",
	);
	const [repeatDraft, setRepeatDraft] = useState(maxRepeats);
	const [variablesDraft, setVariablesDraft] = useState(variables);
	const selectedVariableNames = new Set(variablesDraft);
	const [error, setError] = useState("");
	const [contextDraft, setContextDraft] = useState(
		context ?? DEFAULT_CONTEXT_POLICY,
	);
	const [pricingDraft, setPricingDraft] = useState(pricing);
	const save = () => {
		const parsed = configuredJevQuestionSchema.safeParse(draft);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			setError(
				issue?.code === "too_small"
					? "Complete the instructions and criteria for every answer."
					: (issue?.message ?? "Check the question fields."),
			);
			return;
		}
		const parsedConfidence = confidenceThresholdSchema.safeParse(
			confidenceDraft.trim() === "" ? NaN : Number(confidenceDraft) / 100,
		);
		if (!parsedConfidence.success) {
			setError(
				draft.type === "noul"
					? "Minimum probability of the chosen answer must be between 0 and 100%."
					: "Minimum confidence must be between 0 and 100%.",
			);
			return;
		}
		const fallbackOutputId = questionOutputs(parsed.data).find(
			(output) => choiceValue(output.id) === fallbackDraft,
		)?.id;
		if (fallbackDraft !== "error" && !fallbackOutputId) {
			setError("Select a valid fallback choice.");
			return;
		}
		const parsedContext = contextPolicySchema.safeParse(contextDraft);
		const parsedPricing = pricingSchema.optional().safeParse(pricingDraft);
		if (!parsedContext.success || !parsedPricing.success) {
			setError(
				"Check context settings: budget 1,000–120,000, probability 50–100%, and nonnegative pricing rates.",
			);
			return;
		}
		onSave({
			question: parsed.data,
			confidenceThreshold: parsedConfidence.data,
			fallbackOutputId,
			variables: variablesDraft,
			context: parsedContext.data,
			pricing: parsedPricing.data,
			maxRepeats: repeatDraft,
		});
		onOpenChange(false);
	};
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
					<div className="flex flex-col gap-6 px-4 pb-4">
						<Field>
							<FieldLabel
								htmlFor="jev-question-type"
								className="text-xs text-muted-foreground"
							>
								Question type
							</FieldLabel>
							<Select
								value={draft.type}
								onValueChange={(value) => {
									const type = jevQuestionTypes.find(
										(candidate) => candidate === value,
									);
									if (type) {
										setDraft(defaultJevQuestion(type));
										setFallbackDraft("error");
										setError("");
									}
								}}
							>
								<SelectTrigger id="jev-question-type" className="w-full">
									<SelectValue>
										{(selected: JevQuestionType | null) =>
											selected ? (
												<QuestionTypeOption type={selected} />
											) : (
												"Select a type"
											)
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent alignItemWithTrigger={false}>
									<SelectGroup>
										{jevQuestionTypes.map((type) => (
											<SelectItem key={type} value={type}>
												<QuestionTypeOption type={type} />
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>
						<Field>
							<FieldLabel
								htmlFor="jev-instructions"
								className="text-xs text-muted-foreground"
							>
								Instructions
							</FieldLabel>
							<Textarea
								id="jev-instructions"
								className={editorTextareaSize}
								placeholder="What should Jev decide?"
								value={draft.instructions}
								onChange={(event) =>
									setDraft({ ...draft, instructions: event.target.value })
								}
								rows={2}
							/>
						</Field>
						<StartVariableBinding
							fields={fields}
							selected={variablesDraft}
							onChange={(variables) => {
								setVariablesDraft(variables);
								setContextDraft((policy) =>
									retainBoundInstructions(
										policy,
										variables,
										contextSources.map(({ id }) => id),
									),
								);
							}}
						/>
						{draft.type === "choice" && (
							<ChoiceFields question={draft} onChange={setDraft} />
						)}
						{draft.type === "noul" && (
							<NoulFields question={draft} onChange={setDraft} />
						)}
						{draft.type === "score" && (
							<ScoreFields question={draft} onChange={setDraft} />
						)}
						<Field>
							<FieldLabel
								htmlFor="jev-confidence"
								className="text-xs text-muted-foreground"
							>
								{draft.type === "noul"
									? "Minimum probability of chosen answer (%)"
									: "Minimum confidence (%)"}
							</FieldLabel>
							<Input
								id="jev-confidence"
								type="text"
								inputMode="decimal"
								value={confidenceDraft}
								onChange={(event) => setConfidenceDraft(event.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel
								htmlFor="jev-uncertain"
								className="text-xs text-muted-foreground"
							>
								When below threshold or Jev fails
							</FieldLabel>
							<Select
								value={fallbackDraft}
								onValueChange={(value) => value && setFallbackDraft(value)}
							>
								<SelectTrigger id="jev-uncertain" className="w-full">
									<SelectValue>
										{(selected: string | null) =>
											selected === "error"
												? "Stop with error"
												: (questionOutputs(draft).find(
														(output) => choiceValue(output.id) === selected,
													)?.label ?? "Select a choice")
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent alignItemWithTrigger={false}>
									<SelectGroup>
										<SelectItem value="error">Stop with error</SelectItem>
										{questionOutputs(draft).map((output) => (
											<SelectItem
												key={output.id}
												value={choiceValue(output.id)}
											>
												{output.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>
						{hasRepeat && (
							<Field>
								<FieldLabel
									htmlFor="jev-repeat-limit"
									className="text-xs text-muted-foreground"
								>
									Repeat limit
								</FieldLabel>
								<Select
									value={String(repeatDraft)}
									onValueChange={(value) => {
										if (value) setRepeatDraft(Number(value));
									}}
								>
									<SelectTrigger id="jev-repeat-limit" className="w-full">
										<SelectValue>
											{(selected: string | null) =>
												selected ? (
													<RepeatOption limit={Number(selected)} />
												) : (
													"Select a limit"
												)
											}
										</SelectValue>
									</SelectTrigger>
									<SelectContent alignItemWithTrigger={false}>
										<SelectGroup>
											{[1, 2, 3, 4, 5].map((limit) => (
												<SelectItem key={limit} value={String(limit)}>
													<RepeatOption limit={limit} />
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</Field>
						)}
						<ContextPolicyFields
							fields={fields.filter((field) =>
								selectedVariableNames.has(field.name),
							)}
							id="jev"
							value={contextDraft}
							onChange={setContextDraft}
							sources={contextSources}
							documents={documents}
						/>
						<PricingFields
							id="jev"
							published={JEV_PUBLISHED_PRICING}
							value={pricingDraft}
							onChange={setPricingDraft}
						/>
						{error && <FieldError>{error}</FieldError>}
					</div>
				</ScrollArea>
				<SheetFooter>
					<Button onClick={save}>Save</Button>
					<SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
