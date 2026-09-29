import { ConvexError, v } from "convex/values";
import {
	EVIDENCE_TTL_MS,
	MAX_EVALUATIONS,
	type RouteEvaluation,
	routeEvaluationSchema,
	summarizeRouteEvidence,
} from "../src/lib/route-evidence";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	query,
} from "./_generated/server";
import { ownConversation, ownRun, ownWorkspace } from "./access";

export async function recordRouteEvaluations(
	ctx: MutationCtx,
	run: Doc<"runs">,
	evaluations: RouteEvaluation[],
) {
	if (!run.evaluation || !evaluations.length) return;
	const conversation = await ctx.db.get(run.conversationId);
	if (!conversation) throw new ConvexError("Conversation unavailable");
	const workspace = await ctx.db
		.query("workspaces")
		.withIndex("by_owner", (q) => q.eq("owner", conversation.owner))
		.unique();
	if (!workspace) throw new ConvexError("Workspace unavailable");
	const existing = await ctx.db
		.query("routeEvaluations")
		.withIndex("by_run", (q) => q.eq("runId", run._id))
		.take(100);
	if (existing.length) return;
	const retained = await ctx.db
		.query("routeEvaluations")
		.withIndex("by_workspace_expiry", (q) => q.eq("workspaceId", workspace._id))
		.take(MAX_EVALUATIONS);
	for (const row of retained.slice(
		0,
		Math.max(0, retained.length + evaluations.length - MAX_EVALUATIONS),
	))
		await ctx.db.delete(row._id);
	for (const value of evaluations) {
		const evaluation = routeEvaluationSchema.parse(value);
		await ctx.db.insert("routeEvaluations", {
			...evaluation,
			workspaceId: workspace._id,
			runId: run._id,
			...run.evaluation,
			passed: evaluation.completed ? undefined : false,
			expiresAt: Date.now() + EVIDENCE_TTL_MS,
		});
	}
}

export const evidence = query({
	args: { workspaceId: v.id("workspaces"), scope: v.string(), key: v.string() },
	returns: v.string(),
	handler: async (ctx, args) => {
		await ownWorkspace(ctx, args.workspaceId);
		const rows = await ctx.db
			.query("routeEvaluations")
			.withIndex("by_workspace_scope_key", (q) =>
				q
					.eq("workspaceId", args.workspaceId)
					.eq("scope", args.scope)
					.eq("key", args.key),
			)
			.take(MAX_EVALUATIONS);
		return JSON.stringify(
			summarizeRouteEvidence(rows.filter((row) => row.expiresAt > Date.now())),
		);
	},
});

export const latest = query({
	args: {
		conversationId: v.id("conversations"),
		nodeId: v.string(),
		runId: v.optional(v.id("runs")),
	},
	returns: v.union(
		v.null(),
		v.object({
			runId: v.id("runs"),
			criteria: v.string(),
			model: v.string(),
			question: v.string(),
			answer: v.string(),
			error: v.optional(v.string()),
			completed: v.boolean(),
			passed: v.optional(v.boolean()),
			latencyMs: v.number(),
			costUsd: v.optional(v.number()),
			report: v.string(),
		}),
	),
	handler: async (ctx, args) => {
		await ownConversation(ctx, args.conversationId);
		const run = args.runId
			? await ownRun(ctx, args.runId)
			: (
					await ctx.db
						.query("runs")
						.withIndex("by_conversation", (q) =>
							q.eq("conversationId", args.conversationId),
						)
						.order("desc")
						.take(1)
				)[0];
		if (!run) return null;
		if (run.conversationId !== args.conversationId)
			throw new ConvexError("Conversation unavailable");
		const rows = await ctx.db
			.query("routeEvaluations")
			.withIndex("by_run", (q) => q.eq("runId", run._id))
			.take(100);
		const row = rows.find(
			(row) => row.nodeId === args.nodeId && row.expiresAt > Date.now(),
		);
		if (!row) return null;
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_run", (q) => q.eq("runId", run._id))
			.take(2);
		const question = messages.find((message) => message.role === "user");
		const answer = messages.find((message) => message.role === "assistant");
		if (!question || !answer)
			throw new ConvexError("Recorded answer unavailable");
		const samples = await ctx.db
			.query("routeEvaluations")
			.withIndex("by_workspace_scope_key", (q) =>
				q
					.eq("workspaceId", row.workspaceId)
					.eq("scope", row.scope)
					.eq("key", row.key),
			)
			.take(MAX_EVALUATIONS);
		return {
			report: JSON.stringify(
				summarizeRouteEvidence(
					samples.filter((sample) => sample.expiresAt > Date.now()),
				),
			),
			runId: row.runId,
			criteria: row.criteria,
			model: row.model,
			question: question.content,
			answer: answer.content,
			error: run.error,
			completed: row.completed,
			passed: row.passed,
			latencyMs: row.latencyMs,
			costUsd: row.costUsd,
		};
	},
});

export const list = query({
	args: { conversationId: v.id("conversations"), nodeId: v.string() },
	returns: v.array(
		v.object({
			runId: v.id("runs"),
			createdAt: v.number(),
			model: v.string(),
			passed: v.optional(v.boolean()),
		}),
	),
	handler: async (ctx, args) => {
		const conversation = await ownConversation(ctx, args.conversationId);
		const workspace = await ctx.db
			.query("workspaces")
			.withIndex("by_owner", (q) => q.eq("owner", conversation.owner))
			.unique();
		if (!workspace) throw new ConvexError("Workspace unavailable");
		const [runs, evaluations] = await Promise.all([
			ctx.db
				.query("runs")
				.withIndex("by_conversation", (q) =>
					q.eq("conversationId", args.conversationId),
				)
				.order("desc")
				.take(50),
			ctx.db
				.query("routeEvaluations")
				.withIndex("by_workspace_expiry", (q) =>
					q.eq("workspaceId", workspace._id),
				)
				.take(MAX_EVALUATIONS),
		]);
		const now = Date.now();
		const byRun = new Map(
			evaluations
				.filter((row) => row.nodeId === args.nodeId && row.expiresAt > now)
				.map((row) => [row.runId, row]),
		);
		return runs.flatMap((run) => {
			const row = byRun.get(run._id);
			return row
				? [
						{
							runId: run._id,
							createdAt: run._creationTime,
							model: row.model,
							passed: row.passed,
						},
					]
				: [];
		});
	},
});

export const review = mutation({
	args: { runId: v.id("runs"), nodeId: v.string(), passed: v.boolean() },
	returns: v.null(),
	handler: async (ctx, args) => {
		await ownRun(ctx, args.runId);
		const rows = await ctx.db
			.query("routeEvaluations")
			.withIndex("by_run", (q) => q.eq("runId", args.runId))
			.take(100);
		const row = rows.find((row) => row.nodeId === args.nodeId);
		if (!row || row.expiresAt <= Date.now())
			throw new ConvexError("Evaluation unavailable");
		if (!row.completed && args.passed)
			throw new ConvexError("An unsuccessful route cannot pass quality review");
		await ctx.db.patch(row._id, { passed: args.passed });
		return null;
	},
});

export const expire = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const rows = await ctx.db
			.query("routeEvaluations")
			.withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now()))
			.take(100);
		for (const row of rows) await ctx.db.delete(row._id);
		if (rows.length === 100)
			await ctx.scheduler.runAfter(0, internal.routeEvaluations.expire, {});
		return null;
	},
});
