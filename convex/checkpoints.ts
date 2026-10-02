import { ConvexError, v } from "convex/values";
import { assertCurrentCase } from "../src/lib/evaluation-case";
import {
	MAX_JOURNAL_BYTES,
	workflowJournalSchema,
} from "../src/lib/workflow-journal";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	action,
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { ownRun } from "./access";
import { readRunInput } from "./runInputs";
import { runStatus } from "./schema";

export const RUN_LEASE_MS = 180_000;
export function readCheckpoint(ctx: Pick<QueryCtx, "db">, runId: Id<"runs">) {
	return ctx.db
		.query("runCheckpoints")
		.withIndex("by_run", (q) => q.eq("runId", runId))
		.unique();
}
export async function discardCheckpointFile(
	ctx: MutationCtx,
	runId: Id<"runs">,
) {
	const checkpoint = await readCheckpoint(ctx, runId);
	if (!checkpoint) return;
	if (checkpoint.file) await ctx.storage.delete(checkpoint.file);
	await ctx.db.patch(checkpoint._id, { file: undefined });
}
const identityArgs = { runId: v.id("runs"), executionId: v.string() };
export const view = query({
	args: { runId: v.string() },
	returns: v.object({
		runId: v.id("runs"),
		requestId: v.string(),
		executionId: v.string(),
		revision: v.number(),
		cancelled: v.boolean(),
		url: v.union(v.string(), v.null()),
		status: runStatus,
		scope: v.union(v.string(), v.null()),
		input: v.string(),
		routes: v.string(),
		workspaceId: v.id("workspaces"),
		conversationId: v.id("conversations"),
		createdAt: v.number(),
	}),
	handler: async (ctx, args) => {
		const runId = ctx.db.normalizeId("runs", args.runId);
		if (!runId) throw new ConvexError("Run unavailable");
		const run = await ownRun(ctx, runId);
		const [checkpoint, input, conversation] = await Promise.all([
			readCheckpoint(ctx, run._id),
			readRunInput(ctx, run._id),
			ctx.db.get(run.conversationId),
		]);
		if (!checkpoint || !conversation)
			throw new ConvexError("Run checkpoint unavailable");
		const workspace = await ctx.db
			.query("workspaces")
			.withIndex("by_owner", (q) => q.eq("owner", conversation.owner))
			.unique();
		if (!workspace) throw new ConvexError("Workspace unavailable");
		return {
			runId: run._id,
			requestId: run.requestId,
			executionId: checkpoint.executionId,
			revision: checkpoint.revision,
			cancelled: checkpoint.cancelled,
			url: checkpoint.file ? await ctx.storage.getUrl(checkpoint.file) : null,
			status: run.status,
			scope: run.evaluation?.scope ?? null,
			input: JSON.stringify(input),
			routes: run.routes,
			workspaceId: workspace._id,
			conversationId: run.conversationId,
			createdAt: run._creationTime,
		};
	},
});
export const active = query({
	args: identityArgs,
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ownRun(ctx, args.runId);
		const checkpoint = await readCheckpoint(ctx, run._id);
		if (
			run.status !== "running" ||
			run.expiresAt <= Date.now() ||
			!checkpoint ||
			checkpoint.executionId !== args.executionId ||
			checkpoint.cancelled
		)
			throw new ConvexError("This execution no longer owns the run");
		return null;
	},
});
export const replace = internalMutation({
	args: { ...identityArgs, revision: v.number(), file: v.id("_storage") },
	returns: v.number(),
	handler: async (ctx, args) => {
		const run = await ownRun(ctx, args.runId);
		const checkpoint = await readCheckpoint(ctx, run._id);
		if (
			run.status !== "running" ||
			run.expiresAt <= Date.now() ||
			!checkpoint ||
			checkpoint.cancelled ||
			checkpoint.executionId !== args.executionId ||
			checkpoint.revision !== args.revision
		)
			throw new ConvexError("This execution no longer owns the checkpoint");
		await ctx.db.patch(checkpoint._id, {
			file: args.file,
			revision: checkpoint.revision + 1,
		});
		if (checkpoint.file) await ctx.storage.delete(checkpoint.file);
		return checkpoint.revision + 1;
	},
});
export const save = action({
	args: { ...identityArgs, revision: v.number(), journal: v.string() },
	returns: v.number(),
	handler: async (ctx, args): Promise<number> => {
		await ctx.runQuery(api.checkpoints.active, {
			runId: args.runId,
			executionId: args.executionId,
		});
		if (new TextEncoder().encode(args.journal).length > MAX_JOURNAL_BYTES)
			throw new Error("Workflow checkpoint is too large");
		const journal = workflowJournalSchema.parse(JSON.parse(args.journal));
		if (journal.runId !== args.runId)
			throw new Error("Checkpoint belongs to another run");
		const file = await ctx.storage.store(
			new Blob([JSON.stringify(journal)], { type: "application/json" }),
		);
		try {
			return await ctx.runMutation(internal.checkpoints.replace, {
				runId: args.runId,
				executionId: args.executionId,
				revision: args.revision,
				file,
			});
		} catch (error) {
			await ctx.storage.delete(file);
			throw error;
		}
	},
});
export const claim = mutation({
	args: { ...identityArgs, revision: v.number(), scope: v.string() },
	returns: v.string(),
	handler: async (ctx, args) => {
		const run = await ownRun(ctx, args.runId);
		const checkpoint = await readCheckpoint(ctx, run._id);
		if (
			run.status !== "interrupted" ||
			!checkpoint?.file ||
			checkpoint.cancelled ||
			checkpoint.executionId !== args.executionId ||
			checkpoint.revision !== args.revision
		)
			throw new ConvexError("This run cannot be resumed");
		if (!run.evaluation || run.evaluation.scope !== args.scope)
			throw new ConvexError(
				"Provider credentials changed; this run cannot be resumed",
			);
		assertCurrentCase(await readRunInput(ctx, run._id));
		const conversation = await ctx.db.get(run.conversationId);
		if (!conversation) throw new ConvexError("Conversation unavailable");
		const [workspace, latest] = await Promise.all([
			ctx.db
				.query("workspaces")
				.withIndex("by_owner", (q) => q.eq("owner", conversation.owner))
				.unique(),
			ctx.db
				.query("runs")
				.withIndex("by_conversation", (q) =>
					q.eq("conversationId", run.conversationId),
				)
				.order("desc")
				.first(),
		]);
		if (
			workspace?.conversationId !== run.conversationId ||
			conversation.activeRunId ||
			latest?._id !== run._id
		)
			throw new ConvexError(
				"Only the latest response in the current conversation can resume",
			);
		const executionId = crypto.randomUUID();
		await ctx.db.patch(checkpoint._id, { executionId });
		await ctx.db.patch(run._id, {
			status: "running",
			expiresAt: Date.now() + RUN_LEASE_MS,
			error: undefined,
			footer: undefined,
			resultFile: undefined,
		});
		if (run.resultFile) await ctx.storage.delete(run.resultFile);
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_run", (q) => q.eq("runId", run._id))
			.take(2);
		const assistant = messages.find((message) => message.role === "assistant");
		if (!assistant) throw new ConvexError("Assistant message unavailable");
		await ctx.db.patch(assistant._id, { content: "", failed: false });
		await ctx.db.patch(conversation._id, { activeRunId: run._id });
		await ctx.scheduler.runAfter(RUN_LEASE_MS, internal.runs.expire, {
			runId: run._id,
			executionId,
		});
		return executionId;
	},
});
export const stop = mutation({
	args: { runId: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const runId = ctx.db.normalizeId("runs", args.runId);
		if (!runId) throw new ConvexError("Run unavailable");
		const run = await ownRun(ctx, runId);
		if (run.status !== "running")
			throw new ConvexError("This response is no longer running");
		const checkpoint = await readCheckpoint(ctx, run._id);
		if (!checkpoint) throw new ConvexError("Run checkpoint unavailable");
		await ctx.db.patch(checkpoint._id, { cancelled: true });
		return null;
	},
});

export const loadable = internalQuery({
	args: { ...identityArgs, revision: v.number() },
	returns: v.id("_storage"),
	handler: async (ctx, args) => {
		await ownRun(ctx, args.runId);
		const checkpoint = await readCheckpoint(ctx, args.runId);
		if (
			!checkpoint?.file ||
			checkpoint.executionId !== args.executionId ||
			checkpoint.revision !== args.revision
		)
			throw new ConvexError("Run checkpoint changed");
		return checkpoint.file;
	},
});
export const load = action({
	args: { ...identityArgs, revision: v.number() },
	returns: v.string(),
	handler: async (ctx, args): Promise<string> => {
		const file = await ctx.runQuery(internal.checkpoints.loadable, args);
		const blob = await ctx.storage.get(file);
		if (!blob || blob.size > MAX_JOURNAL_BYTES)
			throw new Error("Run checkpoint unavailable");
		return JSON.stringify(
			workflowJournalSchema.parse(JSON.parse(await blob.text())),
		);
	},
});
