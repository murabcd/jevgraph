import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { experimental_evaluate, streamText } from "ai";
import { z } from "zod";
import { contentHash } from "../src/lib/content-identity.ts";
import type { ContextDocument } from "../src/lib/context.ts";
import { resolveContextDocuments } from "../src/lib/context.ts";
import {
	type JevQuestion,
	questionForJev,
	resolveJevAnswer,
} from "../src/lib/jev-question.ts";
import { textModels } from "../src/lib/models.ts";
import type { RouteEvidence } from "../src/lib/route-evidence.ts";
import {
	type ChatMessage,
	JEV_MODEL_ID,
	type JevDecision,
	MAX_REQUEST_BYTES,
	modelReasoningEffort,
	type RouteStreamEvent,
	type RouteTrace,
	type RoutingMetadata,
	routeRequestSchema,
	type WorkflowRoutes,
} from "../src/lib/routing.ts";
import type { TokenUsage } from "../src/lib/usage.ts";
import {
	assessContext,
	filterContext,
	summarizeContext,
} from "./context-providers.ts";
import type { ConvexPersistence } from "./convex-persistence.ts";
import { modelPrompt } from "./model-prompt.ts";
import { emitStartTiming, measureNode } from "./node-timing.ts";
import {
	evaluationModelFor,
	languageModelFor,
	type ProviderFetch,
	type ProviderKeys,
} from "./provider-access.ts";
import {
	evaluationUsage,
	languageModelUsage,
	ProviderUsageError,
} from "./provider-usage.ts";
import { type ContextRetriever, createContextRetriever } from "./retrieval.ts";
import { embedContext, rerankContext } from "./retrieval-providers.ts";
import {
	contentFingerprint,
	type SessionMemory,
	SessionMemoryPool,
	type SummaryStore,
} from "./session-memory.ts";
import { executeWorkflow, type WorkflowModelRequest } from "./workflow.ts";

const sessionMemories = new SessionMemoryPool();

type RouteExecution = {
	messages: ChatMessage[];
	metadata: RoutingMetadata;
	documents?: ContextDocument[];
	providerFetch?: ProviderFetch;
	keys: ProviderKeys;
	memory: SessionMemory;
	summaryStore: SummaryStore;
	retrieve: ContextRetriever;
	evidenceFor: (key: string) => Promise<RouteEvidence[]>;
	signal: AbortSignal;
	emit: (event: RouteStreamEvent) => void;
};

const jevConfidenceSchema = z.object({ task: z.number().finite() });

async function classify(
	state: string,
	key: string,
	question: JevQuestion,
	signal: AbortSignal,
	providerFetch?: ProviderFetch,
): Promise<JevDecision> {
	const start = performance.now();
	const evaluationModel = evaluationModelFor({
		keys: { TYPESAFE_API_KEY: key },
		signal,
		providerFetch,
	});
	const result = await experimental_evaluate({
		model: evaluationModel,
		state,
		questions: { task: questionForJev(question) },
		abortSignal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
		maxRetries: 0,
	});
	const confidence = result.providerMetadata?.typesafe?.confidence;
	const taskConfidence = jevConfidenceSchema.safeParse(confidence).data?.task;
	try {
		const decision = resolveJevAnswer(
			question,
			result.answers.task,
			taskConfidence,
		);
		return {
			type: question.type,
			...decision,
			model: result.response?.modelId ?? JEV_MODEL_ID,
			latencyMs: Math.round(performance.now() - start),
			usage: evaluationUsage(result.usage),
		};
	} catch (error) {
		throw new ProviderUsageError(error, evaluationUsage(result.usage));
	}
}

