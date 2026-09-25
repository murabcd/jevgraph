import { describe, expect, test } from "bun:test";
import { handleApi } from "../server/api";
import { defaultJevQuestion } from "../src/lib/jev-question";
import { defaultConfig, type RouteStreamEvent } from "../src/lib/routing";

async function eventsFor(
	routes: unknown,
): Promise<{ response: Response; events: RouteStreamEvent[] }> {
	const response = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				messages: [{ role: "user", content: "Hello" }],
				requestPrompt: "",
				config: defaultConfig,
				routes,
			}),
		}),
		{},
	);
	const body = await response.text();
	return {
		response,
		events: body
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as RouteStreamEvent),
	};
}

describe("chatflow API", () => {
	test("runs a direct model graph without Jev", async () => {
		const { response, events } = await eventsFor({
			kind: "workflow",
			nodes: [
				{ id: "input", kind: "input" },
				{
					id: "selected-model",
					kind: "model",
					provider: "openai",
					model: "gpt-4.1",
				},
			],
			edges: [{ id: "entry", source: "input", target: "selected-model" }],
		});
		expect(response.status).toBe(200);
		expect(events.find((event) => event.type === "route")).toMatchObject({
			type: "route",
			route: { model: "gpt-4.1", nodeId: "selected-model" },
		});
		expect(events).toContainEqual({
			type: "timing",
			timing: expect.objectContaining({
				nodeId: "selected-model",
				status: "failed",
			}),
		});
		expect(events.at(-1)).toEqual({
			type: "error",
			error: "openai failed: OPENAI_API_KEY is not configured",
		});
	});

	test("reports the reached Jev node and a failure timing", async () => {
		const { response, events } = await eventsFor({
			kind: "workflow",
			nodes: [
				{ id: "input", kind: "input" },
				{ id: "custom-router", kind: "jev", question: defaultJevQuestion() },
				{
					id: "fast-model",
					kind: "model",
					provider: "google",
					model: "gemini-3.5-flash-lite",
				},
				{
					id: "deep-model",
					kind: "model",
					provider: "openai",
					model: "gpt-5-mini",
				},
			],
			edges: [
				{ id: "entry", source: "input", target: "custom-router" },
				{
					id: "fast",
					source: "custom-router",
					sourceHandle: "fast",
					target: "fast-model",
				},
				{
					id: "deep",
					source: "custom-router",
					sourceHandle: "deep",
					target: "deep-model",
				},
			],
		});
		expect(response.status).toBe(200);
		expect(events).toContainEqual({
			type: "timing",
			timing: expect.objectContaining({
				nodeId: "custom-router",
				status: "failed",
			}),
		});
		expect(events.find((event) => event.type === "route")).toMatchObject({
			route: {
				path: [
					{ nodeId: "input" },
					{ nodeId: "custom-router" },
					{ nodeId: "fast-model" },
				],
			},
		});
	});

	test("rejects an obsolete route shape", async () => {
		const { response } = await eventsFor({ kind: "direct", target: {} });
		expect(response.status).toBe(400);
	});
});
