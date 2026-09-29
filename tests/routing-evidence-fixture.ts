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
