import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { frozenCaseSchema } from "../../src/lib/evaluation-case.ts";
import { recordedReviewSchema } from "../../src/lib/quality-review.ts";
import { workflowRoutesSchema } from "../../src/lib/routing.ts";
import { runArtifactSchema } from "../../src/lib/run-artifact.ts";

export const MAX_EVALUATION_FILE_BYTES = 64_000_000;
export const evaluationTrialSchema = z.strictObject({
	caseId: z.string().min(1).max(100),
	candidate: z.string().min(1).max(100),
	repetition: z.number().int().min(1).max(3),
	runId: z.string().max(100).optional(),
	error: z.string().max(2000).optional(),
	record: z
		.strictObject({
			input: frozenCaseSchema,
			credentialScope: z.string().length(64).nullable(),
			routes: workflowRoutesSchema,
			artifact: runArtifactSchema.nullable(),
			review: recordedReviewSchema.optional(),
			followup: z
				.strictObject({ id: z.string(), content: z.string().max(12000) })
				.optional(),
		})
		.nullable(),
});
export type EvaluationTrial = z.infer<typeof evaluationTrialSchema>;
export const evaluationRunSchema = z.strictObject({
	datasetKey: z.string().length(64),
	startedAt: z.iso.datetime(),
	candidates: z.array(z.string().min(1).max(100)).min(1).max(2),
	repeats: z.number().int().min(1).max(3),
	split: z.enum(["dev", "test", "all"]),
	trials: z.array(evaluationTrialSchema).max(100),
});
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;

export async function loadEvaluationRun(path: string) {
	const file = await stat(path);
	if (file.size > MAX_EVALUATION_FILE_BYTES)
		throw new Error("Evaluation file exceeds its 64 MB budget");
	return evaluationRunSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
