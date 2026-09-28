import { expect, test } from "bun:test";
import { executeWorkflow } from "../server/workflow";
import { publishedRates } from "../src/lib/model-pricing";
import {
	type RouteSelectionResult,
	type WorkflowRoutes,
	workflowRoutesSchema,
} from "../src/lib/routing";
import { estimateCost } from "../src/lib/usage";

const routes: WorkflowRoutes = {
	kind: "workflow",
	nodes: [
		{ id: "input", kind: "input", fields: [] },
		{
			id: "answer",
			kind: "model",
			provider: "openai",
			model: "gpt-6-luna",
			reasoningEffort: "medium",
			routing: {
				models: ["gemini-3.8-flash"],
				expectedOutputTokens: 50,
				expectedRequests: 1,
			},
		},
		{ id: "backup", kind: "model", provider: "openai", model: "gpt-6-luna" },
	],
	edges: [
		{ id: "entry", source: "input", target: "answer" },
		{
			id: "fallback",
			source: "answer",
			sourceHandle: "fallback",
			target: "backup",
		},
	],
};

test.each([false, true])(
	"cost routing retains exactly one explicit backup and never retries a partial answer: %s",
	async (partial) => {
		const attempts: string[] = [];
		const selections: RouteSelectionResult[] = [];
		const run = executeWorkflow({
			routes,
			metadata: {},
			messages: [{ role: "user", content: "Когда приедет заказ?" }],
			evaluate: async () => {
				throw new Error("Not reached");
			},
			onDelta: () => {},
			onProgress: () => {},
			onRoute: (route) => selections.push(route),
			runModel: async ({ target, onDelta }) => {
				attempts.push(target.model);
				if (target.nodeId === "answer") {
					expect(target.provider).toBe("google");
					if (partial) onDelta("Здравствуйте");
					throw new Error("provider unavailable");
				}
				return {
					text: "Уточните номер заказа.",
					model: target.model,
					usage: { inputTokens: 100, outputTokens: 10 },
				};
			},
		});
		if (partial) {
			await expect(run).rejects.toThrow("provider unavailable");
			expect(attempts).toEqual(["gemini-3.8-flash"]);
		} else {
			const result = await run;
			expect(attempts).toEqual(["gemini-3.8-flash", "gpt-6-luna"]);
			expect(result.calls.map(({ status }) => status)).toEqual([
				"failed",
				"completed",
			]);
			expect(result.usage.complete).toBe(false);
			expect(result.modelPlans[0].selectedModel).toBe("gemini-3.8-flash");
			expect(result.traversedEdges.some(({ id }) => id === "fallback")).toBe(
				true,
			);
		}
		expect(selections[0]).toMatchObject({
			provider: "google",
			model: "gemini-3.8-flash",
		});
	},
);

test("reasoning and output expectations are validated against all allowed candidates", () => {
	const build = (
		reasoningEffort: string,
		models: string[],
		expectedOutputTokens = 50,
	) => ({
		...routes,
		nodes: routes.nodes.map((node) =>
			node.id === "answer"
				? {
						...node,
						provider: "google",
						model: "gemini-3.8-flash",
						maxOutputTokens: 100,
						reasoningEffort,
						routing: { models, expectedOutputTokens, expectedRequests: 1 },
					}
				: node,
		),
	});
	expect(
		workflowRoutesSchema.safeParse(build("none", ["gpt-6-luna"])).success,
	).toBe(true);
	expect(
		workflowRoutesSchema.safeParse(
			build("none", ["gpt-6-luna", "gemini-3.8-flash"]),
		).success,
	).toBe(false);
	expect(
		workflowRoutesSchema.safeParse(build("medium", ["gpt-6-luna"], 101))
			.success,
	).toBe(false);
	expect(workflowRoutesSchema.safeParse(build("medium", [])).success).toBe(
		false,
	);
});

test("automatic execution clears the previous model's custom rates and preserves the configured node", async () => {
	const configured = structuredClone(routes);
	const primary = configured.nodes.find((node) => node.id === "answer");
	if (primary?.kind !== "model") throw new Error("Missing test primary");
	primary.pricing = { input: 10, output: 10 };
	const before = structuredClone(configured);
	const usage = { inputTokens: 100, outputTokens: 10 };
	const result = await executeWorkflow({
		routes: configured,
		metadata: {},
		messages: [{ role: "user", content: "Когда приедет заказ?" }],
		evaluate: async () => {
			throw new Error("Not reached");
		},
		onDelta: () => {},
		onProgress: () => {},
		onRoute: () => {},
		runModel: async ({ target }) => {
			expect(target).toMatchObject({
				provider: "google",
				model: "gemini-3.8-flash",
			});
			expect(target.pricing).toBeUndefined();
			return { text: "Уточните номер заказа.", model: target.model, usage };
		},
	});
	expect(result.calls).toHaveLength(1);
	expect(result.calls[0].estimatedCostUsd).toBe(
		estimateCost(
			usage,
			publishedRates("google", "gemini-3.8-flash", usage.inputTokens),
		),
	);
	expect(configured).toEqual(before);
});
