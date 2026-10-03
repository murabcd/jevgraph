import { z } from "zod";
import { RETRIEVAL_VERSION } from "./retrieval.ts";

/** Bump these contracts when execution, prompts, or review semantics move. */
export const EVALUATION_VERSIONS = {
	runtime: "jevgraph:7",
	prompts: "node-context:2",
	evaluator: "criterion-review:1",
	retrieval: RETRIEVAL_VERSION,
	providerSdk: "ai@7.0.113;openai@4.0.74;google@4.0.79;typesafe@3.0.6",
};

export const evaluationVersionsSchema = z.strictObject({
	runtime: z.string(),
	prompts: z.string(),
	evaluator: z.string(),
	retrieval: z.string(),
	providerSdk: z.string(),
});
