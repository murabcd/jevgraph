import { expect, test } from "bun:test";
import { ProviderUsageError } from "../server/provider-usage";
import { executeWorkflow } from "../server/workflow";
import { DEFAULT_CONTEXT_POLICY } from "../src/lib/context";
import type { RouteTrace, WorkflowRoutes } from "../src/lib/routing";
import { configuredJevQuestion } from "./jev-question-fixture";

test.each([true, false])(
	"accounts for every workflow call with custom pricing enabled: %s",
	async (custom) => {
		const rates = custom ? { input: 1, output: 2 } : undefined;
		const routes: WorkflowRoutes = {
			kind: "workflow",
			nodes: [
				{ id: "input", kind: "input", fields: [] },
				{
					id: "draft",
					kind: "model",
					provider: "openai",
					model: "gpt-6-luna",
					pricing: rates,
				},
				{
					id: "judge",
					kind: "jev",
					questions: [configuredJevQuestion("noul")],
					pricing: rates,
					context: {
						...DEFAULT_CONTEXT_POLICY,
						relevance: {
							instructions: "Keep the draft",
							minimumConfidence: 0.9,
							pricing: rates,
						},
					},
				},
				{
					id: "final",
					kind: "model",
					provider: "google",
					model: "gemini-3.8-flash",
					pricing: rates,
				},
			],
			edges: [
				{ id: "entry", source: "input", target: "draft" },
				{
					id: "review",
					source: "draft",
					sourceHandle: "next",
					target: "judge",
				},
				{
					id: "retry",
					source: "judge",
					sourceHandle: "question/no",
					target: "draft",
					repeat: true,
				},
				{
					id: "finish",
					source: "judge",
					sourceHandle: "question/yes",
					target: "final",
				},
			],
		};
		let drafts = 0;
		const result = await executeWorkflow({
			routes,
			messages: [{ role: "user", content: "Write a draft" }],
			metadata: {},
			contextProviders: {
				filter: async ({ chunks }) => ({
					probabilities: Object.fromEntries(chunks.map(({ id }) => [id, 1])),
					usage: { inputTokens: 10, outputTokens: 0 },
				}),
			},
			evaluate: async () => ({
				answers: [
					{
						questionId: "question",
						type: "noul",
						branch: `question/${drafts > 1 ? "yes" : "no"}`,
						value: drafts > 1 ? 0.95 : 0.05,
						confidence: 0.95,
						probabilities: {
							yes: drafts > 1 ? 0.95 : 0.05,
							no: drafts > 1 ? 0.05 : 0.95,
						},
					},
				],
				model: "jev-latest",
				latencyMs: 1,
				usage: { inputTokens: 20, outputTokens: 0 },
			}),
			runModel: async ({ target }) => {
				if (target.nodeId === "draft") drafts++;
				return {
					text: `draft ${drafts}`,
					model: target.model,
					usage: { inputTokens: 100, outputTokens: 25 },
				};
			},
			onDelta: () => {},
			onRoute: () => {},
			onProgress: () => {},
		});
		// Two drafts + two context batches + two review decisions + final generation.
		expect(result.calls).toHaveLength(7);
		expect(new Set(result.calls.map(({ id }) => id)).size).toBe(7);
		expect(result.usage).toMatchObject({
			inputTokens: 360,
			outputTokens: 75,
			complete: true,
			costComplete: true,
		});
		expect(result.usage.estimatedCostUsd).toBeCloseTo(
			custom ? 0.00051 : 0.00021627,
			8,
		);
		expect(
			result.outputs
				.filter((output) => output.nodeId === "draft")
				.map(({ revision }) => revision),
		).toEqual([1, 2]);
		expect(result.jevSteps.at(-1)).toMatchObject({
			status: "accepted",
			selectedBranch: "question/yes",
			value: 0.95,
			probabilities: { yes: 0.95, no: 0.05 },
		});
	},
);

