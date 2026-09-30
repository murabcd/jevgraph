import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api } from "../convex/_generated/api";
import { handleApi } from "../server/api";
import { ConvexPersistence } from "../server/convex-persistence";
import {
	datasetKey,
	evaluationDatasetSchema,
} from "../server/evaluation/dataset";
import { collectTrial, runEvaluation } from "../server/evaluation/runner";
import {
	evaluationRunSchema,
	loadEvaluationRun,
} from "../server/evaluation/trial";
import { frozenCaseKey } from "../src/lib/evaluation-case";
import { EVALUATION_VERSIONS } from "../src/lib/evaluation-version";
import { qualityReviewSchema, reviewCriteria } from "../src/lib/quality-review";
import { loadRunArtifact } from "../src/lib/run-artifact-load";
import { createApiFixture } from "./api-fixture";
import { evaluationDatasetFixture } from "./evaluation-fixture";

async function plan() {
	const seed = evaluationDatasetFixture();
	const dataset = evaluationDatasetSchema.parse({
		...seed,
		cases: seed.cases.slice(0, 2),
	});
	const run = evaluationRunSchema.parse({
		datasetKey: await datasetKey(dataset),
		startedAt: new Date().toISOString(),
		split: "all",
		repeats: 1,
		candidates: ["gpt-6-luna", "gemini-3.8-flash"],
		trials: [],
	});
	return { dataset, run };
}

function providerResponse(url: RequestInfo | URL) {
	if (String(url).includes("typesafe.ai"))
		return Response.json({
			model: "jev-1.13.0",
			answers: {
				task: {
					type: "choice",
					choice: "Accept",
					probabilities: { Accept: 0.99, Clarify: 0.01 },
				},
			},
			usage: { input_tokens: 20, output_tokens: 0 },
		});
	if (String(url).includes("googleapis.com"))
		return new Response(
			`data: ${JSON.stringify({ candidates: [{ index: 0, content: { role: "model", parts: [{ text: "Controlled fixture answer" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 }, modelVersion: "gemini-3.8-flash" })}\n\n`,
			{ headers: { "Content-Type": "text/event-stream" } },
		);
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
			delta: "Controlled fixture answer",
		},
		{
			type: "response.completed",
			response: { usage: { input_tokens: 10, output_tokens: 10 } },
		},
	];
	return new Response(
		events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
		{ headers: { "Content-Type": "text/event-stream" } },
	);
}

