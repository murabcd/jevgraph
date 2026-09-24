import { describe, expect, test } from "bun:test";
import {
	defaultConfig,
	routeRequestSchema,
	selectRoute,
} from "../src/lib/routing";

describe("routing policy", () => {
	const routes = {
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
	};

	test("sends confident fast tasks to Gemini", () => {
		expect(
			selectRoute({ choice: "fast", confidence: 0.8 }, defaultConfig, routes)
				.target.provider,
		).toBe("google");
		expect(
			selectRoute({ choice: "fast", confidence: 0.7 }, defaultConfig, routes)
				.target.model,
		).toBe("gemini-3.5-flash-lite");
	});

	test("sends confident deep tasks to OpenAI", () => {
		expect(
			selectRoute({ choice: "deep", confidence: 0.8 }, defaultConfig, routes)
				.target.provider,
		).toBe("openai");
	});

	test("uses the chosen default at low confidence or without Jev", () => {
		const config = { ...defaultConfig, defaultProvider: "google" as const };
		expect(
			selectRoute({ choice: "deep", confidence: 0.69 }, config, routes).target
				.provider,
		).toBe("google");
		expect(selectRoute(undefined, config, routes).target.provider).toBe(
			"google",
		);
	});

	test("uses the model selected on the connected node", () => {
		const changed = {
			...routes,
			fast: {
				nodeId: "new-node",
				provider: "openai" as const,
				model: "gpt-4.1",
			},
		};
		expect(
			selectRoute({ choice: "fast", confidence: 1 }, defaultConfig, changed)
				.target,
		).toEqual(changed.fast);
	});

	test("accepts a conversation only when the latest turn is from the user", () => {
		const request = {
			config: defaultConfig,
			routes,
			messages: [
				{ role: "user", content: "My name is Alex" },
				{ role: "assistant", content: "Hello, Alex" },
				{ role: "user", content: "What is my name?" },
			],
		};
		expect(routeRequestSchema.safeParse(request).success).toBe(true);
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
});
