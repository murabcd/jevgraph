import { ConvexError, v } from "convex/values";
import { frozenCaseSchema } from "../src/lib/evaluation-case";
import { reasoningEfforts } from "../src/lib/models";
import {
	qualityReviewSchema,
	reviewSources,
	validateQualityReview,
} from "../src/lib/quality-review";
import {
	EVIDENCE_TTL_MS,
	MAX_EVALUATIONS,
	type RouteEvaluation,
	routeEvaluationSchema,
	summarizeRouteEvidence,
} from "../src/lib/route-evidence";
import { workflowRoutesSchema } from "../src/lib/routing";
import { runArtifactSchema } from "../src/lib/run-artifact";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	action,
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
	query,
} from "./_generated/server";
import { ownConversation, ownRun, ownWorkspace } from "./access";
import { followupFor, readRunInput } from "./runInputs";

export async function recordRouteEvaluations(
	ctx: MutationCtx,
	run: Doc<"runs">,
	evaluations: RouteEvaluation[],
) {
	const identity = run.evaluation;
	if (!identity || !evaluations.length) return;
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
	await Promise.all(
		retained
			.slice(
				0,
				Math.max(0, retained.length + evaluations.length - MAX_EVALUATIONS),
			)
			.map((row) => ctx.db.delete(row._id)),
	);
	await Promise.all(
		evaluations.map((value) => {
			const evaluation = routeEvaluationSchema.parse(value);
			return ctx.db.insert("routeEvaluations", {
				...evaluation,
				workspaceId: workspace._id,
				runId: run._id,
				...identity,
				passed: evaluation.completed ? undefined : false,
				expiresAt: Date.now() + EVIDENCE_TTL_MS,
			});
		}),
	);
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

async function evaluationFor(
	ctx: Pick<QueryCtx, "db">,
	runId: Doc<"runs">["_id"],
	nodeId: string,
) {
	const rows = await ctx.db
		.query("routeEvaluations")
		.withIndex("by_run", (q) => q.eq("runId", runId))
		.take(100);
	return rows.find(
		(row) => row.nodeId === nodeId && row.expiresAt > Date.now(),
	);
}

const followupValue = v.object({ id: v.string(), content: v.string() });
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
			input: v.string(),
			routes: v.string(),
			resultUrl: v.union(v.null(), v.string()),
			review: v.optional(v.string()),
			followup: v.optional(followupValue),
			model: v.string(),
			reasoningEffort: v.union(
				...reasoningEfforts.map((effort) => v.literal(effort)),
			),
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
		const row = await evaluationFor(ctx, run._id, args.nodeId);
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
			input: JSON.stringify(await readRunInput(ctx, run._id)),
			routes: run.routes,
			resultUrl: run.resultFile
				? await ctx.storage.getUrl(run.resultFile)
				: null,
			review: row.review,
			followup: await followupFor(ctx, run),
			model: row.model,
			reasoningEffort: row.reasoningEffort,
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
			reasoningEffort: v.union(
				...reasoningEfforts.map((effort) => v.literal(effort)),
			),
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
							reasoningEffort: row.reasoningEffort,
							passed: row.passed,
						},
					]
				: [];
		});
	},
});

export const reviewInputs = internalQuery({
	args: { runId: v.id("runs"), nodeId: v.string() },
	returns: v.object({
		input: v.string(),
		routes: v.string(),
		resultFile: v.optional(v.id("_storage")),
		criteria: v.string(),
		completed: v.boolean(),
		review: v.optional(v.string()),
		followup: v.optional(followupValue),
	}),
	handler: async (ctx, args) => {
		const run = await ownRun(ctx, args.runId);
		const row = await evaluationFor(ctx, run._id, args.nodeId);
		if (!row) throw new ConvexError("Evaluation unavailable");
		return {
			input: JSON.stringify(await readRunInput(ctx, run._id)),
			routes: run.routes,
			resultFile: run.resultFile,
			criteria: row.criteria,
			completed: row.completed,
			review: row.review,
			followup: await followupFor(ctx, run),
		};
	},
});

export const review = action({
	args: {
		runId: v.id("runs"),
		nodeId: v.string(),
		review: v.string(),
		expectedReview: v.union(v.null(), v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const recorded = await ctx.runQuery(
			internal.routeEvaluations.reviewInputs,
			{ runId: args.runId, nodeId: args.nodeId },
		);
		if ((recorded.review ?? null) !== args.expectedReview)
			throw new ConvexError("Review changed. Reload before saving.");
		const review = qualityReviewSchema.parse(JSON.parse(args.review));
		if (
			!recorded.completed &&
			review.criteria.every((criterion) => criterion.verdict === "pass")
		)
			throw new ConvexError("An unsuccessful route cannot pass quality review");
		if (!recorded.resultFile)
			throw new ConvexError("Recorded evidence unavailable");
		const file = await ctx.storage.get(recorded.resultFile);
		if (!file) throw new ConvexError("Recorded evidence unavailable");
		const artifact = runArtifactSchema.parse(JSON.parse(await file.text()));
		const input = frozenCaseSchema.parse(JSON.parse(recorded.input));
		const passed = validateQualityReview(
			review,
			recorded.criteria,
			artifact,
			reviewSources(
				input,
				workflowRoutesSchema.parse(JSON.parse(recorded.routes)),
				artifact,
				recorded.followup,
			),
		);
		await ctx.runMutation(internal.routeEvaluations.saveReview, {
			runId: args.runId,
			nodeId: args.nodeId,
			review: JSON.stringify(review),
			expectedReview: args.expectedReview,
			passed,
		});
		return null;
	},
});

export const saveReview = internalMutation({
	args: {
		runId: v.id("runs"),
		nodeId: v.string(),
		review: v.string(),
		expectedReview: v.union(v.null(), v.string()),
		passed: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ownRun(ctx, args.runId);
		const row = await evaluationFor(ctx, run._id, args.nodeId);
		if (!row) throw new ConvexError("Evaluation unavailable");
		if ((row.review ?? null) !== args.expectedReview)
			throw new ConvexError("Review changed. Reload before saving.");
		qualityReviewSchema.parse(JSON.parse(args.review));
		const conversation = await ownConversation(ctx, run.conversationId);
		await ctx.db.patch(row._id, {
			review: args.review,
			passed: args.passed,
			reviewerId: conversation.owner,
			reviewedAt: Date.now(),
		});
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
		await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
		if (rows.length === 100)
			await ctx.scheduler.runAfter(0, internal.routeEvaluations.expire, {});
		return null;
	},
});
