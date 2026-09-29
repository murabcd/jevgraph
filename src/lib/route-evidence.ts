import { z } from "zod";
import { contentHash } from "./content-identity.ts";
import type { ContextDocument } from "./context.ts";
import { EVALUATION_VERSIONS } from "./evaluation-version.ts";
import type { RouteTrace, WorkflowRoutes } from "./routing.ts";
import { totalUsage } from "./usage.ts";

export const EVIDENCE_TTL_MS = 30 * 86400000;
export const MAX_EVALUATIONS = 256;
export const qualityPolicySchema = z.strictObject({
	criteria: z
		.string()
		.trim()
		.min(1)
		.max(2000)
		.refine(
			(text) => text.split("\n").filter((line) => line.trim()).length <= 20,
			"Use at most twenty review criteria",
		),
	minimumCases: z.number().int().min(5).max(100),
	minimumPassRate: z.number().min(0.5).max(1),
	maximumLatencyMs: z.number().int().min(100).max(120000),
});
export type QualityPolicy = z.infer<typeof qualityPolicySchema>;
export const routeEvidenceSchema = z.strictObject({
	model: z.string(),
	attempts: z.number().int().min(1),
	cases: z.number().int().min(1),
	caseDistribution: z.string().max(20000),
	reviewed: z.number().int().min(0),
	passed: z.number().int().min(0),
	passRate: z.number().min(0).max(1),
	p95LatencyMs: z.number().finite().min(0),
	meanCostUsd: z.number().finite().min(0).optional(),
	meanGenerationCostUsd: z.number().finite().min(0).optional(),
	meanModelAttempts: z.number().finite().min(0),
	costPerPassUsd: z.number().finite().min(0).optional(),
});
export type RouteEvidence = z.infer<typeof routeEvidenceSchema>;
export const routeEvaluationSchema = z.strictObject({
	nodeId: z.string(),
	key: z.string().length(64),
	model: z.string(),
	criteria: z.string().min(1).max(2000),
	latencyMs: z.number().finite().min(0),
	completed: z.boolean(),
	costUsd: z.number().finite().min(0).optional(),
	generationCostUsd: z.number().finite().min(0).optional(),
	modelAttempts: z.number().int().min(0),
});
export type RouteEvaluation = z.infer<typeof routeEvaluationSchema>;

/** Identifies a complete graph strategy with one model candidate varied. */
export async function routeEvidenceKey(
	routes: WorkflowRoutes,
	nodeId: string,
	documents?: ContextDocument[],
): Promise<string> {
	const node = routes.nodes.find((node) => node.id === nodeId);
	if (node?.kind !== "model" || !node.routing)
		throw new Error("Evaluation requires model routing settings");
	return contentHash(
		JSON.stringify({
			versions: EVALUATION_VERSIONS,
			nodeId,
			criteria: node.routing.quality.criteria,
			nodes: routes.nodes
				.toSorted((a, b) => a.id.localeCompare(b.id))
				.map((item) => {
					if (item.kind === "input")
						return { ...item, documents: documents ?? item.documents ?? [] };
					if (item.id === nodeId)
						return {
							...item,
							provider: undefined,
							model: undefined,
							routing: undefined,
							pricing: undefined,
						};
					return item;
				}),
			edges: routes.edges.toSorted((a, b) =>
				JSON.stringify(a).localeCompare(JSON.stringify(b)),
			),
		}),
	);
}

export async function routeEvaluations(
	routes: WorkflowRoutes,
	trace: RouteTrace,
	latencyMs: number,
	completed: boolean,
): Promise<RouteEvaluation[]> {
	const usage = totalUsage(trace.calls);
	return Promise.all(
		routes.nodes.flatMap((node) => {
			if (
				node.kind !== "model" ||
				node.routing?.mode !== "evaluate" ||
				(completed && !trace.path.some((step) => step.nodeId === node.id))
			)
				return [];
			const criteria = node.routing.quality.criteria;
			const calls = trace.calls.filter(
				(call) => call.nodeId === node.id && call.purpose === "model",
			);
			const generation = totalUsage(calls);
			return [
				routeEvidenceKey(routes, node.id).then((key) => ({
					nodeId: node.id,
					key,
					model: node.model,
					criteria,
					latencyMs,
					completed,
					costUsd:
						trace.calls.length && usage.costComplete
							? (usage.estimatedCostUsd ?? 0)
							: undefined,
					generationCostUsd: generation.costComplete
						? (generation.estimatedCostUsd ?? 0)
						: undefined,
					modelAttempts: calls.length,
				})),
			];
		}),
	);
}

export function summarizeRouteEvidence(
	rows: (RouteEvaluation & { caseKey: string; passed?: boolean })[],
): RouteEvidence[] {
	const models = new Set(rows.map((row) => row.model));
	return Array.from(models, (model) => {
		const samples = rows.filter((row) => row.model === model);
		const reviewed = samples.filter((row) => row.passed !== undefined);
		const passed = reviewed.filter((row) => row.passed).length;
		const latencies = samples
			.map((row) => row.latencyMs)
			.toSorted((a, b) => a - b);
		const known = samples.every(
			(row) => row.costUsd !== undefined && row.generationCostUsd !== undefined,
		);
		const total = samples.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
		return {
			model,
			attempts: samples.length,
			cases: new Set(samples.map((row) => row.caseKey)).size,
			caseDistribution: JSON.stringify(
				Array.from(new Set(samples.map((row) => row.caseKey)))
					.sort()
					.map((key) => [
						key,
						samples.filter((row) => row.caseKey === key).length,
					]),
			),
			reviewed: reviewed.length,
			passed,
			passRate: passed / samples.length,
			p95LatencyMs: latencies[Math.ceil(latencies.length * 0.95) - 1],
			meanCostUsd: known ? total / samples.length : undefined,
			meanGenerationCostUsd: known
				? samples.reduce((sum, row) => sum + (row.generationCostUsd ?? 0), 0) /
					samples.length
				: undefined,
			meanModelAttempts:
				samples.reduce((sum, row) => sum + row.modelAttempts, 0) /
				samples.length,
			costPerPassUsd: known && passed ? total / passed : undefined,
		};
	});
}
