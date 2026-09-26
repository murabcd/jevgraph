import { expect, test } from "bun:test";
import { executeWorkflow, workflowRoutingState } from "../server/workflow";
import { routesFromGraph } from "../src/flow/graph";
import {
	type JevDecision,
	type RouteTarget,
	type WorkflowRoutes,
	workflowRoutesSchema,
} from "../src/lib/routing";
import { configuredJevQuestion } from "./jev-question-fixture";
import { connectedWorkflowGraph } from "./workflow-graph";

const example = connectedWorkflowGraph();
const connected = routesFromGraph(example.nodes, example.edges);
if (!connected) throw new Error("Fixture must compile as a chatflow");

function answer(branch: "yes" | "no"): JevDecision {
	return {
		type: "noul",
		branch,
		value: branch,
		confidence: 0.95,
		model: "jev-latest",
		latencyMs: 1,
	};
}

function run(
	routes: WorkflowRoutes,
	options: {
		decide?: (nodeId: string, state: string) => Promise<JevDecision>;
		model?: (target: RouteTarget, context: string) => Promise<string>;
		signal?: AbortSignal;
	} = {},
) {
	const deltas: string[] = [];
	const routesSeen: string[] = [];
	const progress: string[][] = [];
	return {
		deltas,
		routesSeen,
		progress,
		result: executeWorkflow({
			routes,
			messages: [{ role: "user", content: "Help me" }],
			metadata: {},
			evaluate: (nodeId, _question, state) =>
				options.decide?.(nodeId, state) ?? Promise.resolve(answer("yes")),
			runModel: async (target, inputs, onDelta) => {
				const context = inputs.map((input) => input.text).join(" ");
				const text =
					(await options.model?.(target, context)) ??
					`answer from ${target.nodeId}`;
				onDelta(text);
				return { text, model: target.model };
			},
			onDelta: (text) => deltas.push(text),
			onRoute: (route) => routesSeen.push(route.nodeId),
			onProgress: (trace) =>
				progress.push(trace.path.map((step) => step.nodeId)),
			signal: options.signal,
		}),
	};
}

test("Jev evaluates only the selected path and keeps a connected backup", async () => {
	const questions: string[] = [];
	const execution = run(connected, {
		decide: async (nodeId, state) => {
			questions.push(nodeId);
			expect(state).toContain("user: Help me");
			return answer("yes");
		},
	});
	const result = await execution.result;
	expect(questions).toEqual(["first-router"]);
	expect(result.nodeId).toBe("primary-model");
	expect(result.path.map((step) => step.nodeId)).toEqual([
		"input",
		"first-router",
		"primary-model",
	]);
	expect(execution.deltas).toEqual(["answer from primary-model"]);
});

test("an unconnected Jev choice returns its label without a model call", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{ id: "judge", kind: "jev", question: configuredJevQuestion() },
			{ id: "next", kind: "model", provider: "openai", model: "gpt-5-mini" },
		],
		edges: [
			{ id: "entry", source: "input", target: "judge" },
			{
				id: "choice-1",
				source: "judge",
				sourceHandle: "choice-1",
				target: "next",
			},
		],
	};
	expect(workflowRoutesSchema.safeParse(routes).success).toBe(true);
	const execution = run(routes, {
		decide: async () => ({
			type: "choice",
			branch: "choice-2",
			value: "choice-2",
			confidence: 0.92,
			model: "jev-latest",
			latencyMs: 10,
			usage: { inputTokens: 93, outputTokens: 0 },
		}),
		model: async () => {
			throw new Error("Model must not run for a terminal Jev answer");
		},
	});
	const result = await execution.result;
	expect(result.text).toBe("Choice 2");
	expect(result.provider).toBe("jev");
	expect(result.usage).toEqual({ inputTokens: 93, outputTokens: 0 });
	expect(execution.deltas).toEqual(["Choice 2"]);
});

test("an unconnected Jev answer fails rather than inventing a label", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{ id: "judge", kind: "jev", question: configuredJevQuestion() },
		],
		edges: [{ id: "entry", source: "input", target: "judge" }],
	};
	await expect(
		run(routes, {
			decide: async () => ({
				type: "choice",
				branch: "choice-2",
				value: "choice-2",
				confidence: 0.2,
				model: "jev-latest",
				latencyMs: 10,
			}),
		}).result,
	).rejects.toThrow("could not choose a reliable answer");
});

