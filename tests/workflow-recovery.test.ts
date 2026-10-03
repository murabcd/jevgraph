import { expect, test } from "bun:test";
import { api, internal } from "../convex/_generated/api";
import { handleApi } from "../server/api";
import { ConvexPersistence } from "../server/convex-persistence";
import { ProviderEvidence } from "../server/provider-evidence";
import { contentFingerprint } from "../server/session-memory";
import { executeWorkflow } from "../server/workflow";
import { RunExecution, WorkflowJournal } from "../server/workflow-journal";
import { resolveJevAnswer } from "../src/lib/jev-question";
import { readRouteStream } from "../src/lib/route-stream";
import {
	type RouteResult,
	type RouteStreamEvent,
	type WorkflowRoutes,
	workflowRoutesSchema,
} from "../src/lib/routing";
import { runArtifactSchema } from "../src/lib/run-artifact";
import {
	emptyWorkflowJournal,
	workflowJournalSchema,
} from "../src/lib/workflow-journal";
import { createApiFixture } from "./api-fixture";
import { configuredJevQuestion } from "./jev-question-fixture";

const keys = {
	GOOGLE_GENERATIVE_AI_API_KEY: "fixture-google",
	TYPESAFE_API_KEY: "fixture-jev",
};
const scope = contentFingerprint(
	JSON.stringify([
		keys.TYPESAFE_API_KEY,
		undefined,
		keys.GOOGLE_GENERATIVE_AI_API_KEY,
	]),
);
function model(id: string) {
	return {
		id,
		kind: "model" as const,
		provider: "google" as const,
		model: "gemini-3.8-flash",
		prompt: `STAGE:${id}`,
	};
}
function generated(text: string) {
	return new Response(
		`data: ${JSON.stringify({ candidates: [{ index: 0, content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 }, modelVersion: "gemini-3.8-flash" })}\n\n`,
		{ headers: { "Content-Type": "text/event-stream" } },
	);
}
const linear: WorkflowRoutes = {
	kind: "workflow",
	nodes: [
		{ id: "input", kind: "input", fields: [] },
		model("draft"),
		{ id: "judge", kind: "jev", questions: [configuredJevQuestion("noul")] },
		model("final"),
	],
	edges: [
		{ id: "entry", source: "input", target: "draft" },
		{ id: "review", source: "draft", sourceHandle: "next", target: "judge" },
		{
			id: "answer",
			source: "judge",
			sourceHandle: "question/yes",
			target: "final",
		},
		{ id: "no", source: "judge", sourceHandle: "question/no", target: "final" },
	],
};

test("a fresh API worker resumes the frozen run without repeating completed generation or decisions", async () => {
	workflowRoutesSchema.parse(linear);
	const fixture = await createApiFixture();
	const abort = new AbortController();
	const transports: string[] = [];
	const fields = fixture.requestFields();
	const response = await handleApi(
		new Request("http://local/api/route", {
			method: "POST",
			headers: fixture.headers,
			signal: abort.signal,
			body: JSON.stringify({
				...fields,
				routes: linear,
				messages: [{ role: "user", content: "ORIGINAL_QUERY" }],
			}),
		}),
		{
			keys,
			connect: fixture.connect,
			providerFetch: async (_, init) => {
				const body = String(init?.body);
				if (body.includes('"questions"')) {
					transports.push("judge");
					return Response.json({
						model: "jev-1.13.0",
						answers: { question: { type: "noul", noul: 0.99 } },
						usage: { input_tokens: 5, output_tokens: 0 },
					});
				}
				if (body.includes("STAGE:draft")) {
					transports.push("draft");
					return generated("FROZEN_DRAFT");
				}
				transports.push("interrupted-final");
				abort.abort(new Error("worker disconnected"));
				throw abort.signal.reason;
			},
		},
	);
	await expect(readRouteStream(response, () => {})).rejects.toThrow();
	const saved = await fixture.owner.query(api.runs.latest, {
		conversationId: fixture.workspace.conversationId,
	});
	if (!saved) throw new Error("Run missing");
	expect(saved.resumable).toBe(true);
	expect(saved.status).toBe("interrupted");
	// Editing the workspace cannot change the registered graph or input.
	await fixture.owner.mutation(api.workspaces.save, {
		id: fixture.id,
		revision: fixture.workspace.revision,
		graph: fixture.workspace.graph,
	});
	let result: RouteResult | undefined;
	const resumed = await handleApi(
		new Request("http://local/api/resume", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({ runId: saved.runId }),
		}),
		{
			keys,
			connect: () => new ConvexPersistence(fixture.owner),
			providerFetch: async (_, init) => {
				const body = String(init?.body);
				expect(body).toContain("STAGE:final");
				expect(body).toContain("ORIGINAL_QUERY");
				expect(body).toContain("FROZEN_DRAFT");
				transports.push("resumed-final");
				return generated("RECOVERED_ANSWER");
			},
		},
	);
	await readRouteStream(resumed, (event) => {
		if (event.type === "done") result = event.route;
	});
	expect(transports).toEqual([
		"draft",
		"judge",
		"interrupted-final",
		"resumed-final",
	]);
	expect(resumed.headers.get("X-Run-Id")).toBe(saved.runId);
	expect(result?.text).toBe("RECOVERED_ANSWER");
	expect(result?.calls.map((call) => call.nodeId)).toEqual([
		"draft",
		"judge",
		"final",
		"final",
	]);
	expect(result?.usage.complete).toBe(false);
	expect(result?.jevSteps).toHaveLength(1);
	const records = await fixture.t.run(async (ctx) => ({
		runs: await ctx.db.query("runs").collect(),
		messages: await ctx.db.query("messages").collect(),
		checkpoint: await ctx.db.query("runCheckpoints").unique(),
	}));
	expect(records.runs).toHaveLength(1);
	expect(records.messages).toHaveLength(2);
	expect(records.checkpoint?.file).toBeUndefined();
	expect(records.checkpoint?.cancelled).toBe(false);
	const duplicate = await fixture.owner.mutation(api.runs.begin, {
		conversationId: fields.conversationId,
		requestId: fields.requestId,
		routes: JSON.stringify(linear),
		input: JSON.stringify({
			messages: [{ role: "user", content: "ORIGINAL_QUERY" }],
		}),
	});
	expect(duplicate.started).toBe(false);
});

