import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { EMBEDDING_DIMENSIONS } from "../src/lib/retrieval";

export const runStatus = v.union(
	v.literal("running"),
	v.literal("completed"),
	v.literal("failed"),
	v.literal("interrupted"),
);

export default defineSchema({
	...authTables,
	runInputs: defineTable({ runId: v.id("runs"), input: v.string() }).index(
		"by_run",
		["runId"],
	),
	routeEvaluations: defineTable({
		workspaceId: v.id("workspaces"),
		runId: v.id("runs"),
		scope: v.string(),
		key: v.string(),
		caseKey: v.string(),
		nodeId: v.string(),
		model: v.string(),
		criteria: v.string(),
		latencyMs: v.number(),
		completed: v.boolean(),
		costUsd: v.optional(v.number()),
		generationCostUsd: v.optional(v.number()),
		modelAttempts: v.number(),
		passed: v.optional(v.boolean()),
		expiresAt: v.number(),
	})
		.index("by_run", ["runId"])
		.index("by_workspace_scope_key", ["workspaceId", "scope", "key"])
		.index("by_workspace_expiry", ["workspaceId", "expiresAt"])
		.index("by_expiry", ["expiresAt"]),
	retrievalSources: defineTable({
		workspaceId: v.id("workspaces"),
		scope: v.string(),
		key: v.string(),
		namespace: v.string(),
		sourceId: v.string(),
		label: v.string(),
		kind: v.union(v.literal("document"), v.literal("message")),
		chunkCount: v.number(),
		expiresAt: v.number(),
	})
		.index("by_key", ["key"])
		.index("by_workspace_expiry", ["workspaceId", "expiresAt"])
		.index("by_expiry", ["expiresAt"]),
	retrievalChunks: defineTable({
		sourceKey: v.string(),
		namespace: v.string(),
		start: v.number(),
		end: v.number(),
		text: v.string(),
		embedding: v.array(v.float64()),
	})
		.index("by_source", ["sourceKey"])
		.searchIndex("by_text", {
			searchField: "text",
			filterFields: ["namespace"],
		})
		.vectorIndex("by_embedding", {
			vectorField: "embedding",
			dimensions: EMBEDDING_DIMENSIONS,
			filterFields: ["namespace"],
		}),
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
		evaluation: v.optional(
			v.object({ scope: v.string(), caseKey: v.string() }),
		),
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
