import { expect, test } from "bun:test";
import { chooseContextRepresentations } from "../server/automatic-context";
import { prepareContext } from "../server/context";
import { SessionMemory, SessionMemoryPool } from "../server/session-memory";
import { type ContextChunk, DEFAULT_CONTEXT_POLICY } from "../src/lib/context";

const source: ContextChunk = {
	id: "document:delivery",
	sourceId: "delivery",
	kind: "document",
	label: "Доставка",
	representation: "full",
	content: "Доставка занимает 2 дня. Возврат — 14 дней. ".repeat(60),
};
const summaries = {
	short: "Доставка за 2 дня.",
	detailed: "Доставка за 2 дня. Возврат в течение 14 дней.",
};
const request = {
	nodeId: "answer",
	query: "Как вернуть заказ?",
	task: "Помоги покупателю",
	chunks: [source],
	minimumConfidence: 0.9,
	maxCharacters: 24000,
};

function services(probabilities: Record<string, number>) {
	return {
		memory: new SessionMemory(),
		summarize: async () => ({ summaries, model: "gpt-6-luna" }),
		assess: async () => ({ probabilities }),
	};
}

test("selects only an adequate representation and omits only confidently irrelevant sources", async () => {
	for (const [short, detailed, expected] of [
		[0.98, 0.99, "short"],
		[0.1, 0.99, "detailed"],
		[0.1, 0.4, "full"],
	] as const) {
		const {
			choices: [choice],
		} = await chooseContextRepresentations(
			request,
			services({
				"document:delivery:useful": 0.99,
				"document:delivery:short": short,
				"document:delivery:detailed": detailed,
			}),
		);
		expect(choice.included).toBe(true);
		expect(choice.chunk.representation).toBe(expected);
	}
	const {
		choices: [irrelevant],
	} = await chooseContextRepresentations(
		request,
		services({ "document:delivery:useful": 0.01 }),
	);
	expect(irrelevant).toMatchObject({ included: false, reason: "irrelevant" });
	for (const useful of [0.4, NaN, 2]) {
		const {
			choices: [uncertain],
		} = await chooseContextRepresentations(
			request,
			services({ "document:delivery:useful": useful }),
		);
		expect(uncertain.included).toBe(true);
		expect(uncertain.chunk.content).toBe(source.content);
	}
});

test("cache-aware pricing may retain adequate full text even when both summaries are sufficient", async () => {
	const {
		choices: [choice],
	} = await chooseContextRepresentations(
		{
			...request,
			price: (chunks) => (chunks[0].representation === "full" ? 1 : 2),
		},
		services({
			"document:delivery:useful": 0.99,
			"document:delivery:short": 0.99,
			"document:delivery:detailed": 0.99,
		}),
	);
	expect(choice.chunk.representation).toBe("full");
});

test("provider failure retains full source and cancellation propagates", async () => {
	const failed = services({});
	failed.summarize = async () => {
		throw new Error("unavailable");
	};
	failed.assess = async () => {
		throw new Error("unavailable");
	};
	expect(
		(await chooseContextRepresentations(request, failed)).choices[0],
	).toMatchObject({
		included: true,
		reason: "unavailable",
		summaryCache: "unavailable",
		chunk: { representation: "full" },
	});
	const controller = new AbortController();
	controller.abort();
	await expect(
		chooseContextRepresentations(request, {
			...services({}),
			signal: controller.signal,
		}),
	).rejects.toThrow();
});

test("automatic compression changes actual history, stage results and document content before the final budget", async () => {
	const context = await prepareContext({
		nodeId: "answer",
		callId: "1",
		messages: [
			{ role: "user", content: source.content },
			{ role: "user", content: request.query },
		],
		inputs: [
			{
				nodeId: "draft",
				sourceNodeId: "draft",
				revision: 1,
				kind: "model",
				text: source.content,
			},
		],
		documents: [
			{ id: "delivery", name: source.label, content: source.content },
		],
		policy: {
			...DEFAULT_CONTEXT_POLICY,
			automatic: { minimumConfidence: 0.9 },
			maxCharacters: 1000,
			documents: [{ id: "delivery", representation: "summary" }],
		},
		optimize: (input) =>
			chooseContextRepresentations(input, {
				...services({}),
				assess: async ({ sources }) => ({
					probabilities: Object.fromEntries(
						sources.flatMap(({ id }) => [
							[`${id}:useful`, 0.99],
							[`${id}:detailed`, 0.99],
							[`${id}:short`, 0.01],
						]),
					),
				}),
			}),
	});
	expect(context.messages).toEqual([
		{ role: "user", content: summaries.detailed },
		{ role: "user", content: request.query },
	]);
	expect(context.inputs[0]).toMatchObject({
		text: summaries.detailed,
		sourceNodeId: "draft",
		revision: 1,
	});
	expect(context.documents[0]).toMatchObject({
		content: summaries.detailed,
		representation: "detailed",
	});
	expect(context.trace.characters).toBeLessThanOrEqual(1000);
	expect(
		context.trace.chunks.every(
			(chunk) => chunk.included && chunk.representation === "detailed",
		),
	).toBe(true);
});

