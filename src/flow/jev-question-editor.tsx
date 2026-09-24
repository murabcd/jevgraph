import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type JevQuestion, jevQuestionSchema } from "@/lib/jev-question";

type ChoiceQuestion = Extract<JevQuestion, { type: "choice" }>;
type NoulQuestion = Extract<JevQuestion, { type: "noul" }>;
type ScoreQuestion = Extract<JevQuestion, { type: "score" }>;
type FieldsProps<T extends JevQuestion> = {
	question: T;
	onChange: (question: T) => void;
};

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
		<div className="grid gap-3">
			<div className="text-sm font-medium">Choices and connected outputs</div>
			{question.options.map((option, index) => (
				<div key={option.id} className="grid gap-2 rounded-lg border p-3">
					<div className="flex gap-2">
						<Input
							aria-label={`Choice ${index + 1} name`}
							value={option.label}
							onChange={(event) =>
								updateOption(option.id, { label: event.target.value })
							}
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={`Remove ${option.label}`}
							disabled={question.options.length <= 2}
							onClick={() =>
								onChange({
									...question,
									options: question.options.filter(
										(item) => item.id !== option.id,
									),
								})
							}
						>
							<Trash2 />
						</Button>
					</div>
					<Textarea
						aria-label={`${option.label} criteria`}
						value={option.description}
						onChange={(event) =>
							updateOption(option.id, { description: event.target.value })
						}
						rows={2}
					/>
				</div>
			))}
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
	);
}

function NoulFields({ question, onChange }: FieldsProps<NoulQuestion>) {
	return (
		<>
			<label htmlFor="jev-yes" className="grid gap-1 text-sm font-medium">
				Yes criteria
				<Textarea
					id="jev-yes"
					value={question.yesDescription}
					onChange={(event) =>
						onChange({ ...question, yesDescription: event.target.value })
					}
					rows={2}
				/>
			</label>
			<label htmlFor="jev-no" className="grid gap-1 text-sm font-medium">
				No criteria
				<Textarea
					id="jev-no"
					value={question.noDescription}
					onChange={(event) =>
						onChange({ ...question, noDescription: event.target.value })
					}
					rows={2}
				/>
			</label>
		</>
	);
}

function ScoreFields({ question, onChange }: FieldsProps<ScoreQuestion>) {
	const [levelIds, setLevelIds] = useState(() =>
		question.levels.map(() => crypto.randomUUID()),
	);
	const removeLevel = (index: number) => {
		onChange({
			...question,
			levels: question.levels.filter((_, levelIndex) => levelIndex !== index),
			threshold: Math.min(question.threshold, question.levels.length - 2),
		});
		setLevelIds((ids) => ids.filter((_, levelIndex) => levelIndex !== index));
	};
	const addLevel = () => {
		onChange({ ...question, levels: [...question.levels, ""] });
		setLevelIds((ids) => [...ids, crypto.randomUUID()]);
	};
	return (
		<>
			<div className="grid gap-2">
				<div className="text-sm font-medium">
					Score levels (0 to {question.levels.length - 1})
				</div>
				{question.levels.map((level, index) => (
					<div key={levelIds[index]} className="flex items-center gap-2">
						<span className="w-5 text-xs text-muted-foreground">{index}</span>
						<Input
							aria-label={`Score level ${index}`}
							value={level}
							onChange={(event) =>
								onChange({
									...question,
									levels: question.levels.map((item, levelIndex) =>
										levelIndex === index ? event.target.value : item,
									),
								})
							}
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={`Remove score level ${index}`}
							disabled={question.levels.length <= 2}
							onClick={() => removeLevel(index)}
						>
							<Trash2 />
						</Button>
					</div>
				))}
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
			<label htmlFor="jev-threshold" className="grid gap-1 text-sm font-medium">
				High begins at score
				<Input
					id="jev-threshold"
					type="number"
					min={0}
					max={question.levels.length - 1}
					step="any"
					value={question.threshold}
					onChange={(event) =>
						onChange({ ...question, threshold: event.target.valueAsNumber })
					}
				/>
			</label>
		</>
	);
}

type Props = {
	question: JevQuestion;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (question: JevQuestion) => void;
};

export function JevQuestionEditor({
	question,
	open,
	onOpenChange,
	onSave,
}: Props) {
	const [draft, setDraft] = useState<JevQuestion>(question);
	const [error, setError] = useState("");
	const save = () => {
		const parsed = jevQuestionSchema.safeParse(draft);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Check the question fields.");
			return;
		}
		onSave(parsed.data);
		onOpenChange(false);
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[min(80vh,720px)] w-[min(520px,calc(100vw-2rem))] overflow-y-auto sm:max-w-none">
				<DialogHeader>
					<DialogTitle>
						Edit{" "}
						{draft.type === "noul"
							? "Noul"
							: draft.type === "score"
								? "Score"
								: "Choice"}{" "}
						question
					</DialogTitle>
				</DialogHeader>
				<div className="grid gap-4">
					<label
						htmlFor="jev-instructions"
						className="grid gap-1 text-sm font-medium"
					>
						Instructions
						<Textarea
							id="jev-instructions"
							value={draft.instructions}
							onChange={(event) =>
								setDraft({ ...draft, instructions: event.target.value })
							}
							rows={2}
						/>
					</label>
					{draft.type === "choice" && (
						<ChoiceFields question={draft} onChange={setDraft} />
					)}
					{draft.type === "noul" && (
						<NoulFields question={draft} onChange={setDraft} />
					)}
					{draft.type === "score" && (
						<ScoreFields question={draft} onChange={setDraft} />
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
				</div>
				<DialogFooter>
					<Button onClick={save}>Save question</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
