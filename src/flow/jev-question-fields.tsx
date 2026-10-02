import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	defaultJevQuestion,
	type JevQuestion,
	type JevQuestionType,
	jevQuestionTypes,
	questionOutputs,
	questionTypeLabels,
} from "@/lib/jev-question";
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
							htmlFor={`jev-${question.id}-choice-${option.id}-label`}
							className="sr-only"
						>
							Choice {index + 1} name
						</FieldLabel>
						<Input
							id={`jev-${question.id}-choice-${option.id}-label`}
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
							htmlFor={`jev-${question.id}-choice-${option.id}-criteria`}
							className="sr-only"
						>
							{option.label || `Choice ${index + 1}`} criteria
						</FieldLabel>
						<Textarea
							id={`jev-${question.id}-choice-${option.id}-criteria`}
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
				<FieldLabel
					htmlFor={`jev-${question.id}-yes`}
					className="text-xs text-muted-foreground"
				>
					Yes
				</FieldLabel>
				<Textarea
					id={`jev-${question.id}-yes`}
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
				<FieldLabel
					htmlFor={`jev-${question.id}-no`}
					className="text-xs text-muted-foreground"
				>
					No
				</FieldLabel>
				<Textarea
					id={`jev-${question.id}-no`}
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
						<FieldLabel
							htmlFor={`jev-${question.id}-score-${level.id}`}
							className="sr-only"
						>
							Level {index}
						</FieldLabel>
						<Textarea
							id={`jev-${question.id}-score-${level.id}`}
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

export function JevQuestionFields({
	question,
	onChange,
}: FieldsProps<JevQuestion>) {
	const prefix = `jev-${question.id}`;
	return (
		<FieldGroup className="gap-4">
			<Field>
				<FieldLabel htmlFor={`${prefix}-name`}>Name</FieldLabel>
				<Input
					id={`${prefix}-name`}
					value={question.name}
					onChange={(event) =>
						onChange({ ...question, name: event.target.value })
					}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${prefix}-type`}>Question type</FieldLabel>
				<Select
					value={question.type}
					onValueChange={(value) => {
						const type = jevQuestionTypes.find((item) => item === value);
						if (type)
							onChange({
								...defaultJevQuestion(type),
								id: question.id,
								name: question.name,
								confidenceThreshold: question.confidenceThreshold,
							});
					}}
				>
					<SelectTrigger id={`${prefix}-type`} className="w-full">
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
				<FieldLabel htmlFor={`${prefix}-instructions`}>Instructions</FieldLabel>
				<Textarea
					id={`${prefix}-instructions`}
					className={editorTextareaSize}
					placeholder="What should Jev decide?"
					value={question.instructions}
					onChange={(event) =>
						onChange({ ...question, instructions: event.target.value })
					}
					rows={2}
				/>
			</Field>
			{question.type === "choice" && (
				<ChoiceFields question={question} onChange={onChange} />
			)}
			{question.type === "noul" && (
				<NoulFields question={question} onChange={onChange} />
			)}
			{question.type === "score" && (
				<ScoreFields question={question} onChange={onChange} />
			)}
			<Field>
				<FieldLabel htmlFor={`${prefix}-confidence`}>
					{question.type === "noul"
						? "Minimum probability of chosen answer (%)"
						: "Minimum confidence (%)"}
				</FieldLabel>
				<Input
					id={`${prefix}-confidence`}
					type="text"
					inputMode="decimal"
					value={
						Number.isFinite(question.confidenceThreshold)
							? String(question.confidenceThreshold * 100)
							: ""
					}
					onChange={(event) =>
						onChange({
							...question,
							confidenceThreshold: event.target.value.trim()
								? Number(event.target.value) / 100
								: NaN,
						})
					}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${prefix}-uncertain`}>
					When below threshold or Jev fails
				</FieldLabel>
				<Select
					value={
						question.fallbackOutputId
							? choiceValue(question.fallbackOutputId)
							: "error"
					}
					onValueChange={(value) => {
						if (value)
							onChange({
								...question,
								fallbackOutputId: questionOutputs(question).find(
									({ id }) => choiceValue(id) === value,
								)?.id,
							});
					}}
				>
					<SelectTrigger id={`${prefix}-uncertain`} className="w-full">
						<SelectValue>
							{(selected: string | null) =>
								selected === "error"
									? "Stop with error"
									: questionOutputs(question).find(
											({ id }) => choiceValue(id) === selected,
										)?.label
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent alignItemWithTrigger={false}>
						<SelectGroup>
							<SelectItem value="error">Stop with error</SelectItem>
							{questionOutputs(question).map((output) => (
								<SelectItem key={output.id} value={choiceValue(output.id)}>
									{output.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</Field>
		</FieldGroup>
	);
}
