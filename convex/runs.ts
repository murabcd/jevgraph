import { ConvexError, v } from "convex/values";
import { z } from "zod";
import {
	evaluationInputSchema,
	frozenCaseKey,
} from "../src/lib/evaluation-case";
import {
	routeEvaluationSchema,
	routeEvaluations,
} from "../src/lib/route-evidence";
import { workflowRoutesSchema } from "../src/lib/routing";
import { emptyRouteTrace } from "../src/lib/run-artifact";
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
import {
	discardCheckpointFile,
	RUN_LEASE_MS,
	readCheckpoint,
} from "./checkpoints";
import { recordRouteEvaluations } from "./routeEvaluations";
import { followupFor, freezeRunInput, readRunInput } from "./runInputs";
import { runStatus } from "./schema";

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
		input: v.string(),
		replayRunId: v.optional(v.string()),
		routes: v.string(),
		evaluation: v.optional(v.object({ scope: v.string() })),
	},
	returns: v.object({
		runId: v.id("runs"),
		executionId: v.string(),
		createdAt: v.number(),
		input: v.string(),
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
		const submitted = evaluationInputSchema.parse(JSON.parse(args.input));
		const question = submitted.messages.at(-1)?.content ?? "";
		if (
			!z.uuid().safeParse(args.requestId).success ||
			!question.trim() ||
			question.length > 12000
		)
			throw new ConvexError("Invalid chat request");
		const existing = await ctx.db
			.query("runs")
			.withIndex("by_conversation_request", (q) =>
				q.eq("conversationId", conversationId).eq("requestId", args.requestId),
			)
			.unique();
		if (existing) {
			const checkpoint = await readCheckpoint(ctx, existing._id);
			if (!checkpoint) throw new ConvexError("Run checkpoint unavailable");
			return {
				runId: existing._id,
				executionId: checkpoint.executionId,
				createdAt: existing._creationTime,
				input: JSON.stringify(await readRunInput(ctx, existing._id)),
				started: false,
				conversationId,
				workspaceId: workspace._id,
			};
		}
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
		if (args.evaluation && !/^[a-f0-9]{64}$/.test(args.evaluation.scope))
			throw new ConvexError("Invalid evaluation identity");
		if (new TextEncoder().encode(routes).length > 900000)
			throw new ConvexError("Workflow is too large to save");
		const graph = workflowRoutesSchema.parse(JSON.parse(routes));
		const frozen = await freezeRunInput(
			ctx,
			conversationId,
			graph,
			submitted,
			args.replayRunId,
		);
		const input = JSON.stringify(frozen);
		if (new TextEncoder().encode(input).length > 900000)
			throw new ConvexError("Frozen case is too large");
		const evaluation = args.evaluation
			? { scope: args.evaluation.scope, caseKey: await frozenCaseKey(frozen) }
			: undefined;
		const previous = await ctx.db
			.query("runs")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", conversationId),
			)
			.order("desc")
			.first();
		// A new turn supersedes recovery of the previous response.
		if (previous) await discardCheckpointFile(ctx, previous._id);
		const runId = await ctx.db.insert("runs", {
			conversationId: conversationId,
			requestId: args.requestId,
			routes,
			evaluation,
			status: "running",
			expiresAt: Date.now() + RUN_LEASE_MS,
		});
		const createdRun = await ctx.db.get(runId);
		if (!createdRun) throw new ConvexError("Run unavailable");
		const executionId = crypto.randomUUID();
		await ctx.db.insert("runCheckpoints", {
			runId,
			executionId,
			revision: 0,
			cancelled: false,
		});
		await ctx.db.insert("runInputs", { runId, input });
		await ctx.db.insert("messages", {
			conversationId: conversationId,
			runId,
			role: "user",
			content: question,
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
		await ctx.scheduler.runAfter(RUN_LEASE_MS, internal.runs.expire, {
			runId,
			executionId,
		});
		return {
			runId,
			executionId,
			createdAt: createdRun._creationTime,
			input,
			started: true,
			conversationId,
			workspaceId: workspace._id,
		};
	},
});

export const expire = internalMutation({
	args: { runId: v.id("runs"), executionId: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (run?.status !== "running") return null;
		const checkpoint = await readCheckpoint(ctx, run._id);
		if (checkpoint?.executionId !== args.executionId) return null;
		if (run.evaluation && (!checkpoint.file || checkpoint.cancelled)) {
			// A lost server cannot prove which calls completed or what they cost.
			await recordRouteEvaluations(
				ctx,
				run,
				await routeEvaluations(
					workflowRoutesSchema.parse(JSON.parse(run.routes)),
					emptyRouteTrace(),
					RUN_LEASE_MS,
					false,
				),
			);
		}
		if (checkpoint.cancelled) await discardCheckpointFile(ctx, run._id);
		await settle(ctx, args.runId, "", true);
		await ctx.db.patch(args.runId, {
			status: "interrupted",
			error: "The server stopped before saving the response",
		});
		return null;
	},
});

