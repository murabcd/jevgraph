import { v } from "convex/values";
import { contextSummariesSchema } from "../src/lib/context";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { ownWorkspace } from "./access";

const keyArgs = {
	workspaceId: v.id("workspaces"),
	scope: v.string(),
	fingerprint: v.string(),
};
export const get = query({
	args: keyArgs,
	returns: v.union(
		v.null(),
		v.object({ short: v.string(), detailed: v.string() }),
	),
	handler: async (ctx, args) => {
		await ownWorkspace(ctx, args.workspaceId);
		const saved = await ctx.db
			.query("summaries")
			.withIndex("by_workspace_scope_fingerprint", (q) =>
				q
					.eq("workspaceId", args.workspaceId)
					.eq("scope", args.scope)
					.eq("fingerprint", args.fingerprint),
			)
			.unique();
		return saved && saved.expiresAt > Date.now()
			? { short: saved.short, detailed: saved.detailed }
			: null;
	},
});
export const put = mutation({
	args: { ...keyArgs, short: v.string(), detailed: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		await ownWorkspace(ctx, args.workspaceId);
		contextSummariesSchema.parse({
			short: args.short,
			detailed: args.detailed,
		});
		if (
			!/^[a-f0-9]{64}$/.test(args.scope) ||
			!/^[a-f0-9]{64}$/.test(args.fingerprint)
		)
			throw new Error("Invalid summary identity");
		const saved = await ctx.db
			.query("summaries")
			.withIndex("by_workspace_scope_fingerprint", (q) =>
				q
					.eq("workspaceId", args.workspaceId)
					.eq("scope", args.scope)
					.eq("fingerprint", args.fingerprint),
			)
			.unique();
		const value = { ...args, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
		if (saved) await ctx.db.replace(saved._id, value);
		else {
			const oldest = await ctx.db
				.query("summaries")
				.withIndex("by_workspace_expiry", (q) =>
					q.eq("workspaceId", args.workspaceId),
				)
				.take(256);
			if (oldest.length === 256) await ctx.db.delete(oldest[0]._id);
			await ctx.db.insert("summaries", value);
		}
		return null;
	},
});
export const expire = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const expired = await ctx.db
			.query("summaries")
			.withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now()))
			.take(100);
		await Promise.all(expired.map((item) => ctx.db.delete(item._id)));
		if (expired.length === 100)
			await ctx.scheduler.runAfter(0, internal.summaries.expire, {});
		return null;
	},
});
