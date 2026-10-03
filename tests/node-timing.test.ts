import { expect, test } from "bun:test";
import { ProviderEvidence } from "../server/provider-evidence";
import { ProviderLedger } from "../server/provider-ledger";
import { ProviderUsageError } from "../server/provider-usage";
import { WorkflowJournal } from "../server/workflow-journal";
import type { RouteStreamEvent } from "../src/lib/routing";
import {
	emptyWorkflowJournal,
	workflowJournalSchema,
} from "../src/lib/workflow-journal";

const identity = {
	nodeId: "model",
	purpose: "model",
	provider: "google",
	model: "gemini-3.8-flash",
} as const;

test("paid attempts share live and saved durations and retain failed validation usage", async () => {
	const events: RouteStreamEvent[] = [];
	const ledger = new ProviderLedger({
		onRecorded: () => {},
		onTiming: (event) => events.push(event),
	});
	await ledger.run(identity, undefined, ledger.nextId(), async () => ({
		model: identity.model,
	}));
	const failure = new ProviderUsageError(
		new Error("Invalid assessment"),
		{ inputTokens: 50, outputTokens: 2 },
		"jev-1.13.0",
	);
	await expect(
		ledger.run(
			{ ...identity, purpose: "routing", provider: "jev", model: "jev-latest" },
			undefined,
			ledger.nextId(),
			async () => {
				throw failure;
			},
		),
	).rejects.toBe(failure);
	expect(events.map((event) => event.type)).toEqual([
		"node-start",
		"timing",
		"node-start",
		"timing",
	]);
	const timings = events.flatMap((event) =>
		event.type === "timing" ? [event.timing] : [],
	);
	expect(timings).toEqual(
		ledger.calls.map((call) => ({
			nodeId: call.nodeId,
			durationMs: call.durationMs,
			status: call.status,
		})),
	);
	expect(ledger.calls[0].usage).toBeUndefined();
	expect(ledger.calls[1]).toMatchObject({
		status: "failed",
		model: "jev-1.13.0",
		usage: { inputTokens: 50, outputTokens: 2 },
	});
});

test("timing and paid work wait for a durable reservation and acknowledgment precedes return", async () => {
	const events: RouteStreamEvent[] = [];
	const reservation = Promise.withResolvers<void>();
	const entered = Promise.withResolvers<void>();
	const operation = Promise.withResolvers<{ model: string }>();
	const acknowledgmentEntered = Promise.withResolvers<void>();
	const acknowledgment = Promise.withResolvers<void>();
	const evidence = new ProviderEvidence();
	const journal = new WorkflowJournal(
		emptyWorkflowJournal("run"),
		async (json) => {
			if (workflowJournalSchema.parse(JSON.parse(json)).pendingCalls.length) {
				entered.resolve();
				await reservation.promise;
			} else {
				acknowledgmentEntered.resolve();
				await acknowledgment.promise;
			}
		},
		evidence,
	);
	const ledger = new ProviderLedger({
		onRecorded: () => {},
		evidence,
		journal,
		onTiming: (event) => events.push(event),
	});
	let paid = 0;
	const attempt = ledger.run(identity, undefined, ledger.nextId(), () => {
		paid++;
		return operation.promise;
	});
	let returned = false;
	void attempt.then(() => {
		returned = true;
	});
	await entered.promise;
	expect(paid).toBe(0);
	expect(events).toEqual([]);
	reservation.resolve();
	await Promise.resolve();
	operation.resolve({ model: identity.model });
	await acknowledgmentEntered.promise;
	expect(returned).toBe(false);
	acknowledgment.resolve();
	await attempt;
	expect(paid).toBe(1);
	expect(events[0]).toEqual({ type: "node-start", nodeId: "model" });
	expect(journal.state.pendingCalls).toEqual([]);
	expect(journal.state.calls).toEqual(ledger.calls);
});

test("failed reservations produce neither paid work nor fabricated timing", async () => {
	const events: RouteStreamEvent[] = [];
	const evidence = new ProviderEvidence();
	const journal = new WorkflowJournal(
		emptyWorkflowJournal("run"),
		async () => {
			throw new Error("Checkpoint unavailable");
		},
		evidence,
	);
	const ledger = new ProviderLedger({
		onRecorded: () => {},
		evidence,
		journal,
		onTiming: (event) => events.push(event),
	});
	let paid = 0;
	await expect(
		ledger.run(identity, undefined, ledger.nextId(), async () => {
			paid++;
			return { model: identity.model };
		}),
	).rejects.toThrow("Checkpoint unavailable");
	expect(paid).toBe(0);
	expect(events).toEqual([]);
	expect(ledger.calls).toEqual([]);
});
