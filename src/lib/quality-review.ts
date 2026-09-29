import { z } from "zod";
import type { FrozenCase } from "./evaluation-case.ts";
import { EVALUATION_VERSIONS } from "./evaluation-version.ts";
import type { WorkflowRoutes } from "./routing.ts";
import { artifactTrace, type RunArtifact } from "./run-artifact.ts";

export function reviewCriteria(criteria: string) {
	return criteria
		.split("\n")
		.map((text) => text.trim())
		.filter(Boolean)
		.map((text, index) => ({ id: `criterion:${index + 1}`, text }));
}
const evidenceRefSchema = z.strictObject({
	id: z.string().min(1).max(100),
	sourceId: z.string().min(1).max(250),
	quote: z.string().trim().min(1).max(2000),
});
const judgementSchema = z.strictObject({
	reason: z.string().trim().min(1).max(2000),
	evidence: z
		.array(evidenceRefSchema)
		.max(8)
		.refine(
			(refs) => new Set(refs.map((ref) => ref.id)).size === refs.length,
			"Evidence identities must be unique",
		),
});
export const qualityReviewSchema = z.strictObject({
	version: z.literal(EVALUATION_VERSIONS.evaluator),
	criteria: z
		.array(
			judgementSchema.extend({
				id: z.string().min(1).max(100),
				verdict: z.enum(["pass", "fail", "insufficient-evidence"]),
			}),
		)
		.min(1)
		.max(20),
	task: judgementSchema.extend({
		outcome: z.enum(["resolved", "handoff", "unresolved", "unknown"]),
	}),
	reaction: judgementSchema.extend({
		outcome: z.enum(["positive", "negative", "mixed", "unknown"]),
	}),
});
export type QualityReview = z.infer<typeof qualityReviewSchema>;
export type ReviewSource = { id: string; label: string; text: string };

export function reviewSources(
	input: FrozenCase,
	routes: WorkflowRoutes,
	artifact: RunArtifact,
	followup?: { id: string; content: string },
): ReviewSource[] {
	const start = routes.nodes.find((node) => node.kind === "input");
	const trace = artifactTrace(artifact);
	return [
		{
			id: "answer",
			label: "Final answer",
			text:
				artifact.status === "completed" ? artifact.result.text : artifact.text,
		},
		...input.messages.map((message, index) => ({
			id: `input:${index}`,
			label: `Submitted ${message.role} ${index + 1}`,
			text: message.content,
		})),
		...Object.entries(input.metadata ?? {}).map(([id, value]) => ({
			id: `field:${id}`,
			label: `Start ${id}`,
			text: String(value),
		})),
		...(start?.kind === "input" ? (start.documents ?? []) : []).map(
			(document) => ({
				id: `document:${document.id}`,
				label: document.name,
				text: document.content,
			}),
		),
		...input.history.sources.map((source) => ({
			id: `history:${source.id}`,
			label: source.label,
			text: source.content,
		})),
		{
			id: "path",
			label: "Reached path and edges",
			text: JSON.stringify({
				path: trace.path,
				traversedEdges: trace.traversedEdges,
			}),
		},
		...trace.jevSteps.map((step, index) => ({
			id: `decision:${step.nodeId}:${index + 1}`,
			label: `${step.nodeId} decision ${index + 1}`,
			text: JSON.stringify(step),
		})),
		...trace.outputs.map((output) => ({
			id: `output:${output.nodeId}:${output.revision}`,
			label: `${output.nodeId} revision ${output.revision}`,
			text: output.text,
		})),
		...trace.calls.map((call) => ({
			id: `call:${call.id}`,
			label: `${call.id} ${call.model} ${call.purpose}`,
			text: JSON.stringify(call),
		})),
		...artifact.providerEvidence.flatMap((exchange) => [
			{
				id: `${exchange.id}:request`,
				label: `${exchange.callId} request (${exchange.request.complete ? "complete" : "partial"})`,
				text: exchange.request.text,
			},
			{
				id: `${exchange.id}:response`,
				label: `${exchange.callId} response (${exchange.response.complete ? "complete" : "partial"})`,
				text: exchange.response.text,
			},
		]),
		...(followup
			? [
					{
						id: `reaction:${followup.id}`,
						label: "Later user message",
						text: followup.content,
					},
				]
			: []),
	];
}

/** Validates provenance; semantic truth remains an explicit owner judgement. */
export function validateQualityReview(
	review: QualityReview,
	criteria: string,
	artifact: RunArtifact,
	sources: ReviewSource[],
): boolean | undefined {
	const expected = reviewCriteria(criteria);
	if (
		review.criteria.length !== expected.length ||
		review.criteria.some((item, index) => item.id !== expected[index].id)
	)
		throw new Error(
			"Review must cover each configured criterion exactly once in order",
		);
	const byId = new Map(sources.map((source) => [source.id, source]));
	for (const judgement of [...review.criteria, review.task, review.reaction]) {
		for (const ref of judgement.evidence)
			if (!byId.get(ref.sourceId)?.text.includes(ref.quote))
				throw new Error("Evidence quote is not present in its recorded source");
	}
	for (const criterion of review.criteria)
		if (
			criterion.verdict !== "insufficient-evidence" &&
			!criterion.evidence.length
		)
			throw new Error("A pass or fail criterion requires recorded evidence");
	if (review.task.outcome !== "unknown" && !review.task.evidence.length)
		throw new Error("Task outcome requires recorded evidence");
	if (
		review.reaction.outcome !== "unknown" &&
		(!review.reaction.evidence.length ||
			review.reaction.evidence.some(
				(ref) => !ref.sourceId.startsWith("reaction:"),
			))
	)
		throw new Error("User reaction requires a later user message");
	if (
		artifact.status !== "completed" ||
		artifact.result.outcome !== "completed"
	)
		return false;
	if (review.criteria.some((item) => item.verdict === "fail")) return false;
	if (
		artifact.coverage !== "complete" ||
		review.criteria.some((item) => item.verdict === "insufficient-evidence")
	)
		return undefined;
	return true;
}

export const recordedReviewSchema = z.strictObject({
	value: qualityReviewSchema,
	reviewerId: z.string().min(1).max(100),
	reviewedAt: z.number().int().min(0),
	expiresAt: z.number().int().min(0),
});
