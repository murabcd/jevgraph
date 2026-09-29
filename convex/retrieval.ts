import { ConvexError, v } from "convex/values";
import {
	EMBEDDING_DIMENSIONS,
	MAX_RETRIEVAL_CHUNKS,
	MAX_SOURCE_CHUNKS,
	passageSchema,
	type RetrievalCandidate,
	retrievalSourceKey,
	retrievalSourceSchema,
} from "../src/lib/retrieval";
import { workflowRoutesSchema } from "../src/lib/routing";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	action,
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { ownRun, ownWorkspace } from "./access";

const identity = {
	workspaceId: v.id("workspaces"),
	runId: v.id("runs"),
	scope: v.string(),
};
const sourceValue = v.object({
	id: v.string(),
	label: v.string(),
	kind: v.union(v.literal("document"), v.literal("message")),
	content: v.string(),
});
const candidateValue = v.object({
	id: v.string(),
	sourceId: v.string(),
	label: v.string(),
	kind: v.union(v.literal("document"), v.literal("message")),
	start: v.number(),
	end: v.number(),
	text: v.string(),
	rank: v.number(),
});

async function authorize(
	ctx: QueryCtx | MutationCtx,
	args: { workspaceId: Id<"workspaces">; runId: Id<"runs">; scope: string },
) {
	const workspace = await ownWorkspace(ctx, args.workspaceId);
	const run = await ownRun(ctx, args.runId);
	if (
		workspace.conversationId !== run.conversationId ||
		run.status !== "running" ||
		run.expiresAt <= Date.now()
	)
		throw new ConvexError("Retrieval needs an active run");
	if (!/^[a-f0-9]{64}$/.test(args.scope))
		throw new ConvexError("Invalid retrieval scope");
	return run;
}

export const history = query({
	args: { ...identity, limit: v.number() },
	returns: v.object({ sources: v.array(sourceValue), limited: v.boolean() }),
	handler: async (ctx, args) => {
		const run = await authorize(ctx, args);
		if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 200)
			throw new ConvexError("Invalid history limit");
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_conversation", (q) =>
				q.eq("conversationId", run.conversationId),
			)
			.order("desc")
			.take(args.limit + 3);
		const sources = [];
		let characters = 0;
		let limited = messages.length === args.limit + 3;
		for (const message of messages) {
			if (message.runId === args.runId || !message.content.trim()) continue;
			if (
				sources.length === args.limit ||
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
		return { sources: sources.reverse(), limited };
	},
});

export const cached = query({
	args: { ...identity, keys: v.array(v.string()) },
	returns: v.array(v.string()),
	handler: async (ctx, args) => {
		await authorize(ctx, args);
		if (args.keys.length > 220)
			throw new ConvexError("Too many retrieval sources");
		const rows = await Promise.all(
			args.keys.map((key) =>
				ctx.db
					.query("retrievalSources")
					.withIndex("by_key", (q) => q.eq("key", key))
					.unique(),
			),
		);
		return rows.flatMap((row) =>
			row &&
			row.workspaceId === args.workspaceId &&
			row.scope === args.scope &&
			row.expiresAt > Date.now()
				? [row.key]
				: [],
		);
	},
});

async function removeSource(ctx: MutationCtx, source: Doc<"retrievalSources">) {
	const chunks = await ctx.db
		.query("retrievalChunks")
		.withIndex("by_source", (q) => q.eq("sourceKey", source.key))
		.take(MAX_SOURCE_CHUNKS);
	await Promise.all(chunks.map((chunk) => ctx.db.delete(chunk._id)));
	await ctx.db.delete(source._id);
}

