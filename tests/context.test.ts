import { describe, expect, test } from "bun:test";
import { prepareContext } from "../server/context";
import { modelPrompt } from "../server/model-prompt";
import {
	type ContextDocument,
	DEFAULT_CONTEXT_POLICY,
	resolveContextDocuments,
} from "../src/lib/context";
import {
	type NodeOutput,
	type RouteTarget,
	routeRequestSchema,
} from "../src/lib/routing";
import { configuredJevQuestion } from "./jev-question-fixture";

const document: ContextDocument = {
	id: "style",
	name: "Writing guide",
	content: "LONG SOURCE ".repeat(2000),
	summary: "Use short sentences.",
};
const output: NodeOutput = {
	nodeId: "backup",
	sourceNodeId: "draft",
	revision: 2,
	kind: "model",
	text: "Latest draft",
};
const target: RouteTarget = {
	nodeId: "answer",
	provider: "openai",
	model: "gpt-6-luna",
	maxOutputTokens: 100,
};
const messages = [
	{ role: "user" as const, content: "Unrelated old topic" },
	{ role: "assistant" as const, content: "Old answer" },
	{ role: "user" as const, content: "Rewrite the draft" },
];

describe("node-specific context", () => {
	test("uses selected summaries and stage outputs without leaking full documents or old history", async () => {
		const context = await prepareContext({
			nodeId: "answer",
			callId: "1",
			messages,
			inputs: [output],
			documents: [document],
			policy: {
				...DEFAULT_CONTEXT_POLICY,
				historyMessages: 0,
				upstream: "selected",
				outputNodeIds: ["draft"],
				documents: [{ id: "style", representation: "summary" }],
			},
		});
		const prompt = modelPrompt(
			context.messages,
			target,
			context.inputs,
			{},
			context.documents,
		);
		expect(context.messages).toEqual([messages.at(-1)]);
		expect(context.inputs).toEqual([output]);
		expect(prompt.messages.at(-1)?.content).toContain("Use short sentences.");
		expect(prompt.messages.at(-1)?.content).toContain("Latest draft");
		expect(JSON.stringify(prompt)).not.toContain("LONG SOURCE");
		expect(JSON.stringify(prompt)).not.toContain("Unrelated old topic");
		expect(
			context.trace.chunks.find((chunk) => chunk.kind === "output"),
		).toMatchObject({
			id: "output:backup:2",
			sourceId: "draft",
			included: true,
		});
	});

	test("omits whole oversized chunks while always retaining the current query", async () => {
		const context = await prepareContext({
			nodeId: "answer",
			callId: "1",
			messages,
			inputs: [{ ...output, text: "x".repeat(1001) }],
			documents: [document],
			policy: {
				...DEFAULT_CONTEXT_POLICY,
				maxCharacters: 1000,
				documents: [{ id: "style", representation: "summary" }],
			},
		});
		expect(context.inputs).toEqual([]);
		expect(context.messages.at(-1)).toEqual(messages.at(-1));
		expect(context.documents[0].content).toBe(document.summary);
		expect(
			context.trace.chunks.find((chunk) => chunk.kind === "output"),
		).toMatchObject({ included: false, reason: "budget" });
		expect(context.trace.characters).toBeLessThanOrEqual(1000);
		expect(JSON.stringify(context.trace)).not.toContain("x".repeat(1001));
	});

	test("batches relevance and omits only confidently irrelevant chunks", async () => {
		let requests = 0;
		const context = await prepareContext({
			nodeId: "answer",
			callId: "1",
			messages,
			inputs: [output],
			documents: [],
			policy: {
				...DEFAULT_CONTEXT_POLICY,
				relevance: {
					instructions: "Keep task constraints",
					minimumConfidence: 0.9,
				},
			},
			filter: async (request) => {
				requests++;
				expect(request.query).toBe("Rewrite the draft");
				expect(request.chunks).toHaveLength(3);
				return {
					probabilities: {
						"message:0": 0.01,
						"message:1": 0.4,
						"output:backup:2": 0.99,
					},
				};
			},
		});
		expect(requests).toBe(1);
		expect(context.messages).toEqual(messages.slice(1));
		expect(
			context.trace.chunks.find(({ id }) => id === "message:0"),
		).toMatchObject({ included: false, reason: "irrelevant" });
		expect(
			context.trace.chunks.find(({ id }) => id === "message:1"),
		).toMatchObject({ included: true, reason: "uncertain" });
	});

	test("retains context on provider failure but never swallows cancellation", async () => {
		const policy = {
			...DEFAULT_CONTEXT_POLICY,
			relevance: {
				instructions: "Keep useful information",
				minimumConfidence: 0.9,
			},
		};
		const failed = await prepareContext({
			nodeId: "answer",
			callId: "1",
			messages,
			inputs: [output],
			documents: [],
			policy,
			filter: async () => {
				throw new Error("unavailable");
			},
		});
		expect(failed.messages).toEqual(messages);
		expect(failed.inputs).toEqual([output]);
		expect(
			failed.trace.chunks.every((chunk) => chunk.reason === "unavailable"),
		).toBe(true);
		const controller = new AbortController();
		await expect(
			prepareContext({
				nodeId: "answer",
				callId: "2",
				messages,
				inputs: [],
				documents: [],
				policy,
				signal: controller.signal,
				filter: async () => {
					controller.abort();
					throw new Error("cancelled");
				},
			}),
		).rejects.toThrow();
	});

	test("replacing document text cannot reuse its previous summary", () => {
		const supplied = { id: "style", name: "New guide", content: "New source" };
		expect(resolveContextDocuments([document], [supplied])).toEqual([supplied]);
		expect(() =>
			resolveContextDocuments([document], [{ ...supplied, id: "undeclared" }]),
		).toThrow("declared");
		const routes = {
			kind: "workflow",
			nodes: [
				{ id: "input", kind: "input", fields: [], documents: [document] },
				{
					id: "judge",
					kind: "jev",
					question: configuredJevQuestion(),
					context: {
						...DEFAULT_CONTEXT_POLICY,
						documents: [{ id: "style", representation: "summary" }],
					},
				},
			],
			edges: [{ id: "entry", source: "input", target: "judge" }],
		};
		expect(
			routeRequestSchema.safeParse({
				routes,
				messages: [messages.at(-1)],
				documents: [supplied],
			}).success,
		).toBe(false);
	});

	test("preserves structured decision uncertainty in downstream model context", async () => {
		const decision: NodeOutput = {
			nodeId: "judge",
			sourceNodeId: "judge",
			revision: 1,
			kind: "jev",
			text: "Decision: Yes",
			decision: {
				nodeId: "judge",
				branch: "yes",
				selectedBranch: "no",
				status: "uncertain",
				value: 0.4,
				confidence: 0.6,
				probabilities: { yes: 0.4, no: 0.6 },
			},
		};
		const context = await prepareContext({
			nodeId: "answer",
			callId: "1",
			messages,
			inputs: [decision],
			documents: [],
		});
		const prompt = modelPrompt(
			context.messages,
			target,
			context.inputs,
			{},
			context.documents,
		);
		expect(prompt.messages.at(-1)?.content).toContain('"status":"uncertain"');
		expect(prompt.messages.at(-1)?.content).toContain('"selectedBranch":"no"');
		expect(prompt.messages.at(-1)?.content).toContain('"yes":0.4');
	});
});
