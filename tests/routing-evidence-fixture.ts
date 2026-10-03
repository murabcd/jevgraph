import type { RoutingEvaluator } from "../server/task-router";
import { resolveJevAnswer } from "../src/lib/jev-question";
import type { QualityPolicy, RouteEvidence } from "../src/lib/route-evidence";
export const quality: QualityPolicy = {
	criteria: "Preserve document terms and ask for missing order details",
	minimumCases: 5,
	minimumPassRate: 0.95,
	maximumLatencyMs: 20000,
};
export const approvedEvidence: RouteEvidence[] = [
	"gpt-6-luna",
	"gemini-3.8-flash",
].map((model) => ({
	model,
	reasoningEffort: "medium",
	attempts: 5,
	cases: 5,
	caseDistribution: "same-cases",
	reviewed: 5,
	passed: 5,
	passRate: 1,
	p95LatencyMs: 1000,
	meanCostUsd: 0.01,
	meanGenerationCostUsd: 0.01,
	meanModelAttempts: 1,
	costPerPassUsd: 0.01,
}));

export const approvedRoutingTask: RoutingEvaluator = async (
	_nodeId,
	questions,
) => ({
	answers: questions.map((question) =>
		resolveJevAnswer(
			question,
			{ type: "boolean", probability: 0.99 },
			undefined,
		),
	),
	model: "jev-1.13.0",
	latencyMs: 1,
	usage: { inputTokens: 100, outputTokens: 0 },
});
