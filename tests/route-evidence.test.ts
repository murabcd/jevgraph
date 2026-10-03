import { expect, test } from "bun:test";
import { api, internal } from "../convex/_generated/api";
import { planModel } from "../server/model-planner";
import { SessionMemory } from "../server/session-memory";
import { executeWorkflow } from "../server/workflow";
import { EVALUATION_VERSIONS } from "../src/lib/evaluation-version";
import { reviewCriteria } from "../src/lib/quality-review";
import {
	type RouteEvaluation,
	routeEvaluations,
	routeEvidenceKey,
	summarizeRouteEvidence,
} from "../src/lib/route-evidence";
import { type RouteTrace, workflowRoutesSchema } from "../src/lib/routing";
import { createConvexFixture } from "./convex-fixture";
import {
	approvedEvidence,
	approvedRoutingTask,
	quality,
} from "./routing-evidence-fixture";

const routes = workflowRoutesSchema.parse({
	kind: "workflow",
	nodes: [
		{
			id: "input",
			kind: "input",
			fields: [],
			documents: [
				{ id: "policy", name: "Returns", content: "Returns within 14 days" },
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
				minimumConfidence: 0.7,
				candidates: [
					{
						model: "gpt-6-luna",
						reasoningEffort: "medium",
						criteria: "Answer questions from the selected policy",
					},
					{
						model: "gemini-3.8-flash",
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
const empty: RouteTrace = {
	path: [],
	traversedEdges: [],
	jevSteps: [],
	outputs: [],
	calls: [],
	contexts: [],
	modelPlans: [],
};
const request = {
	target: {
		nodeId: "answer",
		provider: "openai" as const,
		model: "gpt-6-luna",
		reasoningEffort: "medium" as const,
		maxOutputTokens: 100,
		routing: {
			mode: "automatic" as const,
			quality,
			minimumConfidence: 0.7,
			candidates: [
				{
					model: "gpt-6-luna",
					reasoningEffort: "medium",
					criteria: "Answer questions from the selected policy",
				},
				{
					model: "gemini-3.8-flash",
					reasoningEffort: "medium",
					criteria: "Answer questions from the selected policy",
				},
			],
			expectedOutputTokens: 100,
			expectedRequests: 1,
		},
	},
	context: {
		messages: [{ role: "user" as const, content: "Can I return this?" }],
		documents: [],
		inputs: [],
	},
	variables: {},
	evidence: approvedEvidence,
};
const available = new Set(
	request.target.routing.candidates.map((candidate) => candidate.model),
);

test("automatic routing requires reviewed comparable cases, complete costs, quality and full-route latency", () => {
	for (const patch of [
		{ cases: 4 },
		{ reviewed: 4 },
		{ passed: 4, passRate: 0.8 },
		{ p95LatencyMs: 30000 },
		{ meanCostUsd: undefined },
	]) {
		expect(() =>
			planModel(
				{
					...request,
					evidence: approvedEvidence.map((sample) => ({ ...sample, ...patch })),
				},
				new SessionMemory(),
				available,
				"1",
			),
		).toThrow("No model meets");
	}
	expect(() =>
		planModel(
			{ ...request, evidence: [] },
			new SessionMemory(),
			available,
			"1",
		),
	).toThrow("No model meets");
	expect(() =>
		planModel(
			{
				...request,
				evidence: approvedEvidence.map((sample, i) => ({
					...sample,
					caseDistribution: String(i),
				})),
			},
			new SessionMemory(),
			available,
			"1",
		),
	).toThrow("No model meets");
	const evidence = approvedEvidence.map((sample) => ({
		...sample,
		meanCostUsd: sample.model === "gpt-6-luna" ? 1 : 0.01,
		meanGenerationCostUsd: 0.01,
	}));
	const plan = planModel(
		{ ...request, evidence },
		new SessionMemory(),
		available,
		"1",
	).plan;
	expect(plan.selectedModel).toBe("gemini-3.8-flash");
	expect(plan.candidates[0].estimatedCostUsd).toBeLessThan(
		plan.candidates[1].estimatedCostUsd ?? 0,
	);
	expect(plan.candidates[0].estimatedRouteCostUsd).toBeGreaterThan(
		plan.candidates[1].estimatedRouteCostUsd ?? 0,
	);
});

test("evaluation runs the configured candidate and quality evidence expires when route behavior changes", async () => {
	const evaluated = planModel(
		{
			...request,
			target: {
				...request.target,
				model: "gemini-3.8-flash",
				routing: { ...request.target.routing, mode: "evaluate" },
			},
			evidence: [],
		},
		new SessionMemory(),
		available,
		"1",
	);
	expect(evaluated.plan.selectedModel).toBe("gemini-3.8-flash");
	const key = await routeEvidenceKey(routes, "answer");
	const selected = structuredClone(routes);
	const node = selected.nodes[1];
	if (node.kind !== "model" || !node.routing) throw new Error("Missing model");
	node.model = "gemini-3.8-flash";
	node.provider = "google";
	node.routing.mode = "automatic";
	expect(await routeEvidenceKey(selected, "answer")).toBe(key);
	node.prompt = "Different task";
	expect(await routeEvidenceKey(selected, "answer")).not.toBe(key);
	expect(
		await routeEvidenceKey(routes, "answer", [
			{ id: "policy", name: "Returns", content: "Returns within 30 days" },
		]),
	).not.toBe(key);
	expect(await routeEvaluations(routes, empty, 1, true)).toEqual([]);
});

test("repeated requests do not inflate distinct cases and unknown failed costs remain unknown", () => {
	const row: RouteEvaluation = {
		nodeId: "answer",
		key: "a".repeat(64),
		model: "gpt-6-luna",
		reasoningEffort: "medium",
		criteria: quality.criteria,
		completed: true,
		latencyMs: 1000,
		costUsd: 0.01,
		generationCostUsd: 0.005,
		modelAttempts: 1,
	};
	const [summary] = summarizeRouteEvidence([
		{ ...row, caseKey: "one", passed: true },
		{ ...row, caseKey: "one" },
		{
			...row,
			caseKey: "two",
			completed: false,
			costUsd: undefined,
			latencyMs: 60000,
			passed: false,
		},
	]);
	expect(summary).toMatchObject({
		attempts: 3,
		cases: 2,
		reviewed: 2,
		passed: 1,
		passRate: 1 / 3,
		p95LatencyMs: 60000,
		meanCostUsd: undefined,
		costPerPassUsd: undefined,
	});
});

test("recorded reviews retain the final reply and allow older unreviewed cases without crossing conversations or owners", async () => {
	const { t, owner, id, workspace } = await createConvexFixture();
	const flow = workflowRoutesSchema.parse({
		...routes,
		nodes: [
			...routes.nodes,
			{ id: "final", kind: "model", provider: "openai", model: "gpt-6-luna" },
		],
		edges: [
			...routes.edges,
			{
				id: "continue",
				source: "answer",
				sourceHandle: "next",
				target: "final",
			},
		],
	});
	const begin = () =>
		owner.mutation(api.runs.begin, {
			conversationId: workspace.conversationId,
			requestId: crypto.randomUUID(),
			input: JSON.stringify({
				messages: [{ role: "user", content: "Return question" }],
				metadata: {},
			}),
			routes: JSON.stringify(flow),
			evaluation: { scope: "a".repeat(64) },
		});
	const first = await begin();
	const result = await executeWorkflow({
		routes: flow,
		metadata: {},
		messages: request.context.messages,
		evaluate: async () => {
			throw new Error("unreached");
		},
		runModel: async ({ target }) => ({
			text:
				target.nodeId === "answer"
					? "Intermediate note"
					: "Final customer reply",
			model: target.model,
			usage: { inputTokens: 100, outputTokens: 20 },
		}),
		onDelta: () => {},
		onRoute: () => {},
		onProgress: () => {},
	});
	await owner.action(api.results.save, {
		runId: first.runId,
		executionId: first.executionId,
		result: JSON.stringify({
			status: "completed",
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
			result: { ...result, latencyMs: 500 },
		}),
	});
	const second = await begin();
	await owner.action(api.results.save, {
		runId: second.runId,
		executionId: second.executionId,
		result: JSON.stringify({
			status: "failed",
			providerEvidence: [],
			text: "Partial reply",
			error: "Provider failed",
			trace: empty,
			latencyMs: 1000,
			coverage: "partial",
		}),
	});
	const args = { conversationId: workspace.conversationId, nodeId: "answer" };
	const records = await owner.query(api.routeEvaluations.list, args);
	expect(records.map((record) => record.runId)).toEqual([
		second.runId,
		first.runId,
	]);
	const previous = await owner.query(api.routeEvaluations.latest, {
		...args,
		runId: first.runId,
	});
	expect(previous).toMatchObject({
		question: "Return question",
		answer: "Final customer reply",
	});
	expect(previous?.passed).toBeUndefined();
	await owner.action(api.routeEvaluations.review, {
		runId: first.runId,
		nodeId: "answer",
		review: fixtureReview(true),
		expectedReview: null,
	});
	expect(
		await owner.query(api.routeEvaluations.latest, {
			...args,
			runId: first.runId,
		}),
	).toMatchObject({ passed: true });
	expect(await owner.query(api.routeEvaluations.latest, args)).toMatchObject({
		runId: second.runId,
		answer: "Partial reply",
		error: "Provider failed",
		passed: false,
	});
	const other = await createConvexFixture(t);
	await expect(
		other.owner.query(api.routeEvaluations.list, args),
	).rejects.toThrow("Conversation unavailable");
	await expect(
		other.owner.query(api.routeEvaluations.latest, {
			...args,
			conversationId: other.workspace.conversationId,
			runId: first.runId,
		}),
	).rejects.toThrow("Conversation unavailable");
	const another = await owner.mutation(api.conversations.start, {
		workspaceId: id,
	});
	await expect(
		owner.query(api.routeEvaluations.latest, {
			...args,
			conversationId: another,
			runId: first.runId,
		}),
	).rejects.toThrow("Conversation unavailable");
});

test("Convex persists owner reviews, isolates scope, and records failed attempts atomically", async () => {
	const { t, owner, id, workspace } = await createConvexFixture();
	const scope = "a".repeat(64);
	const run = await owner.mutation(api.runs.begin, {
		conversationId: workspace.conversationId,
		requestId: crypto.randomUUID(),
		input: JSON.stringify({
			messages: [{ role: "user", content: "Can I return this?" }],
			metadata: {},
		}),
		routes: JSON.stringify(routes),
		evaluation: { scope },
	});
	const result = await executeWorkflow({
		routes,
		metadata: {},
		messages: request.context.messages,
		evaluate: async () => {
			throw new Error("unreached");
		},
		runModel: async ({ target }) => ({
			text: "Return within 14 days. What is your order number?",
			model: target.model,
			usage: { inputTokens: 100, outputTokens: 20 },
		}),
		onDelta: () => {},
		onRoute: () => {},
		onProgress: () => {},
	});
	await owner.action(api.results.save, {
		runId: run.runId,
		executionId: run.executionId,
		result: JSON.stringify({
			status: "completed",
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
			result: { ...result, latencyMs: 500 },
		}),
	});
	const current = await owner.query(api.routeEvaluations.latest, {
		conversationId: workspace.conversationId,
		nodeId: "answer",
	});
	expect(current?.passed).toBeUndefined();
	await owner.action(api.routeEvaluations.review, {
		runId: run.runId,
		nodeId: "answer",
		review: fixtureReview(true),
		expectedReview: null,
	});
	const key = await routeEvidenceKey(routes, "answer");
	expect(
		JSON.parse(
			await owner.query(api.routeEvaluations.evidence, {
				workspaceId: id,
				scope,
				key,
			}),
		)[0],
	).toMatchObject({ reviewed: 1, passed: 1, cases: 1 });
	expect(
		JSON.parse(
			await owner.query(api.routeEvaluations.evidence, {
				workspaceId: id,
				scope: "c".repeat(64),
				key,
			}),
		),
	).toEqual([]);
	const other = await createConvexFixture(t);
	await expect(
		other.owner.action(api.routeEvaluations.review, {
			runId: run.runId,
			nodeId: "answer",
			review: fixtureReview(false),
			expectedReview: null,
		}),
	).rejects.toThrow("Conversation unavailable");
	const failed = await owner.mutation(api.runs.begin, {
		conversationId: workspace.conversationId,
		requestId: crypto.randomUUID(),
		input: JSON.stringify({
			messages: [{ role: "user", content: "Damaged return" }],
			metadata: {},
		}),
		routes: JSON.stringify(routes),
		evaluation: { scope },
	});
	await owner.action(api.results.save, {
		runId: failed.runId,
		executionId: failed.executionId,
		result: JSON.stringify({
			status: "failed",
			providerEvidence: [],
			text: "",
			error: "Provider failed",
			trace: {
				...empty,
				path: [{ nodeId: "input" }, { nodeId: "answer" }],
				calls: [
					{
						id: "1",
						nodeId: "answer",
						purpose: "model",
						provider: "openai",
						model: "gpt-6-luna",
						status: "failed",
						durationMs: 60000,
					},
				],
			},
			latencyMs: 60000,
			coverage: "partial",
		}),
	});
	await expect(
		owner.action(api.routeEvaluations.review, {
			runId: failed.runId,
			nodeId: "answer",
			review: fixtureReview(true),
			expectedReview: null,
		}),
	).rejects.toThrow("cannot pass");
	expect(
		JSON.parse(
			await owner.query(api.routeEvaluations.evidence, {
				workspaceId: id,
				scope,
				key,
			}),
		)[0],
	).toMatchObject({
		attempts: 2,
		cases: 2,
		reviewed: 2,
		passed: 1,
		p95LatencyMs: 60000,
	});
	expect(
		JSON.parse(
			await owner.query(api.routeEvaluations.evidence, {
				workspaceId: id,
				scope,
				key,
			}),
		)[0].meanCostUsd,
	).toBeUndefined();
	await t.run(async (ctx) => {
		for (const row of await ctx.db.query("routeEvaluations").take(100))
			await ctx.db.patch(row._id, { expiresAt: 0 });
	});
	await owner.mutation(internal.routeEvaluations.expire, {});
	expect(
		JSON.parse(
			await owner.query(api.routeEvaluations.evidence, {
				workspaceId: id,
				scope,
				key,
			}),
		),
	).toEqual([]);
});

test("missing quality evidence stops paid context work before model execution", async () => {
	const automatic = structuredClone(routes);
	const node = automatic.nodes[1];
	if (node.kind !== "model" || !node.routing) throw new Error("Missing model");
	node.routing.mode = "automatic";
	node.context = {
		historyMessages: 0,
		maxCharacters: 24000,
		upstream: "none",
		outputNodeIds: [],
		documents: [{ id: "policy", representation: "full" }],
		automatic: { minimumConfidence: 0.9 },
	};
	let calls = 0;
	await expect(
		executeWorkflow({
			routes: automatic,
			metadata: {},
			messages: request.context.messages,
			evidenceFor: async () => [],
			contextProviders: {
				automatic: {
					summarize: async () => {
						calls++;
						throw new Error("unreached");
					},
					assess: async () => {
						calls++;
						throw new Error("unreached");
					},
				},
			},
			evaluate: async () => {
				calls++;
				throw new Error("unreached");
			},
			runModel: async () => {
				calls++;
				throw new Error("unreached");
			},
			onDelta: () => {},
			onRoute: () => {},
			onProgress: () => {},
		}),
	).rejects.toThrow("No model meets");
	expect(calls).toBe(0);
});

test("an abandoned evaluation lease records a failed unknown-cost complete-route observation", async () => {
	const { owner, workspace, id } = await createConvexFixture();
	const scope = "e".repeat(64);
	const run = await owner.mutation(api.runs.begin, {
		conversationId: workspace.conversationId,
		requestId: crypto.randomUUID(),
		input: JSON.stringify({
			messages: [{ role: "user", content: "Test interrupted route" }],
			metadata: {},
		}),
		routes: JSON.stringify(routes),
		evaluation: { scope },
	});
	await owner.mutation(internal.runs.expire, {
		runId: run.runId,
		executionId: run.executionId,
	});
	const key = await routeEvidenceKey(routes, "answer");
	const [evidence] = JSON.parse(
		await owner.query(api.routeEvaluations.evidence, {
			workspaceId: id,
			scope,
			key,
		}),
	);
	expect(evidence).toMatchObject({
		attempts: 1,
		reviewed: 1,
		passed: 0,
		passRate: 0,
		meanModelAttempts: 0,
	});
	expect(evidence.meanCostUsd).toBeUndefined();
	await expect(
		owner.action(api.routeEvaluations.review, {
			runId: run.runId,
			nodeId: "answer",
			review: fixtureReview(true),
			expectedReview: null,
		}),
	).rejects.toThrow("cannot pass");
});

test("preparation economics quotes eligible candidates instead of an unqualified cheaper model", async () => {
	const graph = structuredClone(routes);
	const input = graph.nodes[0];
	const model = graph.nodes[1];
	if (input.kind !== "input" || model.kind !== "model" || !model.routing)
		throw new Error("Missing fixture nodes");
	input.documents = [
		{ id: "policy", name: "Policy", content: "Terms. ".repeat(3000) },
	];
	model.routing.mode = "automatic";
	model.context = {
		historyMessages: 0,
		upstream: "none",
		outputNodeIds: [],
		documents: [{ id: "policy", representation: "full" }],
		maxCharacters: 24000,
		automatic: { minimumConfidence: 0.9, economics: { minimumReturn: 1.1 } },
	};
	let summaries = 0;
	let evidenceReads = 0;
	const result = await executeWorkflow({
		routes: graph,
		metadata: {},
		messages: request.context.messages,
		evidenceFor: async () => {
			evidenceReads++;
			return evidenceReads === 1
				? approvedEvidence.filter((row) => row.model === "gemini-3.8-flash")
				: [];
		},
		contextProviders: {
			automatic: {
				summarize: async () => {
					summaries++;
					return {
						model: "gpt-6-luna",
						usage: { inputTokens: 100, outputTokens: 10 },
						summaries: { short: "Terms.", detailed: "Relevant terms." },
					};
				},
				assess: async () => ({
					model: "jev-1.13.0",
					usage: { inputTokens: 100, outputTokens: 0 },
					probabilities: {
						"document:policy:useful": 0.99,
						"document:policy:short": 0.99,
						"document:policy:detailed": 0.99,
					},
				}),
			},
		},
		evaluate: approvedRoutingTask,
		runModel: async ({ target }) => ({
			model: target.model,
			text: "Terms",
			usage: { inputTokens: 10, outputTokens: 5 },
		}),
		onDelta: () => {},
		onRoute: () => {},
		onProgress: () => {},
	});
	expect(summaries).toBe(1);
	expect(evidenceReads).toBe(1);
	expect(result.model).toBe("gemini-3.8-flash");
	expect(result.contexts[0].preparation?.status).toBe("prepare");
	expect(result.calls.map((call) => call.purpose)).toEqual([
		"summary",
		"context",
		"routing",
		"model",
	]);
});

function fixtureReview(passed: boolean) {
	return JSON.stringify({
		version: EVALUATION_VERSIONS.evaluator,
		criteria: reviewCriteria(quality.criteria).map((criterion) => ({
			id: criterion.id,
			verdict: passed ? "pass" : "fail",
			reason: "Controlled fixture judgement",
			evidence: [
				{ id: "ref:1", sourceId: "document:policy", quote: "14 days" },
			],
		})),
		task: { outcome: "unknown", reason: "Not measured", evidence: [] },
		reaction: { outcome: "unknown", reason: "Not measured", evidence: [] },
	});
}
