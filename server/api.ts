import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { experimental_evaluate, streamText } from "ai";
import { z } from "zod";
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
	type JevEvaluation,
	MAX_REQUEST_BYTES,
	modelReasoningEffort,
	type RouteStreamEvent,
	type RouteTrace,
	type RoutingMetadata,
	resolveStartVariables,
	routeRequestSchema,
	type WorkflowRoutes,
} from "../src/lib/routing.ts";
import type { TokenUsage } from "../src/lib/usage.ts";
import {
	ACTIVE_EXECUTION_MS,
	emptyWorkflowJournal,
	resumeRequestSchema,
} from "../src/lib/workflow-journal.ts";
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
import { ProviderEvidence } from "./provider-evidence.ts";
import {
	evaluationUsage,
	languageModelUsage,
	ProviderUsageError,
} from "./provider-usage.ts";
import { resolveReplay, routeReplayRequestSchema } from "./replay.ts";
import { type ContextRetriever, createContextRetriever } from "./retrieval.ts";
import { embedContext, rerankContext } from "./retrieval-providers.ts";
import {
	contentFingerprint,
	type SessionMemory,
	SessionMemoryPool,
	type SummaryStore,
} from "./session-memory.ts";
import { executeWorkflow, type WorkflowModelRequest } from "./workflow.ts";
import { WorkflowJournal } from "./workflow-journal.ts";

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
	onSnapshot: (trace: RouteTrace) => void;
	providerEvidence: ProviderEvidence;
	journal: WorkflowJournal;
	createdAt: number;
};

const jevConfidenceSchema = z.record(z.string(), z.number().finite());

