import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel";
import type { ContextSummaries } from "../src/lib/context.ts";
import type { RouteResult, WorkflowRoutes } from "../src/lib/routing.ts";
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
	}) {
		const started = await this.client.mutation(api.runs.begin, {
			conversationId: input.conversationId,
			requestId: input.requestId,
			question: input.question,
			routes: JSON.stringify(input.routes),
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
			result: JSON.stringify(result),
		});
	}
	async fail(
		runId: Id<"runs">,
		content: string,
		error: string,
		interrupted: boolean,
	) {
		await this.client.mutation(api.runs.fail, {
			runId,
			content,
			error,
			interrupted,
		});
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
}
