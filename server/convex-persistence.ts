import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel";
import type { ContextSummaries } from "../src/lib/context.ts";
import { routeEvidenceSchema } from "../src/lib/route-evidence.ts";
import type {
	RouteResult,
	RouteTrace,
	WorkflowRoutes,
} from "../src/lib/routing.ts";
import type { RetrievalStore } from "./retrieval.ts";
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
		question: string;
		routes: WorkflowRoutes;
		evaluation?: { scope: string; caseKey: string };
	}) {
		const started = await this.client.mutation(api.runs.begin, {
			conversationId: input.conversationId,
			requestId: input.requestId,
			question: input.question,
			routes: JSON.stringify(input.routes),
			evaluation: input.evaluation,
		});
		if (!started.started)
			throw new Error(
				"This request has already started. It will not call the models again.",
			);
		return started;
	}
	async finish(runId: Id<"runs">, result: RouteResult) {
		await this.client.action(api.results.save, {
			runId,
			result: JSON.stringify({ status: "completed", result }),
		});
	}
	async fail(
		runId: Id<"runs">,
		content: string,
		error: string,
		interrupted: boolean,
		trace: RouteTrace,
		latencyMs: number,
	) {
		await this.client.action(api.results.save, {
			runId,
			result: JSON.stringify({
				status: interrupted ? "interrupted" : "failed",
				text: content,
				error: error.slice(0, 2000),
				trace,
				latencyMs,
				coverage: "partial",
			}),
		});
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