test("an abandoned write-ahead attempt retains unknown usage and duration after explicit recovery", async () => {
	const fixture = await createApiFixture();
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [{ id: "input", kind: "input", fields: [] }, model("final")],
		edges: [{ id: "entry", source: "input", target: "final" }],
	};
	const started = await fixture.owner.mutation(api.runs.begin, {
		...fixture.requestFields(),
		routes: JSON.stringify(routes),
		input: JSON.stringify({ messages: [{ role: "user", content: "Crash" }] }),
		evaluation: { scope },
	});
	const state = emptyWorkflowJournal(started.runId);
	state.nodeAttempts = 2;
	state.sequence = 1;
	state.steps.push({
		key: "0:input",
		nodeId: "input",
		edges: routes.edges,
		exhausted: false,
	});
	state.pendingCalls.push({
		id: "call:1",
		nodeId: "final",
		purpose: "model",
		provider: "google",
		model: "gemini-3.8-flash",
	});
	await fixture.owner.action(api.checkpoints.save, {
		runId: started.runId,
		executionId: started.executionId,
		revision: 0,
		journal: JSON.stringify(state),
	});
	await fixture.t.mutation(internal.runs.expire, {
		runId: started.runId,
		executionId: started.executionId,
	});
	const response = await handleApi(
		new Request("http://local/api/resume", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({ runId: started.runId }),
		}),
		{
			keys,
			connect: () => new ConvexPersistence(fixture.owner),
			providerFetch: async () => generated("Recovered"),
		},
	);
	let result: RouteResult | undefined;
	await readRouteStream(response, (event) => {
		if (event.type === "done") result = event.route;
	});
	expect(result?.calls[0]).toMatchObject({ id: "call:1", status: "failed" });
	expect(result?.calls[0].durationMs).toBeUndefined();
	expect(result?.calls[0].usage).toBeUndefined();
	expect(result?.calls[1].id).toBe("call:2");
	expect(result?.usage.costComplete).toBe(false);
	const artifact = await fixture.t.run(async (ctx) => {
		const run = await ctx.db.get(started.runId);
		if (!run?.resultFile) throw new Error("Result missing");
		const blob = await ctx.storage.get(run.resultFile);
		if (!blob) throw new Error("File missing");
		return runArtifactSchema.parse(JSON.parse(await blob.text()));
	});
	expect(artifact.evidenceCoverage).not.toBe("complete");
});

