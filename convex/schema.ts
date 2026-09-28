import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const runStatus = v.union(
	v.literal("running"),
	v.literal("completed"),
	v.literal("failed"),
	v.literal("interrupted"),
);

export default defineSchema({
	...authTables,
	workspaces: defineTable({
		owner: v.id("users"),
		graph: v.string(),
		revision: v.number(),
		conversationId: v.id("conversations"),
	}).index("by_owner", ["owner"]),
	conversations: defineTable({
		owner: v.id("users"),
		activeRunId: v.optional(v.id("runs")),
	}).index("by_owner", ["owner"]),
	runs: defineTable({
		conversationId: v.id("conversations"),
		requestId: v.string(),
		routes: v.string(),
		status: runStatus,
		expiresAt: v.number(),
		resultFile: v.optional(v.id("_storage")),
		error: v.optional(v.string()),
		footer: v.optional(v.string()),
	})
		.index("by_conversation_request", ["conversationId", "requestId"])
		.index("by_conversation", ["conversationId"]),
	messages: defineTable({
		conversationId: v.id("conversations"),
		runId: v.id("runs"),
		role: v.union(v.literal("user"), v.literal("assistant")),
		content: v.string(),
		failed: v.boolean(),
	})
		.index("by_conversation", ["conversationId"])
		.index("by_run", ["runId"]),
	summaries: defineTable({
		workspaceId: v.id("workspaces"),
		scope: v.string(),
		fingerprint: v.string(),
		short: v.string(),
		detailed: v.string(),
		expiresAt: v.number(),
	})
		.index("by_workspace_scope_fingerprint", [
			"workspaceId",
			"scope",
			"fingerprint",
		])
		.index("by_expiry", ["expiresAt"])
		.index("by_workspace_expiry", ["workspaceId", "expiresAt"]),
});
