import { expect, test } from "bun:test";
import { api, internal } from "../convex/_generated/api";
import { handleApi } from "../server/api";
import { ConvexPersistence } from "../server/convex-persistence";
import { resolveReplay } from "../server/replay";
import { DEFAULT_CONTEXT_POLICY } from "../src/lib/context";
import {
	assertCurrentCase,
	frozenCaseKey,
	frozenCaseSchema,
} from "../src/lib/evaluation-case";
import { DEFAULT_RETRIEVAL_POLICY } from "../src/lib/retrieval";
import { routeEvidenceKey } from "../src/lib/route-evidence";
import { readRouteStream } from "../src/lib/route-stream";
import { workflowRoutesSchema } from "../src/lib/routing";
import { createApiFixture } from "./api-fixture";
import { createConvexFixture } from "./convex-fixture";
import { configuredJevQuestion } from "./jev-question-fixture";
import { quality } from "./routing-evidence-fixture";

const routes = workflowRoutesSchema.parse({
	kind: "workflow",
	nodes: [
		{
			id: "input",
			kind: "input",
			fields: [],
			documents: [
				{ id: "policy", name: "Policy", content: "Returns in 14 days" },
			],
		},
		{
			id: "answer",
			kind: "model",
			provider: "openai",
			model: "gpt-6-luna",
			reasoningEffort: "medium",
			routing: {
				mode: "evaluate",
				quality,
				models: ["gpt-6-luna", "gemini-3.8-flash"],
				expectedOutputTokens: 100,
				expectedRequests: 1,
			},
			context: {
				...DEFAULT_CONTEXT_POLICY,
				retrieval: { ...DEFAULT_RETRIEVAL_POLICY, historyMessages: 10 },
				documents: [{ id: "policy", representation: "full" }],
			},
		},
	],
	edges: [{ id: "entry", source: "input", target: "answer" }],
});

test("registration freezes saved history and replay preserves case identity while varying one allowed candidate", async () => {
	const fixture = await createConvexFixture();
	const persistence = new ConvexPersistence(fixture.owner);
	const old = await fixture.owner.mutation(api.runs.begin, {
		conversationId: fixture.workspace.conversationId,
		requestId: crypto.randomUUID(),
		routes: JSON.stringify(routes),
		input: JSON.stringify({
			messages: [{ role: "user", content: "My order is 123" }],
			metadata: {},
		}),
	});
	await fixture.owner.mutation(internal.runs.expire, { runId: old.runId });
	const registered = await persistence.begin({
		conversationId: fixture.workspace.conversationId,
		requestId: crypto.randomUUID(),
		routes,
		input: {
			messages: [{ role: "user", content: "Return this" }],
			metadata: {},
		},
		evaluation: { scope: "a".repeat(64) },
	});
	expect(
		registered.input.history.sources.map((source) => source.content),
	).toEqual(["My order is 123"]);
	const source = registered.input.history.sources[0];
	await fixture.t.run(async (ctx) => {
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_run", (q) => q.eq("runId", old.runId))
			.take(2);
		await ctx.db.patch(messages[0]._id, {
			content: "Changed after registration",
		});
	});
	const history = await persistence
		.retrievalStore(registered.workspaceId, registered.runId, "a".repeat(64))
		.history(10);
	expect(history.sources).toEqual([source]);
	await fixture.owner.mutation(internal.runs.expire, {
		runId: registered.runId,
	});
	const candidate = await resolveReplay(persistence, {
		runId: registered.runId,
		conversationId: fixture.workspace.conversationId,
		requestId: crypto.randomUUID(),
		candidate: { nodeId: "answer", model: "gemini-3.8-flash" },
	});
	expect(candidate.messages).toEqual(registered.input.messages);
	expect(await routeEvidenceKey(candidate.routes, "answer")).toBe(
		await routeEvidenceKey(routes, "answer"),
	);
	const replay = await persistence.begin({
		conversationId: candidate.conversationId,
		requestId: candidate.requestId,
		routes: candidate.routes,
		input: { messages: candidate.messages, metadata: candidate.metadata },
		replayRunId: registered.runId,
		evaluation: { scope: "a".repeat(64) },
	});
	expect(await frozenCaseKey(replay.input)).toBe(
		await frozenCaseKey(registered.input),
	);
	expect(replay.input.history.sources).toEqual([source]);
	const rows = await fixture.t.run((ctx) => ctx.db.query("runs").collect());
	expect(
		rows.find((row) => row._id === replay.runId)?.evaluation?.caseKey,
	).toBe(rows.find((row) => row._id === registered.runId)?.evaluation?.caseKey);
	const other = await createConvexFixture(fixture.t);
	await expect(
		other.owner.query(api.runs.inspect, { runId: registered.runId }),
	).rejects.toThrow("Conversation unavailable");
	await expect(
		resolveReplay(persistence, {
			runId: registered.runId,
			conversationId: candidate.conversationId,
			requestId: crypto.randomUUID(),
			candidate: { nodeId: "answer", model: "unsupported" },
		}),
	).rejects.toThrow("allowed model");
});

