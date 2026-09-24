import { describe, expect, test } from "bun:test";
import {
	defaultJevQuestion,
	questionForJev,
	resolveJevAnswer,
} from "../src/lib/jev-question";

describe("Jev question modes", () => {
	test("sends each configured question in the provider's format", () => {
		expect(questionForJev(defaultJevQuestion("choice")).type).toBe("choice");
		expect(questionForJev(defaultJevQuestion("noul"))).toMatchObject({
			type: "boolean",
			criteria: { true: "Complex reasoning or high precision is required." },
		});
		expect(questionForJev(defaultJevQuestion("score"))).toMatchObject({
			type: "score",
			criteria: [
				"A direct response is sufficient.",
				"Some reasoning is needed.",
				"Complex, multi-step reasoning is required.",
			],
		});
	});

	test("maps a Choice label to its stable output ID", () => {
		const question = defaultJevQuestion("choice");
		if (question.type !== "choice") throw new Error("Expected Choice question");
		question.options[0].label = "Cheap";
		expect(
			resolveJevAnswer(question, { type: "choice", choice: "Cheap" }, 0.9),
		).toMatchObject({ branch: "fast", confidence: 0.9 });
		expect(() =>
			resolveJevAnswer(question, { type: "choice", choice: "Unknown" }, 0.9),
		).toThrow("unknown choice");
	});

	test("routes Noul by yes probability and derives confidence", () => {
		const question = defaultJevQuestion("noul");
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

	test("routes an expected Score across the configured threshold", () => {
		const question = defaultJevQuestion("score");
		expect(
			resolveJevAnswer(question, { type: "score", score: 1.49 }, 0.8).branch,
		).toBe("low");
		expect(
			resolveJevAnswer(question, { type: "score", score: 1.5 }, 0.8).branch,
		).toBe("high");
		expect(() =>
			resolveJevAnswer(question, { type: "score", score: 3 }, 0.8),
		).toThrow("outside the rubric");
	});
});
