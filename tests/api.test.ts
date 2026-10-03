import { describe, expect, test } from "bun:test";
import { handleApi } from "../server/api";
import type { RouteStreamEvent } from "../src/lib/routing";
import { createApiFixture } from "./api-fixture";
import { configuredJevQuestion } from "./jev-question-fixture";

async function eventsFor(
	routes: unknown,
): Promise<{ response: Response; events: RouteStreamEvent[] }> {
	const fixture = await createApiFixture();
	const response = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				messages: [{ role: "user", content: "Hello" }],
				routes,
			}),
		}),
		{ keys: {}, connect: fixture.connect },
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
				{ id: "input", kind: "input", fields: [] },
				{
					id: "selected-model",
					kind: "model",
					provider: "openai",
					model: "gpt-6-luna",
				},
			],
			edges: [{ id: "entry", source: "input", target: "selected-model" }],
		});
		expect(response.status).toBe(200);
		expect(events.find((event) => event.type === "route")).toMatchObject({
			type: "route",
			route: { model: "gpt-6-luna", nodeId: "selected-model" },
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
				{ id: "input", kind: "input", fields: [] },
				{
					id: "custom-router",
					kind: "jev",
					questions: [
						{
							...configuredJevQuestion(),
							errorOutputId: "question/choice-1",
						},
					],
				},
				{
					id: "first-model",
					kind: "model",
					provider: "google",
					model: "gemini-3.8-flash",
				},
				{
					id: "second-model",
					kind: "model",
					provider: "openai",
					model: "gpt-6-luna",
				},
			],
			edges: [
				{ id: "entry", source: "input", target: "custom-router" },
				{
					id: "choice-1",
					source: "custom-router",
					sourceHandle: "question/choice-1",
					target: "first-model",
				},
				{
					id: "choice-2",
					source: "custom-router",
					sourceHandle: "question/choice-2",
					target: "second-model",
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
					{ nodeId: "first-model" },
				],
			},
		});
	});

	test("rejects an obsolete route shape", async () => {
		const { response } = await eventsFor({ kind: "direct", target: {} });
		expect(response.status).toBe(400);
	});
});

test("the API rejects missing authentication before touching providers", async () => {
	let calls = 0;
	const fixture = await createApiFixture();
	const response = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				messages: [{ role: "user", content: "Здравствуйте" }],
				routes: {
					kind: "workflow",
					nodes: [
						{ id: "input", kind: "input", fields: [] },
						{
							id: "model",
							kind: "model",
							provider: "google",
							model: "gemini-3.8-flash",
							maxOutputTokens: 100,
						},
					],
					edges: [{ id: "entry", source: "input", target: "model" }],
				},
			}),
		}),
		{
			keys: { GOOGLE_GENERATIVE_AI_API_KEY: "test" },
			connect: fixture.connect,
			providerFetch: async () => {
				calls++;
				throw new Error("Should not call");
			},
		},
	);
	expect(response.status).toBe(401);
	expect(calls).toBe(0);
});

test("a Convex connection failure prevents provider calls and creates no unsaved response", async () => {
	const fixture = await createApiFixture();
	let providerCalls = 0;
	const response = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				messages: [{ role: "user", content: "Здравствуйте" }],
				routes: {
					kind: "workflow",
					nodes: [
						{ id: "input", kind: "input", fields: [] },
						{
							id: "model",
							kind: "model",
							provider: "google",
							model: "gemini-3.8-flash",
						},
					],
					edges: [{ id: "entry", source: "input", target: "model" }],
				},
			}),
		}),
		{
			keys: { GOOGLE_GENERATIVE_AI_API_KEY: "test" },
			connect: () => {
				throw new Error("Convex is unavailable");
			},
			providerFetch: async () => {
				providerCalls++;
				throw new Error("Should not call");
			},
		},
	);
	expect(response.status).toBe(502);
	expect(await response.json()).toEqual({ error: "Convex is unavailable" });
	expect(providerCalls).toBe(0);
	expect(await fixture.t.run((ctx) => ctx.db.query("runs").collect())).toEqual(
		[],
	);
});
