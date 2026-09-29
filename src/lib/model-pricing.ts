import type { Pricing, ProviderCall } from "./usage.ts";

export type PublishedPricing = {
	provider: ProviderCall["provider"];
	model: string;
	aliases?: readonly string[];
	rates: Pricing;
	longContext?: { aboveInputTokens: number; rates: Pricing };
	scheduled?: { effectiveAt: string; rates: Pricing };
	source: string;
	verifiedAt: string;
};

export const JEV_PUBLISHED_PRICING: PublishedPricing = {
	provider: "jev",
	model: "jev-1.13.0",
	aliases: ["jev-latest", "jev-preview"],
	rates: { input: 0.042, output: 0 },
	source: "https://docs.typesafe.ai/models",
	verifiedAt: "2026-09-28",
};

const publishedPrices: readonly PublishedPricing[] = [
	JEV_PUBLISHED_PRICING,
	{
		provider: "openai",
		model: "text-embedding-3-small",
		rates: { input: 0.02, output: 0 },
		source:
			"https://developers.openai.com/api/docs/models/text-embedding-3-small",
		verifiedAt: "2026-09-29",
	},
	{
		provider: "openai",
		model: "gpt-6-luna",
		rates: { input: 0.1, output: 0.5, cachedInput: 0.01, cacheWrite: 0.125 },
		longContext: {
			aboveInputTokens: 272000,
			rates: { input: 0.2, output: 0.75, cachedInput: 0.02, cacheWrite: 0.25 },
		},
		source: "https://developers.openai.com/api/docs/models/gpt-6-luna",
		verifiedAt: "2026-09-29",
	},
	{
		provider: "google",
		model: "gemini-3.8-flash",
		rates: { input: 0.75, output: 3.75, cachedInput: 0.075 },
		scheduled: {
			effectiveAt: "2027-01-01T00:00:00Z",
			rates: { input: 1.5, output: 7.5, cachedInput: 0.15 },
		},
		source: "https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash",
		verifiedAt: "2026-09-29",
	},
];

export function publishedPricing(
	provider: ProviderCall["provider"],
	model: string,
	at = new Date(),
): PublishedPricing | undefined {
	const price = publishedPrices.find(
		(item) =>
			item.provider === provider &&
			(item.model === model || item.aliases?.includes(model)),
	);
	if (!price) return undefined;
	return price.scheduled &&
		at.getTime() >= Date.parse(price.scheduled.effectiveAt)
		? { ...price, rates: price.scheduled.rates }
		: price;
}

export function publishedRates(
	provider: ProviderCall["provider"],
	model: string,
	inputTokens = 0,
	at = new Date(),
): Pricing | undefined {
	const price = publishedPricing(provider, model, at);
	return price?.longContext && inputTokens > price.longContext.aboveInputTokens
		? price.longContext.rates
		: price?.rates;
}
