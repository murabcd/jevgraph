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
	type DirectRoutes,
	JEV_MODEL_ID,
	type JevDecision,
	type JevRoutes,
	type RoutePathStep,
	type RouteResult,
	type RouteSelectionResult,
	type RouteStreamEvent,
	type RouteTarget,
	type RoutingConfig,
	type RoutingMetadata,
	routeRequestSchema,
	selectRoute,
	type WorkflowRoutes,
} from "../src/lib/routing.ts";
import { runWithOneFallback } from "./model-failover.ts";
import { emitSystemTiming, measureNode } from "./node-timing.ts";
import { selectWorkflow, workflowRoutingState } from "./workflow.ts";

type Keys = {
	TYPESAFE_API_KEY?: string;
	OPENAI_API_KEY?: string;
	GOOGLE_GENERATIVE_AI_API_KEY?: string;
};

type RouteExecution = {
	messages: ChatMessage[];
	requestPrompt: string;
	config: RoutingConfig;
	metadata: RoutingMetadata;
	keys: Keys;
	emit: (event: RouteStreamEvent) => void;
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
			? `${modelInstructions}\n\nSystem instructions:\n${requestPrompt}`
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
	{ messages, requestPrompt, keys, emit }: RouteExecution,
	routes: DirectRoutes,
): Promise<void> {
	const start = performance.now();
	const target = routes.target;
	emitSystemTiming(routes.systemNodeId, emit);
	const route: RouteSelectionResult = {
		mode: "direct",
		provider: target.provider,
		model: target.model,
		initialProvider: target.provider,
		nodeId: target.nodeId,
		initialNodeId: target.nodeId,
		branch: "direct",
		finalBranch: "direct",
		path: [{ nodeId: "input" }, { nodeId: target.nodeId }],
		reason: "Direct model",
	};
	emit({ type: "route", route });
	const response = await measureNode(
		target.nodeId,
		() =>
			runModel(messages, requestPrompt, target, keys, (text) =>
				emit({ type: "delta", text }),
			),
		emit,
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
	{ messages, requestPrompt, config, metadata, keys, emit }: RouteExecution,
	routes: JevRoutes,
): Promise<void> {
	const start = performance.now();
	emitSystemTiming(routes.systemNodeId, emit);
	let jev: JevDecision | undefined;
	let classificationError: string | undefined;
	try {
		const routingContext = workflowRoutingState(
			messages,
			requestPrompt,
			metadata,
		);
		jev = await measureNode(
			routes.nodeId,
			() => {
				const key = keys.TYPESAFE_API_KEY;
				if (!key) throw new Error("TYPESAFE_API_KEY is not configured");
				return classify(routingContext, key, routes.question);
			},
			emit,
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
	let path: RoutePathStep[] = [
		{ nodeId: "input" },
		{ nodeId: routes.nodeId },
		{ nodeId: target.nodeId, via: selection.branch },
	];
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
		path,
		reason: selection.reason,
		classificationError,
		fallbackReason,
		jev,
	});
	emit({ type: "route", route: routeSelection() });
	const fallback = config.fallbackEnabled
		? questionOutputs(routes.question).find(
				(output) =>
					output.id !== selection.branch &&
					routes.targets[output.id].nodeId !== initialTarget.nodeId,
			)
		: undefined;
	const { response } = await runWithOneFallback(
		initialTarget,
		fallback ? routes.targets[fallback.id] : undefined,
		(model, onDelta) =>
			measureNode(
				model.nodeId,
				() => runModel(messages, requestPrompt, model, keys, onDelta),
				emit,
			),
		(text) => emit({ type: "delta", text }),
		(reason) => {
			if (!fallback) throw new Error("Missing fallback branch");
			finalBranch = fallback.id;
			target = routes.targets[finalBranch];
			path = [
				{ nodeId: "input" },
				{ nodeId: routes.nodeId },
				{ nodeId: target.nodeId, via: finalBranch },
			];
			fallbackReason = reason;
			emit({ type: "route", route: routeSelection() });
		},
	);

	emit({
		type: "done",
		route: {
			...response,
			...routeSelection(),
			latencyMs: Math.round(performance.now() - start),
		},
	});
}

async function routeWorkflowPrompt(
	{ messages, requestPrompt, config, metadata, keys, emit }: RouteExecution,
	routes: WorkflowRoutes,
): Promise<void> {
	const start = performance.now();
	emitSystemTiming(routes.systemNodeId, emit);
	const routingState = workflowRoutingState(messages, requestPrompt, metadata);
	const selected = await selectWorkflow(
		routes,
		config,
		async (nodeId, question) => {
			return measureNode(
				nodeId,
				() => {
					if (!keys.TYPESAFE_API_KEY)
						throw new Error("TYPESAFE_API_KEY is not configured");
					return classify(routingState, keys.TYPESAFE_API_KEY, question);
				},
				emit,
			);
		},
	);
	const initialTarget = selected.target;
	let target = initialTarget;
	let fallbackReason: string | undefined;
	let path = selected.path;
	const branch =
		selected.decisions
			.map((decision) => `${decision.nodeId}:${decision.branch}`)
			.join(" · ") || "direct";
	const routeSelection = (): RouteSelectionResult => ({
		mode: "workflow",
		provider: target.provider,
		model: target.model,
		initialProvider: initialTarget.provider,
		nodeId: target.nodeId,
		initialNodeId: initialTarget.nodeId,
		branch,
		finalBranch: fallbackReason ? "fallback" : branch,
		path,
		reason: branch,
		classificationError:
			selected.decisions
				.map((decision) => decision.error)
				.filter(Boolean)
				.join("; ") || undefined,
		fallbackReason,
		jevSteps: selected.decisions,
	});
	emit({ type: "route", route: routeSelection() });
	const { response } = await runWithOneFallback(
		initialTarget,
		config.fallbackEnabled ? selected.fallback : undefined,
		(model, onDelta) =>
			measureNode(
				model.nodeId,
				() => runModel(messages, requestPrompt, model, keys, onDelta),
				emit,
			),
		(text) => emit({ type: "delta", text }),
		(reason) => {
			fallbackReason = reason;
			target = selected.fallback ?? initialTarget;
			path = [...selected.path, { nodeId: target.nodeId, via: "fallback" }];
			emit({ type: "route", route: routeSelection() });
		},
	);
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
				const execution: RouteExecution = {
					messages: input.messages,
					requestPrompt: input.requestPrompt,
					config: input.config,
					metadata: input.metadata ?? {},
					keys,
					emit,
				};
				let processing: Promise<void>;
				switch (input.routes.kind) {
					case "direct":
						processing = routeDirectPrompt(execution, input.routes);
						break;
					case "jev":
						processing = routeJevPrompt(execution, input.routes);
						break;
					case "workflow":
						processing = routeWorkflowPrompt(execution, input.routes);
						break;
				}
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
