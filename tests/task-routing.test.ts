import { expect, test } from "bun:test";
import { planModel, quoteModels } from "../server/model-planner";
import { ProviderLedger } from "../server/provider-ledger";
import { SessionMemory } from "../server/session-memory";
import { assessRoutingTask } from "../server/task-router";
import { executeWorkflow } from "../server/workflow";
import { evaluationCandidate } from "../src/lib/evaluation-candidate";
import { resolveJevAnswer } from "../src/lib/jev-question";
import {
	effectiveModelConfiguration,
	modelConfigurationKey,
} from "../src/lib/model-configuration";
import { modelRoutingSchema } from "../src/lib/model-routing";
import {
	type RouteEvaluation,
	routeEvidenceKey,
	summarizeRouteEvidence,
} from "../src/lib/route-evidence";
import { modelTarget, workflowRoutesSchema } from "../src/lib/routing";
import { approvedEvidence, quality } from "./routing-evidence-fixture";

const candidates = [
	{
		model: "gpt-6-luna",
		reasoningEffort: "low" as const,
		criteria:
			"Simple factual questions with an explicit answer in the selected policy.",
	},
	{
		model: "gpt-6-luna",
		reasoningEffort: "high" as const,
		criteria:
			"Complex comparisons, conflicting conditions, and multi-step analysis.",
	},
	{
		model: "gemini-3.8-flash",
		reasoningEffort: "low" as const,
		criteria: "Simple policy questions.",
	},
];
const evidence = candidates.map((candidate, index) => ({
	...approvedEvidence[0],
	model: candidate.model,
	reasoningEffort: candidate.reasoningEffort,
	meanOutputTokens: index === 1 ? 900 : 100,
}));
const routes = workflowRoutesSchema.parse({
	kind: "workflow",
	nodes: [
		{
			id: "input",
			kind: "input",
			fields: [
				{
					name: "secret",
					type: "string",
					required: false,
					defaultValue: "unselected private value",
				},
			],
			documents: [
				{
					id: "hidden",
					name: "Hidden",
					content: "Do not expose this document",
				},
			],
		},
		{
			id: "answer",
			kind: "model",
			provider: "openai",
			model: "gpt-6-luna",
			reasoningEffort: "low",
			prompt: "Answer the user's policy question.",
			context: {
				historyMessages: 0,
				maxCharacters: 24000,
				upstream: "none",
				outputNodeIds: [],
				documents: [],
			},
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
const model = routes.nodes[1];
if (model.kind !== "model") throw new Error("Missing test model");
const request = {
	target: modelTarget(model),
	context: {
		messages: [{ role: "user" as const, content: "What are the terms?" }],
		inputs: [],
		documents: [],
	},
	variables: {},
	evidence,
};
const available = new Set(candidates.map((candidate) => candidate.model));

async function runTask(content: string, probability: (key: string) => number) {
	let batches = 0;
	const result = await executeWorkflow({
		routes,
		metadata: {},
		messages: [{ role: "user", content }],
		evidenceFor: async () => evidence,
		evaluate: async (_node, questions, state) => {
			batches++;
			expect(questions).toHaveLength(3);
			expect(state).toContain(content);
			expect(state).not.toContain("unselected private value");
			expect(state).not.toContain("Do not expose this document");
			return {
				answers: questions.map((question) =>
					resolveJevAnswer(
						question,
						{ type: "boolean", probability: probability(question.name) },
						undefined,
					),
				),
				model: "jev-1.13.0",
				latencyMs: 1,
				usage: { inputTokens: 200, outputTokens: 0 },
			};
		},
		runModel: async ({ target }) => ({
			text: modelConfigurationKey(effectiveModelConfiguration(target)),
			model: target.model,
			usage: { inputTokens: 50, outputTokens: 20 },
		}),
		onDelta: () => {},
		onRoute: () => {},
		onProgress: () => {},
	});
	expect(batches).toBe(1);
	expect(result.calls.map((call) => call.purpose)).toEqual([
		"routing",
		"model",
	]);
	expect(result.usage.costComplete).toBe(true);
	return result;
}

test("current task selects a model and effort together and reports paid routing work", async () => {
	const simple = await runTask("What is the return deadline?", (key) =>
		key.endsWith("@low") ? 0.95 : 0.1,
	);
	expect(simple.modelPlans[0]).toMatchObject({
		selectedModel: "gpt-6-luna",
		selectedReasoningEffort: "low",
	});
	const complex = await runTask(
		"Compare conflicting return exceptions across three orders.",
		(key) => (key.endsWith("@high") ? 0.99 : 0.1),
	);
	expect(complex.modelPlans[0]).toMatchObject({
		selectedModel: "gpt-6-luna",
		selectedReasoningEffort: "high",
	});
	expect(complex.calls[1].reasoningEffort).toBe("high");
	expect(complex.modelPlans[0].candidates[0]).toMatchObject({
		excluded: "task",
		taskProbability: 0.1,
	});
	expect(complex.modelPlans[0].preparationCostUsd).toBeGreaterThan(0);
});

test("measured reasoning output is quoted separately and one effort cannot qualify another", () => {
	const quotes = quoteModels(request, new SessionMemory(), available);
	expect(quotes[1].expectedOutputTokens).toBe(900);
	expect(quotes[1].estimatedCostUsd).toBeGreaterThan(
		quotes[0].estimatedCostUsd ?? 0,
	);
	const plan = planModel(
		{
			...request,
			evidence: evidence.filter((row) => row.reasoningEffort === "low"),
		},
		new SessionMemory(),
		available,
		"test",
	).plan;
	expect(plan.candidates[1].excluded).toBe("missing-evidence");
	expect(() =>
		planModel(
			{
				...request,
				assessment: {
					costUsd: 0.00001,
					probabilities: new Map(
						candidates.map((candidate) => [
							modelConfigurationKey(candidate),
							0.1,
						]),
					),
				},
			},
			new SessionMemory(),
			available,
			"test",
		),
	).toThrow("task’s routing criteria");
});

test("invalid, missing or failed assessments do not start generation", async () => {
	for (const outcome of [
		"missing",
		"invalid",
		"failed",
		"unsuitable",
		"unknown-cost",
	] as const) {
		let generations = 0;
		await expect(
			executeWorkflow({
				routes,
				metadata: {},
				messages: request.context.messages,
				evidenceFor: async () => evidence,
				evaluate: async (_node, questions) => {
					if (outcome === "failed") throw new Error("Jev unavailable");
					const answers = questions.map((question) =>
						resolveJevAnswer(
							question,
							{
								type: "boolean",
								probability: outcome === "unsuitable" ? 0.1 : 0.99,
							},
							undefined,
						),
					);
					if (outcome === "missing") answers.pop();
					if (outcome === "invalid") answers[0].value = "wrong";
					return {
						answers,
						model: "jev-1.13.0",
						latencyMs: 1,
						usage:
							outcome === "unknown-cost"
								? undefined
								: { inputTokens: 100, outputTokens: 0 },
					};
				},
				runModel: async () => {
					generations++;
					throw new Error("Unreached");
				},
				onDelta: () => {},
				onRoute: () => {},
				onProgress: () => {},
			}),
		).rejects.toThrow();
		expect(generations).toBe(0);
	}
});

test("cancellation after classification remains final and does not traverse a backup", async () => {
	const controller = new AbortController();
	let generations = 0;
	const graph = workflowRoutesSchema.parse({
		...routes,
		nodes: [
			...routes.nodes,
			{ id: "backup", kind: "model", provider: "openai", model: "gpt-6-luna" },
		],
		edges: [
			...routes.edges,
			{
				id: "backup-edge",
				source: "answer",
				sourceHandle: "fallback",
				target: "backup",
			},
		],
	});
	await expect(
		executeWorkflow({
			routes: graph,
			signal: controller.signal,
			metadata: {},
			messages: request.context.messages,
			evidenceFor: async () => evidence,
			evaluate: async (_node, questions) => {
				controller.abort(new Error("Stopped"));
				return {
					answers: questions.map((question) =>
						resolveJevAnswer(
							question,
							{ type: "boolean", probability: 0.99 },
							undefined,
						),
					),
					model: "jev-1.13.0",
					latencyMs: 1,
				};
			},
			runModel: async () => {
				generations++;
				throw new Error("Unreached");
			},
			onDelta: () => {},
			onRoute: () => {},
			onProgress: () => {},
		}),
	).rejects.toThrow("Stopped");
	expect(generations).toBe(0);
});

test("evaluation replay changes only an allowed pair; task criteria invalidate its shared strategy", async () => {
	const evaluation = evaluationCandidate(routes, "answer", "gpt-6-luna@high");
	expect(await routeEvidenceKey(evaluation, "answer")).toBe(
		await routeEvidenceKey(routes, "answer"),
	);
	expect(evaluation.nodes[1]).toMatchObject({
		model: "gpt-6-luna",
		reasoningEffort: "high",
		routing: { mode: "evaluate" },
	});
	expect(() => evaluationCandidate(routes, "answer", "gpt-6-luna@max")).toThrow(
		"allowed",
	);
	const changed = structuredClone(routes);
	const node = changed.nodes[1];
	if (node.kind !== "model" || !node.routing) throw new Error("Missing model");
	node.routing.candidates[0].criteria = "Different task";
	expect(await routeEvidenceKey(changed, "answer")).not.toBe(
		await routeEvidenceKey(routes, "answer"),
	);
	const row: RouteEvaluation = {
		nodeId: "answer",
		key: "a".repeat(64),
		model: "gpt-6-luna",
		reasoningEffort: "low",
		criteria: "Answer correctly",
		latencyMs: 100,
		completed: true,
		modelAttempts: 1,
		outputTokens: 20,
		costUsd: 0.01,
		generationCostUsd: 0.01,
	};
	const summaries = summarizeRouteEvidence([
		{ ...row, caseKey: "same", passed: true },
		{
			...row,
			reasoningEffort: "high",
			outputTokens: 200,
			caseKey: "same",
			passed: false,
		},
	]);
	expect(
		summaries.map((value) => [
			value.reasoningEffort,
			value.passRate,
			value.meanOutputTokens,
		]),
	).toEqual([
		["low", 1, 20],
		["high", 0, 200],
	]);
});

test("unsupported pairs, duplicate pairs, empty task criteria and old model lists are rejected", () => {
	const routing = request.target.routing;
	if (!routing) throw new Error("Missing routing");
	for (const candidates of [
		[
			{
				model: "gemini-3.8-flash",
				reasoningEffort: "max",
				criteria: "Handle anything",
			},
		],
		[routing.candidates[0], routing.candidates[0]],
		[{ ...routing.candidates[0], criteria: "" }],
	])
		expect(
			modelRoutingSchema.safeParse({ ...routing, candidates }).success,
		).toBe(false);
	expect(
		modelRoutingSchema.safeParse({ ...routing, models: ["gpt-6-luna"] })
			.success,
	).toBe(false);
});

test("invalid task assessments retain paid usage as a failed call", async () => {
	const ledger = new ProviderLedger({ onRecorded: () => {} });
	await expect(
		assessRoutingTask(
			request,
			quoteModels(request, new SessionMemory(), available),
			ledger,
			async () => ({
				answers: [],
				model: "jev-1.13.0",
				latencyMs: 1,
				usage: { inputTokens: 123, outputTokens: 0 },
			}),
		),
	).rejects.toThrow("incomplete routing assessments");
	expect(ledger.calls).toHaveLength(1);
	expect(ledger.calls[0]).toMatchObject({
		purpose: "routing",
		status: "failed",
		usage: { inputTokens: 123, outputTokens: 0 },
	});
	expect(ledger.calls[0].estimatedCostUsd).toBeGreaterThan(0);
});

test("automatic cost per pass includes the current paid task assessment", () => {
	const { plan, quote } = planModel(
		{
			...request,
			assessment: {
				costUsd: 0.0001,
				probabilities: new Map(
					candidates.map((candidate) => [
						modelConfigurationKey(candidate),
						0.99,
					]),
				),
			},
		},
		new SessionMemory(),
		available,
		"test",
	);
	expect(quote.estimatedRouteCostUsd).toBeCloseTo(
		(quote.estimatedCostUsd ?? 0) + 0.0001,
		12,
	);
	expect(plan.selectedReasoningEffort).toBe("low");
});
