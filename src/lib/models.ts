export const providers = ["openai", "google"] as const;
export type Provider = (typeof providers)[number];
export const reasoningEfforts = [
	"none",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

export type TextModel = {
	id: string;
	label: string;
	provider: Provider;
	reasoning: {
		efforts: readonly ReasoningEffort[];
		defaultEffort: ReasoningEffort;
	};
};

export const textModels: TextModel[] = [
	{
		id: "gpt-6-luna",
		label: "GPT-6 Luna",
		provider: "openai",
		reasoning: {
			efforts: ["none", "low", "medium", "high", "xhigh", "max"],
			defaultEffort: "medium",
		},
	},
	{
		id: "gemini-3.8-flash",
		label: "Gemini 3.8 Flash",
		provider: "google",
		reasoning: {
			efforts: ["low", "medium", "high"],
			defaultEffort: "medium",
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
