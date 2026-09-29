import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { EVALUATION_VERSIONS } from "../../src/lib/evaluation-version.ts";
import {
	qualityReviewSchema,
	reviewCriteria,
	reviewSources,
} from "../../src/lib/quality-review.ts";
import { EVIDENCE_TTL_MS } from "../../src/lib/route-evidence.ts";
import type { EvaluationDataset } from "./dataset.ts";
import type { EvaluationRun } from "./trial.ts";

export const localLabelsSchema = z.strictObject({
	reviewer: z.string().trim().min(1).max(94),
	reviewedAt: z.iso.datetime(),
	judgements: z
		.array(
			z.strictObject({
				caseId: z.string(),
				candidate: z.string(),
				repetition: z.number().int().min(1).max(3),
				review: qualityReviewSchema,
			}),
		)
		.max(100),
});

export function labelTemplate(
	dataset: EvaluationDataset,
	run: EvaluationRun,
): z.input<typeof localLabelsSchema> {
	return {
		reviewer: "",
		reviewedAt: new Date().toISOString(),
		judgements: run.trials
			.filter((trial) => trial.record?.artifact)
			.map((trial) => {
				const node = trial.record?.routes.nodes.find(
					(node) => node.id === dataset.evaluationNodeId,
				);
				if (node?.kind !== "model" || !node.routing)
					throw new Error("Evaluated node unavailable");
				return {
					caseId: trial.caseId,
					candidate: trial.candidate,
					repetition: trial.repetition,
					review: {
						version: EVALUATION_VERSIONS.evaluator,
						criteria: reviewCriteria(node.routing.quality.criteria).map(
							(criterion) => ({
								id: criterion.id,
								verdict: "insufficient-evidence",
								reason: "Not assessed",
								evidence: [],
							}),
						),
						task: { outcome: "unknown", reason: "Not assessed", evidence: [] },
						reaction: {
							outcome: "unknown",
							reason: "No assessed later user message",
							evidence: [],
						},
					},
				};
			}),
	};
}

export function labelSources(dataset: EvaluationDataset, run: EvaluationRun) {
	return run.trials.flatMap((trial) => {
		const record = trial.record;
		if (!record?.artifact) return [];
		return [
			{
				caseId: trial.caseId,
				candidate: trial.candidate,
				repetition: trial.repetition,
				expectations: dataset.cases.find((item) => item.id === trial.caseId)
					?.expectations,
				sources: reviewSources(
					record.input,
					record.routes,
					record.artifact,
					record.followup,
				),
			},
		];
	});
}

/** Offline human labels affect this report only; they never write routing approvals. */
export async function applyLocalLabels(
	path: string,
	run: EvaluationRun,
): Promise<EvaluationRun> {
	if ((await stat(path)).size > 2_000_000)
		throw new Error("Labels exceed two million bytes");
	const labels = localLabelsSchema.parse(
		JSON.parse(await readFile(path, "utf8")),
	);
	const reviewedAt = Date.parse(labels.reviewedAt);
	if (reviewedAt < Date.parse(run.startedAt) || reviewedAt > Date.now())
		throw new Error(
			"Review time must follow execution and cannot be in the future",
		);
	const bySlot = new Map(
		labels.judgements.map((item) => [
			JSON.stringify([item.caseId, item.candidate, item.repetition]),
			item.review,
		]),
	);
	if (bySlot.size !== labels.judgements.length)
		throw new Error("Duplicate local review slot");
	const trials = run.trials.map((trial) => {
		const slot = JSON.stringify([
			trial.caseId,
			trial.candidate,
			trial.repetition,
		]);
		const review = bySlot.get(slot);
		if (!review) return trial;
		if (!trial.record?.artifact)
			throw new Error("A local review needs recorded evidence");
		bySlot.delete(slot);
		return {
			...trial,
			record: {
				...trial.record,
				review: {
					value: review,
					reviewerId: `local:${labels.reviewer}`,
					reviewedAt,
					expiresAt: reviewedAt + EVIDENCE_TTL_MS,
				},
			},
		};
	});
	if (bySlot.size) throw new Error("Local labels refer to unrecorded trials");
	return { ...run, trials };
}