async function classify(
	state: string,
	key: string,
	questions: JevQuestion[],
	signal: AbortSignal,
	providerFetch?: ProviderFetch,
): Promise<JevEvaluation> {
	const start = performance.now();
	const evaluationModel = evaluationModelFor({
		keys: { TYPESAFE_API_KEY: key },
		signal,
		providerFetch,
	});
	const result = await experimental_evaluate({
		model: evaluationModel,
		state,
		questions: Object.fromEntries(
			questions.map((question) => [question.id, questionForJev(question)]),
		),
		abortSignal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
		maxRetries: 0,
	});
	const confidence = result.providerMetadata?.typesafe?.confidence;
	const confidences = jevConfidenceSchema.safeParse(confidence).data;
	try {
		const answers = questions.map((question) => {
			const answer = result.answers[question.id];
			if (!answer) throw new Error(`Jev omitted question ${question.name}`);
			return resolveJevAnswer(question, answer, confidences?.[question.id]);
		});
		return {
			answers,
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
		const finishReason = await result.finishReason;
		if (finishReason !== "stop")
			throw new Error(
				`The model stream ended without a normal stop (${finishReason})`,
			);
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
		onSnapshot,
		providerEvidence,
		journal,
		createdAt,
	}: RouteExecution,
	routes: WorkflowRoutes,
) {
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
		onSnapshot,
		journal,
		providerEvidence,
		onProgress: (trace) => emit({ type: "progress", trace }),
		signal,
	});
	return { ...response, latencyMs: Math.max(0, Date.now() - createdAt) };
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
	if (
		request.method !== "POST" ||
		(path !== "/api/route" && path !== "/api/replay" && path !== "/api/resume")
	) {
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
		const persistence = connect(token);
		const replay =
			path === "/api/replay"
				? routeReplayRequestSchema.parse(JSON.parse(bodyText))
				: undefined;
		const credentials = [
			keys.TYPESAFE_API_KEY,
			keys.OPENAI_API_KEY,
			keys.GOOGLE_GENERATIVE_AI_API_KEY,
		];
		const credentialScope = contentFingerprint(JSON.stringify(credentials));
		const recovery =
			path === "/api/resume"
				? await persistence.resume(
						resumeRequestSchema.parse(JSON.parse(bodyText)).runId,
						credentialScope,
					)
				: undefined;
		const input = recovery
			? {
					conversationId: recovery.conversationId,
					requestId: recovery.requestId,
					routes: recovery.routes,
					messages: recovery.input.messages,
					metadata: recovery.input.metadata,
					documents: undefined,
				}
			: replay
				? await resolveReplay(persistence, replay)
				: routeRequestSchema.parse(JSON.parse(bodyText));
		const start = input.routes.nodes.find((node) => node.kind === "input");
		const resolvedDocuments = resolveContextDocuments(
			start?.kind === "input" ? (start.documents ?? []) : [],
			input.documents,
		);
		const metadata = Object.fromEntries(
			Object.entries(
				resolveStartVariables(
					start?.kind === "input" ? start.fields : [],
					input.metadata ?? {},
				),
			).sort(([a], [b]) => a.localeCompare(b)),
		);
		const saved =
			recovery ??
			(await persistence.begin({
				conversationId: input.conversationId,
				requestId: input.requestId,
				input: { messages: input.messages, metadata },
				replayRunId: replay?.runId,
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
				},
			}));
		const encoder = new TextEncoder();
		const cancellation = new AbortController();
		const signal = AbortSignal.any([
			request.signal,
			cancellation.signal,
			AbortSignal.timeout(ACTIVE_EXECUTION_MS),
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
		const providerEvidence = new ProviderEvidence(
			credentials.filter((value): value is string => value !== undefined),
			recovery?.journal.providerEvidence,
		);
		const journal = new WorkflowJournal(
			recovery?.journal ?? emptyWorkflowJournal(saved.runId),
			persistence.checkpointWriter(
				saved.runId,
				saved.executionId,
				recovery?.revision ?? 0,
			),
			providerEvidence,
		);
		await journal.commit();
		// Serialize ownership checks; a remote Stop or lost lease cancels in-flight providers.
		let checking = false;
		const ownershipTimer = setInterval(() => {
			if (checking || signal.aborted) return;
			checking = true;
			void persistence
				.assertExecution(saved.runId, saved.executionId)
				.catch((error) => cancellation.abort(error))
				.finally(() => {
					checking = false;
				});
		}, 2000);
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				const redactedDeltas = providerEvidence.streamRedactor();
				const send = (event: RouteStreamEvent) => {
					if (!closed)
						controller.enqueue(
							encoder.encode(
								`${JSON.stringify(event, (_key, value: unknown) => (typeof value === "string" ? providerEvidence.redact(value) : value))}\n`,
							),
						);
				};
				const emit = (event: RouteStreamEvent) => {
					if (event.type === "delta") {
						partialText += event.text;
						const text = redactedDeltas.write(event.text);
						if (text) send({ type: "delta", text });
					} else {
						if (event.type === "done" || event.type === "error") {
							const text = redactedDeltas.finish();
							if (text) send({ type: "delta", text });
						}
						send(event);
					}
				};
				void executeRoute(
					{
						messages: saved.input.messages,
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
						metadata: saved.input.metadata ?? {},
						documents: input.documents,
						providerFetch: providerEvidence.fetch(providerFetch),
						providerEvidence,
						journal,
						createdAt: saved.createdAt,
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
						onSnapshot: (trace) => {
							latestTrace = trace;
						},
					},
					input.routes,
				)

					.then(async (result) => {
						await persistence.settle(
							saved.runId,
							saved.executionId,
							{
								status: "completed",
								result,
								...providerEvidence.artifactEvidence(
									result.calls.map((call) => call.id),
								),
							},
							providerEvidence.redact,
						);
						emit({ type: "done", route: result });
					})
					.catch(async (error) => {
						const message = providerEvidence.redact(
							error instanceof Error ? error.message : "Chatflow failed",
						);
						await persistence
							.settle(
								saved.runId,
								saved.executionId,
								{
									status:
										signal.aborted || journal.failed ? "interrupted" : "failed",
									text: partialText,
									error: message.slice(0, 2000),
									trace: latestTrace,
									latencyMs: Math.max(
										0,
										Math.round(Date.now() - saved.createdAt),
									),
									...providerEvidence.artifactEvidence(
										latestTrace.calls.map((call) => call.id),
									),
								},
								providerEvidence.redact,
							)
							// Lease expiry will release the run if the database is unavailable.
							.catch((settlementError) => {
								emit({
									type: "error",
									error: providerEvidence.redact(
										`Could not save the failed run: ${settlementError instanceof Error ? settlementError.message : "Database unavailable"}`,
									),
								});
							});
						emit({ type: "error", error: message });
					})
					.finally(() => {
						clearInterval(ownershipTimer);
						if (!closed) {
							closed = true;
							controller.close();
						}
					});
			},
			cancel() {
				clearInterval(ownershipTimer);
				closed = true;
				cancellation.abort();
			},
		});
		return new Response(body, {
			headers: {
				"Content-Type": "application/x-ndjson; charset=utf-8",
				"Cache-Control": "no-cache, no-transform",
				"X-Run-Id": saved.runId,
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
