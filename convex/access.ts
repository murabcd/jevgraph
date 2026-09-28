import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export async function requireOwner(ctx: QueryCtx | MutationCtx) {
	const owner = await getAuthUserId(ctx);
	if (!owner) throw new ConvexError("Authentication required");
	return owner;
}

export async function ownWorkspace(
	ctx: QueryCtx | MutationCtx,
	id: Id<"workspaces">,
) {
	const owner = await requireOwner(ctx);
	const workspace = await ctx.db.get(id);
	if (!workspace || workspace.owner !== owner)
		throw new ConvexError("Workspace unavailable");
	return workspace;
}

export async function ownConversation(
	ctx: QueryCtx | MutationCtx,
	id: Id<"conversations">,
) {
	const conversation = await ctx.db.get(id);
	if (!conversation) throw new ConvexError("Conversation unavailable");
	if (conversation.owner !== (await requireOwner(ctx)))
		throw new ConvexError("Conversation unavailable");
	return conversation;
}

export async function ownRun(ctx: QueryCtx | MutationCtx, id: Id<"runs">) {
	const run = await ctx.db.get(id);
	if (!run) throw new ConvexError("Run unavailable");
	await ownConversation(ctx, run.conversationId);
	return run;
}
