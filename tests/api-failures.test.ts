import { expect, test } from "bun:test";
import { handleApi } from "../server/api";
import type { ProviderFetch } from "../server/provider-access";
import { DEFAULT_CONTEXT_POLICY } from "../src/lib/context";
import type { JevQuestion } from "../src/lib/jev-question";
import { readRouteStream } from "../src/lib/route-stream";
import type {
	RouteResult,
	RouteStreamEvent,
	WorkflowRoutes,
} from "../src/lib/routing";
import { workflowRoutesSchema } from "../src/lib/routing";
import { createApiFixture } from "./api-fixture";

const keys = {
	TYPESAFE_API_KEY: "test-key",
	OPENAI_API_KEY: "test-key",
	GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
};
const question: JevQuestion = {
	id: "question",
	name: "Question",
	confidenceThreshold: 0.7,
	type: "choice",
	instructions: "Определи тему обращения пользователя.",
	options: [
		{
			id: "delivery",
			label: "Доставка",
			description: "Пользователь спрашивает о доставке посылки.",
		},
		{
			id: "operator",
			label: "Оператор",
			description: "Нужно передать обращение оператору.",
		},
	],
};
function jevRoutes(
	policy: Pick<JevQuestion, "uncertainOutputId" | "errorOutputId"> = {
		uncertainOutputId: "question/operator",
	},
): WorkflowRoutes {
	return {
		kind: "workflow",
		nodes: [
			{ id: "input", kind: "input", fields: [] },
			{
				id: "judge",
				kind: "jev",
				questions: [
					{
						...question,
						confidenceThreshold: 0.9,
						...policy,
					},
				],
			},
		],
		edges: [{ id: "entry", source: "input", target: "judge" }],
	};
}
const modelRoutes: WorkflowRoutes = {
	kind: "workflow",
	nodes: [
		{ id: "input", kind: "input", fields: [] },
		{
			id: "primary",
			kind: "model",
			provider: "google",
			model: "gemini-3.8-flash",
			prompt: "Ответь по-русски о сроках доставки.",
		},
		{
			id: "backup",
			kind: "model",
			provider: "openai",
			model: "gpt-6-luna",
			prompt: "Ответь по-русски о сроках доставки.",
		},
	],
	edges: [
		{ id: "entry", source: "input", target: "primary" },
		{
			id: "backup",
			source: "primary",
			sourceHandle: "fallback",
			target: "backup",
		},
	],
};

test("a model-only HTTP workflow accepts its backup as an alternative to the primary", () => {
	expect(workflowRoutesSchema.safeParse(modelRoutes).success).toBe(true);
	const parallelTerminals: WorkflowRoutes = {
		...modelRoutes,
		edges: [
			{ id: "primary", source: "input", target: "primary" },
			{ id: "backup", source: "input", target: "backup" },
		],
	};
	expect(workflowRoutesSchema.safeParse(parallelTerminals).success).toBe(false);
});

async function runHttp(routes: WorkflowRoutes, providerFetch: ProviderFetch) {
	const fixture = await createApiFixture();
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: (request) =>
			handleApi(request, {
				keys: keys,
				connect: fixture.connect,
				providerFetch: providerFetch,
			}),
	});
	const events: RouteStreamEvent[] = [];
	let result: RouteResult | undefined;
	let error: string | undefined;
	try {
		const response = await fetch(new URL("/api/route", server.url), {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				messages: [{ role: "user", content: "Где моя посылка?" }],
				routes,
			}),
		});
		await readRouteStream(response, (event) => {
			events.push(event);
			if (event.type === "done") result = event.route;
		});
	} catch (caught) {
		error = caught instanceof Error ? caught.message : String(caught);
	} finally {
		server.stop(true);
	}
	return { events, result, error };
}

test("Russian HTTP flow returns the configured label after Jev 503 with one failed attempt", async () => {
	let requests = 0;
	const { result, error } = await runHttp(
		jevRoutes({ errorOutputId: "question/operator" }),
		async () => {
			requests++;
			return Response.json(
				{ message: "Сервис временно недоступен" },
				{ status: 503 },
			);
		},
	);
	expect(error).toBeUndefined();
	expect(requests).toBe(1);
	expect(result?.text).toBe("Оператор");
	expect(result?.jevSteps[0]).toMatchObject({
		branch: "question/operator",
		status: "provider-error",
	});
	expect(result?.calls[0]?.status).toBe("failed");
	expect(result?.usage.complete).toBe(false);
	expect(result?.usage.costComplete).toBe(false);
});

test("Russian HTTP flow stops on Jev failure even when a clarification output is configured", async () => {
	let requests = 0;
	const { result, error, events } = await runHttp(jevRoutes(), async () => {
		requests++;
		return Response.json(
			{ message: "Сервис временно недоступен" },
			{ status: 503 },
		);
	});
	expect(requests).toBe(1);
	expect(result).toBeUndefined();
	expect(error).toStartWith("Jev couldn’t evaluate “Question”: ");
	expect(events.some((event) => event.type === "delta")).toBe(false);
});

