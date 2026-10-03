import { expect, test } from "bun:test";
import { z } from "zod";
import { handleApi } from "../server/api";
import { resolveJevBatch } from "../server/jev-node";
import { executeWorkflow } from "../server/workflow";
import {
	configuredJevQuestionsSchema,
	resolveJevAnswer,
} from "../src/lib/jev-question";
import { readRouteStream } from "../src/lib/route-stream";
import {
	type RouteResult,
	type WorkflowRoutes,
	workflowRoutesSchema,
} from "../src/lib/routing";
import { createApiFixture } from "./api-fixture";
import { configuredJevQuestion } from "./jev-question-fixture";

const questions = [
	{ ...configuredJevQuestion("choice"), id: "intent", name: "Intent" },
	{ ...configuredJevQuestion("noul"), id: "eligible", name: "Eligibility" },
	{ ...configuredJevQuestion("score"), id: "quality", name: "Quality" },
];
const evaluation = {
	answers: [
		resolveJevAnswer(
			questions[0],
			{ type: "choice", choice: "Choice 1" },
			0.95,
		),
		resolveJevAnswer(
			questions[1],
			{ type: "boolean", probability: 0.99 },
			undefined,
		),
		resolveJevAnswer(questions[2], { type: "score", score: 2 }, 0.95),
	],
	model: "jev-1.13.0",
	latencyMs: 1,
	usage: { inputTokens: 10, outputTokens: 0 },
};
const graph: WorkflowRoutes = {
	kind: "workflow",
	nodes: [
		{ id: "input", kind: "input", fields: [] },
		{ id: "judge", kind: "jev", questions },
	],
	edges: [{ id: "entry", source: "input", target: "judge" }],
};

test("the TypeSafe SDK sends mixed questions together and retains every typed answer with one usage record", async () => {
	const fixture = await createApiFixture();
	const requestSchema = z.object({
		questions: z.record(z.string(), z.object({ type: z.string() })),
	});
	let calls = 0;
	const response = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				routes: graph,
				messages: [{ role: "user", content: "Review this task" }],
			}),
		}),
		{
			keys: { TYPESAFE_API_KEY: "test-key" },
			connect: fixture.connect,
			providerFetch: async (_, init) => {
				calls++;
				const body = requestSchema.parse(JSON.parse(String(init?.body)));
				expect(Object.keys(body.questions)).toEqual([
					"intent",
					"eligible",
					"quality",
				]);
				expect(Object.values(body.questions).map((q) => q.type)).toEqual([
					"choice",
					"noul",
					"score",
				]);
				return Response.json({
					model: "jev-1.13.0",
					answers: {
						intent: {
							type: "choice",
							choice: "Choice 1",
							confidence: 0.95,
							probabilities: { "Choice 1": 0.95, "Choice 2": 0.05 },
						},
						eligible: { type: "noul", noul: 0.99 },
						quality: {
							type: "score",
							score: 2,
							confidence: 0.95,
							probabilities: { "0": 0, "1": 0, "2": 1 },
						},
					},
					usage: { input_tokens: 10, output_tokens: 0 },
				});
			},
		},
	);
	let result: RouteResult | undefined;
	await readRouteStream(response, (event) => {
		if (event.type === "done") result = event.route;
	});
	expect(calls).toBe(1);
	expect(result?.calls).toHaveLength(1);
	expect(
		result?.jevSteps.map((step) => [step.questionId, step.branch, step.status]),
	).toEqual([
		["intent", "intent/choice-1", "accepted"],
		["eligible", "eligible/yes", "accepted"],
		["quality", "quality/score-2", "accepted"],
	]);
	expect(result?.text).toBe(
		"Intent · Choice 1\nEligibility · Yes\nQuality · Level 2",
	);
	expect(
		result?.outputs[0].kind === "jev" && result.outputs[0].decisions,
	).toHaveLength(3);
	expect(result?.usage.inputTokens).toBe(10);
});

