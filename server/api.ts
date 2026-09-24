import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import { experimental_evaluate, streamText } from "ai";
import { z } from "zod";
import {
	type JevQuestion,
	questionForJev,
	questionOutputs,
	resolveJevAnswer,
} from "../src/lib/jev-question.ts";
import {
	type ChatMessage,
	JEV_MODEL_ID,
	type JevDecision,
	type JevRoutes,
	type RouteResult,
	type RouteSelectionResult,
	type RouteStreamEvent,
	type RouteTarget,
	type RoutingConfig,
	routeRequestSchema,
	selectRoute,
} from "../src/lib/routing.ts";

type Keys = {
	TYPESAFE_API_KEY?: string;
	OPENAI_API_KEY?: string;
	GOOGLE_GENERATIVE_AI_API_KEY?: string;
};

const modelInstructions =
	"You are a helpful assistant in a live conversation. Answer the latest user message in context. Be clear and concise, and preserve important details.";

async function classify(
	prompt: string,
	key: string,
	question: JevQuestion,
): Promise<JevDecision> {
	const start = performance.now();
	const typeSafeAi = createTypeSafeAi({ apiKey: key });
	const result = await experimental_evaluate({
		model: typeSafeAi.evaluationModel(JEV_MODEL_ID),
		state: prompt,
		questions: { task: questionForJev(question) },
		abortSignal: AbortSignal.timeout(10000),
		maxRetries: 0,
	});
	const confidence = result.providerMetadata?.typesafe?.confidence;
	const taskConfidence =
		confidence && typeof confidence === "object" && "task" in confidence
			? confidence.task
			: undefined;
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
	};
}

async function runModel(
	messages: ChatMessage[],
	requestPrompt: string,
	target: RouteTarget,
	keys: Keys,
	onDelta: (text: string) => void,
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
	const result = streamText({
		model,
		instructions: requestPrompt
			? `${modelInstructions}\n\nRequest node instructions:\n${requestPrompt}`
			: modelInstructions,
		messages,
		maxOutputTokens: 1400,
		...(provider === "openai" && modelId === "gpt-5-mini"
			? { providerOptions: { openai: { reasoningEffort: "minimal" as const } } }
			: {}),
		abortSignal: AbortSignal.timeout(60000),
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
	return {
		text,
		model: modelId,
		usage,
	};
}

async function routeDirectPrompt(
	messages: ChatMessage[],
	requestPrompt: string,
	target: RouteTarget,
	keys: Keys,
	emit: (event: RouteStreamEvent) => void,
): Promise<void> {
	const start = performance.now();
	const route: RouteSelectionResult = {
		mode: "direct",
		provider: target.provider,
		model: target.model,
		initialProvider: target.provider,
		nodeId: target.nodeId,
		initialNodeId: target.nodeId,
		branch: "direct",
		finalBranch: "direct",
		reason: "Direct model",
	};
	emit({ type: "route", route });
	const response = await runModel(
		messages,
		requestPrompt,
		target,
		keys,
		(text) => emit({ type: "delta", text }),
	);
	emit({
		type: "done",
		route: {
			...response,
			...route,
			latencyMs: Math.round(performance.now() - start),
		},
	});
}

async function routeJevPrompt(
	messages: ChatMessage[],
	requestPrompt: string,
	config: RoutingConfig,
	routes: JevRoutes,
	keys: Keys,
	emit: (event: RouteStreamEvent) => void,
): Promise<void> {
	const start = performance.now();
	let jev: JevDecision | undefined;
	let classificationError: string | undefined;
	try {
		if (!keys.TYPESAFE_API_KEY)
			throw new Error("TYPESAFE_API_KEY is not configured");
		const routingContext = [
			...(requestPrompt ? [`request instructions: ${requestPrompt}`] : []),
			...messages
				.slice(-6)
				.map((message) => `${message.role}: ${message.content}`),
		].join("\n");
		jev = await classify(
			routingContext,
			keys.TYPESAFE_API_KEY,
			routes.question,
		);
	} catch (error) {
		classificationError =
			error instanceof Error ? error.message : "Unknown Jev error";
	}

	const selection = selectRoute(jev, config, routes);
	const initialTarget = selection.target;
	const initialProvider = initialTarget.provider;
	let target = initialTarget;
	let finalBranch = selection.branch;
	let fallbackReason: string | undefined;
	const routeSelection = (): RouteSelectionResult => ({
		mode: "jev",
		provider: target.provider,
		model: target.model,
		initialProvider,
		nodeId: target.nodeId,
		initialNodeId: initialTarget.nodeId,
		branch: selection.branch,
		finalBranch,
		reason: selection.reason,
		classificationError,
		fallbackReason,
		jev,
	});
	emit({ type: "route", route: routeSelection() });
	let response: Awaited<ReturnType<typeof runModel>>;
	let streamedText = "";
	try {
		response = await runModel(messages, requestPrompt, target, keys, (text) => {
			streamedText += text;
			emit({ type: "delta", text });
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Unknown model error";
		if (!config.fallbackEnabled || streamedText)
			throw new Error(`${target.provider} failed: ${message}`, {
				cause: error,
			});
		const fallback = questionOutputs(routes.question).find(
			(output) =>
				output.id !== selection.branch &&
				routes.targets[output.id].nodeId !== initialTarget.nodeId,
		);
		if (!fallback)
			throw new Error(`${initialProvider} failed: ${message}`, {
				cause: error,
			});
		finalBranch = fallback.id;
		target = routes.targets[finalBranch];
		fallbackReason = `${initialProvider} failed: ${message}`;
		emit({ type: "route", route: routeSelection() });
		try {
			response = await runModel(messages, requestPrompt, target, keys, (text) =>
				emit({ type: "delta", text }),
			);
		} catch (fallbackError) {
			const secondary =
				fallbackError instanceof Error
					? fallbackError.message
					: "Unknown model error";
			throw new Error(
				`Both models failed. ${initialTarget.model}: ${message}. ${target.model}: ${secondary}`,
				{ cause: fallbackError },
			);
		}
	}

	emit({
		type: "done",
		route: {
			...response,
			...routeSelection(),
			latencyMs: Math.round(performance.now() - start),
		},
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
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				const emit = (event: RouteStreamEvent) =>
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				const processing =
					input.routes.kind === "direct"
						? routeDirectPrompt(
								input.messages,
								input.requestPrompt,
								input.routes.target,
								keys,
								emit,
							)
						: routeJevPrompt(
								input.messages,
								input.requestPrompt,
								input.config,
								input.routes,
								keys,
								emit,
							);
				void processing
					.catch((error) =>
						emit({
							type: "error",
							error: error instanceof Error ? error.message : "Routing failed",
						}),
					)
					.finally(() => controller.close());
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
				? "Invalid prompt or routing configuration"
				: error instanceof Error
					? error.message
					: "Routing failed";
		return Response.json(
			{ error: message },
			{ status: error instanceof z.ZodError ? 400 : 502 },
		);
	}
}
