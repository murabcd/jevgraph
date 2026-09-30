import { expect, test } from "bun:test";
import { api } from "../convex/_generated/api";
import { handleApi } from "../server/api";
import { readRouteStream } from "../src/lib/route-stream";
import {
	type RouteStreamEvent,
	workflowRoutesSchema,
} from "../src/lib/routing";
import { runArtifactSchema } from "../src/lib/run-artifact";
import { createApiFixture } from "./api-fixture";

const routes = workflowRoutesSchema.parse({
	kind: "workflow",
	nodes: [
		{ id: "input", kind: "input", fields: [] },
		{
			id: "primary",
			kind: "model",
			provider: "google",
			model: "gemini-3.8-flash",
		},
		{
			id: "backup",
			kind: "model",
			provider: "openai",
			model: "gpt-6-luna",
		},
	],
	edges: [
		{ id: "entry", source: "input", target: "primary" },
		{
			id: "backup",
			source: "primary",
			sourceHandle: "fallback",
			target: "backup",
		},
	],
});

test.each([
	{ label: "in-band 503 after text", finishReason: undefined, error: true },
	{
		label: "EOF without a finish reason",
		finishReason: undefined,
		error: false,
	},
	{ label: "output token limit", finishReason: "MAX_TOKENS", error: false },
	{ label: "content filtering", finishReason: "SAFETY", error: false },
])("$label cannot settle a partial answer as completed", async (scenario) => {
	const fixture = await createApiFixture();
	const events: RouteStreamEvent[] = [];
	const partial =
		"После приёмки возврата магазин обрабатывает возмещение. В этом чате";
	let requests = 0;
	const response = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				messages: [{ role: "user", content: "Когда вернут деньги?" }],
				routes,
			}),
		}),
		{
			keys: {
				GOOGLE_GENERATIVE_AI_API_KEY: "fixture-google-key",
				OPENAI_API_KEY: "fixture-openai-key",
			},
			connect: fixture.connect,
			providerFetch: async () => {
				requests++;
				const chunks = [
					{
						candidates: [
							{
								index: 0,
								content: { role: "model", parts: [{ text: partial }] },
								finishReason: scenario.finishReason,
							},
						],
						usageMetadata: {
							promptTokenCount: 751,
							candidatesTokenCount: 121,
							totalTokenCount: 872,
						},
						modelVersion: "gemini-3.8-flash",
					},
					...(scenario.error
						? [
								{
									error: {
										code: 503,
										message: "High demand",
										status: "UNAVAILABLE",
									},
								},
							]
						: []),
				];
				return new Response(
					chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""),
					{ headers: { "Content-Type": "text/event-stream" } },
				);
			},
		},
	);
	await expect(
		readRouteStream(response, (event) => events.push(event)),
	).rejects.toThrow("without a normal stop");
	expect(requests).toBe(1);
	expect(events.filter((event) => event.type === "delta")).toEqual([
		{ type: "delta", text: partial },
	]);
	expect(events.some((event) => event.type === "done")).toBe(false);
	expect(events.findLast((event) => event.type === "timing")).toMatchObject({
		timing: { nodeId: "primary", status: "failed" },
	});
	const latest = await fixture.owner.query(api.runs.latest, {
		conversationId: fixture.workspace.conversationId,
	});
	expect(latest?.resultUrl).toBeTruthy();
	const artifact = await fixture.t.run(async (ctx) => {
		const run = await ctx.db.query("runs").first();
		if (!run?.resultFile) throw new Error("Artifact missing");
		expect(run.status).toBe("failed");
		const file = await ctx.storage.get(run.resultFile);
		if (!file) throw new Error("Artifact bytes missing");
		return runArtifactSchema.parse(JSON.parse(await file.text()));
	});
	expect(artifact.status).toBe("failed");
	if (artifact.status === "completed") throw new Error("Unexpected completion");
	expect(artifact.text).toBe(partial);
	expect(artifact.trace.calls).toMatchObject([
		{
			nodeId: "primary",
			status: "failed",
			usage: { inputTokens: 751, outputTokens: 121 },
		},
	]);
	expect(artifact.trace.path.some((step) => step.nodeId === "backup")).toBe(
		false,
	);
	if (scenario.error)
		expect(artifact.providerEvidence[0].response.text).toContain("UNAVAILABLE");
});
