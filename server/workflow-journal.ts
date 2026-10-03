import { resolveContextDocuments } from "../src/lib/context.ts";
import {
	type RouteRequest,
	type RouteResult,
	type RouteStreamEvent,
	type RouteTrace,
	resolveStartVariables,
	type WorkflowRoutes,
} from "../src/lib/routing.ts";
import type { ProviderCall } from "../src/lib/usage.ts";
import {
	ACTIVE_EXECUTION_MS,
	emptyWorkflowJournal,
	interruptedJournalCalls,
	journalTrace,
	MAX_JOURNAL_BYTES,
	MAX_NODE_ATTEMPTS,
	type PendingCall,
	type WorkflowJournalState,
	type WorkflowStep,
	workflowJournalSchema,
} from "../src/lib/workflow-journal.ts";
import type { ConvexPersistence } from "./convex-persistence.ts";
import { ProviderEvidence } from "./provider-evidence.ts";
import { contentFingerprint } from "./session-memory.ts";

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

type RegisteredExecution = Pick<
	Awaited<ReturnType<ConvexPersistence["begin"]>>,
	| "runId"
	| "executionId"
	| "workspaceId"
	| "conversationId"
	| "input"
	| "createdAt"
> & { routes: WorkflowRoutes };

export type RunExecutionContext = {
	saved: RegisteredExecution;
	credentialScope: string;
	journal: WorkflowJournal;
	providerEvidence: ProviderEvidence;
	signal: AbortSignal;
	emit: (event: Exclude<RouteStreamEvent, { type: "done" | "error" }>) => void;
	onSnapshot: (trace: RouteTrace) => void;
};

/** Owns one registered execution through acknowledgment, cancellation and settlement. */
export class RunExecution {
	readonly runId: RegisteredExecution["runId"];
	readonly evidence: ProviderEvidence;
	private saved: RegisteredExecution;
	private persistence: ConvexPersistence;
	private journal: WorkflowJournal;
	private credentialScope: string;
	private cancellation = new AbortController();
	private signal: AbortSignal;
	private ownershipTimer: ReturnType<typeof setInterval> | undefined;
	private started = false;

	private constructor({
		saved,
		persistence,
		credentialScope,
		credentials,
		signal,
		state,
		revision,
	}: {
		saved: RegisteredExecution;
		persistence: ConvexPersistence;
		credentialScope: string;
		credentials: (string | undefined)[];
		signal: AbortSignal;
		state: WorkflowJournalState;
		revision: number;
	}) {
		this.runId = saved.runId;
		this.saved = saved;
		this.persistence = persistence;
		this.credentialScope = credentialScope;
		this.signal = AbortSignal.any([
			signal,
			this.cancellation.signal,
			AbortSignal.timeout(ACTIVE_EXECUTION_MS),
		]);
		this.evidence = new ProviderEvidence(
			credentials.filter((value): value is string => value !== undefined),
			state.providerEvidence,
		);
		this.journal = new WorkflowJournal(
			state,
			persistence.checkpointWriter(saved.runId, saved.executionId, revision),
			this.evidence,
		);
	}

	static async start({
		persistence,
		request,
		credentials,
		signal,
	}: {
		persistence: ConvexPersistence;
		request:
			| { kind: "turn"; input: RouteRequest; replayRunId?: string }
			| { kind: "resume"; runId: string };
		credentials: (string | undefined)[];
		signal: AbortSignal;
	}) {
		const credentialScope = contentFingerprint(JSON.stringify(credentials));
		if (request.kind === "resume") {
			const recovery = await persistence.resume(request.runId, credentialScope);
			return new RunExecution({
				saved: recovery,
				persistence,
				credentialScope,
				credentials,
				signal,
				state: recovery.journal,
				revision: recovery.revision,
			});
		}
		const { input } = request;
		const start = input.routes.nodes.find((node) => node.kind === "input");
		if (start?.kind !== "input") throw new Error("Start is missing");
		const documents = resolveContextDocuments(
			start.documents ?? [],
			input.documents,
		);
		const metadata = Object.fromEntries(
			Object.entries(
				resolveStartVariables(start.fields, input.metadata ?? {}),
			).sort(([a], [b]) => a.localeCompare(b)),
		);
		const routes: WorkflowRoutes = {
			...input.routes,
			nodes: input.routes.nodes.map((node) =>
				node.kind === "input" && input.documents
					? { ...node, documents }
					: node,
			),
		};
		const saved = await persistence.begin({
			conversationId: input.conversationId,
			requestId: input.requestId,
			input: { messages: input.messages, metadata },
			replayRunId: request.replayRunId,
			routes,
			evaluation: { scope: credentialScope },
		});
		return new RunExecution({
			saved: { ...saved, routes },
			persistence,
			credentialScope,
			credentials,
			signal,
			state: emptyWorkflowJournal(saved.runId),
			revision: 0,
		});
	}

	cancel() {
		clearInterval(this.ownershipTimer);
		this.cancellation.abort();
	}

	async run(
		execute: (
			context: RunExecutionContext,
		) => Promise<Omit<RouteResult, "latencyMs">>,
		send: (event: RouteStreamEvent) => void,
	): Promise<void> {
		if (this.started) throw new Error("This execution has already started");
		this.started = true;
		const { saved, signal, journal, evidence, persistence } = this;
		let partialText = "";
		let latestTrace = journalTrace(journal.state);
		const emit: RunExecutionContext["emit"] = (event) => {
			if (event.type === "delta") partialText += event.text;
			send(event);
		};
		let checking = false;
		try {
			signal.throwIfAborted();
			await journal.commit();
			signal.throwIfAborted();
			this.ownershipTimer = setInterval(() => {
				if (checking || signal.aborted) return;
				checking = true;
				void persistence
					.assertExecution(saved.runId, saved.executionId)
					.catch((error) => this.cancellation.abort(error))
					.finally(() => {
						checking = false;
					});
			}, 2000);
			const response = await execute({
				saved,
				credentialScope: this.credentialScope,
				journal,
				providerEvidence: evidence,
				signal,
				emit,
				onSnapshot: (trace) => {
					latestTrace = trace;
				},
			});
			signal.throwIfAborted();
			const result = {
				...response,
				latencyMs: Math.max(0, Math.round(Date.now() - saved.createdAt)),
			};
			await persistence.settle(
				saved.runId,
				saved.executionId,
				{
					status: "completed",
					result,
					...evidence.artifactEvidence(result.calls.map((call) => call.id)),
				},
				evidence.redact,
			);
			send({ type: "done", route: result });
		} catch (error) {
			let message = evidence.redact(
				error instanceof Error ? error.message : "Chatflow failed",
			);
			try {
				await persistence.settle(
					saved.runId,
					saved.executionId,
					{
						status: signal.aborted || journal.failed ? "interrupted" : "failed",
						text: partialText,
						error: message.slice(0, 2000),
						trace: latestTrace,
						latencyMs: Math.max(0, Math.round(Date.now() - saved.createdAt)),
						...evidence.artifactEvidence(
							latestTrace.calls.map((call) => call.id),
						),
					},
					evidence.redact,
				);
			} catch (settlementError) {
				// The durable lease releases ownership if settlement cannot reach storage.
				message += evidence.redact(
					`; Could not save the failed run: ${settlementError instanceof Error ? settlementError.message : "Database unavailable"}`,
				);
			}
			send({ type: "error", error: message });
		} finally {
			clearInterval(this.ownershipTimer);
		}
	}
}
