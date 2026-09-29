import { z } from "zod";
import {
	evidenceCoverage,
	providerEvidenceSchema,
} from "./provider-evidence.ts";
import {
	type RouteTrace,
	routeResultSchema,
	routeTraceSchema,
} from "./routing.ts";

export const MAX_ARTIFACT_BYTES = 8_000_000;
export const emptyRouteTrace = (): RouteTrace => ({
	path: [],
	traversedEdges: [],
	jevSteps: [],
	outputs: [],
	calls: [],
	contexts: [],
	modelPlans: [],
});

export const runArtifactSchema = z
	.discriminatedUnion("status", [
		z.strictObject({
			status: z.literal("completed"),
			coverage: z.enum(["complete", "partial", "unavailable"]),
			result: routeResultSchema,
			providerEvidence: providerEvidenceSchema,
		}),
		z.strictObject({
			status: z.enum(["failed", "interrupted"]),
			providerEvidence: providerEvidenceSchema,
			text: z.string().max(240000),
			error: z.string().min(1).max(2000),
			latencyMs: z.number().finite().min(0),
			trace: routeTraceSchema,
			coverage: z.enum(["complete", "partial", "unavailable"]),
		}),
	])
	.superRefine((artifact, ctx) => {
		const trace =
			artifact.status === "completed" ? artifact.result : artifact.trace;
		if (
			artifact.coverage === "complete" &&
			evidenceCoverage(
				artifact.providerEvidence,
				trace.calls.map((call) => call.id),
			) !== "complete"
		)
			ctx.addIssue({
				code: "custom",
				message: "Complete evidence requires all recorded provider bodies",
			});
	});
export type RunArtifact = z.infer<typeof runArtifactSchema>;

export function artifactTrace(artifact: RunArtifact) {
	return artifact.status === "completed" ? artifact.result : artifact.trace;
}
