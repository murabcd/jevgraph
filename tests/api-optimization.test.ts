import { expect, test } from "bun:test";
import { z } from "zod";
import { handleApi } from "../server/api";
import { DEFAULT_CONTEXT_POLICY } from "../src/lib/context";
import { readRouteStream } from "../src/lib/route-stream";
import type { RouteResult } from "../src/lib/routing";
import { createApiFixture } from "./api-fixture";
import { quality } from "./routing-evidence-fixture";

const summaries = {
	short: "Доставка занимает 2 рабочих дня.",
	detailed:
		"Доставка занимает 2 рабочих дня, возврат возможен в течение 14 дней.",
};
const providerBody = z.object({
	stream: z.boolean().optional(),
	questions: z.record(z.string(), z.object({ type: z.string() })).optional(),
});

test("real SDK adapters optimize Russian context, reuse summaries within a workspace and stream the actual selected provider with all preparation costs", async () => {
	let generations = 0;
	let assessments = 0;
	const sent: string[] = [];
	const defaultFixture = await createApiFixture();
	const run = async (extra = "", fixture = defaultFixture) => {
		const response = await handleApi(
			new Request("http://localhost/api/route", {
				method: "POST",
				headers: fixture.headers,
				body: JSON.stringify({
					...fixture.requestFields(),
					messages: [
						{
							role: "user",
							content: "Здравствуйте! Через сколько приедет заказ?",
						},
					],
					routes: {
						kind: "workflow",
						nodes: [
							{
								id: "input",
								kind: "input",
								fields: [],
								documents: [
									{
										id: "delivery",
										name: "Доставка",
										content:
											"Доставка занимает 2 рабочих дня, возврат возможен в течение 14 дней. ".repeat(
												60,
											) + extra,
									},
								],
							},
							{
								id: "answer",
								kind: "model",
								provider: "google",
								model: "gemini-3.8-flash",
								reasoningEffort: "medium",
								maxOutputTokens: 100,
								routing: {
									mode: "evaluate",
									quality,
									models: ["gemini-3.8-flash"],
									expectedOutputTokens: 50,
									expectedRequests: 1,
								},
								context: {
									...DEFAULT_CONTEXT_POLICY,
									automatic: { minimumConfidence: 0.9 },
									documents: [{ id: "delivery", representation: "full" }],
								},
							},
						],
						edges: [{ id: "entry", source: "input", target: "answer" }],
					},
				}),
			}),
			{
				keys: {
					OPENAI_API_KEY: "optimization-test",
					GOOGLE_GENERATIVE_AI_API_KEY: "optimization-test",
					TYPESAFE_API_KEY: "optimization-test",
				},
				connect: fixture.connect,
				providerFetch: async (url, init) => {
					const body = providerBody.parse(JSON.parse(String(init?.body)));
					if (body.questions) {
						assessments++;
						return Response.json({
							model: "jev-1.13.0",
							answers: Object.fromEntries(
								Object.keys(body.questions).map((id) => [
									id,
									{ type: "noul", noul: 0.99 },
								]),
							),
							usage: { input_tokens: 100, output_tokens: 0 },
						});
					}
					if (String(url).includes("openai.com")) {
						generations++;
						expect(body.stream).not.toBe(true);
						return Response.json({
							id: "summary",
							created_at: 1,
							model: "gpt-6-luna",
							status: "completed",
							output: [
								{
									type: "message",
									id: "summary-message",
									role: "assistant",
									status: "completed",
									content: [
										{
											type: "output_text",
											text: JSON.stringify(summaries),
											annotations: [],
										},
									],
								},
							],
							usage: {
								input_tokens: 100,
								output_tokens: 20,
								input_tokens_details: { cached_tokens: 0 },
								output_tokens_details: { reasoning_tokens: 0 },
							},
						});
					}
					sent.push(String(init?.body));
					return new Response(
						`data: ${JSON.stringify({ candidates: [{ index: 0, content: { role: "model", parts: [{ text: "Здравствуйте! Доставка занимает 2 рабочих дня." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 }, modelVersion: "gemini-3.8-flash" })}\n\n`,
						{ headers: { "Content-Type": "text/event-stream" } },
					);
				},
			},
		);
		let result: RouteResult | undefined;
		await readRouteStream(response, (event) => {
			if (event.type === "error") throw new Error(event.error);
			if (event.type === "route")
				expect(event.route).toMatchObject({
					provider: "google",
					model: "gemini-3.8-flash",
				});
			if (event.type === "done") result = event.route;
		});
		return result;
	};
	const first = await run();
	expect(first).toMatchObject({
		provider: "google",
		model: "gemini-3.8-flash",
		text: "Здравствуйте! Доставка занимает 2 рабочих дня.",
	});
	expect(first?.calls.map(({ purpose }) => purpose)).toEqual([
		"summary",
		"context",
		"model",
	]);
	expect(first?.usage).toMatchObject({
		inputTokens: 300,
		outputTokens: 30,
		complete: true,
		costComplete: true,
	});
	expect(first?.modelPlans[0]).toMatchObject({
		selectedModel: "gemini-3.8-flash",
		estimation: "utf8-estimate",
	});
	expect(first?.modelPlans[0].preparationCostUsd).toBeGreaterThan(0);
	expect(first?.contexts[0].chunks[0]).toMatchObject({
		representation: "short",
		summaryCache: "created",
	});
	expect(sent[0]).toContain(summaries.short);
	expect(sent[0]).not.toContain("возврат");
	const second = await run();
	expect(second?.calls.map(({ purpose }) => purpose)).toEqual([
		"context",
		"model",
	]);
	expect(second?.contexts[0].chunks[0].summaryCache).toBe("reused");
	expect(generations).toBe(1);
	await run("Новые условия.");
	expect(generations).toBe(2);
	await run("", await createApiFixture(defaultFixture.t));
	expect(generations).toBe(3);
	expect(assessments).toBe(4);
});