export const settleArtifact = internalMutation({
	args: {
		runId: v.id("runs"),
		executionId: v.string(),
		content: v.string(),
		footer: v.optional(v.string()),
		status: v.union(
			v.literal("completed"),
			v.literal("failed"),
			v.literal("interrupted"),
		),
		error: v.optional(v.string()),
		resultFile: v.id("_storage"),
		evaluations: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ownRun(ctx, args.runId);
		const checkpoint = await readCheckpoint(ctx, run._id);
		if (
			!checkpoint ||
			checkpoint.executionId !== args.executionId ||
			((checkpoint.cancelled || run.expiresAt <= Date.now()) &&
				args.status === "completed")
		)
			throw new ConvexError("This execution no longer owns the run");
		if (run.status !== "running")
			throw new ConvexError("This run is already settled");
		if (args.footer) runFooterSchema.parse(JSON.parse(args.footer));
		if (args.status !== "interrupted" || checkpoint.cancelled)
			await recordRouteEvaluations(
				ctx,
				run,
				z
					.array(routeEvaluationSchema)
					.max(100)
					.parse(JSON.parse(args.evaluations)),
			);
		await settle(ctx, args.runId, args.content, args.status !== "completed");
		await ctx.db.patch(args.runId, {
			status: args.status,
			error: args.error,
			footer: args.footer,
			resultFile: args.resultFile,
		});
		if (args.status !== "interrupted" || checkpoint.cancelled)
			await discardCheckpointFile(ctx, run._id);
		return null;
	},
});

export const owned = internalQuery({
	args: { runId: v.id("runs") },
	returns: v.object({ routes: v.string(), executionId: v.string() }),
	handler: async (ctx, args) => {
		const run = await ownRun(ctx, args.runId);
		const checkpoint = await readCheckpoint(ctx, run._id);
		if (!checkpoint) throw new ConvexError("Run checkpoint unavailable");
		return { routes: run.routes, executionId: checkpoint.executionId };
	},
});

export const latest = query({
	args: { conversationId: v.id("conversations") },
	returns: v.union(
		v.null(),
		v.object({
			runId: v.id("runs"),
			requestId: v.string(),
			status: runStatus,
			resumable: v.boolean(),
			checkpointUrl: v.union(v.string(), v.null()),
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
		const checkpoint = await readCheckpoint(ctx, run[0]._id);
		return {
			runId: run[0]._id,
			requestId: run[0].requestId,
			status: run[0].status,
			resumable:
				run[0].status === "interrupted" &&
				!!checkpoint?.file &&
				!checkpoint.cancelled,
			checkpointUrl:
				run[0].status === "interrupted" && checkpoint?.file
					? await ctx.storage.getUrl(checkpoint.file)
					: null,
			routes: run[0].routes,
			resultUrl: run[0].resultFile
				? await ctx.storage.getUrl(run[0].resultFile)
				: null,
			error: run[0].error,
		};
	},
});

export const inspect = query({
	args: { runId: v.string() },
	returns: v.object({
		input: v.string(),
		routes: v.string(),
		artifactUrl: v.union(v.null(), v.string()),
		credentialScope: v.union(v.null(), v.string()),
		reviews: v.array(
			v.object({
				nodeId: v.string(),
				review: v.optional(v.string()),
				reviewerId: v.optional(v.id("users")),
				reviewedAt: v.optional(v.number()),
				expiresAt: v.number(),
			}),
		),
		followup: v.optional(v.object({ id: v.string(), content: v.string() })),
	}),
	handler: async (ctx, args) => {
		const runId = ctx.db.normalizeId("runs", args.runId);
		if (!runId) throw new ConvexError("Run unavailable");
		const run = await ownRun(ctx, runId);
		if (run.status === "running")
			throw new ConvexError("This run is still active");
		const [input, rows] = await Promise.all([
			readRunInput(ctx, run._id),
			ctx.db
				.query("routeEvaluations")
				.withIndex("by_run", (q) => q.eq("runId", run._id))
				.take(100),
		]);
		return {
			input: JSON.stringify(input),
			routes: run.routes,
			credentialScope: run.evaluation?.scope ?? null,
			artifactUrl: run.resultFile
				? await ctx.storage.getUrl(run.resultFile)
				: null,
			reviews: rows.map((row) => ({
				nodeId: row.nodeId,
				review: row.review,
				reviewerId: row.reviewerId,
				reviewedAt: row.reviewedAt,
				expiresAt: row.expiresAt,
			})),
			followup: await followupFor(ctx, run),
		};
	},
});
