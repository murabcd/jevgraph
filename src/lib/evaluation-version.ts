import { RETRIEVAL_VERSION } from "./retrieval";

/** Bump these contracts when execution, prompts, or review semantics move. */
export const EVALUATION_VERSIONS = {
	runtime: "jevgraph:2",
	prompts: "node-context:1",
	evaluator: "criterion-review:1",
	retrieval: RETRIEVAL_VERSION,
};
