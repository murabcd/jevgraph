import { expect, test } from "bun:test";
import { api, internal } from "../convex/_generated/api";
import { executeWorkflow } from "../server/workflow";
import { createInitialGraph, parseGraphJson } from "../src/lib/graph-snapshot";
import { workflowRoutesSchema } from "../src/lib/routing";
import { emptyRouteTrace } from "../src/lib/run-artifact";

import { createConvexFixture } from "./convex-fixture";

const graph = JSON.stringify(createInitialGraph());
const routes = workflowRoutesSchema.parse({
	kind: "workflow",
	nodes: [
		{ id: "input", kind: "input", fields: [] },
		{
			id: "model",
			kind: "model",
			provider: "google",
			model: "gemini-3.8-flash",
			maxOutputTokens: 100,
		},
	],
	edges: [{ id: "entry", source: "input", target: "model" }],
});
function request(
	conversationId: Awaited<
		ReturnType<typeof createConvexFixture>
	>["workspace"]["conversationId"],
	requestId = crypto.randomUUID(),
) {
	return {
		conversationId,
		requestId,
		input: JSON.stringify({
			messages: [
				{ role: "user", content: "Здравствуйте, когда доставят мой заказ?" },
			],
			metadata: {},
		}),
		routes: JSON.stringify(routes),
	};
}

test("Convex isolates owners and rejects stale graph writes atomically", async () => {
	const { t, owner, id, workspace } = await createConvexFixture();
	await expect(t.query(api.workspaces.current, {})).rejects.toThrow(
		"Authentication required",
	);
	const otherId = await t.run((ctx) =>
		ctx.db.insert("users", { isAnonymous: true }),
	);
	const other = t.withIdentity({ subject: `${otherId}|session` });
	expect(await other.query(api.workspaces.current, {})).toBeNull();
	await expect(
		other.mutation(api.workspaces.save, { id, revision: 0, graph }),
	).rejects.toThrow("Workspace unavailable");
	await expect(
		other.query(api.conversations.turns, {
			conversationId: workspace.conversationId,
		}),
	).rejects.toThrow("Conversation unavailable");
	const changed = parseGraphJson(graph);
	changed.nodes[0].position.x = 55;
	expect(
		await owner.mutation(api.workspaces.save, {
			id,
			revision: 0,
			graph: JSON.stringify(changed),
		}),
	).toBe(1);
	await expect(
		owner.mutation(api.workspaces.save, { id, revision: 0, graph }),
	).rejects.toThrow("changed in another tab");
	expect((await owner.query(api.workspaces.current, {}))?.graph).toBe(
		JSON.stringify(changed),
	);
	await expect(
		owner.mutation(api.workspaces.save, {
			id,
			revision: 1,
			graph: JSON.stringify({
				...changed,
				edges: [{ id: "dangling", source: "input", target: "missing" }],
			}),
		}),
	).rejects.toThrow("Invalid graph connections");
	expect((await owner.query(api.workspaces.current, {}))?.revision).toBe(1);

	expect(await owner.mutation(api.workspaces.initialize, {})).toBe(id);
});

test("Convex deduplicates requests, protects running chats, and retains partial failures", async () => {
	const { owner, id, workspace } = await createConvexFixture();
	expect(
		await owner.query(api.conversations.list, { workspaceId: id }),
	).toEqual([]);
	const input = request(workspace.conversationId);
	const first = await owner.mutation(api.runs.begin, input);
	expect(first.started).toBe(true);
	expect(await owner.mutation(api.runs.begin, input)).toEqual({
		...first,
		started: false,
	});
	await expect(
		owner.mutation(api.runs.begin, request(workspace.conversationId)),
	).rejects.toThrow("already has a running response");
	await expect(
		owner.mutation(api.conversations.start, { workspaceId: id }),
	).rejects.toThrow("Wait for the current response");
	await owner.action(api.results.save, {
		runId: first.runId,
		result: JSON.stringify({
			status: "interrupted",
			providerEvidence: [],
			text: "Проверяю заказ",
			error: "Provider stopped",
			trace: emptyRouteTrace(),
			latencyMs: 0,
			coverage: "partial",
		}),
	});
	const turns = await owner.query(api.conversations.turns, {
		conversationId: workspace.conversationId,
	});
	expect(turns).toHaveLength(2);
	expect(turns[1]).toMatchObject({
		content: "Проверяю заказ",
		failed: true,
		streaming: false,
	});
	const newId = await owner.mutation(api.conversations.start, {
		workspaceId: id,
	});
	expect(
		await owner.query(api.conversations.turns, {
			conversationId: workspace.conversationId,
		}),
	).toEqual(turns);
	const history = await owner.query(api.conversations.list, {
		workspaceId: id,
	});
	expect(history).toEqual([
		{
			id: workspace.conversationId,
			title: JSON.parse(input.input).messages[0].content,
		},
	]);
	const next = await owner.mutation(api.runs.begin, request(newId));
	expect(
		(await owner.query(api.conversations.list, { workspaceId: id })).map(
			(item) => item.id,
		),
	).toEqual([newId, workspace.conversationId]);
	await owner.action(api.results.save, {
		runId: next.runId,
		result: JSON.stringify({
			status: "failed",
			providerEvidence: [],
			text: "",
			error: "Provider stopped",
			trace: emptyRouteTrace(),
			latencyMs: 0,
			coverage: "partial",
		}),
	});
	await expect(
		owner.mutation(api.runs.begin, request(workspace.conversationId)),
	).rejects.toThrow("no longer active");
	await owner.mutation(api.conversations.open, {
		workspaceId: id,
		conversationId: workspace.conversationId,
	});
	expect((await owner.query(api.workspaces.current, {}))?.conversationId).toBe(
		workspace.conversationId,
	);
});

