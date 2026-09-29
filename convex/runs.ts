import { ConvexError, v } from "convex/values";
import { z } from "zod";
import {
	routeEvaluationSchema,
	routeEvaluations,
} from "../src/lib/route-evidence";
import { routeTraceSchema, workflowRoutesSchema } from "../src/lib/routing";
import { runFooterSchema } from "../src/lib/run-footer";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	query,
} from "./_generated/server";
import { ownConversation, ownRun } from "./access";
import { recordRouteEvaluations } from "./routeEvaluations";

const RUN_LEASE_MS = 180000;

async function settle(
	ctx: MutationCtx,
	runId: Id<"runs">,
	content: string,
	failed: boolean,
) {
	const run = await ctx.db.get(runId);
	if (!run) throw new ConvexError("Run unavailable");
	const messages = await ctx.db
		.query("messages")
		.withIndex("by_run", (q) => q.eq("runId", runId))
		.take(2);
	const assistant = messages.find((message) => message.role === "assistant");
	if (!assistant) throw new ConvexError("Assistant message unavailable");
	if (content.length > 240000)
		throw new ConvexError("Response exceeds the saved message limit");
	await ctx.db.patch(assistant._id, { content, failed });
	const conversation = await ctx.db.get(run.conversationId);
	if (conversation?.activeRunId === runId)
		await ctx.db.patch(conversation._id, { activeRunId: undefined });
}

export const begin = mutation({
	args: {
		conversationId: v.string(),
		requestId: v.string(),
		question: v.string(),
		routes: v.string(),
		evaluation: v.optional(
			v.object({ scope: v.string(), caseKey: v.string() }),
		),
	},
	returns: v.object({
		runId: v.id("runs"),
		started: v.boolean(),
		conversationId: v.id("conversations"),
		workspaceId: v.id("workspaces"),
	}),
	handler: async (ctx, args) => {
		const conversationId = ctx.db.normalizeId(
			"conversations",
			args.conversationId,
		);
		if (!conversationId) throw new ConvexError("Conversation unavailable");
		const conversation = await ownConversation(ctx, conversationId);
		const workspace = await ctx.db
			.query("workspaces")
			.withIndex("by_owner", (q) => q.eq("owner", conversation.owner))
			.unique();
		if (!workspace || workspace.conversationId !== conversation._id)
			throw new ConvexError("This conversation is no longer active");
		if (
			!z.uuid().safeParse(args.requestId).success ||
			!args.question.trim() ||
			args.question.length > 12000
		)
			throw new ConvexError("Invalid chat request");
		const existing = await ctx.db
			.query("runs")
			.withIndex("by_conversation_request", (q) =>
				q.eq("conversationId", conversationId).eq("requestId", args.requestId),
			)
			.unique();
		if (existing)
			return {
				runId: existing._id,
				started: false,
				conversationId,
				workspaceId: workspace._id,
			};
		if (conversation.activeRunId) {
			const active = await ctx.db.get(conversation.activeRunId);
			if (active?.status === "running")
				throw new ConvexError(
					"This conversation already has a running response",
				);
		}
		const routes = JSON.stringify(
			workflowRoutesSchema.parse(JSON.parse(args.routes)),
		);
		if (
			args.evaluation &&
			(!/^[a-f0-9]{64}$/.test(args.evaluation.scope) ||
				!/^[a-f0-9]{64}$/.test(args.evaluation.caseKey))
		)
			throw new ConvexError("Invalid evaluation identity");
		if (new TextEncoder().encode(routes).length > 900000)
			throw new ConvexError("Workflow is too large to save");
		const runId = await ctx.db.insert("runs", {
			conversationId: conversationId,
			requestId: args.requestId,
			routes,
			evaluation: args.evaluation,
			status: "running",
			expiresAt: Date.now() + RUN_LEASE_MS,
		});
		await ctx.db.insert("messages", {
			conversationId: conversationId,
			runId,
			role: "user",
			content: args.question,
			failed: false,
		});
		await ctx.db.insert("messages", {
			conversationId: conversationId,
			runId,
			role: "assistant",
			content: "",
			failed: false,
		});
		await ctx.db.patch(conversation._id, { activeRunId: runId });
		await ctx.scheduler.runAfter(RUN_LEASE_MS, internal.runs.expire, { runId });
		return { runId, started: true, conversationId, workspaceId: workspace._id };
	},
});

export const fail = mutation({
	args: {
		runId: v.id("runs"),
		content: v.string(),
		error: v.string(),
		interrupted: v.boolean(),
		trace: v.optional(v.string()),
		latencyMs: v.optional(v.number()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ownRun(ctx, args.runId);
		if (run.status !== "running") return null;
		if (args.trace && args.latencyMs !== undefined) {
			await recordRouteEvaluations(
				ctx,
				run,
				await routeEvaluations(
					workflowRoutesSchema.parse(JSON.parse(run.routes)),
					routeTraceSchema.parse(JSON.parse(args.trace)),
					args.latencyMs,
					false,
				),
			);
		}
		await settle(ctx, args.runId, args.content, true);
		await ctx.db.patch(args.runId, {
			status: args.interrupted ? "interrupted" : "failed",
			error: args.error.slice(0, 2000),
		});
		return null;
	},
});

export const expire = internalMutation({
	args: { runId: v.id("runs") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (run?.status !== "running") return null;
		if (run.evaluation) {
			// A lost server cannot prove which calls completed or what they cost.
			await recordRouteEvaluations(
				ctx,
				run,
				await routeEvaluations(
					workflowRoutesSchema.parse(JSON.parse(run.routes)),
					{
						path: [],
						traversedEdges: [],
						jevSteps: [],
						outputs: [],
						calls: [],
						contexts: [],
						modelPlans: [],
					},
					RUN_LEASE_MS,
					false,
				),
			);
		}
		await settle(ctx, args.runId, "", true);
		await ctx.db.patch(args.runId, {
			status: "interrupted",
			error: "The server stopped before saving the response",
		});
		return null;
	},
});

export const finish = internalMutation({
	args: {
		runId: v.id("runs"),
		content: v.string(),
		footer: v.string(),
		resultFile: v.id("_storage"),
		evaluations: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ownRun(ctx, args.runId);
		if (run.status !== "running")
			throw new ConvexError("This run is already settled");
		runFooterSchema.parse(JSON.parse(args.footer));
		await recordRouteEvaluations(
			ctx,
			run,
			z
				.array(routeEvaluationSchema)
				.max(100)
				.parse(JSON.parse(args.evaluations)),
		);
		await settle(ctx, args.runId, args.content, false);
		await ctx.db.patch(args.runId, {
			status: "completed",
			footer: args.footer,
			resultFile: args.resultFile,
		});
		return null;
	},
});

export const owned = internalQuery({
	args: { runId: v.id("runs") },
	returns: v.object({ routes: v.string() }),
	handler: async (ctx, args) => {
		const run = await ownRun(ctx, args.runId);
		return { routes: run.routes };
	},
});

export const latest = query({
	args: { conversationId: v.id("conversations") },
	returns: v.union(
		v.null(),
		v.object({
			routes: v.string(),
			resultUrl: v.union(v.null(), v.string()),
			error: v.optional(v.string()),
		}),
	),
	handler: async (ctx, args) => {
		await ownConversation(ctx, args.conversationId);
		const run = await ctx.db
			.query("runs")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.order("desc")
			.take(1);
		if (!run[0]) return null;
		return {
			routes: run[0].routes,
			resultUrl: run[0].resultFile
				? await ctx.storage.getUrl(run[0].resultFile)
				: null,
			error: run[0].error,
		};
	},
});
