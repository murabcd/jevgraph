import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import { experimental_evaluate } from "ai";
import { JEV_MODEL_ID } from "../src/lib/routing.ts";
import type { TokenUsage } from "../src/lib/usage.ts";
import type { ProviderAccess } from "./provider-access.ts";
import { evaluationUsage, ProviderUsageError } from "./provider-usage.ts";

/** Keep reported billing even when SDK answer validation rejects the response. */
export async function evaluateJev(
	request: Pick<
		Parameters<typeof experimental_evaluate>[0],
		"state" | "questions"
	>,
	access: ProviderAccess,
	timeoutMs: number,
) {
	if (!access.keys.TYPESAFE_API_KEY)
		throw new Error("TYPESAFE_API_KEY is not configured");
	const model = createTypeSafeAi({
		apiKey: access.keys.TYPESAFE_API_KEY,
		fetch: access.providerFetch,
	}).evaluationModel(JEV_MODEL_ID);
	let usage: TokenUsage | undefined;
	let modelId: string | undefined;
	try {
		return await experimental_evaluate({
			...request,
			model: {
				specificationVersion: model.specificationVersion,
				provider: model.provider,
				modelId: model.modelId,
				supportedQuestionTypes: model.supportedQuestionTypes,
				async doEvaluate(options) {
					const result = await model.doEvaluate(options);
					usage = evaluationUsage(result.usage ?? {});
					modelId = result.response?.modelId;
					return result;
				},
			},
			abortSignal: AbortSignal.any([
				access.signal,
				AbortSignal.timeout(timeoutMs),
			]),
			maxRetries: 0,
		});
	} catch (error) {
		throw new ProviderUsageError(error, usage, modelId);
	}
}