test("selected question routes execute in parallel and join once with all batch decisions", async () => {
	const routes: WorkflowRoutes = {
		...graph,
		nodes: [
			...graph.nodes,
			...["intent-path", "eligible-path", "join"].map((id) => ({
				id,
				kind: "model" as const,
				provider: "openai" as const,
				model: "gpt-6-luna",
			})),
		],
		edges: [
			...graph.edges,
			{
				id: "intent",
				source: "judge",
				sourceHandle: "intent/choice-1",
				target: "intent-path",
			},
			{
				id: "eligible",
				source: "judge",
				sourceHandle: "eligible/yes",
				target: "eligible-path",
			},
			{ id: "a", source: "intent-path", sourceHandle: "next", target: "join" },
			{
				id: "b",
				source: "eligible-path",
				sourceHandle: "next",
				target: "join",
			},
		],
	};
	workflowRoutesSchema.parse(routes);
	let evaluated = 0;
	const models: string[] = [];
	const result = await executeWorkflow({
		routes,
		messages: [{ role: "user", content: "Review" }],
		metadata: {},
		evaluate: async (_, batch) => {
			evaluated++;
			expect(batch).toHaveLength(3);
			return evaluation;
		},
		runModel: async ({ target, context }) => {
			models.push(target.nodeId);
			const decisionOutput = context.inputs.find(
				(output) => output.sourceNodeId === "judge",
			);
			expect(
				decisionOutput?.kind === "jev" && decisionOutput.decisions,
			).toHaveLength(3);
			if (target.nodeId === "join")
				expect(context.inputs.map((output) => output.sourceNodeId)).toEqual(
					expect.arrayContaining(["intent-path", "eligible-path"]),
				);
			return { text: target.nodeId, model: target.model };
		},
		onDelta: () => {},
		onProgress: () => {},
		onRoute: () => {},
	});
	expect(evaluated).toBe(1);
	expect(models).toEqual(["intent-path", "eligible-path", "join"]);
	expect(result.text).toBe("join");
});

test("per-question uncertainty is explicit and a rejected batch releases no paths", () => {
	const repeatCounts = new Map<string, number>();
	const uncertain = {
		...evaluation,
		answers: evaluation.answers.map((answer) =>
			answer.questionId === "quality" ? { ...answer, confidence: 0.1 } : answer,
		),
	};
	const resolve = (batch = questions) =>
		resolveJevBatch({
			nodeId: "judge",
			questions: batch,
			evaluation: uncertain,
			error: undefined,
			edges: [],
			repeatCounts,
			maxRepeats: 3,
		});
	expect(() => resolve()).toThrow("Quality");
	expect(repeatCounts.size).toBe(0);
	const resolved = resolve(
		questions.map((question) =>
			question.id === "quality"
				? { ...question, uncertainOutputId: "quality/score-0" }
				: question,
		),
	);
	expect(resolved.decisions.map(({ status }) => status)).toEqual([
		"accepted",
		"accepted",
		"uncertain",
	]);
	expect(resolved.decisions[2]).toMatchObject({
		branch: "quality/score-0",
		selectedBranch: "quality/score-2",
		confidence: 0.1,
	});
});

test("uncertainty and provider errors use only their own configured outputs", () => {
	const question = {
		...questions[0],
		uncertainOutputId: "intent/choice-2",
		errorOutputId: "intent/choice-1",
	};
	const resolve = (
		batch: typeof questions,
		result: typeof evaluation | undefined,
		error?: string,
	) =>
		resolveJevBatch({
			nodeId: "judge",
			questions: batch,
			evaluation: result,
			error,
			edges: [],
			repeatCounts: new Map(),
			maxRepeats: 3,
		});
	const uncertain = {
		...evaluation,
		answers: [{ ...evaluation.answers[0], confidence: 0.69 }],
	};
	expect(resolve([question], uncertain).decisions[0]).toMatchObject({
		branch: "intent/choice-2",
		status: "uncertain",
	});
	expect(
		resolve([question], undefined, "unavailable").decisions[0],
	).toMatchObject({
		branch: "intent/choice-1",
		status: "provider-error",
		error: "unavailable",
	});
	expect(() =>
		resolve(
			[{ ...question, errorOutputId: undefined }],
			undefined,
			"unavailable",
		),
	).toThrow("couldn’t evaluate");
	expect(() =>
		resolve([{ ...question, uncertainOutputId: undefined }], uncertain),
	).toThrow("couldn’t determine a reliable answer");
	for (const invalid of [
		{ ...evaluation, answers: [] },
		{
			...evaluation,
			answers: [{ ...evaluation.answers[0], branch: "intent/missing" }],
		},
	]) {
		expect(resolve([question], invalid).decisions[0]).toMatchObject({
			status: "provider-error",
			error: "Jev returned no valid answer",
		});
		expect(() =>
			resolve([{ ...question, errorOutputId: undefined }], invalid),
		).toThrow("no valid answer");
	}
	expect(resolve([question], undefined, "").decisions[0].status).toBe(
		"provider-error",
	);
});

