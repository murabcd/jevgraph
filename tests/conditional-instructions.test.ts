import { expect, test } from "bun:test";
import { resolveInstructions } from "../server/conditional-instructions";
import { executeWorkflow } from "../server/workflow";
import type { ConditionalInstruction } from "../src/lib/conditional-instructions";
import { DEFAULT_CONTEXT_POLICY } from "../src/lib/context";
import {
	type NodeOutput,
	type WorkflowRoutes,
	workflowRoutesSchema,
} from "../src/lib/routing";
import { configuredJevQuestion } from "./jev-question-fixture";

const rules: ConditionalInstruction[] = [
	{
		id: "vip",
		name: "VIP",
		instructions: "Offer priority service.",
		condition: { kind: "variable", name: "vip", value: true },
	},
	{
		id: "approved",
		name: "Approved",
		instructions: "Explain the approved refund.",
		condition: { kind: "decision", nodeId: "review", outputId: "yes" },
	},
];
const output: NodeOutput = {
	nodeId: "review",
	sourceNodeId: "review",
	revision: 1,
	kind: "jev",
	text: "yes",
	decision: { nodeId: "review", branch: "yes", status: "accepted" },
};

test("instruction activation uses selected typed values and accepted reached decisions only", () => {
	const resolve = (
		inputs = [output],
		variables = { vip: true },
		upstream: "all" | "none" = "all",
	) =>
		resolveInstructions({
			base: "Base",
			policy: { ...DEFAULT_CONTEXT_POLICY, instructions: rules, upstream },
			variables,
			inputs,
		});
	expect(resolve().instructions).toBe(
		"Base\n\nOffer priority service.\n\nExplain the approved refund.",
	);
	expect(resolve([], { vip: false }).instructions).toBe("Base");
	expect(
		resolve([output], { vip: false }, "none").trace.map(({ active }) => active),
	).toEqual([false, false]);
	for (const status of ["uncertain", "provider-error", "exhausted"] as const)
		expect(
			resolve(
				[
					{
						...output,
						decision: {
							...output.decision,
							nodeId: "review",
							branch: "yes",
							status,
						},
					},
				],
				{ vip: false },
			).instructions,
		).toBe("Base");
	expect(
		resolve(
			[
				{
					...output,
					revision: 2,
					decision: { nodeId: "review", branch: "no", status: "accepted" },
				},
			],
			{ vip: false },
		).instructions,
	).toBe("Base");
});

test("workflow resolves active instructions for both Jev and generation before context preparation", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{
				id: "input",
				kind: "input",
				fields: [
					{ name: "vip", type: "boolean", required: false, defaultValue: true },
				],
			},
			{
				id: "review",
				kind: "jev",
				question: configuredJevQuestion("noul"),
				variables: ["vip"],
				context: { ...DEFAULT_CONTEXT_POLICY, instructions: [rules[0]] },
			},
			{
				id: "answer",
				kind: "model",
				provider: "openai",
				model: "gpt-6-luna",
				variables: ["vip"],
				context: { ...DEFAULT_CONTEXT_POLICY, instructions: rules },
			},
		],
		edges: [
			{ id: "entry", source: "input", target: "review" },
			{
				id: "accepted",
				source: "review",
				sourceHandle: "yes",
				target: "answer",
			},
		],
	};
	expect(workflowRoutesSchema.safeParse(routes).success).toBe(true);
	const result = await executeWorkflow({
		routes,
		metadata: {},
		messages: [{ role: "user", content: "Can I return this?" }],
		evaluate: async (_, question) => {
			expect(question.instructions).toContain("Offer priority service.");
			return {
				type: "noul",
				branch: "yes",
				value: 0.99,
				confidence: 0.99,
				model: "jev-latest",
				latencyMs: 1,
			};
		},
		runModel: async ({ target }) => {
			expect(target.prompt).toContain("Explain the approved refund.");
			return { text: "Approved", model: target.model };
		},
		onDelta: () => {},
		onProgress: () => {},
		onRoute: () => {},
	});
	expect(
		result.contexts
			.find(({ nodeId }) => nodeId === "answer")
			?.instructions?.map(({ active }) => active),
	).toEqual([true, true]);
	const unselected = structuredClone(routes);
	const answer = unselected.nodes.find(({ id }) => id === "answer");
	if (answer?.kind === "model") answer.variables = [];
	expect(workflowRoutesSchema.safeParse(unselected).success).toBe(false);
	const downstream = structuredClone(routes);
	const review = downstream.nodes.find(({ id }) => id === "review");
	if (review?.kind === "jev")
		review.context = {
			...DEFAULT_CONTEXT_POLICY,
			instructions: [
				{
					...rules[1],
					condition: { kind: "decision", nodeId: "review", outputId: "yes" },
				},
			],
		};
	expect(workflowRoutesSchema.safeParse(downstream).success).toBe(false);
});