for (const model of ["jev-1.13.0", "jev-unpriced"]) {
	test(`invalid SDK evaluation retains reported usage and model ${model}`, async () => {
		let requests = 0;
		const { result, error } = await runHttp(
			jevRoutes({ errorOutputId: "question/operator" }),
			async () => {
				requests++;
				return Response.json({
					model,
					answers: {
						question: {
							type: "choice",
							choice: "Доставка",
							probabilities: { Доставка: 0.8, Оператор: 0.1 },
							confidence: 0.9,
						},
					},
					usage: { input_tokens: 100, output_tokens: 20 },
				});
			},
		);
		expect(error).toBeUndefined();
		expect(requests).toBe(1);
		expect(result?.text).toBe("Оператор");
		expect(result?.jevSteps[0].status).toBe("provider-error");
		expect(result?.calls[0]).toMatchObject({
			status: "failed",
			model,
			usage: { inputTokens: 100, outputTokens: 20 },
		});
		expect(result?.usage.complete).toBe(true);
		if (model === "jev-unpriced") {
			expect(result?.calls[0].estimatedCostUsd).toBeUndefined();
			expect(result?.usage.costComplete).toBe(false);
		} else {
			expect(result?.calls[0].estimatedCostUsd).toBeCloseTo(0.0000042, 12);
			expect(result?.usage.costComplete).toBe(true);
		}
	});
}

test("Russian HTTP flow preserves the original uncertain choice while taking its fallback", async () => {
	const { result } = await runHttp(jevRoutes(), async () =>
		Response.json({
			model: "jev-1.13.0",
			answers: {
				question: {
					type: "choice",
					choice: "Доставка",
					probabilities: { Доставка: 0.55, Оператор: 0.45 },
					confidence: 0.55,
				},
			},
			usage: { input_tokens: 100, output_tokens: 20 },
		}),
	);
	expect(result?.text).toBe("Оператор");
	expect(result?.jevSteps[0]).toMatchObject({
		branch: "question/operator",
		selectedBranch: "question/delivery",
		status: "uncertain",
		value: "Доставка",
		confidence: 0.55,
	});
	expect(result?.usage.estimatedCostUsd).toBeCloseTo(0.0000042, 12);
});

test("Russian HTTP flow retains its document when relevance fails and accounts for the failed call", async () => {
	const routes = jevRoutes();
	const start = routes.nodes[0];
	const judge = routes.nodes[1];
	if (start.kind !== "input" || judge.kind !== "jev")
		throw new Error("Invalid test graph");
	start.documents = [
		{ id: "guide", name: "Доставка", content: "Доставка занимает два дня." },
	];
	judge.context = {
		...DEFAULT_CONTEXT_POLICY,
		documents: [{ id: "guide", representation: "full" }],
		relevance: {
			instructions: "Сохрани правила доставки, полезные для обращения.",
			minimumConfidence: 0.9,
		},
	};
	const bodies: string[] = [];
	const { result, error } = await runHttp(routes, async (_url, init) => {
		bodies.push(String(init?.body));
		if (bodies.length === 1)
			return Response.json(
				{ message: "Сбой проверки контекста" },
				{ status: 503 },
			);
		return Response.json({
			model: "jev-1.13.0",
			answers: {
				question: {
					type: "choice",
					choice: "Доставка",
					probabilities: { Доставка: 0.99, Оператор: 0.01 },
					confidence: 0.99,
				},
			},
			usage: { input_tokens: 100, output_tokens: 20 },
		});
	});
	expect(error).toBeUndefined();
	expect(bodies).toHaveLength(2);
	expect(bodies[1]).toContain("Доставка занимает два дня.");
	expect(result?.calls.map(({ purpose, status }) => [purpose, status])).toEqual(
		[
			["context", "failed"],
			["decision", "completed"],
		],
	);
	expect(result?.contexts[0].chunks[0]).toMatchObject({
		included: true,
		reason: "unavailable",
	});
	expect(result?.usage.complete).toBe(false);
});

test("Russian HTTP partial stream failure never invokes the connected backup", async () => {
	let requests = 0;
	const { result, error, events } = await runHttp(modelRoutes, async () => {
		requests++;
		const partial = {
			candidates: [
				{
					index: 0,
					content: { role: "model", parts: [{ text: "Проверяю посылку" }] },
				},
			],
		};
		return new Response(
			`data: ${JSON.stringify(partial)}\n\ndata: {"candidates":"invalid"}\n\n`,
			{ headers: { "Content-Type": "text/event-stream" } },
		);
	});
	expect(requests).toBe(1);
	expect(result).toBeUndefined();
	expect(error).toBeDefined();
	expect(events.filter((event) => event.type === "delta")).toEqual([
		{ type: "delta", text: "Проверяю посылку" },
	]);
	const progress = events.findLast((event) => event.type === "progress");
	expect(
		progress?.type === "progress" ? progress.trace.calls : [],
	).toMatchObject([{ nodeId: "primary", status: "failed" }]);
});

test("cancelling the Russian response aborts the provider without invoking backup", async () => {
	let requests = 0;
	const began = Promise.withResolvers<void>();
	const aborted = Promise.withResolvers<void>();
	const fixture = await createApiFixture();
	const response = await handleApi(
		new Request("http://localhost/api/route", {
			method: "POST",
			headers: fixture.headers,
			body: JSON.stringify({
				...fixture.requestFields(),
				messages: [
					{ role: "user", content: "Проверьте сроки доставки посылки." },
				],
				routes: modelRoutes,
			}),
		}),
		{
			keys: keys,
			connect: fixture.connect,
			providerFetch: async (_url, init) => {
				requests++;
				began.resolve();
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						aborted.resolve();
						reject(new DOMException("Запрос отменён", "AbortError"));
					});
				});
			},
		},
	);
	await began.promise;
	await response.body?.cancel();
	await aborted.promise;
	expect(requests).toBe(1);
});
