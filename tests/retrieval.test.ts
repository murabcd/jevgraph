import { expect, test } from "bun:test";
import { api, internal } from "../convex/_generated/api";
import { ConvexPersistence } from "../server/convex-persistence";
import {
	createContextRetriever,
	type RetrievalRequest,
} from "../server/retrieval";
import { DEFAULT_CONTEXT_POLICY } from "../src/lib/context";
import {
	DEFAULT_RETRIEVAL_POLICY,
	EMBEDDING_DIMENSIONS,
	retrievalSourceKey,
	splitPassages,
} from "../src/lib/retrieval";
import type { WorkflowRoutes } from "../src/lib/routing";
import { emptyRouteTrace } from "../src/lib/run-artifact";
import { createConvexFixture } from "./convex-fixture";

const document = {
	id: "returns",
	name: "Returns policy",
	content:
		"Refunds are available within 14 days. Opened medicines cannot be returned.",
};
function routes(): WorkflowRoutes {
	return {
		kind: "workflow",
		nodes: [
			{
				id: "input",
				kind: "input",
				fields: [],
				documents: [
					document,
					{ id: "private", name: "Unselected", content: "Secret policy" },
				],
			},
			{
				id: "answer",
				kind: "model",
				provider: "openai",
				model: "gpt-6-luna",
				context: {
					...DEFAULT_CONTEXT_POLICY,
					retrieval: DEFAULT_RETRIEVAL_POLICY,
					documents: [{ id: document.id, representation: "full" }],
				},
			},
		],
		edges: [{ id: "entry", source: "input", target: "answer" }],
	};
}
const scope = "a".repeat(64);
const vector = () =>
	Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
		index === 0 ? 1 : 0,
	);
const embed: RetrievalRequest["embed"] = async (values) => ({
	model: "text-embedding-3-small",
	embeddings: values.map(vector),
	usage: { inputTokens: values.length, outputTokens: 0 },
});
const rerank: RetrievalRequest["rerank"] = async ({ candidates }) => ({
	model: "jev-latest",
	grades: Object.fromEntries(
		candidates.map(({ id }) => [id, { grade: 3, confidence: 0.99 }]),
	),
});

async function setup() {
	const fixture = await createConvexFixture();
	const persistence = new ConvexPersistence(fixture.owner);
	const run = await persistence.begin({
		conversationId: fixture.workspace.conversationId,
		requestId: crypto.randomUUID(),
		question: "Can I get a refund?",
		routes: routes(),
	});
	const store = persistence.retrievalStore(run.workspaceId, run.runId, scope);
	return {
		...fixture,
		persistence,
		run,
		store,
		retrieve: createContextRetriever(store),
	};
}
function request(): RetrievalRequest {
	return {
		query: "refund",
		task: "Answer the customer using evidence",
		documents: [document],
		policy: DEFAULT_RETRIEVAL_POLICY,
		embed,
		rerank,
	};
}

test("Convex hybrid retrieval searches only indexed selections and returns exact source passages", async () => {
	const fixture = await setup();
	const result = await fixture.retrieve(request());
	expect(result.chunks).toHaveLength(1);
	expect(result.chunks[0]).toMatchObject({
		sourceId: "returns",
		content: document.content,
		passage: { start: 0, end: document.content.length },
	});
	expect(result.trace).toMatchObject({ sources: 1, reranking: "completed" });
	const saved = await fixture.t.run((ctx) =>
		ctx.db.query("retrievalSources").collect(),
	);
	expect(saved.map((source) => source.sourceId)).toEqual(["returns"]);
	const other = await createConvexFixture(fixture.t);
	await expect(
		other.owner.query(api.retrieval.cached, {
			workspaceId: fixture.id,
			runId: fixture.run.runId,
			scope,
			keys: saved.map(({ key }) => key),
		}),
	).rejects.toThrow("Workspace unavailable");
	await expect(
		fixture.owner.query(api.retrieval.cached, {
			workspaceId: fixture.id,
			runId: fixture.run.runId,
			scope: "bad",
			keys: [],
		}),
	).rejects.toThrow("Invalid retrieval scope");
});

