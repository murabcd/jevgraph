import { v } from "convex/values";
import { routeEvaluations } from "../src/lib/route-evidence";
import { routeResultSchema, workflowRoutesSchema } from "../src/lib/routing";
import { runFooter } from "../src/lib/run-footer";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

export const save = action({
	args: { runId: v.id("runs"), result: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.runQuery(internal.runs.owned, { runId: args.runId });
		if (new TextEncoder().encode(args.result).length > 8000000)
			throw new Error("Run result is too large to save");
		const result = routeResultSchema.parse(JSON.parse(args.result));
		const evaluations = await routeEvaluations(
			workflowRoutesSchema.parse(JSON.parse(run.routes)),
			result,
			result.latencyMs,
			result.outcome === "completed",
		);
		const resultFile = await ctx.storage.store(
			new Blob([JSON.stringify(result)], { type: "application/json" }),
		);
		try {
			await ctx.runMutation(internal.runs.finish, {
				runId: args.runId,
				content: result.text,
				footer: JSON.stringify(runFooter(result)),
				resultFile,
				evaluations: JSON.stringify(evaluations),
			});
		} catch (error) {
			await ctx.storage.delete(resultFile);
			throw error;
		}
		return null;
	},
});