async function runModel(
	{ target, context, variables, onDelta, cache }: WorkflowModelRequest,
	{
		keys,
		signal,
		providerFetch,
	}: Pick<RouteExecution, "keys" | "signal" | "providerFetch">,
) {
	const { provider, model: modelId } = target;
	const model = languageModelFor(provider, modelId, {
		keys,
		signal,
		providerFetch,
	});
	const reasoningEffort = modelReasoningEffort(
		provider,
		modelId,
		target.reasoningEffort,
	);
	const result = streamText({
		model,
		...modelPrompt(
			context.messages,
			target,
			context.inputs,
			variables,
			context.documents,
			cache,
		),
		maxOutputTokens: target.maxOutputTokens,
		...(reasoningEffort && reasoningEffort !== "max"
			? { reasoning: reasoningEffort }
			: {}),
		...(provider === "openai"
			? {
					providerOptions: {
						openai: {
							...(reasoningEffort === "max" ? { reasoningEffort: "max" } : {}),
							...(cache ? { promptCacheOptions: { mode: "explicit" } } : {}),
						} satisfies OpenAIResponsesProviderOptions,
					},
				}
			: {}),
		abortSignal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
		maxRetries: 0,
	});
	let text = "";
	let usage: TokenUsage | undefined;
	try {
		for await (const part of result.fullStream) {
			if (part.type === "error") throw part.error;
			if (part.type === "text-delta") {
				text += part.text;
				onDelta(part.text);
			}
			if (part.type === "finish") {
				usage = languageModelUsage(part.totalUsage);
			}
			if (part.type === "finish-step") usage = languageModelUsage(part.usage);
		}
		if (!text.trim()) throw new Error("The model returned no text");
		return { text, model: modelId, usage };
	} catch (error) {
		throw new ProviderUsageError(error, usage);
	}
}

async function executeRoute(
	{
		messages,
		metadata,
		documents,
		providerFetch,
		keys,
		memory,
		summaryStore,
		retrieve,
		evidenceFor,
		signal,
		emit,
	}: RouteExecution,
	routes: WorkflowRoutes,
) {
	const start = performance.now();
	emitStartTiming(emit);
	const response = await executeWorkflow({
		routes,
		messages,
		metadata,
		documents,
		memory,
		summaryStore,
		evidenceFor,
		availableModels: new Set(
			textModels
				.filter((model) =>
					model.provider === "openai"
						? keys.OPENAI_API_KEY
						: keys.GOOGLE_GENERATIVE_AI_API_KEY,
				)
				.map((model) => model.id),
		),
		contextProviders: {
			retrieval: {
				retrieve,
				embed: (nodeId, values) =>
					measureNode(
						nodeId,
						() => embedContext(values, { keys, signal, providerFetch }),
						emit,
					),
				rerank: (nodeId, request) =>
					measureNode(
						nodeId,
						() => rerankContext(request, { keys, signal, providerFetch }),
						emit,
					),
			},
			automatic: {
				summarize: (request) =>
					measureNode(
						request.nodeId,
						() => summarizeContext(request, { keys, signal, providerFetch }),
						emit,
					),
				assess: (request) =>
					measureNode(
						request.nodeId,
						() => assessContext(request, { keys, signal, providerFetch }),
						emit,
					),
			},
			filter: (request) =>
				measureNode(
					request.nodeId,
					() => filterContext(request, { keys, signal, providerFetch }),
					emit,
				),
		},
		evaluate: (nodeId, question, state) =>
			measureNode(
				nodeId,
				() => {
					if (!keys.TYPESAFE_API_KEY)
						throw new Error("TYPESAFE_API_KEY is not configured");
					return classify(
						state,
						keys.TYPESAFE_API_KEY,
						question,
						signal,
						providerFetch,
					);
				},
				emit,
			),
		runModel: (request) =>
			measureNode(
				request.target.nodeId,
				() => runModel(request, { keys, signal, providerFetch }),
				emit,
			),
		onDelta: (text) => emit({ type: "delta", text }),
		onRoute: (route) => emit({ type: "route", route }),
		onProgress: (trace) => emit({ type: "progress", trace }),
		signal,
	});
	return { ...response, latencyMs: Math.round(performance.now() - start) };
}

