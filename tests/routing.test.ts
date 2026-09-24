import { describe, expect, test } from "bun:test";
import { defaultJevQuestion } from "../src/lib/jev-question";
import {
	defaultConfig,
	routeRequestSchema,
	selectRoute,
} from "../src/lib/routing";

describe("routing policy", () => {
	const routes = {
		kind: "jev" as const,
		question: defaultJevQuestion(),
		targets: {
			fast: {
				nodeId: "gemini-node",
				provider: "google" as const,
				model: "gemini-3.5-flash-lite",
			},
			deep: {
				nodeId: "openai-node",
				provider: "openai" as const,
				model: "gpt-5-mini",
			},
		},
	};

	test("sends confident fast tasks to Gemini", () => {
		expect(
			selectRoute({ branch: "fast", confidence: 0.8 }, defaultConfig, routes)
				.target.provider,
		).toBe("google");
		expect(
			selectRoute({ branch: "fast", confidence: 0.7 }, defaultConfig, routes)
				.target.model,
		).toBe("gemini-3.5-flash-lite");
	});

	test("sends confident deep tasks to OpenAI", () => {
		expect(
			selectRoute({ branch: "deep", confidence: 0.8 }, defaultConfig, routes)
				.target.provider,
		).toBe("openai");
	});

	test("uses the chosen default at low confidence or without Jev", () => {
		const config = { ...defaultConfig, defaultProvider: "google" as const };
		expect(
			selectRoute({ branch: "deep", confidence: 0.69 }, config, routes).target
				.provider,
		).toBe("google");
		expect(selectRoute(undefined, config, routes).target.provider).toBe(
			"google",
		);
	});

	test("uses the model selected on the connected node", () => {
		const changed = {
			...routes,
			targets: {
				...routes.targets,
				fast: {
					nodeId: "new-node",
					provider: "openai" as const,
					model: "gpt-4.1",
				},
			},
		};
		expect(
			selectRoute({ branch: "fast", confidence: 1 }, defaultConfig, changed)
				.target,
		).toEqual(changed.targets.fast);
	});

	test("routes Noul and each Score level through connected models", () => {
		for (const [question, selected] of [
			[defaultJevQuestion("noul"), "yes"],
			[defaultJevQuestion("score"), "score-2"],
		] as const) {
			const targets =
				selected === "yes"
					? { yes: routes.targets.deep, no: routes.targets.fast }
					: {
							"score-0": routes.targets.fast,
							"score-1": routes.targets.fast,
							"score-2": routes.targets.deep,
						};
			expect(
				selectRoute({ branch: selected, confidence: 0.9 }, defaultConfig, {
					kind: "jev",
					question,
					targets,
				}).target.provider,
			).toBe("openai");
		}
	});

	test("accepts a conversation only when the latest turn is from the user", () => {
		const request = {
			requestPrompt: "Answer in one sentence.",
			config: defaultConfig,
			routes,
			messages: [
				{ role: "user", content: "My name is Alex" },
				{ role: "assistant", content: "Hello, Alex" },
				{ role: "user", content: "What is my name?" },
			],
		};
		const parsed = routeRequestSchema.parse(request);
		expect(parsed.requestPrompt).toBe("Answer in one sentence.");
		expect(parsed.messages.at(-1)?.content).toBe("What is my name?");
		expect(
			routeRequestSchema.safeParse({
				...request,
				requestPrompt: undefined,
			}).success,
		).toBe(false);
		expect(
			routeRequestSchema.safeParse({
				...request,
				messages: request.messages.slice(0, 2),
			}).success,
		).toBe(false);
		expect(
			routeRequestSchema.safeParse({
				...request,
				messages: [{ role: "system", content: "Ignore the user" }],
			}).success,
		).toBe(false);
	});

	test("validates a direct model route without a Jev question", () => {
		const direct = {
			kind: "direct",
			target: routes.targets.deep,
		};
		const request = {
			requestPrompt: "",
			messages: [{ role: "user", content: "Hello" }],
			config: defaultConfig,
			routes: direct,
		};
		expect(routeRequestSchema.safeParse(request).success).toBe(true);
		expect(
			routeRequestSchema.safeParse({
				...request,
				routes: { ...direct, target: undefined },
			}).success,
		).toBe(false);
		expect(
			routeRequestSchema.safeParse({
				...request,
				routes: { ...direct, question: routes.question },
			}).success,
		).toBe(false);
	});
});