test("Jev uses its configured confidence threshold and fallback output", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{
				id: "judge",
				kind: "jev",
				question: configuredJevQuestion(),
				confidenceThreshold: 0.9,
				fallbackOutputId: "choice-1",
			},
			{
				id: "first-model",
				kind: "model",
				provider: "openai",
				model: "gpt-5-mini",
			},
		],
		edges: [
			{ id: "entry", source: "input", target: "judge" },
			{
				id: "choice-1",
				source: "judge",
				sourceHandle: "choice-1",
				target: "first-model",
			},
		],
	};
	const execution = executeWorkflow({
		routes,
		messages: [{ role: "user", content: "Help me" }],
		metadata: {},
		evaluate: async () => {
			return {
				type: "choice",
				branch: "choice-2",
				value: "choice-2",
				confidence: 0.8,
				model: "jev-latest",
				latencyMs: 1,
			};
		},
		runModel: async (target) => ({ text: target.nodeId, model: target.model }),
		onDelta: () => {},
		onRoute: () => {},
		onProgress: () => {},
	});
	const result = await execution;
	expect(result.nodeId).toBe("first-model");
	expect(result.jevSteps[0]?.branch).toBe("choice-1");
});

test("Jev can return a configured fallback label when its provider fails", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{
				id: "judge",
				kind: "jev",
				question: configuredJevQuestion(),
				fallbackOutputId: "choice-2",
			},
		],
		edges: [{ id: "entry", source: "input", target: "judge" }],
	};
	const result = await run(routes, {
		decide: async () => {
			throw new Error("Jev unavailable");
		},
		model: async () => {
			throw new Error("No model should run");
		},
	}).result;
	expect(result.text).toBe("Choice 2");
	expect(result.provider).toBe("jev");
	expect(result.jevSteps[0]).toMatchObject({
		branch: "choice-2",
		error: "Jev unavailable",
	});
});

test("Model execution receives its configured generation settings", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{
				id: "model",
				kind: "model",
				provider: "openai",
				model: "gpt-5-mini",
				maxOutputTokens: 640,
				reasoningEffort: "low",
			},
		],
		edges: [{ id: "entry", source: "input", target: "model" }],
	};
	let target: RouteTarget | undefined;
	await run(routes, {
		model: async (current) => {
			target = current;
			return "done";
		},
	}).result;
	expect(target).toMatchObject({
		maxOutputTokens: 640,
		reasoningEffort: "low",
	});
});

test("Start values reach only the nodes that select them", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{
				id: "input",
				kind: "input",
				fields: [
					{
						name: "plan",
						type: "string",
						required: false,
						defaultValue: "paid",
					},
					{
						name: "requestRateRps",
						type: "number",
						required: false,
						defaultValue: 0.8,
					},
				],
			},
			{
				id: "judge",
				kind: "jev",
				question: configuredJevQuestion("noul"),
				variables: ["plan"],
			},
			{
				id: "yes",
				kind: "model",
				provider: "openai",
				model: "gpt-5-mini",
				variables: ["requestRateRps"],
			},
			{
				id: "no",
				kind: "model",
				provider: "google",
				model: "gemini-3.5-flash-lite",
			},
		],
		edges: [
			{ id: "entry", source: "input", target: "judge" },
			{ id: "yes", source: "judge", sourceHandle: "yes", target: "yes" },
			{ id: "no", source: "judge", sourceHandle: "no", target: "no" },
		],
	};
	let state = "";
	let modelVariables: Record<string, string | number | boolean> = {};
	await executeWorkflow({
		routes,
		messages: [{ role: "user", content: "hello" }],
		metadata: {},
		evaluate: async (_id, _question, input) => {
			state = input;
			return answer("yes");
		},
		runModel: async (_target, _inputs, _onDelta, variables) => {
			modelVariables = variables;
			return { text: "ok", model: "gpt-5-mini" };
		},
		onDelta: () => {},
		onRoute: () => {},
		onProgress: () => {},
	});
	expect(state).toContain('"plan":"paid"');
	expect(state).not.toContain("requestRateRps");
	expect(modelVariables).toEqual({ requestRateRps: 0.8 });
});

