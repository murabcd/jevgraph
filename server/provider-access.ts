import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import type { Provider } from "../src/lib/models.ts";
import { JEV_MODEL_ID } from "../src/lib/routing.ts";

export type ProviderKeys = {
	TYPESAFE_API_KEY?: string;
	OPENAI_API_KEY?: string;
	GOOGLE_GENERATIVE_AI_API_KEY?: string;
};
export type ProviderFetch = NonNullable<
	Parameters<typeof createOpenAI>[0]
>["fetch"];
export type ProviderAccess = {
	keys: ProviderKeys;
	signal: AbortSignal;
	providerFetch?: ProviderFetch;
};

export function languageModelFor(
	provider: Provider,
	id: string,
	{ keys, providerFetch }: ProviderAccess,
) {
	const key =
		provider === "openai"
			? keys.OPENAI_API_KEY
			: keys.GOOGLE_GENERATIVE_AI_API_KEY;
	if (!key)
		throw new Error(
			`${
				provider === "openai"
					? "OPENAI_API_KEY"
					: "GOOGLE_GENERATIVE_AI_API_KEY"
			} is not configured`,
		);
	return provider === "openai"
		? createOpenAI({ apiKey: key, fetch: providerFetch })(id)
		: createGoogle({ apiKey: key, fetch: providerFetch })(id);
}

export function evaluationModelFor({ keys, providerFetch }: ProviderAccess) {
	if (!keys.TYPESAFE_API_KEY)
		throw new Error("TYPESAFE_API_KEY is not configured");
	return createTypeSafeAi({
		apiKey: keys.TYPESAFE_API_KEY,
		fetch: providerFetch,
	}).evaluationModel(JEV_MODEL_ID);
}