export const put = mutation({
	args: {
		...identity,
		key: v.string(),
		source: sourceValue,
		chunks: v.array(
			v.object({
				start: v.number(),
				end: v.number(),
				text: v.string(),
				embedding: v.array(v.float64()),
			}),
		),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await authorize(ctx, args);
		const source = retrievalSourceSchema.parse(args.source);
		if (
			!args.key.startsWith(`${args.workspaceId}:${args.scope}:`) ||
			args.key.length > 300
		)
			throw new ConvexError("Invalid retrieval key");
		if (source.kind === "message") {
			const id = ctx.db.normalizeId("messages", source.id);
			const message = id ? await ctx.db.get(id) : null;
			if (
				!message ||
				message.conversationId !== run.conversationId ||
				message.runId === run._id ||
				message.content !== source.content
			)
				throw new ConvexError("Retrieval message unavailable");
		} else {
			const routes = workflowRoutesSchema.parse(JSON.parse(run.routes));
			const start = routes.nodes.find((node) => node.kind === "input");
			const document =
				start?.kind === "input"
					? start.documents?.find((document) => document.id === source.id)
					: undefined;
			if (
				!document ||
				document.content !== source.content ||
				document.name !== source.label
			)
				throw new ConvexError("Retrieval document version is not declared");
		}
		if (
			args.key !==
			(await retrievalSourceKey(`${args.workspaceId}:${args.scope}`, source))
		)
			throw new ConvexError("Retrieval key does not match its source");
		if (!args.chunks.length || args.chunks.length > MAX_SOURCE_CHUNKS)
			throw new ConvexError("Invalid passage count");
		for (const chunk of args.chunks) {
			passageSchema.parse({
				start: chunk.start,
				end: chunk.end,
				text: chunk.text,
			});
			if (
				source.content.slice(chunk.start, chunk.end) !== chunk.text ||
				chunk.embedding.length !== EMBEDDING_DIMENSIONS ||
				chunk.embedding.some((value) => !Number.isFinite(value))
			)
				throw new ConvexError("Invalid indexed passage");
		}
		const existing = await ctx.db
			.query("retrievalSources")
			.withIndex("by_key", (q) => q.eq("key", args.key))
			.unique();
		if (existing) {
			if (
				existing.workspaceId !== args.workspaceId ||
				existing.scope !== args.scope
			)
				throw new ConvexError("Retrieval source unavailable");
			if (existing.expiresAt > Date.now()) return null;
			await removeSource(ctx, existing);
		}
		const retained = await ctx.db
			.query("retrievalSources")
			.withIndex("by_workspace_expiry", (q) =>
				q.eq("workspaceId", args.workspaceId),
			)
			.take(MAX_RETRIEVAL_CHUNKS + 1);
		let count = retained.reduce((sum, row) => sum + row.chunkCount, 0);
		for (const oldest of retained) {
			if (count + args.chunks.length <= MAX_RETRIEVAL_CHUNKS) break;
			await removeSource(ctx, oldest);
			count -= oldest.chunkCount;
		}
		const namespace =
			source.kind === "document"
				? args.key
				: `${args.workspaceId}:${args.scope}:conversation:${run.conversationId}`;
		await ctx.db.insert("retrievalSources", {
			workspaceId: args.workspaceId,
			scope: args.scope,
			key: args.key,
			namespace,
			sourceId: source.id,
			label: source.label,
			kind: source.kind,
			chunkCount: args.chunks.length,
			expiresAt: Date.now() + 30 * 86400000,
		});
		await Promise.all(
			args.chunks.map((chunk) =>
				ctx.db.insert("retrievalChunks", {
					...chunk,
					sourceKey: args.key,
					namespace,
				}),
			),
		);
		return null;
	},
});

async function loadSelected(
	ctx: QueryCtx,
	args: {
		workspaceId: Id<"workspaces">;
		runId: Id<"runs">;
		scope: string;
		keys: string[];
	},
) {
	const run = await authorize(ctx, args);
	const routes = workflowRoutesSchema.parse(JSON.parse(run.routes));
	const start = routes.nodes.find((node) => node.kind === "input");
	const documentKeys = new Set(
		await Promise.all(
			(start?.kind === "input" ? (start.documents ?? []) : []).map((document) =>
				retrievalSourceKey(`${args.workspaceId}:${args.scope}`, {
					id: document.id,
					label: document.name,
					kind: "document",
					content: document.content,
				}),
			),
		),
	);
	if (!args.keys.length || args.keys.length > 220)
		throw new ConvexError("Invalid retrieval selection");
	return Promise.all(
		args.keys.map(async (key) => {
			const source = await ctx.db
				.query("retrievalSources")
				.withIndex("by_key", (q) => q.eq("key", key))
				.unique();
			if (
				!source ||
				source.workspaceId !== args.workspaceId ||
				source.scope !== args.scope ||
				source.expiresAt <= Date.now() ||
				(source.kind === "document" && !documentKeys.has(key)) ||
				(source.kind === "message" &&
					source.namespace !==
						`${args.workspaceId}:${args.scope}:conversation:${run.conversationId}`)
			)
				throw new ConvexError("Retrieval index unavailable. Retry the turn.");
			return {
				key,
				namespace: source.namespace,
				sourceId: source.sourceId,
				label: source.label,
				kind: source.kind,
			};
		}),
	);
}

