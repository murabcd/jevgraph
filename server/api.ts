import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";
import {
	type JevQuestion,
	questionForJev,
	resolveJevAnswer,
} from "../src/lib/jev-question.ts";
import { effectiveModelConfiguration } from "../src/lib/model-configuration.ts";
import { textModels } from "../src/lib/models.ts";
import {
	JEV_MODEL_ID,
	type JevEvaluation,
	MAX_REQUEST_BYTES,
	type RouteStreamEvent,
	routeRequestSchema,
} from "../src/lib/routing.ts";
import type { TokenUsage } from "../src/lib/usage.ts";
import { resumeRequestSchema } from "../src/lib/workflow-journal.ts";
import {
	assessContext,
	filterContext,
	summarizeContext,
} from "./context-providers.ts";
import type { ConvexPersistence } from "./convex-persistence.ts";
import { evaluateJev } from "./jev-evaluation.ts";
import { modelPrompt } from "./model-prompt.ts";
import {
	languageModelFor,
	type ProviderAccess,
	type ProviderFetch,
	type ProviderKeys,
} from "./provider-access.ts";
import {
	evaluationUsage,
	languageModelUsage,
	ProviderUsageError,
} from "./provider-usage.ts";
import { resolveReplay, routeReplayRequestSchema } from "./replay.ts";
import { createContextRetriever } from "./retrieval.ts";
import { embedContext, rerankContext } from "./retrieval-providers.ts";
import { contentFingerprint, SessionMemoryPool } from "./session-memory.ts";
import { executeWorkflow, type WorkflowModelRequest } from "./workflow.ts";
import { RunExecution, type RunExecutionContext } from "./workflow-journal.ts";

const sessionMemories = new SessionMemoryPool();

const jevConfidenceSchema = z.record(z.string(), z.number().finite());

async function classify(
	state: string,
	key: string,
	questions: JevQuestion[],
	signal: AbortSignal,
	providerFetch?: ProviderFetch,
): Promise<JevEvaluation> {
	const start = performance.now();
	const result = await evaluateJev(
		{
			state,
			questions: Object.fromEntries(
				questions.map((question) => [question.id, questionForJev(question)]),
			),
		},
		{ keys: { TYPESAFE_API_KEY: key }, signal, providerFetch },
		10000,
	);
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
		throw new ProviderUsageError(
			error,
			evaluationUsage(result.usage),
			result.response.modelId,
		);
	}
}

async function runModel(
	{ target, context, variables, onDelta, cache }: WorkflowModelRequest,
	{ keys, signal, providerFetch }: ProviderAccess,
) {
	const { provider, model: modelId } = target;
	const model = languageModelFor(provider, modelId, {
		keys,
		signal,
		providerFetch,
	});
	const { reasoningEffort } = effectiveModelConfiguration(target);
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
		saved,
		credentialScope,
		signal,
		emit,
		onSnapshot,
		providerEvidence,
		journal,
	}: RunExecutionContext,
	{
		keys,
		persistence,
		providerFetch,
	}: {
		keys: ProviderKeys;
		persistence: ConvexPersistence;
		providerFetch?: ProviderFetch;
	},
) {
	const providers = {
		keys,
		signal,
		providerFetch: providerEvidence.fetch(providerFetch),
	};
	return executeWorkflow({
		routes: saved.routes,
		messages: saved.input.messages,
		metadata: saved.input.metadata ?? {},
		memory: sessionMemories.get(
			contentFingerprint(
				JSON.stringify({
					conversationId: saved.conversationId,
					credentialScope,
				}),
			),
		),
		summaryStore: persistence.summaryStore(saved.workspaceId, credentialScope),
		evidenceFor: (key) =>
			persistence.routeEvidence(saved.workspaceId, credentialScope, key),
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
				retrieve: createContextRetriever(
					persistence.retrievalStore(
						saved.workspaceId,
						saved.runId,
						credentialScope,
					),
				),
				embed: (values) => embedContext(values, providers),
				rerank: (request) => rerankContext(request, providers),
			},
			automatic: {
				summarize: (request) => summarizeContext(request, providers),
				assess: (request) => assessContext(request, providers),
			},
			filter: (request) => filterContext(request, providers),
		},
		evaluate: (_nodeId, question, state) => {
			if (!keys.TYPESAFE_API_KEY)
				throw new Error("TYPESAFE_API_KEY is not configured");
			return classify(
				state,
				keys.TYPESAFE_API_KEY,
				question,
				signal,
				providers.providerFetch,
			);
		},
		runModel: (request) => runModel(request, providers),
		onTiming: emit,
		onDelta: (text) => emit({ type: "delta", text }),
		onRoute: (route) => emit({ type: "route", route }),
		onSnapshot,
		journal,
		providerEvidence,
		onProgress: (trace) => emit({ type: "progress", trace }),
		signal,
	});
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
		const execution = await RunExecution.start({
			persistence,
			credentials,
			signal: request.signal,
			request:
				path === "/api/resume"
					? {
							kind: "resume",
							runId: resumeRequestSchema.parse(JSON.parse(bodyText)).runId,
						}
					: {
							kind: "turn",
							input: replay
								? await resolveReplay(persistence, replay)
								: routeRequestSchema.parse(JSON.parse(bodyText)),
							replayRunId: replay?.runId,
						},
		});
		const encoder = new TextEncoder();
		let closed = false;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				const redactedDeltas = execution.evidence.streamRedactor();
				const send = (event: RouteStreamEvent) => {
					if (!closed)
						controller.enqueue(
							encoder.encode(
								`${JSON.stringify(event, (_key, value: unknown) => (typeof value === "string" ? execution.evidence.redact(value) : value))}\n`,
							),
						);
				};
				const emit = (event: RouteStreamEvent) => {
					if (event.type === "delta") {
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
				void execution
					.run(
						(context) =>
							executeRoute(context, { keys, persistence, providerFetch }),
						emit,
					)
					.then(
						() => {
							if (!closed) {
								closed = true;
								controller.close();
							}
						},
						(error) => {
							if (!closed) {
								closed = true;
								controller.error(error);
							}
						},
					);
			},
			cancel() {
				closed = true;
				execution.cancel();
			},
		});
		return new Response(body, {
			headers: {
				"Content-Type": "application/x-ndjson; charset=utf-8",
				"Cache-Control": "no-cache, no-transform",
				"X-Run-Id": execution.runId,
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
