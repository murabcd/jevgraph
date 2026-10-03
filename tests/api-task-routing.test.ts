import { expect, test } from "bun:test";
import { z } from "zod";
import { handleApi } from "../server/api";
import { contentFingerprint } from "../server/session-memory";
import { modelConfigurationKey } from "../src/lib/model-configuration";
import { routeEvidenceKey } from "../src/lib/route-evidence";
import { readRouteStream } from "../src/lib/route-stream";
import { type RouteResult, workflowRoutesSchema } from "../src/lib/routing";
import { runArtifactSchema } from "../src/lib/run-artifact";
import { createApiFixture } from "./api-fixture";
import { quality } from "./routing-evidence-fixture";

test("automatic effort crosses SDK, stream and persisted artifact boundaries", async () => {
	const fixture = await createApiFixture();
	const candidates = [
		{
			model: "gpt-6-luna",
			reasoningEffort: "low",
			criteria: "Simple policy questions",
		},
		{
			model: "gpt-6-luna",
			reasoningEffort: "high",
			criteria: "Complex comparisons and multi-step analysis",
		},
		{
			model: "gemini-3.8-flash",
			reasoningEffort: "low",
			criteria: "Simple policy questions",
		},
	];
	const routes = workflowRoutesSchema.parse({
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{
				id: "answer",
				kind: "model",
				provider: "openai",
				model: "gpt-6-luna",
				reasoningEffort: "low",
				routing: {
					mode: "automatic",
					quality,
					minimumConfidence: 0.7,
					candidates,
					expectedOutputTokens: 100,
					expectedRequests: 1,
				},
			},
		],
		edges: [{ id: "entry", source: "input", target: "answer" }],
	});
	const node = routes.nodes[1];
	if (node.kind !== "model" || !node.routing) throw new Error("Missing model");
	const keys = {
		TYPESAFE_API_KEY: "routing-fixture",
		OPENAI_API_KEY: "routing-fixture",
		GOOGLE_GENERATIVE_AI_API_KEY: "routing-fixture",
	};
	const scope = contentFingerprint(JSON.stringify(Object.values(keys)));
	const key = await routeEvidenceKey(routes, node.id);
	// Reviewed fixture cases remain isolated to this in-memory test backend.
	await fixture.t.run(async (ctx) => {
		for (const candidate of node.routing?.candidates ?? []) {
			for (let index = 0; index < 5; index++) {
				const runId = await ctx.db.insert("runs", {
					conversationId: fixture.workspace.conversationId,
					requestId: crypto.randomUUID(),
					routes: JSON.stringify(routes),
					status: "completed",
					expiresAt: Date.now() + 60000,
				});
				await ctx.db.insert("routeEvaluations", {
					workspaceId: fixture.id,
					runId,
					scope,
					key,
					caseKey: `case-${index}`,
					nodeId: node.id,
					model: candidate.model,
					reasoningEffort: candidate.reasoningEffort,
					criteria: quality.criteria,
					latencyMs: 100,
					completed: true,
					costUsd: 0.01,
					generationCostUsd: 0.01,
					modelAttempts: 1,
					outputTokens: 20,
					passed: true,
					review: "Reviewed fixture",
					reviewerId: fixture.workspace.owner,
					reviewedAt: Date.now(),
					expiresAt: Date.now() + 60000,
				});
			}
		}
	});
	let assessments = 0;
	let generations = 0;
	const requestId = crypto.randomUUID();
	const response = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				requestId,
				routes,
				messages: [
					{
						role: "user",
						content: "Compare the conflicting exceptions across three orders.",
					},
				],
			}),
		}),
		{
			keys,
			connect: fixture.connect,
			providerFetch: async (url, init) => {
				const body = JSON.parse(String(init?.body));
				if ("questions" in body) {
					assessments++;
					const parsed = z
						.object({
							questions: z.record(
								z.string(),
								z.object({ type: z.literal("noul") }),
							),
						})
						.parse(body);
					expect(Object.keys(parsed.questions)).toHaveLength(3);
					return Response.json({
						model: "jev-1.13.0",
						answers: Object.fromEntries(
							Object.keys(parsed.questions).map((id) => [
								id,
								{ type: "noul", noul: id === "routing_1" ? 0.99 : 0.1 },
							]),
						),
						usage: { input_tokens: 100, output_tokens: 0 },
					});
				}
				generations++;
				expect(String(url)).toBe("https://api.openai.com/v1/responses");
				z.object({
					model: z.literal("gpt-6-luna"),
					reasoning: z.object({ effort: z.literal("high") }),
				}).parse(body);
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
						delta: "Comparison completed.",
					},
					{
						type: "response.completed",
						response: {
							usage: {
								input_tokens: 100,
								output_tokens: 25,
								input_tokens_details: { cached_tokens: 0 },
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
	expect(assessments).toBe(1);
	expect(generations).toBe(1);
	expect(result?.text).toBe("Comparison completed.");
	expect(result?.modelPlans[0].selectedReasoningEffort).toBe("high");
	expect(result?.calls.map((call) => call.purpose)).toEqual([
		"routing",
		"model",
	]);
	expect(result?.calls[1].reasoningEffort).toBe("high");
	expect(result?.modelPlans[0].candidates.map(modelConfigurationKey)).toEqual([
		"gpt-6-luna@low",
		"gpt-6-luna@high",
		"gemini-3.8-flash@low",
	]);
	const artifact = await fixture.t.run(async (ctx) => {
		const run = await ctx.db
			.query("runs")
			.withIndex("by_conversation_request", (q) =>
				q
					.eq("conversationId", fixture.workspace.conversationId)
					.eq("requestId", requestId),
			)
			.unique();
		if (!run?.resultFile) throw new Error("Missing artifact");
		const file = await ctx.storage.get(run.resultFile);
		if (!file) throw new Error("Missing artifact bytes");
		return runArtifactSchema.parse(JSON.parse(await file.text()));
	});
	expect(artifact.status === "completed" && artifact.result).toEqual(result);
	expect(artifact.coverage).toBe("complete");
});
