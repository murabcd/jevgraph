import { describe, expect, test } from "bun:test";
import { handleApi } from "../server/api";
import { defaultJevQuestion } from "../src/lib/jev-question";
import { defaultConfig, type RouteStreamEvent } from "../src/lib/routing";

describe("route API", () => {
	test("sends a direct route without requiring Jev", async () => {
		const response = await handleApi(
			new Request("http://localhost/api/route", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					messages: [{ role: "user", content: "Hello" }],
					requestPrompt: "",
					config: defaultConfig,
					routes: {
						kind: "direct",
						target: {
							nodeId: "selected-model",
							provider: "openai",
							model: "gpt-4.1",
						},
					},
				}),
			}),
			{},
		);
		const events = (await response.text())
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as RouteStreamEvent);
		expect(response.status).toBe(200);
		expect(events[0]).toMatchObject({
			type: "route",
			route: {
				mode: "direct",
				model: "gpt-4.1",
				nodeId: "selected-model",
				branch: "direct",
			},
		});
		expect(events[1]).toMatchObject({
			type: "timing",
			timing: {
				nodeId: "selected-model",
				status: "failed",
			},
		});
		expect(events[2]).toMatchObject({
			type: "error",
			error: "OPENAI_API_KEY is not configured",
		});
	});

	test("uses the configured Router ID for a single-Jev route", async () => {
		const response = await handleApi(
			new Request("http://localhost/api/route", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					messages: [{ role: "user", content: "Hello" }],
					requestPrompt: "",
					config: defaultConfig,
					routes: {
						kind: "jev",
						nodeId: "custom-router",
						question: defaultJevQuestion(),
						targets: {
							fast: {
								nodeId: "fast-model",
								provider: "google",
								model: "gemini-3.5-flash-lite",
							},
							deep: {
								nodeId: "deep-model",
								provider: "openai",
								model: "gpt-5-mini",
							},
						},
					},
				}),
			}),
			{},
		);
		const events = (await response.text())
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as RouteStreamEvent);
		expect(events).toContainEqual({
			type: "timing",
			timing: expect.objectContaining({
				nodeId: "custom-router",
				status: "failed",
			}),
		});
		expect(events.find((event) => event.type === "route")).toMatchObject({
			route: {
				mode: "jev",
				path: [
					{ nodeId: "input" },
					{ nodeId: "custom-router" },
					{ nodeId: "deep-model", via: "deep" },
				],
			},
		});
	});
});
