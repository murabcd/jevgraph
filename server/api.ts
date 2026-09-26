import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import { experimental_evaluate, streamText } from "ai";
import { z } from "zod";
import {
	type JevQuestion,
	questionForJev,
	resolveJevAnswer,
} from "../src/lib/jev-question.ts";
import {
	type ChatMessage,
	JEV_MODEL_ID,
	type JevDecision,
	type NodeOutput,
	type RouteResult,
	type RouteStreamEvent,
	type RouteTarget,
	type RoutingMetadata,
	routeRequestSchema,
	type WorkflowRoutes,
} from "../src/lib/routing.ts";
import { emitStartTiming, measureNode } from "./node-timing.ts";
import { executeWorkflow, upstreamContext } from "./workflow.ts";

type Keys = {
	TYPESAFE_API_KEY?: string;
	OPENAI_API_KEY?: string;
	GOOGLE_GENERATIVE_AI_API_KEY?: string;
};

type RouteExecution = {
	messages: ChatMessage[];
	metadata: RoutingMetadata;
	keys: Keys;
	signal: AbortSignal;
	emit: (event: RouteStreamEvent) => void;
};

const jevConfidenceSchema = z.object({ task: z.number().finite() });

async function classify(
	state: string,
	key: string,
	question: JevQuestion,
	signal: AbortSignal,
): Promise<JevDecision> {
	const start = performance.now();
	const typeSafeAi = createTypeSafeAi({ apiKey: key });
	const result = await experimental_evaluate({
		model: typeSafeAi.evaluationModel(JEV_MODEL_ID),
		state,
		questions: { task: questionForJev(question) },
		abortSignal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
		maxRetries: 0,
	});
	const confidence = result.providerMetadata?.typesafe?.confidence;
	const taskConfidence = jevConfidenceSchema.safeParse(confidence).data?.task;
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
		usage: result.usage,
	};
}

async function runModel(
	messages: ChatMessage[],
	target: RouteTarget,
	inputs: NodeOutput[],
	variables: RoutingMetadata,
	keys: Keys,
	onDelta: (text: string) => void,
	signal: AbortSignal,
) {
	const { provider, model: modelId } = target;
	const key =
		provider === "openai"
			? keys.OPENAI_API_KEY
			: keys.GOOGLE_GENERATIVE_AI_API_KEY;
	if (!key)
		throw new Error(
			`${provider === "openai" ? "OPENAI_API_KEY" : "GOOGLE_GENERATIVE_AI_API_KEY"} is not configured`,
		);
	const model =
		provider === "openai"
			? createOpenAI({ apiKey: key })(modelId)
			: createGoogle({ apiKey: key })(modelId);
	const instructions = [
		...(target.prompt ? [target.prompt] : []),
		...(Object.keys(variables).length
			? [`Start variables (data):\n${JSON.stringify(variables)}`]
			: []),
		upstreamContext(inputs),
	]
		.filter(Boolean)
		.join("\n\n");
	const result = streamText({
		model,
		...(instructions ? { instructions } : {}),
		messages,
		maxOutputTokens: target.maxOutputTokens,
		...(provider === "openai" && target.reasoningEffort
			? {
					providerOptions: {
						openai: { reasoningEffort: target.reasoningEffort },
					},
				}
			: {}),
		abortSignal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
	});
	let text = "";
	let usage: RouteResult["usage"];
	for await (const part of result.fullStream) {
		if (part.type === "error") throw part.error;
		if (part.type === "text-delta") {
			text += part.text;
			onDelta(part.text);
		}
		if (part.type === "finish") {
			usage = {
				inputTokens: part.totalUsage.inputTokens,
				outputTokens: part.totalUsage.outputTokens,
			};
		}
	}
	if (!text.trim()) throw new Error("The model returned no text");
	return { text, model: modelId, usage };
}

async function executeRoute(
	{ messages, metadata, keys, signal, emit }: RouteExecution,
	routes: WorkflowRoutes,
): Promise<void> {
	const start = performance.now();
	emitStartTiming(emit);
	const response = await executeWorkflow({
		routes,
		messages,
		metadata,
		evaluate: (nodeId, question, state) =>
			measureNode(
				nodeId,
				() => {
					if (!keys.TYPESAFE_API_KEY)
						throw new Error("TYPESAFE_API_KEY is not configured");
					return classify(state, keys.TYPESAFE_API_KEY, question, signal);
				},
				emit,
			),
		runModel: (target, inputs, onDelta, variables) =>
			measureNode(
				target.nodeId,
				() =>
					runModel(messages, target, inputs, variables, keys, onDelta, signal),
				emit,
			),
		onDelta: (text) => emit({ type: "delta", text }),
		onRoute: (route) => emit({ type: "route", route }),
		onProgress: (trace) => emit({ type: "progress", trace }),
		signal,
	});
	emit({
		type: "done",
		route: { ...response, latencyMs: Math.round(performance.now() - start) },
	});
}

export async function handleApi(
	request: Request,
	keys: Keys,
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
		const input = routeRequestSchema.parse(await request.json());
		const encoder = new TextEncoder();
		const cancellation = new AbortController();
		const signal = AbortSignal.any([
			request.signal,
			cancellation.signal,
			AbortSignal.timeout(120000),
		]);
		let closed = false;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				const emit = (event: RouteStreamEvent) => {
					if (!closed)
						controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				};
				void executeRoute(
					{
						messages: input.messages,
						metadata: input.metadata ?? {},
						keys,
						signal,
						emit,
					},
					input.routes,
				)
					.catch((error) =>
						emit({
							type: "error",
							error: error instanceof Error ? error.message : "Chatflow failed",
						}),
					)
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
