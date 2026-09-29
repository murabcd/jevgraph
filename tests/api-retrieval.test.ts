import { expect, test } from "bun:test";
import { z } from "zod";
import { handleApi } from "../server/api";
import { DEFAULT_CONTEXT_POLICY } from "../src/lib/context";
import {
	DEFAULT_RETRIEVAL_POLICY,
	EMBEDDING_DIMENSIONS,
} from "../src/lib/retrieval";
import { readRouteStream } from "../src/lib/route-stream";
import type { RouteResult } from "../src/lib/routing";
import { createApiFixture } from "./api-fixture";

const providerBody = z.object({
	input: z.array(z.string()).optional(),
	dimensions: z.number().optional(),
	questions: z.record(z.string(), z.object({ type: z.string() })).optional(),
});

test("real AI SDK adapters retrieve, rerank, activate instructions, account usage and settle durable traces", async () => {
	const fixture = await createApiFixture();
	let embeddingCalls = 0;
	let reranks = 0;
	const generated: string[] = [];
	const run = async () => {
		const response = await handleApi(
			new Request("http://localhost/api/route", {
				method: "POST",
				headers: fixture.headers,
				body: JSON.stringify({
					...fixture.requestFields(),
					metadata: { vip: true },
					messages: [
						{ role: "user", content: "Можно ли вернуть открытое лекарство?" },
					],
					routes: {
						kind: "workflow",
						nodes: [
							{
								id: "input",
								kind: "input",
								fields: [{ name: "vip", type: "boolean", required: false }],
								documents: [
									{
										id: "returns",
										name: "Возврат",
										content:
											"Возврат возможен в течение 14 дней. Открытые лекарства возвращать нельзя.",
									},
									{
										id: "private",
										name: "Не выбран",
										content: "PRIVATE UNSELECTED",
									},
								],
							},
							{
								id: "answer",
								kind: "model",
								provider: "google",
								model: "gemini-3.8-flash",
								variables: ["vip"],
								context: {
									...DEFAULT_CONTEXT_POLICY,
									retrieval: DEFAULT_RETRIEVAL_POLICY,
									documents: [{ id: "returns", representation: "full" }],
									instructions: [
										{
											id: "vip",
											name: "Приоритет",
											instructions: "Предложи приоритетную помощь.",
											condition: { kind: "variable", name: "vip", value: true },
										},
									],
								},
							},
						],
						edges: [{ id: "entry", source: "input", target: "answer" }],
					},
				}),
			}),
			{
				connect: fixture.connect,
				keys: {
					OPENAI_API_KEY: "retrieval-test",
					TYPESAFE_API_KEY: "retrieval-test",
					GOOGLE_GENERATIVE_AI_API_KEY: "retrieval-test",
				},
				providerFetch: async (url, init) => {
					if (String(url).includes("/embeddings")) {
						const body = providerBody.parse(JSON.parse(String(init?.body)));
						embeddingCalls++;
						expect(body.dimensions).toBe(EMBEDDING_DIMENSIONS);
						expect(String(init?.body)).not.toContain("PRIVATE UNSELECTED");
						return Response.json({
							object: "list",
							model: "text-embedding-3-small",
							data: body.input?.map((_, index) => ({
								object: "embedding",
								index,
								embedding: Array.from(
									{ length: EMBEDDING_DIMENSIONS },
									(_, i) => (i === 0 ? 1 : 0),
								),
							})),
							usage: { prompt_tokens: 10, total_tokens: 10 },
						});
					}
					if (String(url).includes("typesafe.ai")) {
						const body = providerBody.parse(JSON.parse(String(init?.body)));
						reranks++;
						expect(String(init?.body)).toContain("Открытые лекарства");
						return Response.json({
							model: "jev-1.13.0",
							answers: Object.fromEntries(
								Object.keys(body.questions ?? {}).map((id) => [
									id,
									{
										type: "score",
										score: 3,
										confidence: 0.99,
										probabilities: {
											"0": 0.001,
											"1": 0.001,
											"2": 0.008,
											"3": 0.99,
										},
									},
								]),
							),
							usage: { input_tokens: 20, output_tokens: 0 },
						});
					}
					generated.push(String(init?.body));
					return new Response(
						`data: ${JSON.stringify({ candidates: [{ index: 0, content: { role: "model", parts: [{ text: "Открытые лекарства вернуть нельзя. Предложу приоритетную помощь." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 }, modelVersion: "gemini-3.8-flash" })}\n\n`,
						{ headers: { "Content-Type": "text/event-stream" } },
					);
				},
			},
		);
		let result: RouteResult | undefined;
		const starts: string[] = [];
		await readRouteStream(response, (event) => {
			if (event.type === "node-start") starts.push(event.nodeId);
			if (event.type === "error") throw new Error(event.error);
			if (event.type === "done") result = event.route;
		});
		expect(starts).toHaveLength(result?.calls.length ?? 0);
		return result;
	};
	const first = await run();
	expect(first?.calls.map(({ purpose }) => purpose)).toEqual([
		"embedding",
		"embedding",
		"rerank",
		"model",
	]);
	expect(first?.usage).toMatchObject({
		inputTokens: 70,
		outputTokens: 10,
		complete: true,
		costComplete: true,
	});
	expect(first?.contexts[0]).toMatchObject({
		retrieval: { reranking: "completed", sources: 1 },
		instructions: [{ id: "vip", active: true }],
	});
	expect(generated[0]).toContain("Предложи приоритетную помощь.");
	expect(generated[0]).toContain("Открытые лекарства");
	expect(generated[0]).not.toContain("PRIVATE UNSELECTED");
	const saved = await fixture.t.run((ctx) => ctx.db.query("runs").collect());
	expect(saved[0].status).toBe("completed");
	expect(saved[0].resultFile).toBeDefined();
	const second = await run();
	expect(second?.calls.map(({ purpose }) => purpose)).toEqual([
		"embedding",
		"rerank",
		"model",
	]);
	expect(embeddingCalls).toBe(3);
	expect(reranks).toBe(2);
});