test("keeps unknown failed usage and applies the backup's own context policy", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{ id: "draft", kind: "model", provider: "openai", model: "gpt-6-luna" },
			{
				id: "backup",
				kind: "model",
				provider: "google",
				model: "gemini-3.8-flash",
				context: { ...DEFAULT_CONTEXT_POLICY, historyMessages: 0 },
			},
			{
				id: "final",
				kind: "model",
				provider: "openai",
				model: "gpt-6-luna",
				context: {
					...DEFAULT_CONTEXT_POLICY,
					upstream: "selected",
					outputNodeIds: ["draft"],
				},
			},
		],
		edges: [
			{ id: "entry", source: "input", target: "draft" },
			{
				id: "backup",
				source: "draft",
				sourceHandle: "fallback",
				target: "backup",
			},
			{ id: "finish", source: "draft", sourceHandle: "next", target: "final" },
		],
	};
	const result = await executeWorkflow({
		routes,
		messages: [
			{ role: "assistant", content: "Old context" },
			{ role: "user", content: "New query" },
		],
		metadata: {},
		evaluate: async () => {
			throw new Error("Unexpected Jev");
		},
		runModel: async ({ target, context }) => {
			if (target.nodeId === "draft")
				throw new ProviderUsageError(new Error("unavailable"), undefined);
			if (target.nodeId === "backup")
				expect(context.messages).toEqual([
					{ role: "user", content: "New query" },
				]);
			if (target.nodeId === "final")
				expect(context.inputs).toMatchObject([
					{ nodeId: "backup", sourceNodeId: "draft", text: "backup answer" },
				]);
			return {
				text: target.nodeId === "backup" ? "backup answer" : "final answer",
				model: target.model,
				usage: { inputTokens: 50, outputTokens: 10 },
			};
		},
		onDelta: () => {},
		onRoute: () => {},
		onProgress: () => {},
	});
	expect(result.calls.map(({ nodeId, status }) => [nodeId, status])).toEqual([
		["draft", "failed"],
		["backup", "completed"],
		["final", "completed"],
	]);
	expect(result.usage).toMatchObject({
		inputTokens: 100,
		outputTokens: 20,
		complete: false,
		costComplete: false,
	});
	// Missing primary usage remains unknown; both successful providers are priced.
	expect(result.calls[0].estimatedCostUsd).toBeUndefined();
	expect(result.calls[1].estimatedCostUsd).toBeCloseTo(0.000075, 10);
	expect(result.calls[2].estimatedCostUsd).toBeCloseTo(0.00001, 10);
	expect(result.usage.estimatedCostUsd).toBeCloseTo(0.000085, 10);
});

test("preserves reported usage on a partial stream failure without calling the backup", async () => {
	let latest: RouteTrace | undefined;
	let attempts = 0;
	const execution = executeWorkflow({
		routes: {
			kind: "workflow",
			nodes: [
				{ id: "input", kind: "input", fields: [] },
				{
					id: "primary",
					kind: "model",
					provider: "openai",
					model: "gpt-6-luna",
				},
				{
					id: "backup",
					kind: "model",
					provider: "google",
					model: "gemini-3.8-flash",
				},
			],
			edges: [
				{ id: "entry", source: "input", target: "primary" },
				{
					id: "error",
					source: "primary",
					sourceHandle: "fallback",
					target: "backup",
				},
			],
		},
		messages: [{ role: "user", content: "Hello" }],
		metadata: {},
		evaluate: async () => {
			throw new Error("Unexpected Jev");
		},
		runModel: async ({ onDelta }) => {
			attempts++;
			onDelta("partial");
			throw new ProviderUsageError(new Error("stream disconnected"), {
				inputTokens: 120,
				outputTokens: 3,
			});
		},
		onDelta: () => {},
		onRoute: () => {},
		onProgress: (trace) => {
			latest = trace;
		},
	});
	await expect(execution).rejects.toThrow("stream disconnected");
	expect(attempts).toBe(1);
	expect(latest?.calls).toMatchObject([
		{
			nodeId: "primary",
			status: "failed",
			usage: { inputTokens: 120, outputTokens: 3 },
			estimatedCostUsd: 0.0000135,
		},
	]);
});
