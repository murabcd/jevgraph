import type {
	Experimental_EvaluationAnswer,
	Experimental_EvaluationQuestion,
} from "ai";
import { z } from "zod";

export const DEFAULT_JEV_CONFIDENCE_THRESHOLD = 0.7;
export const confidenceThresholdSchema = z.number().finite().min(0).max(1);
export const MAX_JEV_QUESTIONS = 16;
const questionIdentity = {
	id: z
		.string()
		.min(1)
		.max(40)
		.regex(/^[a-zA-Z0-9_-]+$/),
	name: z.string().trim().min(1).max(80),
	confidenceThreshold: confidenceThresholdSchema,
	uncertainOutputId: z.string().min(1).max(200).optional(),
	errorOutputId: z.string().min(1).max(200).optional(),
};

const probabilitiesSchema = z.record(
	z.string(),
	z.number().finite().min(0).max(1),
);

function questionSchema(text: z.ZodString) {
	const choiceQuestionSchema = z.strictObject({
		...questionIdentity,
		type: z.literal("choice"),
		instructions: text,
		options: z
			.array(
				z.object({
					id: z.string().min(1).max(100),
					label: z.string().trim().min(1).max(80),
					description: text,
				}),
			)
			.min(2)
			.max(255)
			.refine(
				(options) =>
					new Set(options.map((option) => option.id)).size === options.length &&
					new Set(options.map((option) => option.label)).size ===
						options.length,
				"Choice IDs and labels must be unique",
			),
	});
	const noulQuestionSchema = z.strictObject({
		...questionIdentity,
		type: z.literal("noul"),
		instructions: text,
		yesDescription: text,
		noDescription: text,
	});
	const scoreQuestionSchema = z.strictObject({
		...questionIdentity,
		type: z.literal("score"),
		instructions: text,
		levels: z
			.array(z.object({ id: z.string().min(1).max(100), description: text }))
			.min(2)
			.max(10)
			.refine(
				(levels) =>
					new Set(levels.map((level) => level.id)).size === levels.length,
				"Score level IDs must be unique",
			),
	});
	return z.union([
		choiceQuestionSchema,
		noulQuestionSchema,
		scoreQuestionSchema,
	]);
}

export const jevQuestionSchema = questionSchema(z.string().trim().max(500));
export const configuredJevQuestionSchema = questionSchema(
	z.string().trim().min(1).max(500),
);
export const jevQuestionsSchema = questionBatchSchema(jevQuestionSchema);
export const configuredJevQuestionsSchema = questionBatchSchema(
	configuredJevQuestionSchema,
);
function questionBatchSchema(question: typeof jevQuestionSchema) {
	return z
		.array(question)
		.min(1)
		.max(MAX_JEV_QUESTIONS)
		.superRefine((questions, ctx) => {
			if (
				new Set(questions.map(({ id }) => id)).size !== questions.length ||
				new Set(questions.map(({ name }) => name)).size !== questions.length
			)
				ctx.addIssue({
					code: "custom",
					message: "Question IDs and names must be unique",
				});
			for (const [index, item] of questions.entries()) {
				const outputs = new Set(questionOutputs(item).map(({ id }) => id));
				for (const field of ["uncertainOutputId", "errorOutputId"] as const) {
					if (item[field] !== undefined && !outputs.has(item[field]))
						ctx.addIssue({
							code: "custom",
							path: [index, field],
							message: `Invalid ${field === "uncertainOutputId" ? "uncertainty" : "error"} output for ${item.name}`,
						});
				}
			}
		});
}
export type JevQuestion = z.infer<typeof jevQuestionSchema>;
export type JevQuestionType = JevQuestion["type"];

export const jevQuestionTypes = ["choice", "noul", "score"] as const;
export const questionTypeLabels = {
	choice: "Choice",
	noul: "Noul",
	score: "Score",
} satisfies Record<JevQuestionType, string>;

export function defaultJevQuestion(
	type: JevQuestionType = "choice",
): JevQuestion {
	const identity = {
		id: "question",
		name: "Question",
		confidenceThreshold: DEFAULT_JEV_CONFIDENCE_THRESHOLD,
	};
	if (type === "noul") {
		return {
			...identity,
			type,
			instructions: "",
			yesDescription: "",
			noDescription: "",
		};
	}
	if (type === "score") {
		return {
			...identity,
			type,
			instructions: "",
			levels: [
				{ id: "score-0", description: "" },
				{ id: "score-1", description: "" },
				{ id: "score-2", description: "" },
			],
		};
	}
	return {
		...identity,
		type: "choice",
		instructions: "",
		options: [
			{
				id: "choice-1",
				label: "Choice 1",
				description: "",
			},
			{
				id: "choice-2",
				label: "Choice 2",
				description: "",
			},
		],
	};
}

