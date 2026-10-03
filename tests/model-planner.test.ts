import { expect, test } from "bun:test";
import type { ContextContent } from "../server/context";
import {
	observeModelCache,
	planModel,
	prefixIdentity,
	quoteModels,
} from "../server/model-planner";
import { modelPrompt } from "../server/model-prompt";
import { SessionMemory } from "../server/session-memory";
import type { ModelRouting } from "../src/lib/model-routing";
import type { RouteTarget } from "../src/lib/routing";
import { approvedEvidence, quality } from "./routing-evidence-fixture";

const routing: ModelRouting = {
	mode: "automatic",
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
	expectedOutputTokens: 1,
	expectedRequests: 1,
};
const target: RouteTarget = {
	nodeId: "answer",
	provider: "openai",
	model: "gpt-6-luna",
	prompt: "Answer faithfully",
	reasoningEffort: "medium",
	maxOutputTokens: 100,
	routing,
};
const context: ContextContent = {
	messages: [{ role: "user", content: "Сколько стоит доставка?" }],
	inputs: [],
	documents: [
		{
			id: "document:delivery",
			sourceId: "delivery",
			kind: "document",
			label: "Доставка",
			representation: "full",
			content: "Правила доставки. ".repeat(6000),
		},
	],
};
const request = { target, context, variables: {}, evidence: approvedEvidence };
const available = new Set(["gpt-6-luna", "gemini-3.8-flash"]);

test("cold routes use known prices without inventing an implicit cache hit", () => {
	const { plan } = planModel(request, new SessionMemory(), available, "1");
	expect(plan.selectedModel).toBe("gpt-6-luna");
	expect(plan.candidates.map((quote) => quote.expectedCachedTokens)).toEqual([
		0, 0,
	]);
	expect(plan.candidates.map((quote) => quote.cache)).toEqual([
		"uncached",
		"implicit",
	]);
});

test("actual Gemini cache evidence can change the selected model and expires conservatively", () => {
	let now = 0;
	const memory = new SessionMemory(() => now);
	const google = {
		...target,
		provider: "google" as const,
		model: "gemini-3.8-flash",
	};
	const quotes = quoteModels(request, memory, available);
	observeModelCache(google, context, memory, quotes[1], {
		inputTokens: 60000,
		outputTokens: 1,
		cachedInputTokens: 60000,
	});
	expect(planModel(request, memory, available, "1").plan.selectedModel).toBe(
		"gemini-3.8-flash",
	);
	now += 5 * 60 * 1000;
	expect(planModel(request, memory, available, "2").plan.selectedModel).toBe(
		"gpt-6-luna",
	);
});

test("OpenAI writes are enabled only when the projected reuse justifies their premium", () => {
	const memory = new SessionMemory();
	const repeated = {
		...request,
		target: { ...target, routing: { ...routing, expectedRequests: 2 } },
	};
	const quote = quoteModels(repeated, memory, available)[0];
	expect(quote.cache).toBe("write");
	expect(quote.estimatedCostUsd).toBeGreaterThan(
		quoteModels(request, memory, available)[0].estimatedCostUsd ?? 0,
	);
	observeModelCache(target, context, memory, quote, {
		inputTokens: 60000,
		outputTokens: 1,
		cacheWriteTokens: 60000,
	});
	expect(quoteModels(request, memory, available)[0].cache).toBe("reuse");
	observeModelCache(target, context, memory, quote, {
		inputTokens: 60000,
		outputTokens: 1,
		cachedInputTokens: 0,
	});
	expect(quoteModels(request, memory, available)[0].cache).toBe("uncached");
});

test("changing source or reasoning invalidates cache identity and short prefixes receive no speculative discount", () => {
	const memory = new SessionMemory();
	memory.observePrefix(prefixIdentity(target, context).key, 50000, 10000);
	for (const changed of [
		{
			...request,
			target: {
				...target,
				reasoningEffort: "high" as const,
				routing: {
					...routing,
					candidates: [
						{ ...routing.candidates[0], reasoningEffort: "high" as const },
					],
				},
			},
		},
		{
			...request,
			context: {
				...context,
				documents: [
					{
						...context.documents[0],
						content: `${context.documents[0].content}Изменено`,
					},
				],
			},
		},
	]) {
		expect(
			quoteModels(changed, memory, available)[0].expectedCachedTokens,
		).toBe(0);
	}
	const short = { ...context, documents: [] };
	memory.observePrefix(prefixIdentity(target, short).key, 100, 10000);
	expect(
		quoteModels({ ...request, context: short }, memory, available)[0].cache,
	).toBe("uncached");
});

test("unavailable providers are excluded and custom rates apply only to their owning model", () => {
	const memory = new SessionMemory();
	expect(
		planModel(request, memory, new Set(["gemini-3.8-flash"]), "1").plan
			.selectedModel,
	).toBe("gemini-3.8-flash");
	expect(() => planModel(request, memory, new Set(), "1")).toThrow(
		"No model meets",
	);
	const custom = quoteModels(
		{ ...request, target: { ...target, pricing: { input: 10, output: 10 } } },
		memory,
		available,
	);
	expect(custom[0].estimatedCostUsd).toBeGreaterThan(
		custom[1].estimatedCostUsd ?? 0,
	);
	expect(custom[1]).toEqual(quoteModels(request, memory, available)[1]);
});

test("explicit cache breakpoints do not mutate configured example messages", () => {
	const configured = {
		...target,
		promptMessages: [{ role: "user" as const, content: "Example" }],
	};
	const original = structuredClone(configured);
	const prompt = modelPrompt(context.messages, configured, [], {}, [], "write");
	expect(prompt.messages[0].content).toEqual([
		{
			type: "text",
			text: "Example",
			providerOptions: {
				openai: { promptCacheBreakpoint: { mode: "explicit" } },
			},
		},
	]);
	expect(configured).toEqual(original);
	expect(
		modelPrompt(context.messages, configured, [], {}).messages[0].content,
	).toBe("Example");
});
