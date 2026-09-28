import { describe, expect, test } from "bun:test";
import { publishedRates } from "../src/lib/model-pricing";
import { textModels } from "../src/lib/models";
import {
	estimateCost,
	formatCostUsd,
	type ProviderCall,
	totalUsage,
} from "../src/lib/usage";

const call: ProviderCall = {
	id: "1",
	nodeId: "draft",
	purpose: "model",
	provider: "openai",
	model: "test",
	status: "completed",
	durationMs: 1,
	usage: {
		inputTokens: 100,
		outputTokens: 20,
		cachedInputTokens: 40,
		cacheWriteTokens: 10,
		reasoningTokens: 8,
	},
};

describe("workflow accounting", () => {
	test("prices Jev input at its published rate with free output and preserves small costs", () => {
		const pricing = publishedRates("jev", "jev-1.13.0");
		const cost = estimateCost({ inputTokens: 835, outputTokens: 54 }, pricing);
		expect(cost).toBeCloseTo(0.00003507, 10);
		expect(formatCostUsd(cost ?? 0)).toBe("$0.00003507");
		expect(
			estimateCost({ inputTokens: 835, outputTokens: 9999 }, pricing),
		).toBe(cost);
		expect(publishedRates("jev", "jev-latest")).toEqual(pricing);
		expect(publishedRates("jev", "jev-2.0.0")).toBeUndefined();
	});
	test("covers only the current picker with provider-scoped published prices", () => {
		expect(textModels.map(({ id }) => id)).toEqual([
			"gpt-6-luna",
			"gemini-3.8-flash",
		]);
		for (const model of textModels)
			expect(publishedRates(model.provider, model.id)).toBeDefined();
		expect(publishedRates("google", "gpt-6-luna")).toBeUndefined();
		expect(publishedRates("openai", "gpt-5-mini")).toBeUndefined();
	});
	test("prices cached reads, writes and output without double-counting reasoning", () => {
		const usage = {
			inputTokens: 1000000,
			outputTokens: 100000,
			cachedInputTokens: 200000,
			cacheWriteTokens: 100000,
			reasoningTokens: 50000,
		};
		const at = new Date("2026-09-29T12:00:00Z");
		expect(
			estimateCost(
				usage,
				publishedRates("openai", "gpt-6-luna", usage.inputTokens, at),
			),
		).toBeCloseTo(0.244, 8);
		expect(
			estimateCost(
				{ ...usage, cacheWriteTokens: 0 },
				publishedRates("google", "gemini-3.8-flash", usage.inputTokens, at),
			),
		).toBeCloseTo(0.99, 8);
	});
	test("switches Luna rates above 272K total input, including cached tokens", () => {
		const at = new Date("2026-09-29T12:00:00Z");
		const short = {
			inputTokens: 272000,
			outputTokens: 1000,
			cachedInputTokens: 200000,
		};
		const long = { ...short, inputTokens: 272001 };
		expect(
			estimateCost(
				short,
				publishedRates("openai", "gpt-6-luna", short.inputTokens, at),
			),
		).toBeCloseTo(0.0097, 8);
		expect(
			estimateCost(
				long,
				publishedRates("openai", "gpt-6-luna", long.inputTokens, at),
			),
		).toBeCloseTo(0.0191502, 8);
	});
	test("applies Gemini's announced January price change at the UTC boundary", () => {
		expect(
			publishedRates(
				"google",
				"gemini-3.8-flash",
				100,
				new Date("2026-12-31T23:59:59Z"),
			),
		).toEqual({ input: 0.75, output: 3.75, cachedInput: 0.075 });
		expect(
			publishedRates(
				"google",
				"gemini-3.8-flash",
				100,
				new Date("2027-01-01T00:00:00Z"),
			),
		).toEqual({ input: 1.5, output: 7.5, cachedInput: 0.15 });
	});
	test("uses cached read/write rates and counts reasoning inside total output only once", () => {
		expect(
			estimateCost(call.usage, {
				input: 2,
				output: 10,
				cachedInput: 0.5,
				cacheWrite: 3,
			}),
		).toBeCloseTo(0.00035, 8);
		expect(estimateCost(call.usage, { input: 2, output: 10 })).toBeUndefined();
	});
	test("adds every reported call while retaining unknown failed attempts", () => {
		const usage = totalUsage([
			{ ...call, estimatedCostUsd: 0.00035 },
			{
				...call,
				id: "2",
				usage: { inputTokens: 25, outputTokens: 0 },
				estimatedCostUsd: 0.00005,
			},
			{ ...call, id: "3", status: "failed", usage: undefined },
		]);
		expect(usage).toMatchObject({
			inputTokens: 125,
			outputTokens: 20,
			cachedInputTokens: 40,
			reasoningTokens: 8,
			complete: false,
			costComplete: false,
		});
		expect(usage.estimatedCostUsd).toBeCloseTo(0.0004, 8);
	});
	test("zero reported usage differs from missing usage", () => {
		expect(
			totalUsage([
				{
					...call,
					usage: { inputTokens: 0, outputTokens: 0 },
					estimatedCostUsd: 0,
				},
			]),
		).toMatchObject({
			inputTokens: 0,
			outputTokens: 0,
			complete: true,
			estimatedCostUsd: 0,
			costComplete: true,
		});
		expect(totalUsage([{ ...call, usage: undefined }])).toEqual({
			complete: false,
			costComplete: false,
		});
	});
});