/** Output identity survives edits within a question type, never a type change. */
export function stableQuestionOutputIds(
	previous: JevQuestion[],
	next: JevQuestion[],
) {
	const types = new Map(
		previous.map((question) => [question.id, question.type]),
	);
	return new Set(
		batchOutputs(
			next.filter(
				(question) =>
					!types.has(question.id) || types.get(question.id) === question.type,
			),
		).map(({ id }) => id),
	);
}

export function questionOutputId(questionId: string, outputId: string) {
	return `${questionId}/${outputId}`;
}
export function questionOutputs(question: JevQuestion) {
	const outputs =
		question.type === "choice"
			? question.options.map(({ id, label }) => ({ id, label }))
			: question.type === "noul"
				? [
						{ id: "no", label: "No" },
						{ id: "yes", label: "Yes" },
					]
				: question.levels.map((level, index) => ({
						id: level.id,
						label: `Level ${index}`,
					}));
	return outputs.map(({ id, label }) => ({
		id: questionOutputId(question.id, id),
		label,
	}));
}
export function batchOutputs(questions: JevQuestion[]) {
	return questions.flatMap((question) =>
		questionOutputs(question).map((output) => ({
			...output,
			label:
				questions.length === 1
					? output.label
					: `${question.name} · ${output.label}`,
		})),
	);
}

export function questionForJev(
	question: JevQuestion,
): Experimental_EvaluationQuestion {
	if (question.type === "choice")
		return {
			type: "choice",
			instructions: question.instructions,
			criteria: Object.fromEntries(
				question.options.map(({ label, description }) => [label, description]),
			),
		};
	if (question.type === "noul")
		return {
			type: "boolean",
			instructions: question.instructions,
			criteria: {
				true: question.yesDescription,
				false: question.noDescription,
			},
		};
	return {
		type: "score",
		instructions: question.instructions,
		criteria: question.levels.map((level) => level.description),
	};
}

export function resolveJevAnswer(
	question: JevQuestion,
	answer: Experimental_EvaluationAnswer<Experimental_EvaluationQuestion>,
	providerConfidence: unknown,
) {
	let branch: string;
	let value: string | number;
	let probabilities: Record<string, number> | undefined;
	if (question.type === "choice" && answer.type === "choice") {
		const selected = question.options.find(
			(option) => option.label === answer.choice,
		);
		if (!selected) throw new Error("Jev returned an unknown choice");
		branch = selected.id;
		value = answer.choice;
		probabilities = answer.probabilities;
	} else if (question.type === "noul" && answer.type === "boolean") {
		if (
			!Number.isFinite(answer.probability) ||
			answer.probability < 0 ||
			answer.probability > 1
		)
			throw new Error("Jev returned an invalid yes probability");
		branch = answer.probability >= 0.5 ? "yes" : "no";
		value = answer.probability;
		probabilities = { yes: answer.probability, no: 1 - answer.probability };
	} else if (question.type === "score" && answer.type === "score") {
		if (
			!Number.isFinite(answer.score) ||
			answer.score < 0 ||
			answer.score > question.levels.length - 1
		)
			throw new Error("Jev returned a score outside the rubric");
		branch = question.levels[Math.round(answer.score)].id;
		value = answer.score;
		probabilities = answer.probabilities;
	} else throw new Error("Jev returned the wrong question type");
	const confidence =
		question.type === "noul" && answer.type === "boolean"
			? Math.max(answer.probability, 1 - answer.probability)
			: providerConfidence;
	if (
		typeof confidence !== "number" ||
		!Number.isFinite(confidence) ||
		confidence < 0 ||
		confidence > 1
	)
		throw new Error("Jev returned no task confidence");
	if (probabilities !== undefined) {
		const parsed = probabilitiesSchema.safeParse(probabilities);
		if (!parsed.success) throw new Error("Jev returned invalid probabilities");
		probabilities = parsed.data;
	}
	return {
		questionId: question.id,
		type: question.type,
		branch: questionOutputId(question.id, branch),
		value,
		probabilities,
		confidence,
	};
}
