export const providers = ["openai", "google"] as const;
export type Provider = (typeof providers)[number];
export const reasoningEfforts = ["minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

export type CostBracket = "lowest" | "low" | "high" | "highest";

type ModelThinking =
	| {
			kind: "effort";
			efforts: readonly ReasoningEffort[];
			defaultEffort: ReasoningEffort;
	  }
	| {
			kind: "budget";
			minPositive: number;
			max: number;
			allowOff: boolean;
			defaultBudget: number;
	  }
	| { kind: "none" };

export type TextModel = {
	id: string;
	label: string;
	provider: Provider;
	costBracket: CostBracket;
	thinking: ModelThinking;
};

const noMinimalReasoning = ["low", "medium", "high"] as const;

export const textModels: TextModel[] = [
	{
		id: "gpt-5.4",
		label: "GPT-5.4",
		provider: "openai",
		costBracket: "highest",
		thinking: {
			kind: "effort",
			efforts: reasoningEfforts,
			defaultEffort: "medium",
		},
	},
	{
		id: "gpt-5.2",
		label: "GPT-5.2",
		provider: "openai",
		costBracket: "highest",
		thinking: {
			kind: "effort",
			efforts: reasoningEfforts,
			defaultEffort: "medium",
		},
	},
	{
		id: "gpt-5",
		label: "GPT-5",
		provider: "openai",
		costBracket: "high",
		thinking: {
			kind: "effort",
			efforts: reasoningEfforts,
			defaultEffort: "medium",
		},
	},
	{
		id: "gpt-5-mini",
		label: "GPT-5 Mini",
		provider: "openai",
		costBracket: "low",
		thinking: {
			kind: "effort",
			efforts: reasoningEfforts,
			defaultEffort: "medium",
		},
	},
	{
		id: "gpt-5-nano",
		label: "GPT-5 Nano",
		provider: "openai",
		costBracket: "lowest",
		thinking: {
			kind: "effort",
			efforts: reasoningEfforts,
			defaultEffort: "medium",
		},
	},
	{
		id: "gpt-4.1",
		label: "GPT-4.1",
		provider: "openai",
		costBracket: "high",
		thinking: { kind: "none" },
	},
	{
		id: "gemini-3.5-flash-lite",
		label: "Gemini 3.5 Flash Lite",
		provider: "google",
		costBracket: "low",
		thinking: {
			kind: "effort",
			efforts: reasoningEfforts,
			defaultEffort: "minimal",
		},
	},
	{
		id: "gemini-3.1-pro-preview",
		label: "Gemini 3.1 Pro Preview",
		provider: "google",
		costBracket: "high",
		thinking: {
			kind: "effort",
			efforts: noMinimalReasoning,
			defaultEffort: "high",
		},
	},
	{
		id: "gemini-3-flash-preview",
		label: "Gemini 3 Flash Preview",
		provider: "google",
		costBracket: "low",
		thinking: {
			kind: "effort",
			efforts: reasoningEfforts,
			defaultEffort: "high",
		},
	},
	{
		id: "gemini-2.5-pro",
		label: "Gemini 2.5 Pro",
		provider: "google",
		costBracket: "high",
		thinking: {
			kind: "budget",
			minPositive: 128,
			max: 32768,
			allowOff: false,
			defaultBudget: -1,
		},
	},
	{
		id: "gemini-2.5-flash",
		label: "Gemini 2.5 Flash",
		provider: "google",
		costBracket: "low",
		thinking: {
			kind: "budget",
			minPositive: 1,
			max: 24576,
			allowOff: true,
			defaultBudget: -1,
		},
	},
	{
		id: "gemini-2.5-flash-lite",
		label: "Gemini 2.5 Flash Lite",
		provider: "google",
		costBracket: "lowest",
		thinking: {
			kind: "budget",
			minPositive: 512,
			max: 24576,
			allowOff: true,
			defaultBudget: 0,
		},
	},
];

export function textModel(
	provider: Provider,
	modelId: string,
): TextModel | undefined {
	return textModels.find(
		(model) => model.provider === provider && model.id === modelId,
	);
}

export function providerForModel(modelId: string): Provider | undefined {
	return textModels.find((model) => model.id === modelId)?.provider;
}