test("each question accepts its threshold boundary and uses only its uncertainty policy below it", () => {
	for (const question of questions) {
		const answer = evaluation.answers.find(
			(answer) => answer.questionId === question.id,
		);
		if (!answer) throw new Error("Missing fixture answer");
		for (const confidence of [0.699, 0.7]) {
			const result = resolveJevBatch({
				nodeId: "judge",
				questions: [{ ...question, uncertainOutputId: answer.branch }],
				evaluation: { ...evaluation, answers: [{ ...answer, confidence }] },
				error: undefined,
				edges: [],
				repeatCounts: new Map(),
				maxRepeats: 3,
			});
			expect(result.decisions[0].status).toBe(
				confidence < 0.7 ? "uncertain" : "accepted",
			);
		}
	}
});

test("an error output cannot traverse an exhausted repeat or its success exit", () => {
	const result = resolveJevBatch({
		nodeId: "judge",
		questions: [{ ...questions[0], errorOutputId: "intent/choice-2" }],
		evaluation: undefined,
		error: "unavailable",
		edges: [
			{
				id: "repeat",
				source: "judge",
				sourceHandle: "intent/choice-2",
				target: "draft",
				repeat: true,
			},
			{
				id: "success",
				source: "judge",
				sourceHandle: "intent/choice-1",
				target: "answer",
			},
		],
		repeatCounts: new Map([["repeat", 3]]),
		maxRepeats: 3,
	});
	expect(result.exhausted).toBe(true);
	expect(result.edges).toEqual([]);
	expect(result.decisions[0]).toMatchObject({
		status: "exhausted",
		error: "unavailable",
	});
	expect(result.text).toBe("Repeat limit reached. Review did not pass.");
});

test("a failed question releases no batch paths even when another question is accepted", async () => {
	let modelCalls = 0;
	await expect(
		executeWorkflow({
			routes: {
				...graph,
				nodes: [
					...graph.nodes,
					{
						id: "answer",
						kind: "model",
						provider: "openai",
						model: "gpt-6-luna",
					},
				],
				edges: [
					...graph.edges,
					{
						id: "selected",
						source: "judge",
						sourceHandle: "intent/choice-1",
						target: "answer",
					},
				],
			},
			messages: [{ role: "user", content: "Review" }],
			metadata: {},
			evaluate: async () => ({
				...evaluation,
				answers: [evaluation.answers[0]],
			}),
			runModel: async ({ target }) => {
				modelCalls++;
				return { text: "unexpected", model: target.model };
			},
			onDelta: () => {},
			onProgress: () => {},
			onRoute: () => {},
		}),
	).rejects.toThrow("Eligibility");
	expect(modelCalls).toBe(0);
});

test("batches reject duplicate identities, cross-question failure outputs, and ambiguous repeat control", () => {
	expect(
		configuredJevQuestionsSchema.safeParse([questions[0], questions[0]])
			.success,
	).toBe(false);
	for (const field of ["uncertainOutputId", "errorOutputId"] as const)
		expect(
			configuredJevQuestionsSchema.safeParse([
				{ ...questions[0], [field]: "eligible/yes" },
			]).success,
		).toBe(false);
	expect(
		configuredJevQuestionsSchema.safeParse([
			{ ...questions[0], fallbackOutputId: "intent/choice-1" },
		]).success,
	).toBe(false);
	const routes = {
		...graph,
		nodes: [
			graph.nodes[0],
			{ id: "draft", kind: "model", provider: "openai", model: "gpt-6-luna" },
			graph.nodes[1],
		],
		edges: [
			{ id: "entry", source: "input", target: "draft" },
			{ id: "review", source: "draft", target: "judge" },
			{
				id: "repeat",
				source: "judge",
				sourceHandle: "eligible/no",
				target: "draft",
				repeat: true,
			},
		],
	};
	expect(workflowRoutesSchema.safeParse(routes).success).toBe(false);
});
