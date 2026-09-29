import { z } from "zod";
import {
	type RouteTrace,
	routeResultSchema,
	routeTraceSchema,
} from "./routing";

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

export const runArtifactSchema = z.discriminatedUnion("status", [
	z.strictObject({ status: z.literal("completed"), result: routeResultSchema }),
	z.strictObject({
		status: z.enum(["failed", "interrupted"]),
		text: z.string().max(240000),
		error: z.string().min(1).max(2000),
		latencyMs: z.number().finite().min(0),
		trace: routeTraceSchema,
		coverage: z.enum(["complete", "partial", "unavailable"]),
	}),
]);
export type RunArtifact = z.infer<typeof runArtifactSchema>;

export function artifactTrace(artifact: RunArtifact) {
	return artifact.status === "completed" ? artifact.result : artifact.trace;
}