test("recovery skips a completed parallel sibling and joins its saved output once", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			model("a"),
			model("b"),
			model("join"),
		],
		edges: [
			{ id: "a", source: "input", target: "a" },
			{ id: "b", source: "input", target: "b" },
			{ id: "aj", source: "a", target: "join" },
			{ id: "bj", source: "b", target: "join" },
		],
	};
	let stored = emptyWorkflowJournal("run");
	const writer = async (json: string) => {
		stored = workflowJournalSchema.parse(JSON.parse(json));
	};
	const invoke = (
		journal: WorkflowJournal,
		runModel: Parameters<typeof executeWorkflow>[0]["runModel"],
		signal?: AbortSignal,
	) =>
		executeWorkflow({
			routes,
			messages: [{ role: "user", content: "Join" }],
			metadata: {},
			journal,
			signal,
			runModel,
			evaluate: async () => {
				throw new Error("Unexpected Jev");
			},
			onDelta: () => {},
			onRoute: () => {},
			onProgress: () => {},
		});
	const abort = new AbortController();
	await expect(
		invoke(
			new WorkflowJournal(stored, writer, new ProviderEvidence()),
			async ({ target }) => {
				if (target.nodeId === "b") {
					await Bun.sleep(20);
					abort.abort();
					throw new Error("Disconnected");
				}
				return { text: "SAVED_A", model: target.model };
			},
			abort.signal,
		),
	).rejects.toThrow();
	expect(stored.steps.map((step) => step.nodeId)).toEqual(["input", "a"]);
	const invoked: string[] = [];
	const result = await invoke(
		new WorkflowJournal(
			structuredClone(stored),
			writer,
			new ProviderEvidence(),
		),
		async ({ target, context }) => {
			invoked.push(target.nodeId);
			if (target.nodeId === "join")
				expect(context.inputs.map((output) => output.text)).toEqual([
					"SAVED_A",
					"NEW_B",
				]);
			return {
				text: target.nodeId === "b" ? "NEW_B" : "JOINED",
				model: target.model,
			};
		},
	);
	expect(invoked).toEqual(["b", "join"]);
	expect(result.text).toBe("JOINED");
	expect(result.calls).toHaveLength(4);
});

test("a journal write failure stops before paid work and never enables model backup", async () => {
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			model("primary"),
			model("backup"),
		],
		edges: [
			{ id: "entry", source: "input", target: "primary" },
			{
				id: "backup",
				source: "primary",
				sourceHandle: "fallback",
				target: "backup",
			},
		],
	};
	let providers = 0;
	const journal = new WorkflowJournal(
		emptyWorkflowJournal("run"),
		async (json) => {
			if (workflowJournalSchema.parse(JSON.parse(json)).pendingCalls.length)
				throw new Error("Database failed");
		},
		new ProviderEvidence(),
	);
	await expect(
		executeWorkflow({
			routes,
			messages: [{ role: "user", content: "Run" }],
			metadata: {},
			journal,
			evaluate: async () => {
				throw new Error("Unexpected Jev");
			},
			runModel: async ({ target }) => {
				providers++;
				return { text: "wrong", model: target.model };
			},
			onDelta: () => {},
			onRoute: () => {},
			onProgress: () => {},
		}),
	).rejects.toThrow("Database failed");
	expect(providers).toBe(0);
	expect(journal.failed).toBe(true);
	await expect(journal.commit()).rejects.toThrow("Database failed");
});