test("indexing shares work, while changed source text gets a fresh index", async () => {
	const fixture = await setup();
	let batches = 0;
	const embedding: RetrievalRequest["embed"] = async (values) => {
		batches++;
		await Promise.resolve();
		return embed(values);
	};
	await Promise.all([
		fixture.retrieve({ ...request(), embed: embedding }),
		fixture.retrieve({ ...request(), embed: embedding }),
	]);
	expect(batches).toBe(3); // One shared source batch and two independent query embeddings.
	await createContextRetriever(fixture.store)({
		...request(),
		embed: embedding,
	});
	expect(batches).toBe(4);
	const changed = {
		...document,
		content: "Refunds are available within 30 days.",
	};
	await expect(
		fixture.retrieve({
			...request(),
			documents: [changed],
			embed: embedding,
		}),
	).rejects.toThrow("Retrieval document version is not declared");
	await fixture.persistence.fail(
		fixture.run.runId,
		"",
		"New document version",
		false,
		emptyRouteTrace(),
		0,
	);
	const updated = routes();
	const start = updated.nodes.find((node) => node.kind === "input");
	if (start?.kind !== "input") throw new Error("Start missing");
	start.documents = [changed];
	const next = await fixture.persistence.begin({
		conversationId: fixture.run.conversationId,
		requestId: crypto.randomUUID(),
		question: "Can I get a refund?",
		routes: updated,
	});
	const result = await createContextRetriever(
		fixture.persistence.retrievalStore(next.workspaceId, next.runId, scope),
	)({ ...request(), documents: [changed], embed: embedding });
	expect(result.chunks.map(({ content }) => content)).toEqual([
		changed.content,
	]);
	expect(batches).toBe(7);
});

test("retrieval rejects forged source keys and stale document versions within the same workspace", async () => {
	const fixture = await setup();
	await fixture.retrieve(request());
	const indexed = await fixture.t.run((ctx) =>
		ctx.db.query("retrievalSources").first(),
	);
	if (!indexed) throw new Error("Missing indexed source");
	const source = {
		id: document.id,
		label: document.name,
		kind: "document" as const,
		content: document.content,
	};
	await expect(
		fixture.store.put(
			`${fixture.store.identity}:${"0".repeat(64)}`,
			source,
			splitPassages(source.content).map((passage) => ({
				...passage,
				embedding: vector(),
			})),
		),
	).rejects.toThrow("Retrieval key does not match its source");
	await fixture.persistence.fail(
		fixture.run.runId,
		"",
		"Change source",
		false,
		emptyRouteTrace(),
		0,
	);
	const updated = routes();
	const start = updated.nodes.find((node) => node.kind === "input");
	if (start?.kind !== "input") throw new Error("Start missing");
	start.documents = [{ ...document, content: "Returns within 30 days" }];
	const next = await fixture.persistence.begin({
		conversationId: fixture.run.conversationId,
		requestId: crypto.randomUUID(),
		question: "Can I return this?",
		routes: updated,
	});
	await expect(
		fixture.owner.action(api.retrieval.search, {
			workspaceId: next.workspaceId,
			runId: next.runId,
			scope,
			keys: [indexed.key],
			vector: vector(),
			text: "refund",
			limit: 4,
		}),
	).rejects.toThrow("Retrieval index unavailable");
	await expect(
		fixture.owner.query(internal.retrieval.hydrate, {
			workspaceId: next.workspaceId,
			runId: next.runId,
			scope,
			keys: [indexed.key],
			ids: [],
		}),
	).rejects.toThrow("Retrieval index unavailable");
});

test("history retrieval reaches older saved messages and excludes the active pair", async () => {
	const fixture = await setup();
	await fixture.t.run(async (ctx) => {
		const oldRun = await ctx.db.insert("runs", {
			conversationId: fixture.run.conversationId,
			requestId: crypto.randomUUID(),
			routes: JSON.stringify(routes()),
			status: "completed",
			expiresAt: 0,
		});
		await ctx.db.insert("messages", {
			conversationId: fixture.run.conversationId,
			runId: oldRun,
			role: "user",
			content: "My order number is 1234",
			failed: false,
		});
	});
	const result = await fixture.retrieve({
		...request(),
		query: "order number",
		documents: [],
		policy: { ...DEFAULT_RETRIEVAL_POLICY, historyMessages: 100 },
	});
	expect(result.chunks.map(({ content }) => content)).toEqual([
		"My order number is 1234",
	]);
	expect(result.trace.sources).toBe(1);
	expect(result.trace.historyLimited).toBe(false);
});

