import { expect, test } from "bun:test";
import { z } from "zod";
import { handleApi } from "../server/api";
import { DEFAULT_CONTEXT_POLICY } from "../src/lib/context";
import { readRouteStream } from "../src/lib/route-stream";
import type { RouteResult } from "../src/lib/routing";
import { createApiFixture } from "./api-fixture";
import { configuredJevQuestion } from "./jev-question-fixture";

test("the real TypeSafe SDK batches relevance and reports all evaluation usage through the stream contract", async () => {
	const bodies: string[] = [];
	const bodySchema = z.object({
		state: z.string(),
		questions: z.record(z.string(), z.object({ type: z.string() })),
	});
	const fixture = await createApiFixture();
	const response = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				messages: [
					{ role: "assistant", content: "UNRELATED_HISTORY" },
					{ role: "user", content: "Classify this task" },
				],
				routes: {
					kind: "workflow",
					nodes: [
						{ id: "input", kind: "input", fields: [] },
						{
							id: "judge",
							kind: "jev",
							question: configuredJevQuestion("noul"),
							context: {
								...DEFAULT_CONTEXT_POLICY,
								relevance: {
									instructions: "Keep useful context",
									minimumConfidence: 0.9,
								},
							},
						},
					],
					edges: [{ id: "entry", source: "input", target: "judge" }],
				},
			}),
		}),
		{
			keys: { TYPESAFE_API_KEY: "test-key" },
			connect: fixture.connect,
			providerFetch: async (_url, init) => {
				const body = bodySchema.parse(JSON.parse(String(init?.body)));
				bodies.push(body.state);
				return Response.json({
					model: "jev-1.13.0",
					answers: Object.fromEntries(
						Object.keys(body.questions).map((id) => [
							id,
							{ type: "noul", noul: id.startsWith("chunk_") ? 0.01 : 0.99 },
						]),
					),
					usage: { input_tokens: 10, output_tokens: 0 },
				});
			},
		},
	);
	let result: RouteResult | undefined;
	await readRouteStream(response, (event) => {
		if (event.type === "done") result = event.route;
	});
	expect(bodies).toHaveLength(2);
	expect(bodies[0]).toContain("UNRELATED_HISTORY");
	expect(bodies[1]).not.toContain("UNRELATED_HISTORY");
	expect(result?.text).toBe("Yes");
	expect(result?.usage).toMatchObject({
		inputTokens: 20,
		outputTokens: 0,
		complete: true,
		costComplete: true,
	});
	expect(result?.usage.estimatedCostUsd).toBeCloseTo(0.00000084, 10);
	expect(result?.calls.every(({ model }) => model === "jev-1.13.0")).toBe(true);
	expect(result?.calls.map(({ purpose }) => purpose)).toEqual([
		"context",
		"decision",
	]);
	expect(result?.contexts[0].chunks[0]).toMatchObject({
		included: false,
		reason: "irrelevant",
	});
});

test("the real Gemini SDK preserves cached and reasoning token details in workflow accounting", async () => {
	const fixture = await createApiFixture();
	const response = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				messages: [{ role: "user", content: "Say hello" }],
				routes: {
					kind: "workflow",
					nodes: [
						{ id: "input", kind: "input", fields: [] },
						{
							id: "answer",
							kind: "model",
							provider: "google",
							model: "gemini-3.8-flash",
							maxOutputTokens: 100,
						},
					],
					edges: [{ id: "entry", source: "input", target: "answer" }],
				},
			}),
		}),
		{
			keys: { GOOGLE_GENERATIVE_AI_API_KEY: "test-key" },
			connect: fixture.connect,
			providerFetch: async () =>
				new Response(
					`data: ${JSON.stringify({ candidates: [{ index: 0, content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 125, cachedContentTokenCount: 40, thoughtsTokenCount: 5 }, modelVersion: "gemini-3.8-flash" })}\n\n`,
					{ headers: { "Content-Type": "text/event-stream" } },
				),
		},
	);
	let result: RouteResult | undefined;
	await readRouteStream(response, (event) => {
		if (event.type === "done") result = event.route;
	});
	expect(result?.text).toBe("Hello");
	expect(result?.usage).toMatchObject({
		inputTokens: 100,
		outputTokens: 25,
		cachedInputTokens: 40,
		reasoningTokens: 5,
		complete: true,
		costComplete: true,
	});
	expect(result?.calls).toHaveLength(1);
	expect(result?.usage.estimatedCostUsd).toBeCloseTo(0.00014175, 10);
});

test("Luna Max reaches the Responses API and uses published cache read/write rates", async () => {
	const requestSchema = z.object({
		model: z.literal("gpt-6-luna"),
		reasoning: z.object({ effort: z.literal("max") }),
	});
	const fixture = await createApiFixture();
	const response = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				messages: [{ role: "user", content: "Поздоровайся" }],
				routes: {
					kind: "workflow",
					nodes: [
						{ id: "input", kind: "input", fields: [] },
						{
							id: "answer",
							kind: "model",
							provider: "openai",
							model: "gpt-6-luna",
							reasoningEffort: "max",
						},
					],
					edges: [{ id: "entry", source: "input", target: "answer" }],
				},
			}),
		}),
		{
			keys: { OPENAI_API_KEY: "test-key" },
			connect: fixture.connect,
			providerFetch: async (url, init) => {
				expect(String(url)).toBe("https://api.openai.com/v1/responses");
				requestSchema.parse(JSON.parse(String(init?.body)));
				const events = [
					{
						type: "response.created",
						response: { id: "r1", created_at: 1, model: "gpt-6-luna" },
					},
					{
						type: "response.output_item.added",
						output_index: 0,
						item: { id: "m1", type: "message" },
					},
					{
						type: "response.output_text.delta",
						item_id: "m1",
						output_index: 0,
						delta: "Привет",
					},
					{
						type: "response.completed",
						response: {
							usage: {
								input_tokens: 100,
								output_tokens: 25,
								input_tokens_details: {
									cached_tokens: 40,
									cache_write_tokens: 10,
								},
								output_tokens_details: { reasoning_tokens: 5 },
							},
						},
					},
				];
				return new Response(
					events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
					{ headers: { "Content-Type": "text/event-stream" } },
				);
			},
		},
	);
	let result: RouteResult | undefined;
	await readRouteStream(response, (event) => {
		if (event.type === "done") result = event.route;
	});
	expect(result?.text).toBe("Привет");
	expect(result?.usage).toMatchObject({
		inputTokens: 100,
		outputTokens: 25,
		cachedInputTokens: 40,
		cacheWriteTokens: 10,
		reasoningTokens: 5,
		costComplete: true,
	});
	expect(result?.usage.estimatedCostUsd).toBeCloseTo(0.00001915, 10);
});