export async function handleApi(
	request: Request,
	{
		keys,
		connect,
		providerFetch,
	}: {
		keys: ProviderKeys;
		connect: (token: string) => ConvexPersistence;
		providerFetch?: ProviderFetch;
	},
): Promise<Response> {
	const path = new URL(request.url).pathname;
	if (request.method === "GET" && path === "/api/status") {
		return Response.json({
			jev: Boolean(keys.TYPESAFE_API_KEY),
			openai: Boolean(keys.OPENAI_API_KEY),
			google: Boolean(keys.GOOGLE_GENERATIVE_AI_API_KEY),
		});
	}
	if (request.method !== "POST" || path !== "/api/route") {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	try {
		const bodyText = await request.text();
		if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES)
			return Response.json({ error: "Request is too large" }, { status: 413 });
		const token = request.headers
			.get("Authorization")
			?.match(/^Bearer (\S+)$/)?.[1];
		if (!token)
			return Response.json(
				{ error: "Authenticated conversation required" },
				{ status: 401 },
			);
		const input = routeRequestSchema.parse(JSON.parse(bodyText));
		const persistence = connect(token);
		const credentialScope = contentFingerprint(
			JSON.stringify([
				keys.TYPESAFE_API_KEY,
				keys.OPENAI_API_KEY,
				keys.GOOGLE_GENERATIVE_AI_API_KEY,
			]),
		);
		const start = input.routes.nodes.find((node) => node.kind === "input");
		const resolvedDocuments = resolveContextDocuments(
			start?.kind === "input" ? (start.documents ?? []) : [],
			input.documents,
		);
		const metadata = Object.fromEntries(
			Object.entries(input.metadata ?? {}).sort(([a], [b]) =>
				a.localeCompare(b),
			),
		);
		const saved = await persistence.begin({
			conversationId: input.conversationId,
			requestId: input.requestId,
			question: input.messages[input.messages.length - 1].content,
			routes: {
				...input.routes,
				nodes: input.routes.nodes.map((node) =>
					node.kind === "input" && input.documents
						? { ...node, documents: resolvedDocuments }
						: node,
				),
			},
			evaluation: {
				scope: credentialScope,
				caseKey: await contentHash(
					JSON.stringify({
						messages: input.messages,
						metadata,
					}),
				),
			},
		});
		const encoder = new TextEncoder();
		const cancellation = new AbortController();
		const signal = AbortSignal.any([
			request.signal,
			cancellation.signal,
			AbortSignal.timeout(120000),
		]);
		let closed = false;
		let partialText = "";
		let latestTrace: RouteTrace = {
			path: [],
			traversedEdges: [],
			jevSteps: [],
			outputs: [],
			calls: [],
			contexts: [],
			modelPlans: [],
		};
		const executionStarted = performance.now();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				const emit = (event: RouteStreamEvent) => {
					if (event.type === "progress") latestTrace = event.trace;
					if (event.type === "delta") partialText += event.text;
					if (!closed)
						controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				};
				void executeRoute(
					{
						messages: input.messages,
						evidenceFor: (key) =>
							persistence.routeEvidence(
								saved.workspaceId,
								credentialScope,
								key,
							),
						retrieve: createContextRetriever(
							persistence.retrievalStore(
								saved.workspaceId,
								saved.runId,
								credentialScope,
							),
						),
						summaryStore: persistence.summaryStore(
							saved.workspaceId,
							credentialScope,
						),
						metadata,
						documents: input.documents,
						providerFetch,
						keys,
						memory: sessionMemories.get(
							contentFingerprint(
								JSON.stringify({
									conversationId: saved.conversationId,
									credentialScope,
								}),
							),
						),
						signal,
						emit,
					},
					input.routes,
				)

					.then(async (result) => {
						await persistence.finish(saved.runId, result);
						emit({ type: "done", route: result });
					})
					.catch(async (error) => {
						const message =
							error instanceof Error ? error.message : "Chatflow failed";
						await persistence
							.fail(
								saved.runId,
								partialText,
								message,
								signal.aborted,
								latestTrace,
								Math.round(performance.now() - executionStarted),
							)
							// Lease expiry will release the run if the database is unavailable.
							.catch(() => {});
						emit({ type: "error", error: message });
					})
					.finally(() => {
						if (!closed) {
							closed = true;
							controller.close();
						}
					});
			},
			cancel() {
				closed = true;
				cancellation.abort();
			},
		});
		return new Response(body, {
			headers: {
				"Content-Type": "application/x-ndjson; charset=utf-8",
				"Cache-Control": "no-cache, no-transform",
			},
		});
	} catch (error) {
		const message =
			error instanceof z.ZodError
				? "Invalid prompt or chatflow configuration"
				: error instanceof Error
					? error.message
					: "Chatflow failed";
		return Response.json(
			{ error: message },
			{ status: error instanceof z.ZodError ? 400 : 502 },
		);
	}
}