test("frozen cases reject version drift and include all selected history in case identity", async () => {
	const fixture = await createConvexFixture();
	const run = await fixture.owner.mutation(api.runs.begin, {
		conversationId: fixture.workspace.conversationId,
		requestId: crypto.randomUUID(),
		routes: JSON.stringify(routes),
		input: JSON.stringify({
			messages: [{ role: "user", content: "Return" }],
			metadata: {},
		}),
	});
	const input = frozenCaseSchema.parse(JSON.parse(run.input));
	expect(() =>
		assertCurrentCase({
			...input,
			versions: { ...input.versions, prompts: "changed" },
		}),
	).toThrow("different runtime");
	expect(
		await frozenCaseKey({
			...input,
			history: {
				conversationId: input.history.conversationId,
				sources: [
					{
						id: "prior",
						kind: "message",
						label: "user",
						content: "different order",
					},
				],
				limited: false,
			},
		}),
	).not.toBe(await frozenCaseKey(input));
});

test("authenticated replay follows registration, exact input reuse and request deduplication", async () => {
	const fixture = await createApiFixture();
	const packets: string[] = [];
	const options = {
		keys: { TYPESAFE_API_KEY: "test-key" },
		connect: fixture.connect,
		providerFetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
			packets.push(String(init?.body));
			return Response.json({
				model: "jev-1.13.0",
				answers: { task: { type: "noul", noul: 0.99 } },
				usage: { input_tokens: 10, output_tokens: 0 },
			});
		},
	};
	const original = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				messages: [{ role: "user", content: "Frozen question" }],
				routes: {
					kind: "workflow",
					nodes: [
						{ id: "input", kind: "input", fields: [] },
						{
							id: "judge",
							kind: "jev",
							question: configuredJevQuestion("noul"),
						},
					],
					edges: [{ id: "entry", source: "input", target: "judge" }],
				},
			}),
		}),
		options,
	);
	await readRouteStream(original, () => {});
	const runId = original.headers.get("X-Run-Id");
	expect(runId).toBeTruthy();
	const replayRequest = { ...fixture.requestFields(), runId };
	const replay = await handleApi(
		new Request("http://localhost/api/replay", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify(replayRequest),
		}),
		options,
	);
	const events: string[] = [];
	await readRouteStream(replay, (event) => events.push(event.type));
	expect(events.at(-1)).toBe("done");
	expect(packets).toHaveLength(2);
	expect(packets[0]).toBe(packets[1]);
	const duplicate = await handleApi(
		new Request("http://localhost/api/replay", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify(replayRequest),
		}),
		options,
	);
	expect(duplicate.status).toBe(502);
	expect(packets).toHaveLength(2);
});
