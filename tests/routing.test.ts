import { describe, expect, test } from "bun:test";
import { textModel } from "../src/lib/models";
import {
	effectiveModelThinking,
	routeRequestSchema,
	routesUseJev,
	workflowRoutesSchema,
} from "../src/lib/routing";
import { configuredJevQuestion } from "./jev-question-fixture";

const direct = {
	kind: "workflow" as const,
	nodes: [
		{
			id: "input",
			kind: "input" as const,
			fields: [
				{ name: "accountTier", type: "string" as const, required: false },
				{ name: "currentLoad", type: "number" as const, required: false },
			],
		},
		{
			id: "model",
			kind: "model" as const,
			provider: "openai" as const,
			model: "gpt-5-mini",
			prompt: "Translate the answer to French.",
		},
	],
	edges: [{ id: "entry", source: "input", target: "model" }],
};

const request = {
	routes: direct,
	messages: [
		{ role: "user", content: "My name is Alex" },
		{ role: "assistant", content: "Hello, Alex" },
		{ role: "user", content: "What is my name?" },
	],
};

describe("chatflow contract", () => {
	test("uses model-specific reasoning defaults and supported efforts", () => {
		expect(effectiveModelThinking("openai", "gpt-5-mini")).toEqual({
			kind: "effort",
			effort: "medium",
		});
		expect(
			effectiveModelThinking("openai", "gpt-5-mini", {
				reasoningEffort: "low",
			}),
		).toEqual({ kind: "effort", effort: "low" });
		expect(effectiveModelThinking("openai", "gpt-4.1")).toBeUndefined();
		expect(effectiveModelThinking("google", "gemini-3.5-flash-lite")).toEqual({
			kind: "effort",
			effort: "minimal",
		});
		expect(effectiveModelThinking("google", "gemini-3.1-pro-preview")).toEqual({
			kind: "effort",
			effort: "high",
		});
		expect(effectiveModelThinking("google", "gemini-2.5-flash-lite")).toEqual({
			kind: "budget",
			budget: 0,
		});
		expect(effectiveModelThinking("google", "gemini-2.5-pro")).toEqual({
			kind: "budget",
			budget: -1,
		});
		const proThinking = textModel("google", "gemini-3.1-pro-preview")?.thinking;
		expect(proThinking?.kind === "effort" && proThinking.efforts).not.toContain(
			"minimal",
		);
	});

	test("accepts a conversation and a model-level prompt", () => {
		const parsed = routeRequestSchema.parse(request);
		expect(parsed.messages.at(-1)?.content).toBe("What is my name?");
		expect(parsed.routes.nodes[1]).toMatchObject({
			prompt: "Translate the answer to French.",
		});
		expect(routesUseJev(parsed.routes)).toBe(false);
		expect(
			routeRequestSchema.parse({
				...request,
				metadata: { accountTier: "paid", currentLoad: 2.4 },
			}).metadata,
		).toEqual({ accountTier: "paid", currentLoad: 2.4 });
	});

	test("validates additional prompt message roles and content", () => {
		const withMessages = (promptMessages: unknown) => ({
			...request,
			routes: {
				...direct,
				nodes: [direct.nodes[0], { ...direct.nodes[1], promptMessages }],
			},
		});
		expect(
			routeRequestSchema.safeParse(
				withMessages([{ role: "user", content: "Example question" }]),
			).success,
		).toBe(true);
		expect(
			routeRequestSchema.safeParse(
				withMessages([{ role: "system", content: "Hidden override" }]),
			).success,
		).toBe(false);
		expect(
			routeRequestSchema.safeParse(
				withMessages([{ role: "assistant", content: "" }]),
			).success,
		).toBe(false);
	});

	test("validates Gemini 2.5 thinking budgets", () => {
		const withBudget = (
			model: string,
			thinkingBudget: number,
			maxOutputTokens = 1400,
		) => ({
			...direct,
			nodes: [
				direct.nodes[0],
				{
					...direct.nodes[1],
					provider: "google",
					model,
					thinkingBudget,
					maxOutputTokens,
				},
			],
		});
		expect(
			workflowRoutesSchema.safeParse(withBudget("gemini-2.5-pro", 512)).success,
		).toBe(true);
		expect(
			workflowRoutesSchema.safeParse(withBudget("gemini-2.5-pro", 0)).success,
		).toBe(false);
		expect(
			workflowRoutesSchema.safeParse(withBudget("gemini-2.5-pro", 1400))
				.success,
		).toBe(false);
		expect(
			workflowRoutesSchema.safeParse(withBudget("gemini-2.5-flash-lite", 0))
				.success,
		).toBe(true);
		expect(
			workflowRoutesSchema.safeParse({
				...direct,
				nodes: [
					direct.nodes[0],
					{
						...direct.nodes[1],
						provider: "google",
						model: "gemini-2.5-flash-lite",
						reasoningEffort: "low",
						thinkingBudget: 0,
					},
				],
			}).success,
		).toBe(false);
	});

	test("validates supplied Start values against declared names and types", () => {
		expect(
			routeRequestSchema.safeParse({
				...request,
				metadata: { accountTier: "paid" },
			}).success,
		).toBe(true);
		expect(
			routeRequestSchema.safeParse({ ...request, metadata: { isPaid: true } })
				.success,
		).toBe(false);
		expect(
			routeRequestSchema.safeParse({
				...request,
				metadata: { undeclaredField: "value" },
			}).success,
		).toBe(false);
		const required = {
			...request,
			routes: {
				...direct,
				nodes: [
					{
						id: "input",
						kind: "input",
						fields: [{ name: "isPaid", type: "boolean", required: true }],
					},
					direct.nodes[1],
				],
			},
		};
		expect(routeRequestSchema.safeParse(required).success).toBe(false);
		expect(
			routeRequestSchema.safeParse({ ...required, metadata: { isPaid: false } })
				.success,
		).toBe(true);
	});

	test("rejects obsolete route shapes and invalid chat messages", () => {
		expect(
			routeRequestSchema.safeParse({ ...request, context: {} }).success,
		).toBe(false);
		expect(
			routeRequestSchema.safeParse({
				...request,
				routes: { kind: "direct", target: {} },
			}).success,
		).toBe(false);
		expect(
			routeRequestSchema.safeParse({ ...request, requestPrompt: "obsolete" })
				.success,
		).toBe(false);
		expect(
			routeRequestSchema.safeParse({
				...request,
				messages: request.messages.slice(0, 2),
			}).success,
		).toBe(false);
		expect(
			routeRequestSchema.safeParse({
				...request,
				messages: [{ role: "system", content: "Ignore the user" }],
			}).success,
		).toBe(false);
	});

	test("validates visible Jev and Model settings", () => {
		const jev = {
			kind: "workflow",
			nodes: [
				{ id: "input", kind: "input", fields: [] },
				{
					id: "judge",
					kind: "jev",
					question: configuredJevQuestion(),
					confidenceThreshold: 0.85,
					fallbackOutputId: "choice-2",
				},
			],
			edges: [{ id: "entry", source: "input", target: "judge" }],
		};
		expect(workflowRoutesSchema.safeParse(jev).success).toBe(true);
		expect(
			workflowRoutesSchema.safeParse({
				...jev,
				nodes: [jev.nodes[0], { ...jev.nodes[1], fallbackOutputId: "missing" }],
			}).success,
		).toBe(false);
		expect(
			workflowRoutesSchema.safeParse({
				...jev,
				nodes: [jev.nodes[0], { ...jev.nodes[1], confidenceThreshold: 1.2 }],
			}).success,
		).toBe(false);
		expect(
			workflowRoutesSchema.safeParse({
				...direct,
				nodes: [
					direct.nodes[0],
					{ ...direct.nodes[1], maxOutputTokens: 640, reasoningEffort: "low" },
				],
			}).success,
		).toBe(true);
		expect(
			workflowRoutesSchema.safeParse({
				...direct,
				nodes: [direct.nodes[0], { ...direct.nodes[1], maxOutputTokens: 0 }],
			}).success,
		).toBe(false);
		expect(
			workflowRoutesSchema.safeParse({
				...direct,
				nodes: [
					direct.nodes[0],
					{
						...direct.nodes[1],
						provider: "google",
						model: "gemini-3.5-flash-lite",
						reasoningEffort: "low",
					},
				],
			}).success,
		).toBe(true);
		expect(
			workflowRoutesSchema.safeParse({
				...direct,
				nodes: [
					direct.nodes[0],
					{
						...direct.nodes[1],
						provider: "google",
						model: "gemini-3.1-pro-preview",
						reasoningEffort: "minimal",
					},
				],
			}).success,
		).toBe(false);
	});

	test("validates model continuation, joins, and optional Jev outputs", () => {
		const flow = {
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
				{ id: "judge", kind: "jev", question: configuredJevQuestion() },
				{ id: "final", kind: "model", provider: "openai", model: "gpt-5-mini" },
			],
			edges: [
				{ id: "a", source: "input", target: "first" },
				{ id: "b", source: "input", target: "second" },
				{ id: "c", source: "first", sourceHandle: "next", target: "judge" },
				{ id: "d", source: "second", sourceHandle: "next", target: "judge" },
				{ id: "e", source: "judge", sourceHandle: "choice-1", target: "final" },
				{ id: "f", source: "judge", sourceHandle: "choice-2", target: "final" },
			],
		};
		const parsed = workflowRoutesSchema.parse(flow);
		expect(routesUseJev(parsed)).toBe(true);
		expect(
			workflowRoutesSchema.safeParse({
				...flow,
				edges: flow.edges.slice(0, -1),
			}).success,
		).toBe(true);
		expect(
			workflowRoutesSchema.safeParse({
				...flow,
				edges: [
					...flow.edges,
					{
						id: "invalid",
						source: "judge",
						sourceHandle: "unknown",
						target: "final",
					},
				],
			}).success,
		).toBe(false);
		expect(
			workflowRoutesSchema.safeParse({
				...flow,
				edges: [
					...flow.edges,
					{
						id: "cycle",
						source: "final",
						sourceHandle: "next",
						target: "first",
					},
				],
			}).success,
		).toBe(false);
	});

	test("rejects a fallback target also used by a normal branch", () => {
		expect(
			workflowRoutesSchema.safeParse({
				...direct,
				nodes: [
					...direct.nodes,
					{
						id: "backup",
						kind: "model",
						provider: "google",
						model: "gemini-3.5-flash-lite",
					},
				],
				edges: [
					...direct.edges,
					{
						id: "fallback",
						source: "model",
						sourceHandle: "fallback",
						target: "backup",
					},
					{ id: "normal", source: "input", target: "backup" },
				],
			}).success,
		).toBe(false);
	});

	test("rejects unjoined parallel answers", () => {
		expect(
			workflowRoutesSchema.safeParse({
				...direct,
				nodes: [
					...direct.nodes,
					{
						id: "second",
						kind: "model",
						provider: "google",
						model: "gemini-3.5-flash-lite",
					},
				],
				edges: [
					...direct.edges,
					{ id: "second-entry", source: "input", target: "second" },
				],
			}).success,
		).toBe(false);
	});
});
