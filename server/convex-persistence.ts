import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel";
import type { ContextSummaries } from "../src/lib/context.ts";
import {
	assertCurrentCase,
	type FrozenCase,
	frozenCaseSchema,
} from "../src/lib/evaluation-case.ts";
import { recordedReviewSchema } from "../src/lib/quality-review.ts";
import { routeEvidenceSchema } from "../src/lib/route-evidence.ts";
import {
	type WorkflowRoutes,
	workflowRoutesSchema,
} from "../src/lib/routing.ts";
import type { RunArtifact } from "../src/lib/run-artifact.ts";
import { workflowJournalSchema } from "../src/lib/workflow-journal.ts";
import type { RetrievalStore } from "./retrieval.ts";
import { serializeRunArtifact } from "./serialize-run-artifact.ts";
import type { SummaryStore } from "./session-memory.ts";

type PersistenceClient = Pick<
	ConvexHttpClient,
	"mutation" | "query" | "action"
>;

export class ConvexPersistence {
	private client: PersistenceClient;
	constructor(client: PersistenceClient) {
		this.client = client;
	}
	static connect(url: string, token: string) {
		const client = new ConvexHttpClient(url, {
			auth: token,
			fetch: (input, init) => {
				const request = new Request(input, init);
				return fetch(request, {
					signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
				});
			},
		});
		return new ConvexPersistence(client);
	}
	async begin(input: {
		conversationId: string;
		requestId: string;
		input: Pick<FrozenCase, "messages" | "metadata">;
		replayRunId?: string;
		routes: WorkflowRoutes;
		evaluation?: { scope: string };
	}) {
		const started = await this.client.mutation(api.runs.begin, {
			conversationId: input.conversationId,
			requestId: input.requestId,
			input: JSON.stringify(input.input),
			replayRunId: input.replayRunId,
			routes: JSON.stringify(input.routes),
			evaluation: input.evaluation,
		});
		if (!started.started)
			throw new Error(
				"This request has already started. It will not call the models again.",
			);
		return {
			...started,
			input: frozenCaseSchema.parse(JSON.parse(started.input)),
		};
	}
	async settle(
		runId: Id<"runs">,
		executionId: string,
		artifact: RunArtifact,
		redact: (text: string) => string,
	) {
		await this.client.action(api.results.save, {
			runId,
			executionId,
			result: serializeRunArtifact(artifact, redact),
		});
	}

	checkpointWriter(
		runId: Id<"runs">,
		executionId: string,
		initialRevision = 0,
	) {
		let revision = initialRevision;
		return async (journal: string) => {
			revision = await this.client.action(api.checkpoints.save, {
				runId,
				executionId,
				revision,
				journal,
			});
		};
	}
	async assertExecution(runId: Id<"runs">, executionId: string) {
		await this.client.query(api.checkpoints.active, { runId, executionId });
	}
	async resume(runId: string, scope: string) {
		const saved = await this.client.query(api.checkpoints.view, { runId });
		if (!saved.url || saved.cancelled || saved.status !== "interrupted")
			throw new Error("This run cannot be resumed");
		if (saved.scope !== scope)
			throw new Error(
				"Provider credentials changed; this run cannot be resumed",
			);
		const input = frozenCaseSchema.parse(JSON.parse(saved.input));
		assertCurrentCase(input);
		const json = await this.client.action(api.checkpoints.load, {
			runId: saved.runId,
			executionId: saved.executionId,
			revision: saved.revision,
		});
		const journal = workflowJournalSchema.parse(JSON.parse(json));
		if (journal.runId !== saved.runId)
			throw new Error("Checkpoint belongs to another run");
		const routes = workflowRoutesSchema.parse(JSON.parse(saved.routes));
		const executionId = await this.client.mutation(api.checkpoints.claim, {
			runId: saved.runId,
			executionId: saved.executionId,
			revision: saved.revision,
			scope,
		});
		return {
			...saved,
			runId: saved.runId,
			executionId,
			input,
			routes,
			journal,
			revision: saved.revision,
		};
	}

	async inspect(runId: string) {
		const saved = await this.client.query(api.runs.inspect, { runId });
		return {
			...saved,
			input: frozenCaseSchema.parse(JSON.parse(saved.input)),
			routes: workflowRoutesSchema.parse(JSON.parse(saved.routes)),
			reviews: saved.reviews.map((row) => ({
				nodeId: row.nodeId,
				review: row.review
					? recordedReviewSchema.parse({
							value: JSON.parse(row.review),
							reviewerId: row.reviewerId,
							reviewedAt: row.reviewedAt,
							expiresAt: row.expiresAt,
						})
					: undefined,
			})),
		};
	}
	async routeEvidence(
		workspaceId: Id<"workspaces">,
		scope: string,
		key: string,
	) {
		return z
			.array(routeEvidenceSchema)
			.max(2)
			.parse(
				JSON.parse(
					await this.client.query(api.routeEvaluations.evidence, {
						workspaceId,
						scope,
						key,
					}),
				),
			);
	}
	summaryStore(workspaceId: Id<"workspaces">, scope: string): SummaryStore {
		return {
			get: async (fingerprint) =>
				this.client.query(api.summaries.get, {
					workspaceId,
					scope,
					fingerprint,
				}),
			put: async (fingerprint, value: ContextSummaries) => {
				await this.client.mutation(api.summaries.put, {
					workspaceId,
					scope,
					fingerprint,
					...value,
				});
			},
		};
	}
	retrievalStore(
		workspaceId: Id<"workspaces">,
		runId: Id<"runs">,
		scope: string,
	): RetrievalStore {
		const identity = { workspaceId, runId, scope };
		return {
			identity: `${workspaceId}:${scope}`,
			history: (limit) =>
				this.client.query(api.retrieval.history, { ...identity, limit }),
			cached: (keys) =>
				this.client.query(api.retrieval.cached, { ...identity, keys }),
			put: async (key, source, chunks) => {
				await this.client.mutation(api.retrieval.put, {
					...identity,
					key,
					source,
					chunks,
				});
			},
			search: (request) =>
				this.client.action(api.retrieval.search, { ...identity, ...request }),
		};
	}
}
