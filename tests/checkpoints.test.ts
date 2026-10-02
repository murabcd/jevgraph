import { expect, test } from "bun:test";
import { api, internal } from "../convex/_generated/api";
import { ConvexPersistence } from "../server/convex-persistence";
import { ProviderEvidence } from "../server/provider-evidence";
import { ProviderLedger } from "../server/provider-ledger";
import { WorkflowJournal } from "../server/workflow-journal";
import { frozenCaseSchema } from "../src/lib/evaluation-case";
import { emptyWorkflowJournal } from "../src/lib/workflow-journal";
import { createConvexFixture } from "./convex-fixture";

const scope = "a".repeat(64);
const routes = {
	kind: "workflow",
	nodes: [
		{ id: "input", kind: "input", fields: [] },
		{
			id: "answer",
			kind: "model",
			provider: "google",
			model: "gemini-3.8-flash",
		},
	],
	edges: [{ id: "entry", source: "input", target: "answer" }],
};
async function registered() {
	const fixture = await createConvexFixture();
	const started = await fixture.owner.mutation(api.runs.begin, {
		conversationId: fixture.workspace.conversationId,
		requestId: crypto.randomUUID(),
		input: JSON.stringify({ messages: [{ role: "user", content: "Resume" }] }),
		routes: JSON.stringify(routes),
		evaluation: { scope },
	});
	const journal = emptyWorkflowJournal(started.runId);
	const args = { runId: started.runId, executionId: started.executionId };
	await fixture.owner.action(api.checkpoints.save, {
		...args,
		revision: 0,
		journal: JSON.stringify(journal),
	});
	return { ...fixture, started, journal, args };
}

test("checkpoint ownership, revision and execution token fence storage and stale workers", async () => {
	const fixture = await registered();
	const foreign = await createConvexFixture(fixture.t);
	const json = JSON.stringify(fixture.journal);
	await expect(
		foreign.owner.query(api.checkpoints.view, { runId: fixture.started.runId }),
	).rejects.toThrow();
	await expect(
		foreign.owner.action(api.checkpoints.save, {
			...fixture.args,
			revision: 1,
			journal: json,
		}),
	).rejects.toThrow();
	await expect(
		foreign.owner.mutation(api.checkpoints.stop, {
			runId: fixture.started.runId,
		}),
	).rejects.toThrow();
	// A losing CAS allocates a file, then removes it instead of leaking evidence.
	await expect(
		fixture.owner.action(api.checkpoints.save, {
			...fixture.args,
			revision: 0,
			journal: json,
		}),
	).rejects.toThrow("checkpoint");
	expect(
		await fixture.t.run((ctx) => ctx.db.system.query("_storage").collect()),
	).toHaveLength(1);
	await fixture.t.mutation(internal.runs.expire, fixture.args);
	await expect(
		fixture.owner.mutation(api.checkpoints.claim, {
			...fixture.args,
			revision: 1,
			scope: "b".repeat(64),
		}),
	).rejects.toThrow("credentials");
	const executionId = await fixture.owner.mutation(api.checkpoints.claim, {
		...fixture.args,
		revision: 1,
		scope,
	});
	await expect(
		fixture.owner.mutation(api.checkpoints.claim, {
			...fixture.args,
			revision: 1,
			scope,
		}),
	).rejects.toThrow("cannot be resumed");
	await expect(
		fixture.owner.action(api.checkpoints.save, {
			...fixture.args,
			revision: 1,
			journal: json,
		}),
	).rejects.toThrow("owns");
	await fixture.t.mutation(internal.runs.expire, fixture.args);
	expect(
		(
			await fixture.owner.query(api.runs.latest, {
				conversationId: fixture.workspace.conversationId,
			})
		)?.status,
	).toBe("running");
	await fixture.owner.query(api.checkpoints.active, {
		runId: fixture.started.runId,
		executionId,
	});
	expect(
		await fixture.t.run((ctx) => ctx.db.system.query("_storage").collect()),
	).toHaveLength(1);
});

test("Stop is final, and expiry discards its checkpoint while freeing the conversation", async () => {
	const fixture = await registered();
	await fixture.owner.mutation(api.checkpoints.stop, {
		runId: fixture.started.runId,
	});
	await expect(
		fixture.owner.query(api.checkpoints.active, fixture.args),
	).rejects.toThrow();
	await fixture.t.mutation(internal.runs.expire, fixture.args);
	expect(
		(
			await fixture.owner.query(api.runs.latest, {
				conversationId: fixture.workspace.conversationId,
			})
		)?.resumable,
	).toBe(false);
	await expect(
		new ConvexPersistence(fixture.owner).resume(fixture.started.runId, scope),
	).rejects.toThrow("cannot be resumed");
	expect(
		await fixture.t.run((ctx) => ctx.db.system.query("_storage").collect()),
	).toHaveLength(0);
	expect(
		(await fixture.t.run((ctx) => ctx.db.get(fixture.workspace.conversationId)))
			?.activeRunId,
	).toBeUndefined();
});