test("OpenAI SDK forwards explicit cache options and stable-prefix breakpoints, then plans from reported writes", async () => {
	const bodySchema = z.object({
		prompt_cache_options: z.object({ mode: z.literal("explicit") }),
		input: z.array(
			z.object({
				role: z.string(),
				content: z.array(
					z.object({
						text: z.string(),
						prompt_cache_breakpoint: z
							.object({ mode: z.literal("explicit") })
							.optional(),
					}),
				),
			}),
		),
	});
	const fixture = await createApiFixture();
	let calls = 0;
	const run = async () => {
		const response = await handleApi(
			new Request("http://localhost/api/route", {
				method: "POST",
				headers: fixture.headers,
				body: JSON.stringify({
					...fixture.requestFields(),
					messages: [{ role: "user", content: "Где мой заказ?" }],
					routes: {
						kind: "workflow",
						nodes: [
							{
								id: "input",
								kind: "input",
								fields: [],
								documents: [
									{
										id: "guide",
										name: "Guide",
										content: "Delivery rules ".repeat(2500),
									},
								],
							},
							{
								id: "answer",
								kind: "model",
								provider: "openai",
								model: "gpt-6-luna",
								reasoningEffort: "medium",
								routing: {
									mode: "evaluate",
									quality,
									models: ["gpt-6-luna"],
									expectedOutputTokens: 50,
									expectedRequests: 2,
								},
								context: {
									...DEFAULT_CONTEXT_POLICY,
									maxCharacters: 120000,
									documents: [{ id: "guide", representation: "full" }],
								},
							},
						],
						edges: [{ id: "entry", source: "input", target: "answer" }],
					},
				}),
			}),
			{
				keys: { OPENAI_API_KEY: "cache-options-test" },
				connect: fixture.connect,
				providerFetch: async (_url, init) => {
					const body = bodySchema.parse(JSON.parse(String(init?.body)));
					expect(body.input[0].content[0].prompt_cache_breakpoint).toEqual({
						mode: "explicit",
					});
					expect(
						body.input.at(-1)?.content[0].prompt_cache_breakpoint,
					).toBeUndefined();
					const write = calls++ === 0;
					const events = [
						{
							type: "response.created",
							response: { id: "cached", created_at: 1, model: "gpt-6-luna" },
						},
						{
							type: "response.output_item.added",
							output_index: 0,
							item: { id: "answer", type: "message" },
						},
						{
							type: "response.output_text.delta",
							item_id: "answer",
							output_index: 0,
							delta: "Уточните номер заказа.",
						},
						{
							type: "response.completed",
							response: {
								usage: {
									input_tokens: 10000,
									output_tokens: 10,
									input_tokens_details: {
										cached_tokens: write ? 0 : 8192,
										cache_write_tokens: write ? 8192 : 0,
									},
									output_tokens_details: { reasoning_tokens: 0 },
								},
							},
						},
					];
					return new Response(
						events
							.map((event) => `data: ${JSON.stringify(event)}\n\n`)
							.join(""),
						{ headers: { "Content-Type": "text/event-stream" } },
					);
				},
			},
		);
		let result: RouteResult | undefined;
		await readRouteStream(response, (event) => {
			if (event.type === "error") throw new Error(event.error);
			if (event.type === "done") result = event.route;
		});
		return result;
	};
	const first = await run();
	expect(first?.modelPlans[0].candidates[0].cache).toBe("write");
	expect(first?.usage.cacheWriteTokens).toBe(8192);
	const second = await run();
	expect(second?.modelPlans[0].candidates[0]).toMatchObject({
		cache: "reuse",
		expectedCachedTokens: 8192,
	});
	expect(second?.usage.cachedInputTokens).toBe(8192);
});