test("Convex stores full traces and picks the newest run by creation time", async () => {
	const { owner, workspace, t } = await createConvexFixture();
	const first = await owner.mutation(
		api.runs.begin,
		request(workspace.conversationId, "ffffffff-ffff-4fff-8fff-ffffffffffff"),
	);
	await owner.action(api.results.save, {
		runId: first.runId,
		result: JSON.stringify({
			status: "failed",
			providerEvidence: [],
			text: "",
			error: "First failed",
			trace: emptyRouteTrace(),
			latencyMs: 0,
			coverage: "partial",
		}),
	});
	const next = await owner.mutation(
		api.runs.begin,
		request(workspace.conversationId, "00000000-0000-4000-8000-000000000000"),
	);
	const response = await executeWorkflow({
		routes,
		metadata: {},
		messages: [{ role: "user", content: "Когда доставят?" }],
		evaluate: async () => {
			throw new Error("No Jev node");
		},
		runModel: async () => ({
			text: "Напишите номер заказа, пожалуйста.",
			model: "gemini-3.8-flash",
			usage: { inputTokens: 10, outputTokens: 8 },
		}),
		onDelta: () => {},
		onRoute: () => {},
		onProgress: () => {},
	});
	const result = { ...response, latencyMs: 30 };
	await owner.action(api.results.save, {
		runId: next.runId,
		result: JSON.stringify({
			status: "completed",
			coverage: "unavailable",
			providerEvidence: [],
			result: result,
		}),
	});
	const latest = await owner.query(api.runs.latest, {
		conversationId: workspace.conversationId,
	});
	expect(latest?.error).toBeUndefined();
	expect(latest?.resultUrl).toBeTruthy();
	const run = await t.run((ctx) => ctx.db.get(next.runId));
	if (!run?.resultFile) throw new Error("Result file missing");
	const fileId = run.resultFile;
	const stored = await t.run(async (ctx) => {
		const file = await ctx.storage.get(fileId);
		if (!file) throw new Error("Result bytes missing");
		return file.text();
	});
	expect(JSON.parse(stored)).toEqual({
		status: "completed",
		coverage: "unavailable",
		providerEvidence: [],
		result,
	});
	const turns = await owner.query(api.conversations.turns, {
		conversationId: workspace.conversationId,
	});
	expect(turns.at(-1)).toMatchObject({
		content: result.text,
		failed: false,
		streaming: false,
	});
	expect(JSON.parse(turns.at(-1)?.footer ?? "{}").usage.inputTokens).toBe(10);
	await owner.mutation(internal.runs.expire, { runId: next.runId });
	expect((await t.run((ctx) => ctx.db.get(next.runId)))?.status).toBe(
		"completed",
	);
});

test("Convex expires abandoned runs and scoped summaries without crossing owners", async () => {
	const { owner, workspace, t, id } = await createConvexFixture();
	const run = await owner.mutation(
		api.runs.begin,
		request(workspace.conversationId),
	);
	await owner.mutation(internal.runs.expire, { runId: run.runId });
	expect(
		(
			await owner.query(api.conversations.turns, {
				conversationId: workspace.conversationId,
			})
		)[1],
	).toMatchObject({ streaming: false, failed: true });
	const key = {
		workspaceId: id,
		scope: "a".repeat(64),
		fingerprint: "b".repeat(64),
	};
	const value = {
		short: "Нужен номер заказа",
		detailed:
			"Чтобы проверить срок доставки, сначала нужно получить номер заказа.",
	};
	await owner.mutation(api.summaries.put, { ...key, ...value });
	expect(await owner.query(api.summaries.get, key)).toEqual(value);
	expect(
		await owner.query(api.summaries.get, { ...key, scope: "c".repeat(64) }),
	).toBeNull();
	const otherId = await t.run((ctx) => ctx.db.insert("users", {}));
	await expect(
		t
			.withIdentity({ subject: `${otherId}|session` })
			.query(api.summaries.get, key),
	).rejects.toThrow("Workspace unavailable");
	await t.run(async (ctx) => {
		const item = await ctx.db.query("summaries").first();
		if (item) await ctx.db.patch(item._id, { expiresAt: 0 });
	});
	expect(await owner.query(api.summaries.get, key)).toBeNull();
	await owner.mutation(internal.summaries.expire, {});
	expect(await t.run((ctx) => ctx.db.query("summaries").take(1))).toEqual([]);
});
