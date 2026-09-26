import type {
	Experimental_EvaluationAnswer,
	Experimental_EvaluationQuestion,
} from "ai";
import { z } from "zod";

function questionSchema(text: z.ZodString) {
	const choiceQuestionSchema = z.object({
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
	const noulQuestionSchema = z.object({
		type: z.literal("noul"),
		instructions: text,
		yesDescription: text,
		noDescription: text,
	});
	const scoreQuestionSchema = z.object({
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
	if (type === "noul") {
		return {
			type,
			instructions: "",
			yesDescription: "",
			noDescription: "",
		};
	}
	if (type === "score") {
		return {
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

export function questionOutputs(question: JevQuestion) {
	if (question.type === "choice") {
		return question.options.map(({ id, label }) => ({ id, label }));
	}
	if (question.type === "noul") {
		return [
			{ id: "no", label: "No" },
			{ id: "yes", label: "Yes" },
		];
	}
	return question.levels.map((level, index) => ({
		id: level.id,
		label: `Level ${index}`,
	}));
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
	return { branch, value, probabilities, confidence };
}
