import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { ownConversation, ownWorkspace } from "./access";

async function requireIdleConversation(
	ctx: MutationCtx,
	id: Id<"conversations">,
) {
	const conversation = await ownConversation(ctx, id);
	if (conversation.activeRunId) {
		const run = await ctx.db.get(conversation.activeRunId);
		if (run?.status === "running")
			throw new ConvexError(
				"Wait for the current response before changing conversations",
			);
	}
}

export const start = mutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.id("conversations"),
	handler: async (ctx, args) => {
		const workspace = await ownWorkspace(ctx, args.workspaceId);
		await requireIdleConversation(ctx, workspace.conversationId);
		const conversationId = await ctx.db.insert("conversations", {
			owner: workspace.owner,
		});
		await ctx.db.patch(workspace._id, { conversationId });
		return conversationId;
	},
});

export const turns = query({
	args: { conversationId: v.id("conversations") },
	returns: v.array(
		v.object({
			id: v.string(),
			role: v.union(v.literal("user"), v.literal("assistant")),
			content: v.string(),
			failed: v.boolean(),
			streaming: v.boolean(),
			footer: v.optional(v.string()),
		}),
	),
	handler: async (ctx, args) => {
		await ownConversation(ctx, args.conversationId);
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", args.conversationId),
			)
			.order("desc")
			.take(100);
		return Promise.all(
			messages.reverse().map(async (message) => {
				const run = await ctx.db.get(message.runId);
				return {
					id: `${run?.requestId}:${message.role}`,
					role: message.role,
					content: message.content,
					failed: message.failed,
					streaming: message.role === "assistant" && run?.status === "running",
					footer: message.role === "assistant" ? run?.footer : undefined,
				};
			}),
		);
	},
});

export const list = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(v.object({ id: v.id("conversations"), title: v.string() })),
	handler: async (ctx, args) => {
		const workspace = await ownWorkspace(ctx, args.workspaceId);
		const conversations = await ctx.db
			.query("conversations")
			.withIndex("by_owner", (q) => q.eq("owner", workspace.owner))
			.order("desc")
			.take(50);
		return Promise.all(
			conversations.map(async (conversation) => {
				const first = await ctx.db
					.query("messages")
					.withIndex("by_conversation", (q) =>
						q.eq("conversationId", conversation._id),
					)
					.order("asc")
					.first();
				return {
					id: conversation._id,
					title: first?.content.slice(0, 100) ?? "New conversation",
				};
			}),
		);
	},
});
export const open = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		conversationId: v.id("conversations"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const workspace = await ownWorkspace(ctx, args.workspaceId);
		await ownConversation(ctx, args.conversationId);
		await requireIdleConversation(ctx, workspace.conversationId);
		await ctx.db.patch(workspace._id, { conversationId: args.conversationId });
		return null;
	},
});