test.each(["backup", "repeat"] as const)(
	"recovery reconstructs %s stage identity without repeating completed work",
	async (scenario) => {
		const routes: WorkflowRoutes =
			scenario === "backup"
				? {
						kind: "workflow",
						nodes: [
							{ id: "input", kind: "input", fields: [] },
							model("primary"),
							model("backup"),
							model("final"),
						],
						edges: [
							{ id: "entry", source: "input", target: "primary" },
							{
								id: "backup",
								source: "primary",
								sourceHandle: "fallback",
								target: "backup",
							},
							{
								id: "next",
								source: "primary",
								sourceHandle: "next",
								target: "final",
							},
						],
					}
				: {
						...linear,
						nodes: linear.nodes.map((node) =>
							node.kind === "jev" ? { ...node, maxRepeats: 1 } : node,
						),
						edges: linear.edges
							.filter((edge) => edge.id !== "no")
							.concat({
								id: "repeat",
								source: "judge",
								sourceHandle: "question/no",
								target: "draft",
								repeat: true,
							}),
					};
		workflowRoutesSchema.parse(routes);
		let stored = emptyWorkflowJournal("run");
		const writer = async (json: string) => {
			stored = workflowJournalSchema.parse(JSON.parse(json));
		};
		const invoke = (
			runModel: Parameters<typeof executeWorkflow>[0]["runModel"],
			signal?: AbortSignal,
		) =>
			executeWorkflow({
				routes,
				messages: [{ role: "user", content: "Review" }],
				metadata: {},
				journal: new WorkflowJournal(
					structuredClone(stored),
					writer,
					new ProviderEvidence(),
				),
				signal,
				runModel,
				evaluate: async () => ({
					model: "jev-1.13.0",
					latencyMs: 1,
					answers: [
						{
							questionId: "question",
							type: "noul",
							branch: "question/no",
							value: "no",
							confidence: 0.95,
						},
					],
				}),
				onDelta: () => {},
				onRoute: () => {},
				onProgress: () => {},
			});
		const abort = new AbortController();
		let drafts = 0;
		await expect(
			invoke(async ({ target }) => {
				if (target.nodeId === "primary") throw new Error("Primary unavailable");
				if (
					target.nodeId === "final" ||
					(target.nodeId === "draft" && drafts++ > 0)
				) {
					abort.abort();
					throw new Error("Worker lost");
				}
				return { text: "SAVED_DRAFT", model: target.model };
			}, abort.signal),
		).rejects.toThrow("Worker lost");
		const calls: string[] = [];
		const result = await invoke(async ({ target, context }) => {
			calls.push(target.nodeId);
			if (scenario === "backup")
				expect(context.inputs[0]).toMatchObject({
					sourceNodeId: "primary",
					nodeId: "backup",
					revision: 1,
				});
			return { text: "RESUMED_DRAFT", model: target.model };
		});
		expect(calls).toEqual([scenario === "backup" ? "final" : "draft"]);
		if (scenario === "backup") {
			expect(result.fallbackReason).toContain("Primary unavailable");
			expect(
				result.traversedEdges.filter(
					(edge) => edge.sourceHandle === "fallback",
				),
			).toHaveLength(1);
		} else {
			expect(result.outcome).toBe("repeat-exhausted");
			expect(result.jevSteps.map((step) => step.status)).toEqual([
				"accepted",
				"exhausted",
			]);
			expect(
				result.outputs
					.filter((output) => output.nodeId === "draft")
					.map((output) => output.revision),
			).toEqual([1, 2]);
			expect(result.traversedEdges.some((edge) => edge.id === "answer")).toBe(
				false,
			);
		}
	},
);

test("a remote Stop aborts an active provider and leaves no resumable journal", async () => {
	const fixture = await createApiFixture();
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const routes: WorkflowRoutes = {
		kind: "workflow",
		nodes: [{ id: "input", kind: "input", fields: [] }, model("final")],
		edges: [{ id: "entry", source: "input", target: "final" }],
	};
	let providerAborted = false;
	const response = await handleApi(
		new Request("http://local/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				routes,
				messages: [{ role: "user", content: "Stop remotely" }],
			}),
		}),
		{
			keys,
			connect: fixture.connect,
			providerFetch: async (_, init) => {
				entered();
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => {
							providerAborted = true;
							reject(init.signal?.reason);
						},
						{ once: true },
					);
				});
			},
		},
	);
	const reading = readRouteStream(response, () => {});
	// Attach a rejection handler before the cancellation signal arrives.
	const rejected = reading.catch((error: unknown) => error);
	await started;
	const runId = response.headers.get("X-Run-Id");
	if (!runId) throw new Error("Run identity missing");
	await fixture.owner.mutation(api.checkpoints.stop, { runId });
	expect(await rejected).toBeInstanceOf(Error);
	expect(providerAborted).toBe(true);
	expect(
		(
			await fixture.owner.query(api.runs.latest, {
				conversationId: fixture.workspace.conversationId,
			})
		)?.resumable,
	).toBe(false);
	const checkpoint = await fixture.t.run((ctx) =>
		ctx.db.query("runCheckpoints").unique(),
	);
	expect(checkpoint?.cancelled).toBe(true);
	expect(checkpoint?.file).toBeUndefined();
});

test("initial checkpoint failure settles the lock without starting paid work", async () => {
	const fixture = await createApiFixture();
	class UnavailableCheckpoint extends ConvexPersistence {
		override checkpointWriter() {
			return async () => {
				throw new Error("Initial checkpoint unavailable");
			};
		}
	}
	const persistence = new UnavailableCheckpoint(fixture.owner);
	let providers = 0;
	const response = await handleApi(
		new Request("http://local/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				routes: linear,
				messages: [
					{ role: "user", content: "Do not pay without a checkpoint" },
				],
			}),
		}),
		{
			keys,
			connect: () => persistence,
			providerFetch: async () => {
				providers++;
				return generated("wrong");
			},
		},
	);
	await expect(readRouteStream(response, () => {})).rejects.toThrow(
		"Initial checkpoint unavailable",
	);
	expect(providers).toBe(0);
	const latest = await fixture.owner.query(api.runs.latest, {
		conversationId: fixture.workspace.conversationId,
	});
	expect(latest).toMatchObject({
		status: "interrupted",
		resumable: false,
		checkpointUrl: null,
		error: "Initial checkpoint unavailable",
	});
	await fixture.t.run(async (ctx) => {
		const conversation = await ctx.db.get(fixture.workspace.conversationId);
		expect(conversation?.activeRunId).toBeUndefined();
	});
});

