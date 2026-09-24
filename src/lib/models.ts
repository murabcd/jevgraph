import type { Provider } from "./routing";

export type CostBracket = "lowest" | "low" | "high" | "highest";

type TextModel = {
	id: string;
	label: string;
	provider: Provider;
	costBracket: CostBracket;
};

export const textModels: TextModel[] = [
	{
		id: "gpt-5.4",
		label: "GPT-5.4",
		provider: "openai",
		costBracket: "highest",
	},
	{
		id: "gpt-5.2",
		label: "GPT-5.2",
		provider: "openai",
		costBracket: "highest",
	},
	{ id: "gpt-5", label: "GPT-5", provider: "openai", costBracket: "high" },
	{
		id: "gpt-5-mini",
		label: "GPT-5 Mini",
		provider: "openai",
		costBracket: "low",
	},
	{
		id: "gpt-5-nano",
		label: "GPT-5 Nano",
		provider: "openai",
		costBracket: "lowest",
	},
	{
		id: "gpt-4.1",
		label: "GPT-4.1",
		provider: "openai",
		costBracket: "high",
	},
	{
		id: "gemini-3.5-flash-lite",
		label: "Gemini 3.5 Flash Lite",
		provider: "google",
		costBracket: "low",
	},
	{
		id: "gemini-3.1-pro-preview",
		label: "Gemini 3.1 Pro Preview",
		provider: "google",
		costBracket: "high",
	},
	{
		id: "gemini-3-flash-preview",
		label: "Gemini 3 Flash Preview",
		provider: "google",
		costBracket: "low",
	},
	{
		id: "gemini-2.5-pro",
		label: "Gemini 2.5 Pro",
		provider: "google",
		costBracket: "high",
	},
	{
		id: "gemini-2.5-flash",
		label: "Gemini 2.5 Flash",
		provider: "google",
		costBracket: "low",
	},
	{
		id: "gemini-2.5-flash-lite",
		label: "Gemini 2.5 Flash Lite",
		provider: "google",
		costBracket: "lowest",
	},
];

export function providerForModel(modelId: string): Provider | undefined {
	return textModels.find((model) => model.id === modelId)?.provider;
}