export const selected = internalQuery({
	args: { ...identity, keys: v.array(v.string()) },
	returns: v.array(
		v.object({
			key: v.string(),
			namespace: v.string(),
			sourceId: v.string(),
			label: v.string(),
			kind: v.union(v.literal("document"), v.literal("message")),
		}),
	),
	handler: loadSelected,
});

export const lexical = internalQuery({
	args: {
		...identity,
		namespace: v.string(),
		text: v.string(),
		limit: v.number(),
	},
	returns: v.array(v.id("retrievalChunks")),
	handler: async (ctx, args) => {
		await authorize(ctx, args);
		return (
			await ctx.db
				.query("retrievalChunks")
				.withSearchIndex("by_text", (q) =>
					q.search("text", args.text).eq("namespace", args.namespace),
				)
				.take(args.limit)
		).map((row) => row._id);
	},
});

export const hydrate = internalQuery({
	args: {
		...identity,
		keys: v.array(v.string()),
		ids: v.array(v.id("retrievalChunks")),
	},
	returns: v.array(candidateValue),
	handler: async (ctx, args): Promise<RetrievalCandidate[]> => {
		const sources = await loadSelected(ctx, {
			workspaceId: args.workspaceId,
			runId: args.runId,
			scope: args.scope,
			keys: args.keys,
		});
		const byKey = new Map(sources.map((source) => [source.key, source]));
		if (args.ids.length > 256) throw new ConvexError("Too many retrieval hits");
		const result: RetrievalCandidate[] = [];
		for (const [index, id] of args.ids.entries()) {
			const chunk = await ctx.db.get(id);
			const source = chunk && byKey.get(chunk.sourceKey);
			if (!chunk || !source) continue;
			result.push({
				id,
				sourceId: source.sourceId,
				label: source.label,
				kind: source.kind,
				start: chunk.start,
				end: chunk.end,
				text: chunk.text,
				rank: index + 1,
			});
		}
		return result;
	},
});

export const search = action({
	args: {
		...identity,
		keys: v.array(v.string()),
		vector: v.array(v.float64()),
		text: v.string(),
		limit: v.number(),
	},
	returns: v.array(candidateValue),
	handler: async (ctx, args): Promise<RetrievalCandidate[]> => {
		if (
			args.vector.length !== EMBEDDING_DIMENSIONS ||
			args.vector.some((n) => !Number.isFinite(n)) ||
			!Number.isInteger(args.limit) ||
			args.limit < 4 ||
			args.limit > 32
		)
			throw new ConvexError("Invalid retrieval search");
		const sources = await ctx.runQuery(internal.retrieval.selected, {
			workspaceId: args.workspaceId,
			runId: args.runId,
			scope: args.scope,
			keys: args.keys,
		});
		const namespaces = [...new Set(sources.map((source) => source.namespace))];
		if (namespaces.length > 21)
			throw new ConvexError("Too many retrieval collections");
		const keyword = (args.text.match(/[\p{L}\p{N}_-]+/gu) ?? [])
			.slice(0, 16)
			.join(" ");
		const [vectors, words] = await Promise.all([
			ctx.vectorSearch("retrievalChunks", "by_embedding", {
				vector: args.vector,
				limit: 64,
				filter: (q) =>
					q.or(...namespaces.map((namespace) => q.eq("namespace", namespace))),
			}),
			keyword
				? Promise.all(
						namespaces.map((namespace) =>
							ctx.runQuery(internal.retrieval.lexical, {
								workspaceId: args.workspaceId,
								runId: args.runId,
								scope: args.scope,
								namespace,
								text: keyword,
								limit: args.limit,
							}),
						),
					)
				: Promise.resolve([]),
		]);
		const fused = new Map<Id<"retrievalChunks">, number>();
		for (const list of [vectors.map((hit) => hit._id), ...words])
			for (const [rank, id] of list.entries())
				fused.set(id, (fused.get(id) ?? 0) + 1 / (60 + rank + 1));
		const ids = [...fused]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, 256)
			.map(([id]) => id);
		const result = await ctx.runQuery(internal.retrieval.hydrate, {
			workspaceId: args.workspaceId,
			runId: args.runId,
			scope: args.scope,
			keys: args.keys,
			ids,
		});
		return result.slice(0, args.limit);
	},
});

export const expire = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const sources = await ctx.db
			.query("retrievalSources")
			.withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now()))
			.take(5);
		for (const source of sources) await removeSource(ctx, source);
		if (sources.length === 5)
			await ctx.scheduler.runAfter(0, internal.retrieval.expire, {});
		return null;
	},
});