test("run execution emits completion only after settlement and rejects a second worker", async () => {
	const fixture = await createApiFixture();
	const entered = Promise.withResolvers<void>();
	const acknowledge = Promise.withResolvers<void>();
	class PendingSettlement extends ConvexPersistence {
		override async settle(...args: Parameters<ConvexPersistence["settle"]>) {
			if (args[2].status === "completed") {
				entered.resolve();
				await acknowledge.promise;
			}
			return super.settle(...args);
		}
	}
	const execution = await RunExecution.start({
		persistence: new PendingSettlement(fixture.owner),
		credentials: [],
		signal: new AbortController().signal,
		request: {
			kind: "turn",
			input: {
				...fixture.requestFields(),
				routes: linear,
				messages: [{ role: "user", content: "Wait for durable settlement" }],
			},
		},
	});
	const events: RouteStreamEvent[] = [];
	let workers = 0;
	const completion = execution.run(
		async ({ saved, signal, journal, providerEvidence, onSnapshot }) => {
			workers++;
			return executeWorkflow({
				routes: saved.routes,
				messages: saved.input.messages,
				metadata: saved.input.metadata ?? {},
				signal,
				journal,
				providerEvidence,
				onSnapshot,
				evaluate: async (_nodeId, questions) => ({
					model: "jev-1.13.0",
					latencyMs: 1,
					answers: questions.map((question) =>
						resolveJevAnswer(
							question,
							{ type: "boolean", probability: 0.99 },
							undefined,
						),
					),
				}),
				runModel: async ({ target }) => ({
					model: target.model,
					text: "Settled answer",
				}),
				onDelta: () => {},
				onRoute: () => {},
				onProgress: () => {},
			});
		},
		(event) => events.push(event),
	);
	await Promise.race([
		entered.promise,
		completion.then(() => {
			throw new Error("Execution ended before settlement");
		}),
	]);
	expect(events.some((event) => event.type === "done")).toBe(false);
	await expect(
		execution.run(
			async () => {
				throw new Error("second worker");
			},
			() => {},
		),
	).rejects.toThrow("already started");
	expect(workers).toBe(1);
	acknowledge.resolve();
	await completion;
	expect(events.map((event) => event.type)).toEqual(["done"]);
	const latest = await fixture.owner.query(api.runs.latest, {
		conversationId: fixture.workspace.conversationId,
	});
	expect(latest?.status).toBe("completed");
});

test("cancelling the stream while settlement is pending finishes storage without another provider call", async () => {
	const fixture = await createApiFixture();
	const entered = Promise.withResolvers<void>();
	const acknowledge = Promise.withResolvers<void>();
	const stored = Promise.withResolvers<void>();
	class PendingSettlement extends ConvexPersistence {
		override async settle(...args: Parameters<ConvexPersistence["settle"]>) {
			entered.resolve();
			await acknowledge.promise;
			await super.settle(...args);
			stored.resolve();
		}
	}
	let paid = 0;
	const response = await handleApi(
		new Request("http://local/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				routes: {
					kind: "workflow",
					nodes: [{ id: "input", kind: "input", fields: [] }, model("answer")],
					edges: [{ id: "entry", source: "input", target: "answer" }],
				},
				messages: [{ role: "user", content: "Complete before disconnect" }],
			}),
		}),
		{
			keys,
			connect: () => new PendingSettlement(fixture.owner),
			providerFetch: async () => {
				paid++;
				return generated("Complete answer");
			},
		},
	);
	await entered.promise;
	if (!response.body) throw new Error("Missing response stream");
	await response.body.cancel();
	acknowledge.resolve();
	await stored.promise;
	expect(paid).toBe(1);
	const latest = await fixture.owner.query(api.runs.latest, {
		conversationId: fixture.workspace.conversationId,
	});
	expect(latest).toMatchObject({
		status: "completed",
		resumable: false,
		checkpointUrl: null,
	});
	const messages = await fixture.owner.query(api.conversations.turns, {
		conversationId: fixture.workspace.conversationId,
	});
	expect(messages.at(-1)?.content).toBe("Complete answer");
});
