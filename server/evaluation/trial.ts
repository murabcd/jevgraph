import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { frozenCaseSchema } from "../../src/lib/evaluation-case.ts";
import {
	MAX_MODEL_CONFIGURATIONS,
	modelConfigurationIdSchema,
} from "../../src/lib/model-configuration.ts";
import { recordedReviewSchema } from "../../src/lib/quality-review.ts";
import { workflowRoutesSchema } from "../../src/lib/routing.ts";
import { runArtifactSchema } from "../../src/lib/run-artifact.ts";

export const MAX_EVALUATION_FILE_BYTES = 64_000_000;
export const MAX_EVALUATION_TRIALS = 100;
export const evaluationTrialSchema = z.strictObject({
	caseId: z.string().min(1).max(100),
	candidate: modelConfigurationIdSchema,
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
	candidates: z
		.array(modelConfigurationIdSchema)
		.min(1)
		.max(MAX_MODEL_CONFIGURATIONS)
		.refine((values) => new Set(values).size === values.length),
	repeats: evaluationTrialSchema.shape.repetition,
	split: z.enum(["dev", "test", "all"]),
	trials: z.array(evaluationTrialSchema).max(MAX_EVALUATION_TRIALS),
});
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;

export async function loadEvaluationRun(path: string) {
	const file = await stat(path);
	if (file.size > MAX_EVALUATION_FILE_BYTES)
		throw new Error("Evaluation file exceeds its 64 MB budget");
	return evaluationRunSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
