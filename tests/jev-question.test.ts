import { describe, expect, test } from "bun:test";
import {
	configuredJevQuestionSchema,
	defaultJevQuestion,
	jevQuestionSchema,
	questionForJev,
	questionOutputs,
	resolveJevAnswer,
} from "../src/lib/jev-question";
import { configuredJevQuestion } from "./jev-question-fixture";

describe("Jev question modes", () => {
	test("sends each configured question in the provider's format", () => {
		expect(questionForJev(configuredJevQuestion("choice")).type).toBe("choice");
		expect(questionForJev(configuredJevQuestion("noul"))).toMatchObject({
			type: "boolean",
			criteria: { true: "The condition is met." },
		});
		expect(questionForJev(configuredJevQuestion("score"))).toMatchObject({
			type: "score",
			criteria: ["Level 0 criteria.", "Level 1 criteria.", "Level 2 criteria."],
		});
	});

	test("keeps new questions generic until configured", () => {
		for (const type of ["choice", "noul", "score"] as const) {
			const question = defaultJevQuestion(type);
			expect(jevQuestionSchema.safeParse(question).success).toBe(true);
			expect(configuredJevQuestionSchema.safeParse(question).success).toBe(
				false,
			);
			expect(
				configuredJevQuestionSchema.safeParse(configuredJevQuestion(type))
					.success,
			).toBe(true);
		}
		expect(questionOutputs(defaultJevQuestion("choice"))).toEqual([
			{ id: "choice-1", label: "Choice 1" },
			{ id: "choice-2", label: "Choice 2" },
		]);
	});

	test("maps a Choice label to its stable output ID", () => {
		const question = configuredJevQuestion("choice");
		if (question.type !== "choice") throw new Error("Expected Choice question");
		question.options[0].label = "Cheap";
		expect(
			resolveJevAnswer(question, { type: "choice", choice: "Cheap" }, 0.9),
		).toMatchObject({ branch: "choice-1", confidence: 0.9 });
		expect(() =>
			resolveJevAnswer(question, { type: "choice", choice: "Unknown" }, 0.9),
		).toThrow("unknown choice");
	});

	test("routes Noul by yes probability and derives confidence", () => {
		const question = configuredJevQuestion("noul");
		expect(
			resolveJevAnswer(
				question,
				{ type: "boolean", probability: 0.2 },
				undefined,
			),
		).toMatchObject({ branch: "no", confidence: 0.8 });
		expect(
			resolveJevAnswer(
				question,
				{ type: "boolean", probability: 0.9 },
				undefined,
			),
		).toMatchObject({ branch: "yes", confidence: 0.9 });
		expect(() =>
			resolveJevAnswer(
				question,
				{ type: "boolean", probability: 1.2 },
				undefined,
			),
		).toThrow("invalid yes probability");
	});

	test("routes Score to the nearest numbered level", () => {
		const question = configuredJevQuestion("score");
		expect(questionOutputs(question)).toEqual([
			{ id: "score-0", label: "Level 0" },
			{ id: "score-1", label: "Level 1" },
			{ id: "score-2", label: "Level 2" },
		]);
		expect(
			resolveJevAnswer(question, { type: "score", score: 0.49 }, 0.8).branch,
		).toBe("score-0");
		expect(
			resolveJevAnswer(question, { type: "score", score: 0.5 }, 0.8).branch,
		).toBe("score-1");
		expect(
			resolveJevAnswer(question, { type: "score", score: 1.5 }, 0.8).branch,
		).toBe("score-2");
		expect(() =>
			resolveJevAnswer(question, { type: "score", score: 3 }, 0.8),
		).toThrow("outside the rubric");
	});
});