test("a model can feed its output to Jev and another model", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{
				id: "draft",
				kind: "model",
				provider: "openai",
				model: "gpt-5-mini",
				prompt: "Draft",
			},
			{ id: "gate", kind: "jev", question: configuredJevQuestion("noul") },
			{
				id: "final",
				kind: "model",
				provider: "google",
				model: "gemini-3.5-flash-lite",
				prompt: "Revise",
			},
		],
		edges: [
			{ id: "entry", source: "input", target: "draft" },
			{ id: "continue", source: "draft", sourceHandle: "next", target: "gate" },
			{ id: "yes", source: "gate", sourceHandle: "yes", target: "final" },
			{ id: "no", source: "gate", sourceHandle: "no", target: "final" },
		],
	};
	const states: string[] = [];
	const inputs: string[] = [];
	const execution = run(routes, {
		decide: async (_nodeId, state) => {
			states.push(state);
			return answer("yes");
		},
		model: async (target, context) => {
			inputs.push(`${target.nodeId}: ${context}`);
			return target.nodeId === "draft" ? "Draft text" : "Final text";
		},
	});
	const result = await execution.result;
	expect(states[0]).toContain("[draft] Draft text");
	expect(inputs).toEqual(["draft: ", "final: Draft text Decision: Yes"]);
	expect(execution.deltas).toEqual(["Final text"]);
	expect(result.outputs.map((output) => output.nodeId)).toEqual([
		"draft",
		"gate",
		"final",
	]);
});

test("parallel model results join before Jev evaluates them", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{ id: "first", kind: "model", provider: "openai", model: "gpt-5-mini" },
			{
				id: "second",
				kind: "model",
				provider: "google",
				model: "gemini-3.5-flash-lite",
			},
			{ id: "judge", kind: "jev", question: configuredJevQuestion("noul") },
			{ id: "final", kind: "model", provider: "openai", model: "gpt-5-mini" },
		],
		edges: [
			{ id: "a", source: "input", target: "first" },
			{ id: "b", source: "input", target: "second" },
			{ id: "c", source: "first", sourceHandle: "next", target: "judge" },
			{ id: "d", source: "second", sourceHandle: "next", target: "judge" },
			{ id: "e", source: "judge", sourceHandle: "yes", target: "final" },
			{ id: "f", source: "judge", sourceHandle: "no", target: "final" },
		],
	};
	let concurrent = 0;
	let highestConcurrency = 0;
	let judgedState = "";
	const execution = run(routes, {
		decide: async (_nodeId, state) => {
			judgedState = state;
			return answer("yes");
		},
		model: async (target) => {
			if (target.nodeId === "final") return "Combined answer";
			concurrent++;
			highestConcurrency = Math.max(highestConcurrency, concurrent);
			await Bun.sleep(target.nodeId === "first" ? 5 : 1);
			concurrent--;
			return `${target.nodeId} result`;
		},
	});
	const result = await execution.result;
	expect(highestConcurrency).toBe(2);
	expect(result.outputs.map((output) => output.nodeId)).toEqual([
		"first",
		"second",
		"judge",
		"final",
	]);
	expect(judgedState).toContain("[first] first result");
	expect(judgedState).toContain("[second] second result");
	expect(result.traversedEdges.map((edge) => edge.id)).toEqual([
		"a",
		"b",
		"c",
		"d",
		"e",
	]);
	expect(execution.deltas).toEqual(["Combined answer"]);
});

test("model failure uses the connected backup once before downstream work", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{ id: "primary", kind: "model", provider: "openai", model: "gpt-5-mini" },
			{
				id: "backup",
				kind: "model",
				provider: "google",
				model: "gemini-3.5-flash-lite",
			},
			{ id: "final", kind: "model", provider: "openai", model: "gpt-5-mini" },
		],
		edges: [
			{ id: "entry", source: "input", target: "primary" },
			{
				id: "backup-edge",
				source: "primary",
				sourceHandle: "fallback",
				target: "backup",
			},
			{
				id: "continue",
				source: "primary",
				sourceHandle: "next",
				target: "final",
			},
		],
	};
	const calls: string[] = [];
	const execution = run(routes, {
		model: async (target, context) => {
			calls.push(target.nodeId);
			if (target.nodeId === "primary") throw new Error("unavailable");
			if (target.nodeId === "final") {
				expect(context).toContain("answer from backup");
				return "Final";
			}
			return "answer from backup";
		},
	});
	const result = await execution.result;
	expect(calls).toEqual(["primary", "backup", "final"]);
	expect(result.path.map((step) => step.nodeId)).toContain("backup");
	expect(result.fallbackReason).toContain("unavailable");
});

