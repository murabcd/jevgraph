import { expect, test } from "bun:test";
import { api } from "../convex/_generated/api";
import { executeWorkflow } from "../server/workflow";
import { frozenCaseSchema } from "../src/lib/evaluation-case";
import { EVALUATION_VERSIONS } from "../src/lib/evaluation-version";
import {
	type QualityReview,
	qualityReviewSchema,
	reviewSources,
	validateQualityReview,
} from "../src/lib/quality-review";
import { workflowRoutesSchema } from "../src/lib/routing";
import type { RunArtifact } from "../src/lib/run-artifact";
import { createConvexFixture } from "./convex-fixture";
import { quality } from "./routing-evidence-fixture";

const criteria = "Preserve the deadline\nDo not claim a completed refund";
const routes = workflowRoutesSchema.parse({
	kind: "workflow",
	nodes: [
		{ id: "input", kind: "input", fields: [] },
		{
			id: "answer",
			kind: "model",
			provider: "openai",
			model: "gpt-6-luna",
			routing: {
				mode: "evaluate",
				quality: { ...quality, criteria },
				minimumConfidence: 0.7,
				candidates: [
					{
						model: "gpt-6-luna",
						reasoningEffort: "medium",
						criteria: "Answer questions from the selected policy",
					},
				],
				expectedOutputTokens: 100,
				expectedRequests: 1,
			},
		},
	],
	edges: [{ id: "entry", source: "input", target: "answer" }],
});

function review(): QualityReview {
	return qualityReviewSchema.parse({
		version: EVALUATION_VERSIONS.evaluator,
		criteria: [
			{
				id: "criterion:1",
				verdict: "pass",
				reason: "The original deadline is retained",
				evidence: [{ id: "ref:1", sourceId: "answer", quote: "14 days" }],
			},
			{
				id: "criterion:2",
				verdict: "pass",
				reason: "The reply promises only a handoff",
				evidence: [
					{ id: "ref:1", sourceId: "answer", quote: "contact support" },
				],
			},
		],
		task: {
			outcome: "handoff",
			reason: "Support must perform the refund",
			evidence: [{ id: "ref:1", sourceId: "answer", quote: "contact support" }],
		},
		reaction: {
			outcome: "unknown",
			reason: "No later user message",
			evidence: [],
		},
	});
}
async function setup() {
	const fixture = await createConvexFixture();
	const run = await fixture.owner.mutation(api.runs.begin, {
		conversationId: fixture.workspace.conversationId,
		requestId: crypto.randomUUID(),
		input: JSON.stringify({
			messages: [{ role: "user", content: "Refund my order" }],
			metadata: {},
		}),
		routes: JSON.stringify(routes),
		evaluation: { scope: "a".repeat(64) },
	});
	const result = await executeWorkflow({
		routes,
		metadata: {},
		messages: [{ role: "user", content: "Refund my order" }],
		evaluate: async () => {
			throw new Error("No Jev");
		},
		runModel: async () => ({
			text: "Returns within 14 days; contact support for your refund.",
			model: "gpt-6-luna",
			usage: { inputTokens: 10, outputTokens: 10 },
		}),
		onDelta: () => {},
		onProgress: () => {},
		onRoute: () => {},
	});
	const artifact: RunArtifact = {
		status: "completed",
		result: { ...result, latencyMs: 5 },
		coverage: "complete",
		providerEvidence: result.calls.map((call) => ({
			id: `exchange:${call.id}`,
			callId: call.id,
			endpoint: "https://fixture.example",
			method: "POST",
			request: { text: "{}", bytes: 2, complete: true },
			response: { text: "{}", bytes: 2, complete: true },
			state: "completed",
		})),
	};
	await fixture.owner.action(api.results.save, {
		runId: run.runId,
		executionId: run.executionId,
		result: JSON.stringify(artifact),
	});
	const input = frozenCaseSchema.parse(JSON.parse(run.input));
	return {
		...fixture,
		run,
		artifact,
		input,
		sources: reviewSources(input, routes, artifact),
	};
}

test("criterion reviews distinguish handoff, reaction and execution; incomplete evidence never approves routing", async () => {
	const fixture = await setup();
	expect(
		validateQualityReview(
			review(),
			criteria,
			fixture.artifact,
			fixture.sources,
		),
	).toBe(true);
	expect(
		validateQualityReview(
			review(),
			criteria,
			{ ...fixture.artifact, coverage: "partial" },
			fixture.sources,
		),
	).toBeUndefined();
	const uncertain = review();
	uncertain.criteria[1] = {
		...uncertain.criteria[1],
		verdict: "insufficient-evidence",
		evidence: [],
	};
	expect(
		validateQualityReview(
			uncertain,
			criteria,
			fixture.artifact,
			fixture.sources,
		),
	).toBeUndefined();
	const fabricated = review();
	fabricated.criteria[0].evidence[0].quote = "Refund completed";
	expect(() =>
		validateQualityReview(
			fabricated,
			criteria,
			fixture.artifact,
			fixture.sources,
		),
	).toThrow("not present");
	const missing = review();
	missing.criteria.pop();
	expect(() =>
		validateQualityReview(missing, criteria, fixture.artifact, fixture.sources),
	).toThrow("each configured");
	const reaction = review();
	reaction.reaction = {
		outcome: "positive",
		reason: "An assistant claims satisfaction",
		evidence: [{ id: "ref:1", sourceId: "answer", quote: "14 days" }],
	};
	expect(() =>
		validateQualityReview(
			reaction,
			criteria,
			fixture.artifact,
			fixture.sources,
		),
	).toThrow("later user message");
});

test("owner reviews persist grounded labels, reject stale edits and leave insufficient evidence ineligible", async () => {
	const fixture = await setup();
	const args = {
		runId: fixture.run.runId,
		nodeId: "answer",
		expectedReview: null,
	};
	const original = JSON.stringify(review());
	await fixture.owner.action(api.routeEvaluations.review, {
		...args,
		review: original,
	});
	const recorded = await fixture.owner.query(api.routeEvaluations.latest, {
		conversationId: fixture.workspace.conversationId,
		nodeId: "answer",
	});
	expect(recorded?.passed).toBe(true);
	expect(JSON.parse(recorded?.review ?? "{}").task.outcome).toBe("handoff");
	expect(JSON.parse(recorded?.review ?? "{}").reaction.outcome).toBe("unknown");
	const uncertain = review();
	uncertain.criteria[0] = {
		...uncertain.criteria[0],
		verdict: "insufficient-evidence",
		evidence: [],
	};
	await expect(
		fixture.owner.action(api.routeEvaluations.review, {
			...args,
			review: JSON.stringify(uncertain),
		}),
	).rejects.toThrow("Review changed");
	await fixture.owner.action(api.routeEvaluations.review, {
		...args,
		expectedReview: original,
		review: JSON.stringify(uncertain),
	});
	expect(
		(
			await fixture.owner.query(api.routeEvaluations.latest, {
				conversationId: fixture.workspace.conversationId,
				nodeId: "answer",
			})
		)?.passed,
	).toBeUndefined();
	const stored = await fixture.t.run((ctx) =>
		ctx.db.query("routeEvaluations").first(),
	);
	expect(stored?.reviewerId).toBeTruthy();
	expect(stored?.reviewedAt).toBeGreaterThan(0);
});
