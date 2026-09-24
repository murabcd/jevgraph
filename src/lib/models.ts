import type { Provider } from "./routing";

export const textModels: { id: string; label: string; provider: Provider }[] = [
	{ id: "gpt-5.4", label: "GPT-5.4", provider: "openai" },
	{ id: "gpt-5.2", label: "GPT-5.2", provider: "openai" },
	{ id: "gpt-5", label: "GPT-5", provider: "openai" },
	{ id: "gpt-5-mini", label: "GPT-5 Mini", provider: "openai" },
	{ id: "gpt-5-nano", label: "GPT-5 Nano", provider: "openai" },
	{ id: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
	{
		id: "gemini-3.5-flash-lite",
		label: "Gemini 3.5 Flash Lite",
		provider: "google",
	},
	{
		id: "gemini-3.1-pro-preview",
		label: "Gemini 3.1 Pro Preview",
		provider: "google",
	},
	{
		id: "gemini-3-flash-preview",
		label: "Gemini 3 Flash Preview",
		provider: "google",
	},
	{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
	{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
	{
		id: "gemini-2.5-flash-lite",
		label: "Gemini 2.5 Flash Lite",
		provider: "google",
	},
];

export function providerForModel(modelId: string): Provider | undefined {
	return textModels.find((model) => model.id === modelId)?.provider;
}
