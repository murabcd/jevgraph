import { ConvexError, v } from "convex/values";
import { createInitialGraph, parseGraphJson } from "../src/lib/graph-snapshot";
import { mutation, query } from "./_generated/server";
import { ownWorkspace, requireOwner } from "./access";

const workspaceView = v.object({
	id: v.id("workspaces"),
	graph: v.string(),
	revision: v.number(),
	conversationId: v.id("conversations"),
});

export const current = query({
	args: {},
	returns: v.union(v.null(), workspaceView),
	handler: async (ctx) => {
		const owner = await requireOwner(ctx);
		const workspace = await ctx.db
			.query("workspaces")
			.withIndex("by_owner", (q) => q.eq("owner", owner))
			.unique();
		return workspace
			? {
					id: workspace._id,
					graph: workspace.graph,
					revision: workspace.revision,
					conversationId: workspace.conversationId,
				}
			: null;
	},
});

export const initialize = mutation({
	args: {},
	returns: v.id("workspaces"),
	handler: async (ctx) => {
		const owner = await requireOwner(ctx);
		const existing = await ctx.db
			.query("workspaces")
			.withIndex("by_owner", (q) => q.eq("owner", owner))
			.unique();
		if (existing) return existing._id;
		const graph = JSON.stringify(createInitialGraph());
		const conversationId = await ctx.db.insert("conversations", { owner });
		const workspaceId = await ctx.db.insert("workspaces", {
			owner,
			graph,
			revision: 0,
			conversationId,
		});
		return workspaceId;
	},
});

export const save = mutation({
	args: { id: v.id("workspaces"), revision: v.number(), graph: v.string() },
	returns: v.number(),
	handler: async (ctx, args) => {
		const workspace = await ownWorkspace(ctx, args.id);
		if (workspace.revision !== args.revision)
			throw new ConvexError(
				"The graph changed in another tab. Reload to get the latest version.",
			);
		const graph = JSON.stringify(parseGraphJson(args.graph));
		const revision = workspace.revision + 1;
		await ctx.db.patch(args.id, { graph, revision });
		return revision;
	},
});