test("a newer turn supersedes recovery and discards the old journal", async () => {
	const fixture = await registered();
	await fixture.t.mutation(internal.runs.expire, fixture.args);
	await fixture.owner.mutation(api.runs.begin, {
		conversationId: fixture.workspace.conversationId,
		requestId: crypto.randomUUID(),
		input: JSON.stringify({
			messages: [{ role: "user", content: "New turn" }],
		}),
		routes: JSON.stringify(routes),
		evaluation: { scope },
	});
	await expect(
		new ConvexPersistence(fixture.owner).resume(fixture.started.runId, scope),
	).rejects.toThrow("cannot be resumed");
	expect(
		await fixture.t.run((ctx) => ctx.db.system.query("_storage").collect()),
	).toHaveLength(0);
});

test("recovery rejects frozen runtime drift before claiming a paid execution", async () => {
	const fixture = await registered();
	await fixture.t.mutation(internal.runs.expire, fixture.args);
	await fixture.t.run(async (ctx) => {
		const input = await ctx.db.query("runInputs").unique();
		if (!input) throw new Error("Input missing");
		const original = frozenCaseSchema.parse(JSON.parse(input.input));
		await ctx.db.patch(input._id, {
			input: JSON.stringify({
				...original,
				versions: { ...original.versions, runtime: "obsolete" },
			}),
		});
	});
	await expect(
		new ConvexPersistence(fixture.owner).resume(fixture.started.runId, scope),
	).rejects.toThrow("version");
	expect(
		(
			await fixture.owner.query(api.runs.latest, {
				conversationId: fixture.workspace.conversationId,
			})
		)?.status,
	).toBe("interrupted");
});

test("provider and node attempt budgets survive worker restart", async () => {
	const state = emptyWorkflowJournal("run");
	state.nodeAttempts = 100;
	state.sequence = 200;
	state.calls = Array.from({ length: 200 }, (_, i) => ({
		id: `call:${i + 1}`,
		nodeId: "model",
		purpose: "model" as const,
		provider: "google" as const,
		model: "gemini-3.8-flash",
		status: "failed" as const,
	}));
	let paid = 0;
	const journal = new WorkflowJournal(
		state,
		async () => {},
		new ProviderEvidence(),
	);
	const ledger = new ProviderLedger(() => {}, new ProviderEvidence(), journal);
	await expect(journal.beginStep()).rejects.toThrow("node attempt budget");
	await expect(
		ledger.run(
			{
				nodeId: "model",
				purpose: "model",
				provider: "google",
				model: "gemini-3.8-flash",
			},
			undefined,
			ledger.nextId(),
			async () => {
				paid++;
				return { model: "gemini-3.8-flash" };
			},
		),
	).rejects.toThrow("provider call budget");
	expect(paid).toBe(0);
	expect(state.nodeAttempts).toBe(100);
	expect(ledger.calls).toHaveLength(200);
});

test("a concurrent invalid checkpoint poisons earlier reservations before they can send", async () => {
	let acknowledge!: () => void;
	let entered!: () => void;
	const writing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const stored = new Promise<void>((resolve) => {
		acknowledge = resolve;
	});
	const journal = new WorkflowJournal(
		emptyWorkflowJournal("run"),
		async () => {
			entered();
			await stored;
		},
		new ProviderEvidence(),
	);
	const ledger = new ProviderLedger(() => {}, new ProviderEvidence(), journal);
	let paid = 0;
	const pending = ledger.run(
		{
			nodeId: "model",
			purpose: "model",
			provider: "google",
			model: "gemini-3.8-flash",
		},
		undefined,
		ledger.nextId(),
		async () => {
			paid++;
			return { model: "gemini-3.8-flash" };
		},
	);
	const failed = pending.catch((error: unknown) => error);
	await writing;
	journal.state.nodeAttempts = 101;
	await expect(journal.commit()).rejects.toThrow();
	acknowledge();
	expect(await failed).toBeInstanceOf(Error);
	expect(paid).toBe(0);
});

test("an expired worker cannot complete while its scheduled expiry is still queued", async () => {
	const fixture = await registered();
	await fixture.t.run((ctx) =>
		ctx.db.patch(fixture.started.runId, { expiresAt: Date.now() - 1 }),
	);
	await expect(
		fixture.owner.action(api.results.save, {
			...fixture.args,
			result: JSON.stringify({
				status: "completed",
				coverage: "complete",
				providerEvidence: [],
				result: {
					nodeId: "answer",
					provider: "google",
					model: "gemini-3.8-flash",
					outcome: "completed",
					text: "Late answer",
					reason: "Fixture completion",
					latencyMs: 1,
					path: [],
					traversedEdges: [],
					jevSteps: [],
					outputs: [],
					calls: [],
					contexts: [],
					modelPlans: [],
					usage: {
						complete: true,
						costComplete: true,
						inputTokens: 0,
						outputTokens: 0,
						estimatedCostUsd: 0,
					},
				},
			}),
		}),
	).rejects.toThrow("owns");
	expect(
		(
			await fixture.owner.query(api.runs.latest, {
				conversationId: fixture.workspace.conversationId,
			})
		)?.status,
	).toBe("running");
	expect(
		await fixture.t.run((ctx) => ctx.db.system.query("_storage").collect()),
	).toHaveLength(1);
});
