import { ConvexError } from "convex/values";
import {
	assertCurrentCase,
	type FrozenCase,
	frozenCaseSchema,
} from "../src/lib/evaluation-case";
import { EVALUATION_VERSIONS } from "../src/lib/evaluation-version";
import type { WorkflowRoutes } from "../src/lib/routing";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ownRun } from "./access";

/** Callers authorize the run before reading its immutable registered inputs. */
export async function readRunInput(
	ctx: Pick<QueryCtx, "db">,
	runId: Id<"runs">,
) {
	const row = await ctx.db
		.query("runInputs")
		.withIndex("by_run", (q) => q.eq("runId", runId))
		.unique();
	if (!row) throw new ConvexError("Frozen run inputs unavailable");
	return frozenCaseSchema.parse(JSON.parse(row.input));
}

export async function freezeRunInput(
	ctx: MutationCtx,
	conversationId: Id<"conversations">,
	graph: WorkflowRoutes,
	submitted: Pick<FrozenCase, "messages" | "metadata">,
	replayRunId?: string,
): Promise<FrozenCase> {
	const limit = Math.max(
		0,
		...graph.nodes.map((node) =>
			node.kind === "input"
				? 0
				: (node.context?.retrieval?.historyMessages ?? 0),
		),
	);
	let frozen: FrozenCase;
	if (replayRunId) {
		const originalId = ctx.db.normalizeId("runs", replayRunId);
		if (!originalId) throw new ConvexError("Run unavailable");
		const original = await ownRun(ctx, originalId);
		frozen = await readRunInput(ctx, original._id);
		assertCurrentCase(frozen);
		if (
			JSON.stringify(submitted) !==
			JSON.stringify({ messages: frozen.messages, metadata: frozen.metadata })
		)
			throw new ConvexError("Replay inputs differ from the frozen case");
	} else {
		const messages = limit
			? await ctx.db
					.query("messages")
					.withIndex("by_conversation", (q) =>
						q.eq("conversationId", conversationId),
					)
					.order("desc")
					.take(limit + 1)
			: [];
		const sources = [];
		let characters = 0;
		let limited = messages.length > limit;
		for (const message of messages) {
			if (!message.content.trim()) continue;
			if (
				sources.length === limit ||
				characters + message.content.length > 120000
			) {
				limited = true;
				break;
			}
			characters += message.content.length;
			sources.push({
				id: message._id,
				kind: "message" as const,
				label: `${message.role}${message.failed ? " (partial)" : ""} · ${new Date(message._creationTime).toISOString()}`,
				content: message.content,
			});
		}
		frozen = {
			...submitted,
			versions: EVALUATION_VERSIONS,
			history: { conversationId, sources: sources.reverse(), limited },
		};
	}
	return frozen;
}

export async function followupFor(ctx: Pick<QueryCtx, "db">, run: Doc<"runs">) {
	const messages = await ctx.db
		.query("messages")
		.withIndex("by_conversation", (q) =>
			q
				.eq("conversationId", run.conversationId)
				.gte("_creationTime", run._creationTime),
		)
		.order("asc")
		.take(4);
	const message = messages.find(
		(message) => message.role === "user" && message.runId !== run._id,
	);
	return message ? { id: message._id, content: message.content } : undefined;
}
