import { v } from "convex/values";
import { routeEvaluations } from "../src/lib/route-evidence";
import { workflowRoutesSchema } from "../src/lib/routing";
import {
	artifactTrace,
	MAX_ARTIFACT_BYTES,
	runArtifactSchema,
} from "../src/lib/run-artifact";
import { runFooter } from "../src/lib/run-footer";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

export const save = action({
	args: { runId: v.id("runs"), executionId: v.string(), result: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.runQuery(internal.runs.owned, { runId: args.runId });
		if (new TextEncoder().encode(args.result).length > MAX_ARTIFACT_BYTES)
			throw new Error("Run result is too large to save");
		if (run.executionId !== args.executionId)
			throw new Error("This execution no longer owns the run");
		const artifact = runArtifactSchema.parse(JSON.parse(args.result));
		const trace = artifactTrace(artifact);
		const evaluations = await routeEvaluations(
			workflowRoutesSchema.parse(JSON.parse(run.routes)),
			trace,
			artifact.status === "completed"
				? artifact.result.latencyMs
				: artifact.latencyMs,
			artifact.status === "completed" &&
				artifact.result.outcome === "completed",
		);
		const settlement = {
			runId: args.runId,
			executionId: args.executionId,
			content:
				artifact.status === "completed" ? artifact.result.text : artifact.text,
			status: artifact.status,
			error: artifact.status === "completed" ? undefined : artifact.error,
			footer:
				artifact.status === "completed"
					? JSON.stringify(runFooter(artifact.result))
					: undefined,
			evaluations: JSON.stringify(evaluations),
		};
		const resultFile = await ctx.storage.store(
			new Blob([JSON.stringify(artifact)], { type: "application/json" }),
		);
		try {
			await ctx.runMutation(internal.runs.settleArtifact, {
				...settlement,
				resultFile,
			});
		} catch (error) {
			await ctx.storage.delete(resultFile);
			throw error;
		}
		return null;
	},
});