test("history embeddings batch across messages and indexing failures stay explicit", async () => {
	const fixture = await setup();
	await fixture.t.run(async (ctx) => {
		const oldRun = await ctx.db.insert("runs", {
			conversationId: fixture.run.conversationId,
			requestId: crypto.randomUUID(),
			routes: JSON.stringify(routes()),
			status: "completed",
			expiresAt: 0,
		});
		for (let index = 0; index < 34; index++)
			await ctx.db.insert("messages", {
				conversationId: fixture.run.conversationId,
				runId: oldRun,
				role: "user",
				content: `Order history ${index}`,
				failed: false,
			});
	});
	const sizes: number[] = [];
	await fixture.retrieve({
		...request(),
		documents: [],
		policy: { ...DEFAULT_RETRIEVAL_POLICY, historyMessages: 100 },
		embed: async (values) => {
			sizes.push(values.length);
			return embed(values);
		},
	});
	expect(sizes).toEqual([16, 16, 2, 1]);
	await expect(
		createContextRetriever({
			...fixture.store,
			search: async () => {
				throw new Error("Database unavailable");
			},
		})(request()),
	).rejects.toThrow("Database unavailable");
});

test("uncertain or failed Jev reranking retains retrieval ordering and records the outcome", async () => {
	const fixture = await setup();
	const uncertain = await fixture.retrieve({
		...request(),
		rerank: async () => ({ model: "jev-latest", grades: {} }),
	});
	expect(uncertain.chunks).toHaveLength(1);
	expect(uncertain.trace.reranking).toBe("uncertain");
	const failed = await fixture.retrieve({
		...request(),
		rerank: async () => {
			throw new Error("Jev unavailable");
		},
	});
	expect(failed.trace).toMatchObject({
		reranking: "unavailable",
		error: "Jev unavailable",
	});
	expect(failed.chunks).toHaveLength(1);
	const omitted = await fixture.retrieve({
		...request(),
		rerank: async ({ candidates }) => ({
			model: "jev-latest",
			grades: Object.fromEntries(
				candidates.map(({ id }) => [id, { grade: 0.01, confidence: 0.99 }]),
			),
		}),
	});
	expect(omitted.chunks).toEqual([]);
});

test("cancelled indexing leaves no saved source and cancelled reranking cannot continue", async () => {
	const fixture = await setup();
	const controller = new AbortController();
	await expect(
		fixture.retrieve({
			...request(),
			signal: controller.signal,
			embed: async (values) => {
				controller.abort();
				return embed(values);
			},
		}),
	).rejects.toThrow();
	expect(
		await fixture.t.run((ctx) => ctx.db.query("retrievalSources").collect()),
	).toEqual([]);
	const second = new AbortController();
	await expect(
		fixture.retrieve({
			...request(),
			signal: second.signal,
			rerank: async (input) => {
				second.abort();
				return rerank(input);
			},
		}),
	).rejects.toThrow();
});

test("expired retrieval sources clean up their chunks and invalid vectors reject atomically", async () => {
	const fixture = await setup();
	await fixture.retrieve(request());
	await fixture.t.run(async (ctx) => {
		const source = await ctx.db.query("retrievalSources").first();
		if (source) await ctx.db.patch(source._id, { expiresAt: 0 });
	});
	await fixture.t.mutation(internal.retrieval.expire, {});
	expect(
		await fixture.t.run((ctx) => ctx.db.query("retrievalChunks").collect()),
	).toEqual([]);
	await expect(
		fixture.store.put(
			await retrievalSourceKey(fixture.store.identity, {
				id: document.id,
				label: document.name,
				kind: "document",
				content: document.content,
			}),
			{
				id: document.id,
				label: document.name,
				kind: "document",
				content: document.content,
			},
			[
				{
					start: 0,
					end: document.content.length,
					text: document.content,
					embedding: [1],
				},
			],
		),
	).rejects.toThrow("Invalid indexed passage");
	expect(
		await fixture.t.run((ctx) => ctx.db.query("retrievalSources").collect()),
	).toEqual([]);
});

test("passage splitting preserves offsets, Unicode boundaries and full source coverage", () => {
	expect(splitPassages(`${"a".repeat(2400)}\nremaining`)[0].text).toHaveLength(
		2400,
	);
	const text = "A😀 policy exception.\n".repeat(400);
	const chunks = splitPassages(text);
	expect(chunks.length).toBeGreaterThan(1);
	expect(chunks[0].start).toBe(0);
	expect(chunks.at(-1)?.end).toBe(text.length);
	for (const [index, chunk] of chunks.entries()) {
		expect(chunk.text).toBe(text.slice(chunk.start, chunk.end));
		expect(chunk.text.length).toBeLessThanOrEqual(2400);
		expect(chunk.text.isWellFormed()).toBe(true);
		if (index > 0) expect(chunk.start).toBeLessThan(chunks[index - 1].end);
	}
});
