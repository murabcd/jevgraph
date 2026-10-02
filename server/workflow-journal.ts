import type { ProviderCall } from "../src/lib/usage.ts";
import {
	interruptedJournalCalls,
	MAX_JOURNAL_BYTES,
	MAX_NODE_ATTEMPTS,
	type PendingCall,
	type WorkflowJournalState,
	type WorkflowStep,
	workflowJournalSchema,
} from "../src/lib/workflow-journal.ts";
import type { ProviderEvidence } from "./provider-evidence.ts";

/** Serializes fenced write-ahead attempts and completed steps before downstream work. */
export class WorkflowJournal {
	readonly state: WorkflowJournalState;
	private steps: Map<string, WorkflowStep>;
	private pending: Promise<void> = Promise.resolve();
	private failure: Error | undefined;
	private write: (json: string) => Promise<void>;
	private evidence: ProviderEvidence;
	constructor(
		state: WorkflowJournalState,
		write: (json: string) => Promise<void>,
		evidence: ProviderEvidence,
	) {
		this.state = state;
		this.write = write;
		this.evidence = evidence;
		this.steps = new Map(state.steps.map((step) => [step.key, step]));
		// A lost worker cannot prove completion, usage, or duration of these attempts.
		state.calls = interruptedJournalCalls(state);
		state.pendingCalls = [];
	}
	get failed() {
		return this.failure !== undefined;
	}
	get(key: string) {
		return this.steps.get(key);
	}
	async beginStep() {
		if (this.state.nodeAttempts >= MAX_NODE_ATTEMPTS)
			throw new Error("Chatflow exceeded its node attempt budget");
		this.state.nodeAttempts++;
		await this.commit();
	}
	async complete(step: WorkflowStep) {
		if (this.steps.has(step.key))
			throw new Error("Workflow step already completed");
		this.steps.set(step.key, step);
		this.state.steps.push(step);
		await this.commit();
	}
	async beforeCall(call: PendingCall, sequence: number) {
		this.state.sequence = sequence;
		this.state.pendingCalls.push(call);
		await this.commit();
	}
	async afterCall(call: ProviderCall) {
		this.state.pendingCalls = this.state.pendingCalls.filter(
			(pending) => pending.id !== call.id,
		);
		this.state.calls.push(call);
		await this.commit();
	}
	async commit() {
		if (this.failure) throw this.failure;
		try {
			this.state.providerEvidence = this.evidence.snapshot();
			const json = JSON.stringify(
				workflowJournalSchema.parse(this.state),
				(_key, value: unknown) =>
					typeof value === "string" ? this.evidence.redact(value) : value,
			);
			if (new TextEncoder().encode(json).length > MAX_JOURNAL_BYTES)
				throw new Error("Workflow checkpoint exceeds its storage limit");
			this.pending = this.pending.then(() => this.write(json));
			await this.pending;
			if (this.failure) throw this.failure;
		} catch (error) {
			this.failure =
				error instanceof Error ? error : new Error("Checkpoint storage failed");
			throw this.failure;
		}
	}
}
