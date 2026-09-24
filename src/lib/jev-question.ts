import type {
	Experimental_EvaluationAnswer,
	Experimental_EvaluationQuestion,
} from "ai";
import { z } from "zod";

const instructions = z.string().trim().min(1).max(500);
const description = z.string().trim().min(1).max(500);

const choiceQuestionSchema = z.object({
	type: z.literal("choice"),
	instructions,
	options: z
		.array(
			z.object({
				id: z.string().min(1).max(100),
				label: z.string().trim().min(1).max(80),
				description,
			}),
		)
		.min(2)
		.max(255)
		.refine(
			(options) =>
				new Set(options.map((option) => option.id)).size === options.length &&
				new Set(options.map((option) => option.label)).size === options.length,
			"Choice IDs and labels must be unique",
		),
});

const noulQuestionSchema = z.object({
	type: z.literal("noul"),
	instructions,
	yesDescription: description,
	noDescription: description,
});

const scoreQuestionSchema = z
	.object({
		type: z.literal("score"),
		instructions,
		levels: z.array(description).min(2).max(10),
		threshold: z.number().min(0),
	})
	.refine((question) => question.threshold <= question.levels.length - 1, {
		message: "Threshold must be within the score levels",
		path: ["threshold"],
	});

export const jevQuestionSchema = z.union([
	choiceQuestionSchema,
	noulQuestionSchema,
	scoreQuestionSchema,
]);
export type JevQuestion = z.infer<typeof jevQuestionSchema>;
export type JevQuestionType = JevQuestion["type"];

export const jevQuestionTypes = ["choice", "noul", "score"] as const;

export function defaultJevQuestion(
	type: JevQuestionType = "choice",
): JevQuestion {
	if (type === "noul") {
		return {
			type,
			instructions: "Does this request require complex reasoning?",
			yesDescription: "Complex reasoning or high precision is required.",
			noDescription: "A direct response is sufficient.",
		};
	}
	if (type === "score") {
		return {
			type,
			instructions: "How much reasoning does this request require?",
			levels: [
				"A direct response is sufficient.",
				"Some reasoning is needed.",
				"Complex, multi-step reasoning is required.",
			],
			threshold: 1.5,
		};
	}
	return {
		type: "choice",
		instructions:
			"Which level of generative model is appropriate to answer this request accurately?",
		options: [
			{
				id: "fast",
				label: "Fast",
				description:
					"Straightforward writing, extraction, summary, translation, or direct questions with limited reasoning.",
			},
			{
				id: "deep",
				label: "Deep",
				description:
					"Complex reasoning, multi-step analysis, coding, nuanced synthesis, or high precision instructions.",
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
	return [
		{ id: "low", label: "Low" },
		{ id: "high", label: "High" },
	];
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
		criteria: question.levels,
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
		branch = answer.score >= question.threshold ? "high" : "low";
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