test("summaries reuse content, change on source changes, expire, and isolate sessions", async () => {
	let now = 0;
	let generations = 0;
	const memory = new SessionMemory(() => now);
	const run = (chunk = source) =>
		chooseContextRepresentations(
			{ ...request, chunks: [chunk] },
			{
				...services({}),
				memory,
				summarize: async () => {
					generations++;
					return { summaries, model: "gpt-6-luna" };
				},
			},
		);
	expect((await run()).choices[0].summaryCache).toBe("created");
	expect((await run()).choices[0].summaryCache).toBe("reused");
	await run({ ...source, content: `${source.content}Новые условия.` });
	expect(generations).toBe(2);
	now += 30 * 60 * 1000;
	await run();
	expect(generations).toBe(3);
	const pool = new SessionMemoryPool(() => now);
	expect(pool.get("one")).toBe(pool.get("one"));
	expect(pool.get("one")).not.toBe(pool.get("two"));
	const first = pool.get("one");
	now += 30 * 60 * 1000;
	expect(pool.get("one")).not.toBe(first);
});

test("parallel requests generate a summary once and rejected generations do not poison the cache", async () => {
	const memory = new SessionMemory();
	let complete: (value: typeof summaries) => void = () => {};
	let generations = 0;
	const create = () => {
		generations++;
		return new Promise<typeof summaries>((resolve) => {
			complete = resolve;
		});
	};
	const first = memory.summarize("same", create);
	const second = memory.summarize("same", create);
	complete(summaries);
	expect((await first).cache).toBe("created");
	expect((await second).cache).toBe("reused");
	expect(generations).toBe(1);
	await expect(
		memory.summarize("failed", async () => {
			throw new Error("cancelled");
		}),
	).rejects.toThrow("cancelled");
	expect((await memory.summarize("failed", async () => summaries)).cache).toBe(
		"created",
	);
});

test("a fresh process reuses durable summaries without generating or charging again", async () => {
	const values = new Map<string, typeof summaries>();
	const store = {
		get: async (key: string) => values.get(key) ?? null,
		put: async (key: string, value: typeof summaries) => {
			values.set(key, value);
		},
	};
	let calls = 0;
	const create = async () => {
		calls++;
		return summaries;
	};
	expect(
		(await new SessionMemory().summarize("content", create, store)).cache,
	).toBe("created");
	expect(
		(await new SessionMemory().summarize("content", create, store)).cache,
	).toBe("reused");
	expect(calls).toBe(1);
	expect(
		(await new SessionMemory().summarize("changed", create, store)).cache,
	).toBe("created");
});

test("query-aware summaries reuse only matching query, task and source content", async () => {
	const memory = new SessionMemory();
	const sent: { query: string; task: string }[] = [];
	const run = (query = request.query, task = request.task) =>
		chooseContextRepresentations(
			{ ...request, query, task },
			{
				...services({}),
				memory,
				summarize: async (input) => {
					sent.push({ query: input.query, task: input.task });
					return { summaries, model: "gpt-6-luna" };
				},
			},
		);
	await run();
	await run();
	await run("Когда доставка?");
	await run(request.query, "Explain the exception for opened medicine.");
	expect(sent).toEqual([
		{ query: request.query, task: request.task },
		{ query: "Когда доставка?", task: request.task },
		{
			query: request.query,
			task: "Explain the exception for opened medicine.",
		},
	]);
});

test("payback policy skips paid preparation for cheap or unknown savings but preserves full selected sources", async () => {
	for (const price of [undefined, () => 0.0001]) {
		let calls = 0;
		const { choices, preparation } = await chooseContextRepresentations(
			{
				...request,
				economics: { minimumReturn: 1.1 },
				maxCharacters: 24000,
				price,
			},
			{
				memory: new SessionMemory(),
				summarize: async () => {
					calls++;
					return { summaries, model: "gpt-6-luna" };
				},
				assess: async () => {
					calls++;
					return { probabilities: {} };
				},
			},
		);
		expect(calls).toBe(0);
		expect(choices[0].chunk.content).toBe(source.content);
		expect(preparation?.status).toBe(price ? "retain-full" : "unknown-price");
	}
});

test("payback preparation proceeds for sufficient savings or a required context budget and propagates cancellation", async () => {
	for (const budget of [1000, 24000]) {
		let calls = 0;
		const { preparation } = await chooseContextRepresentations(
			{
				...request,
				economics: { minimumReturn: 1.1 },
				maxCharacters: budget,
				price: (chunks) => (chunks.length ? 1 : 0),
			},
			{
				...services({}),
				summarize: async () => {
					calls++;
					return { summaries, model: "gpt-6-luna" };
				},
			},
		);
		expect(calls).toBe(1);
		expect(preparation?.status).toBe(
			budget === 1000 ? "budget-required" : "prepare",
		);
	}
	const controller = new AbortController();
	controller.abort();
	await expect(
		chooseContextRepresentations(
			{ ...request, economics: { minimumReturn: 1.1 }, price: () => 0 },
			{ ...services({}), signal: controller.signal },
		),
	).rejects.toThrow();
});