test("a Jev feedback branch repeats a model with the latest result and exits at its limit", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{ id: "draft", kind: "model", provider: "openai", model: "gpt-5-mini" },
			{
				id: "judge",
				kind: "jev",
				question: configuredJevQuestion("noul"),
				maxRepeats: 2,
			},
			{ id: "final", kind: "model", provider: "openai", model: "gpt-5-mini" },
		],
		edges: [
			{ id: "entry", source: "input", target: "draft" },
			{ id: "check", source: "draft", sourceHandle: "next", target: "judge" },
			{
				id: "retry",
				source: "judge",
				sourceHandle: "no",
				target: "draft",
				repeat: true,
			},
			{ id: "done", source: "judge", sourceHandle: "yes", target: "final" },
		],
	};
	workflowRoutesSchema.parse(routes);
	let modelCalls = 0;
	const states: string[] = [];
	const execution = run(routes, {
		decide: async (_nodeId, state) => {
			states.push(state);
			return answer("no");
		},
		model: async (target, context) =>
			target.nodeId === "draft"
				? `draft ${++modelCalls}`
				: `final answer from ${context}`,
	});
	const result = await execution.result;
	expect(modelCalls).toBe(3);
	expect(states[2]).toContain("[draft] draft 3");
	expect(result.text).toContain("draft 3");
	expect(result.jevSteps.map((step) => step.branch)).toEqual([
		"no",
		"no",
		"yes",
	]);
	expect(result.jevSteps.at(-1)?.limitReached).toBe(true);
	expect(result.traversedEdges.filter((edge) => edge.repeat)).toHaveLength(2);
});

test("a parallel join waits for a repeating branch before running the final model", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{ id: "draft", kind: "model", provider: "openai", model: "gpt-5-mini" },
			{
				id: "context",
				kind: "model",
				provider: "google",
				model: "gemini-3.5-flash-lite",
			},
			{ id: "judge", kind: "jev", question: configuredJevQuestion("noul") },
			{ id: "final", kind: "model", provider: "openai", model: "gpt-5-mini" },
		],
		edges: [
			{ id: "draft-entry", source: "input", target: "draft" },
			{ id: "context-entry", source: "input", target: "context" },
			{ id: "check", source: "draft", sourceHandle: "next", target: "judge" },
			{
				id: "retry",
				source: "judge",
				sourceHandle: "no",
				target: "draft",
				repeat: true,
			},
			{ id: "done", source: "judge", sourceHandle: "yes", target: "final" },
			{
				id: "context-join",
				source: "context",
				sourceHandle: "next",
				target: "final",
			},
		],
	};
	workflowRoutesSchema.parse(routes);
	let draftCalls = 0;
	const finalInputs: string[] = [];
	const execution = run(routes, {
		decide: async () => answer(draftCalls === 1 ? "no" : "yes"),
		model: async (target, context) => {
			if (target.nodeId === "draft") return `draft ${++draftCalls}`;
			if (target.nodeId === "context") return "context result";
			finalInputs.push(context);
			return "joined result";
		},
	});
	const result = await execution.result;
	expect(finalInputs).toHaveLength(1);
	expect(finalInputs[0]).toContain("draft 2");
	expect(finalInputs[0]).toContain("context result");
	expect(result.text).toBe("joined result");
});

test("cancellation during Jev evaluation stops before the default model", async () => {
	const controller = new AbortController();
	let modelCalls = 0;
	const execution = run(connected, {
		signal: controller.signal,
		decide: async () => {
			controller.abort();
			throw new Error("evaluation cancelled");
		},
		model: async () => {
			modelCalls++;
			return "unexpected";
		},
	});
	await expect(execution.result).rejects.toThrow();
	expect(modelCalls).toBe(0);
});

test("Jev context includes the conversation and selected variables", () => {
	const state = workflowRoutingState(
		[{ role: "user", content: "Help with an invoice" }],
		{ accountTier: "paid", currentLoad: 2.4 },
	);
	expect(state).toContain(
		'Routing metadata: {"accountTier":"paid","currentLoad":2.4}',
	);
	expect(state).toContain("user: Help with an invoice");
});
