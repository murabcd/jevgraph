import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel";
import type { ContextSummaries } from "../src/lib/context.ts";
import {
	type FrozenCase,
	frozenCaseSchema,
} from "../src/lib/evaluation-case.ts";
import {
	evidenceCoverage,
	type ProviderExchange,
} from "../src/lib/provider-evidence.ts";
import { recordedReviewSchema } from "../src/lib/quality-review.ts";
import { routeEvidenceSchema } from "../src/lib/route-evidence.ts";
import type {
	RouteResult,
	RouteTrace,
	WorkflowRoutes,
} from "../src/lib/routing.ts";
import { workflowRoutesSchema } from "../src/lib/routing.ts";
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
		const client = new ConvexHttpClient(url);
		client.setAuth(token);
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
	async finish(
		runId: Id<"runs">,
		result: RouteResult,
		providerEvidence: ProviderExchange[],
	) {
		await this.client.action(api.results.save, {
			runId,
			result: serializeRunArtifact({
				status: "completed",
				result,
				providerEvidence,
				coverage: evidenceCoverage(
					providerEvidence,
					result.calls.map((call) => call.id),
				),
			}),
		});
	}
	async fail(
		runId: Id<"runs">,
		content: string,
		error: string,
		interrupted: boolean,
		trace: RouteTrace,
		latencyMs: number,
		providerEvidence: ProviderExchange[],
	) {
		await this.client.action(api.results.save, {
			runId,
			result: serializeRunArtifact({
				status: interrupted ? "interrupted" : "failed",
				text: content,
				error: error.slice(0, 2000),
				trace,
				latencyMs,
				providerEvidence,
				coverage: evidenceCoverage(
					providerEvidence,
					trace.calls.map((call) => call.id),
				),
			}),
		});
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