test("runner uses required owned persistence, real SDK fixtures and replay for paired candidate inputs", async () => {
	const fixture = await createApiFixture();
	const { dataset, run } = await plan();
	const dir = await mkdtemp(join(tmpdir(), "jev-eval-run-"));
	const paths: string[] = [];
	let paidAttempts = 0;
	const artifactFetch: typeof fetch = async (input) => {
		const file = await fixture.t.run(async (ctx) => {
			const rows = await ctx.db.query("runs").take(20);
			for (const row of rows)
				if (
					row.resultFile &&
					(await ctx.storage.getUrl(row.resultFile)) === String(input)
				) {
					const blob = await ctx.storage.get(row.resultFile);
					if (!blob) throw new Error("Artifact missing");
					return blob.text();
				}
			throw new Error("Owned test artifact missing");
		});
		return new Response(file);
	};
	try {
		const out = join(dir, "run.json");
		await runEvaluation(
			dataset,
			run,
			out,
			fixture.owner,
			async (path, body) => {
				paths.push(path);
				return handleApi(
					new Request(`http://localhost${path}`, {
						method: "POST",
						headers: fixture.headers,
						body,
					}),
					{
						keys: {
							TYPESAFE_API_KEY: "fixture-jev-key",
							OPENAI_API_KEY: "fixture-openai-key",
							GOOGLE_GENERATIVE_AI_API_KEY: "fixture-google-key",
						},
						connect: fixture.connect,
						providerFetch: async (url) => {
							paidAttempts++;
							return providerResponse(url);
						},
					},
				);
			},
			artifactFetch,
		);
		expect(paths).toEqual([
			"/api/route",
			"/api/replay",
			"/api/route",
			"/api/replay",
		]);
		expect(run.trials.map((trial) => trial.error)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
		]);
		expect(paidAttempts).toBe(8);
		expect(
			run.trials.every(
				(trial) =>
					trial.record?.artifact?.status === "completed" && !trial.error,
			),
		).toBe(true);
		const first = run.trials[0].record,
			replay = run.trials[1].record;
		if (!first || !replay)
			throw new Error(JSON.stringify(run.trials.map((trial) => trial.error)));
		expect(await frozenCaseKey(first.input)).toBe(
			await frozenCaseKey(replay.input),
		);
		expect(first.routes.nodes).not.toEqual(replay.routes.nodes);
		expect(first.input.metadata).toEqual({ priority: "standard" });
		expect(first.input.history.sources).toEqual([]);
		expect((await stat(out)).mode & 0o777).toBe(0o600);
		expect(await loadEvaluationRun(out)).toEqual(run);
		const runId = run.trials[0].runId;
		if (!runId) throw new Error("Registered run missing");
		const node = dataset.graph.nodes.find(
			(node) => node.id === dataset.evaluationNodeId,
		);
		if (node?.kind !== "model" || !node.routing)
			throw new Error("Fixture model missing");
		const review = qualityReviewSchema.parse({
			version: EVALUATION_VERSIONS.evaluator,
			criteria: reviewCriteria(node.routing.quality.criteria).map(
				(criterion) => ({
					id: criterion.id,
					verdict: "pass",
					reason: "Controlled fixture",
					evidence: [
						{
							id: "ref:1",
							sourceId: "answer",
							quote: "Controlled fixture answer",
						},
					],
				}),
			),
			task: {
				outcome: "unknown",
				reason: "No downstream result",
				evidence: [],
			},
			reaction: { outcome: "unknown", reason: "No feedback", evidence: [] },
		});
		const registeredId = await fixture.t.run((ctx) =>
			ctx.db.normalizeId("runs", runId),
		);
		if (!registeredId) throw new Error("Invalid registered run");
		await fixture.owner.action(api.routeEvaluations.review, {
			runId: registeredId,
			nodeId: dataset.evaluationNodeId,
			review: JSON.stringify(review),
			expectedReview: null,
		});
		const collected = await collectTrial(
			new ConvexPersistence(fixture.owner),
			run.trials[0],
			dataset.evaluationNodeId,
			artifactFetch,
		);
		expect(collected.record?.review?.reviewerId).toBeTruthy();
		expect(collected.record?.review?.value).toEqual(review);
		expect(paidAttempts).toBe(8);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("registration failures skip remaining paired trials and do not retry paid execution", async () => {
	const fixture = await createApiFixture();
	const { dataset, run } = await plan();
	const dir = await mkdtemp(join(tmpdir(), "jev-eval-failed-"));
	let attempts = 0;
	try {
		await runEvaluation(
			dataset,
			run,
			join(dir, "run.json"),
			fixture.owner,
			async () => {
				attempts++;
				return new Response("Rejected", { status: 403 });
			},
		);
		expect(attempts).toBe(2);
		expect(run.trials).toHaveLength(4);
		expect(run.trials.every((trial) => !trial.record)).toBe(true);
		expect(run.trials[1].error).toContain("skipped");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("artifact downloads cancel oversized and malformed bodies instead of retaining unbounded evidence", async () => {
	let cancelled = false;
	await expect(
		loadRunArtifact(
			"https://fixture.example",
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array(8_000_001));
						},
						cancel() {
							cancelled = true;
						},
					}),
				),
		),
	).rejects.toThrow("eight million bytes");
	expect(cancelled).toBe(true);
	await expect(
		loadRunArtifact(
			"https://fixture.example",
			async () => new Response(new Uint8Array([0xff])),
		),
	).rejects.toThrow();
});
