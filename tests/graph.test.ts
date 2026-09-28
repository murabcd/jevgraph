import { afterAll, describe, expect, test } from "bun:test";
import type { Edge } from "@xyflow/react";
import {
	canConnectNodes,
	duplicateModelNode,
	type FlowNode,
	nodeStepLabels,
	readGraph,
	removeGraphNode,
	retainQuestionEdges,
	routesFromGraph,
	saveGraph,
} from "../src/flow/graph";
import { DEFAULT_CONTEXT_POLICY } from "../src/lib/context";
import { defaultJevQuestion, questionOutputs } from "../src/lib/jev-question";
import {
	DEFAULT_JEV_CONFIDENCE_THRESHOLD,
	DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
	routesUseJev,
} from "../src/lib/routing";
import { configuredJevQuestion } from "./jev-question-fixture";
import { connectedWorkflowGraph } from "./workflow-graph";

const stored = new Map<string, string>();
const previousStorage = Object.getOwnPropertyDescriptor(
	globalThis,
	"localStorage",
);
Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => stored.set(key, value),
		removeItem: (key: string) => stored.delete(key),
	},
});
afterAll(() => {
	if (previousStorage)
		Object.defineProperty(globalThis, "localStorage", previousStorage);
	else Reflect.deleteProperty(globalThis, "localStorage");
});

function node(
	id: string,
	kind: "input" | "jev" | "openai" | "google",
	x: number,
): FlowNode {
	return {
		id,
		type: "route",
		position: { x, y: 0 },
		data: {
			kind,
			active: false,
			...(kind === "input" ? { fields: [] } : {}),
			...(kind === "jev"
				? {
						question: configuredJevQuestion(),
						confidenceThreshold: DEFAULT_JEV_CONFIDENCE_THRESHOLD,
					}
				: {}),
			...(kind === "openai"
				? {
						model: "gpt-6-luna",
						maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
					}
				: {}),
			...(kind === "google"
				? {
						model: "gemini-3.8-flash",
						maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
					}
				: {}),
		},
	};
}

describe("editable chatflow graph", () => {
	test("automatic policies survive persistence and compilation without normalizing reasoning against the manual model", () => {
		const nodes: FlowNode[] = [
			node("input", "input", 0),
			{
				id: "model",
				type: "route",
				position: { x: 1, y: 0 },
				data: {
					kind: "google",
					model: "gemini-3.8-flash",
					active: false,
					maxOutputTokens: 100,
					reasoningEffort: "none",
					routing: {
						models: ["gpt-6-luna"],
						expectedOutputTokens: 50,
						expectedRequests: 2,
					},
					context: {
						...DEFAULT_CONTEXT_POLICY,
						automatic: { minimumConfidence: 0.9 },
					},
					modelPlans: [
						{
							nodeId: "model",
							callId: "1",
							selectedModel: "gpt-6-luna",
							expectedRequests: 2,
							estimation: "utf8-estimate",
							candidates: [],
						},
					],
				},
			},
		];
		const edges = [{ id: "entry", source: "input", target: "model" }];
		saveGraph(nodes, edges);
		const restored = readGraph();
		expect(restored.nodes[1].data.modelPlans).toBeUndefined();
		expect(
			routesFromGraph(restored.nodes, restored.edges)?.nodes[1],
		).toMatchObject({
			reasoningEffort: "none",
			routing: { models: ["gpt-6-luna"] },
			context: { automatic: { minimumConfidence: 0.9 } },
		});
		expect(
			duplicateModelNode(nodes, "model", "copy").at(-1)?.data.modelPlans,
		).toBeUndefined();
	});

	test("duplicates model configuration without copying execution state or losing context and prices", () => {
		const original: FlowNode = {
			id: "original",
			type: "route",
			position: { x: 0, y: 0 },
			selected: true,
			data: {
				kind: "openai",
				active: true,
				model: "gpt-6-luna",
				maxOutputTokens: 800,
				reasoningEffort: "none",
				prompt: "Keep it short.",
				promptMessages: [{ role: "user", content: "Example" }],
				variables: ["test"],
				context: {
					...DEFAULT_CONTEXT_POLICY,
					historyMessages: 2,
					documents: [{ id: "kb", representation: "summary" }],
				},
				pricing: { input: 1, output: 2 },
				output: "Last answer",
				timing: { nodeId: "original", durationMs: 42, status: "completed" },
				isBackup: true,
			},
		};
		const duplicated = duplicateModelNode([original], "original", "copy");
		const copy = duplicated.at(-1);
		expect(copy).toMatchObject({
			id: "copy",
			selected: true,
			data: {
				kind: "openai",
				active: false,
				model: "gpt-6-luna",
				maxOutputTokens: 800,
				prompt: "Keep it short.",
				promptMessages: original.data.promptMessages,
				variables: ["test"],
				reasoningEffort: "none",
				context: original.data.context,
				pricing: original.data.pricing,
			},
		});
		expect(copy?.data.output).toBeUndefined();
		expect(copy?.data.timing).toBeUndefined();
		expect(copy?.data.isBackup).toBeUndefined();
		expect(duplicated[0].selected).toBe(false);
		expect(original.selected).toBe(true);
		expect(duplicateModelNode([original], "missing", "copy")).toEqual([
			original,
		]);
	});

	test("restores document representations and prices without persisting execution data, and removes deleted output bindings", () => {
		const graph = connectedWorkflowGraph();
		const policy = {
			...DEFAULT_CONTEXT_POLICY,
			upstream: "selected" as const,
			outputNodeIds: ["first-router"],
			documents: [{ id: "guide", representation: "summary" as const }],
			relevance: { instructions: "Keep constraints", minimumConfidence: 0.9 },
		};
		graph.nodes = graph.nodes.map(
			(item): FlowNode => ({
				...item,
				data:
					item.data.kind === "input"
						? {
								...item.data,
								documents: [
									{
										id: "guide",
										name: "Guide",
										content: "Full source",
										summary: "Short guide",
									},
								],
							}
						: item.id === "primary-model"
							? {
									...item.data,
									context: policy,
									pricing: { input: 1, output: 2 },
									output: "Private execution result",
								}
							: item.data,
			}),
		);
		saveGraph(graph.nodes, graph.edges);
		const restored = readGraph();
		const routes = routesFromGraph(restored.nodes, restored.edges);
		expect(routes).not.toBeNull();
		expect(
			routes?.nodes.find(({ id }) => id === "primary-model"),
		).toMatchObject({ context: policy, pricing: { input: 1, output: 2 } });
		expect(
			restored.nodes.find(({ id }) => id === "primary-model")?.data.output,
		).toBeUndefined();
		const removed = removeGraphNode(
			restored.nodes,
			restored.edges,
			"first-router",
		);
		expect(
			removed.nodes.find(({ id }) => id === "primary-model")?.data.context
				?.outputNodeIds,
		).toEqual([]);
	});
	test("compiles, persists, and restores a connected Jev flow with a model backup", () => {
		const graph = connectedWorkflowGraph();
		const routes = routesFromGraph(graph.nodes, graph.edges);
		expect(routes?.kind).toBe("workflow");
		expect(routes?.nodes.filter((item) => item.kind === "jev")).toHaveLength(2);
		saveGraph(graph.nodes, graph.edges);
		expect(routesFromGraph(readGraph().nodes, readGraph().edges)).toEqual(
			routes,
		);
		expect(
			routesFromGraph(
				graph.nodes,
				graph.edges.filter((edge) => edge.id !== "second-no"),
			),
		).not.toBeNull();
	});

	test("persists configured Start fields and only declared node bindings", () => {
		const nodes = [
			{
				...node("input", "input", 0),
				data: {
					kind: "input" as const,
					active: false,
					fields: [
						{
							name: "plan",
							type: "string" as const,
							required: false,
							defaultValue: "free",
						},
					],
				},
			},
			{
				...node("model", "openai", 1),
				data: {
					kind: "openai" as const,
					active: false,
					model: "gpt-6-luna",
					maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
					variables: ["plan"],
				},
			},
		];
		const edges: Edge[] = [{ id: "entry", source: "input", target: "model" }];
		const routes = routesFromGraph(nodes, edges);
		expect(routes?.nodes[0]).toEqual({
			id: "input",
			kind: "input",
			fields: [
				{ name: "plan", type: "string", required: false, defaultValue: "free" },
			],
		});
		expect(routes?.nodes[1]).toMatchObject({
			kind: "model",
			variables: ["plan"],
			reasoningEffort: "medium",
		});
		saveGraph(nodes, edges);
		expect(routesFromGraph(readGraph().nodes, readGraph().edges)).toEqual(
			routes,
		);
		expect(
			routesFromGraph(
				[
					nodes[0],
					{ ...nodes[1], data: { ...nodes[1].data, variables: ["unknown"] } },
				],
				edges,
			),
		).toBeNull();
	});

	test("compiles Gemini reasoning defaults for a connected Model", () => {
		const nodes = [node("input", "input", 0), node("model", "google", 1)];
		const edges: Edge[] = [{ id: "entry", source: "input", target: "model" }];
		expect(routesFromGraph(nodes, edges)?.nodes[1]).toMatchObject({
			kind: "model",
			model: "gemini-3.8-flash",
			reasoningEffort: "medium",
		});
	});

	test("connects models downstream to Jev or another model, including joins", () => {
		const nodes = [
			node("input", "input", 0),
			node("first", "openai", 1),
			node("judge", "jev", 2),
			node("final", "google", 3),
		];
		const edges: Edge[] = [
			{ id: "entry", source: "input", target: "first" },
			{ id: "next", source: "first", sourceHandle: "next", target: "judge" },
		];
		expect(
			canConnectNodes(
				{ source: "first", sourceHandle: "next", target: "judge" },
				nodes,
			),
		).toBe(true);
		expect(
			canConnectNodes(
				{ source: "first", sourceHandle: "next", target: "final" },
				nodes,
				edges,
			),
		).toBe(true);
		expect(
			canConnectNodes(
				{ source: "first", sourceHandle: "next", target: "judge" },
				nodes,
				edges,
			),
		).toBe(false);
		expect(
			canConnectNodes(
				{ source: "judge", sourceHandle: "choice-1", target: "first" },
				nodes,
				edges,
			),
		).toBe(true);
		expect(
			canConnectNodes(
				{ source: "final", sourceHandle: "fallback", target: "first" },
				nodes,
				edges,
			),
		).toBe(false);
	});

	test("does not replace an occupied error branch with another backup", () => {
		const nodes = [
			node("input", "input", 0),
			node("primary", "openai", 1),
			node("backup", "google", 2),
			node("another", "openai", 3),
		];
		const occupied: Edge[] = [
			{ id: "entry", source: "input", target: "primary" },
			{
				id: "backup-edge",
				source: "primary",
				sourceHandle: "fallback",
				target: "backup",
			},
		];
		const connection = {
			source: "primary",
			sourceHandle: "fallback",
			target: "another",
		};
		expect(canConnectNodes(connection, nodes, occupied)).toBe(false);
		expect(canConnectNodes(connection, nodes, occupied.slice(0, 1))).toBe(true);
	});

	test("compiles sequential model output into Jev and a final model", () => {
		const nodes = [
			node("input", "input", 0),
			node("first", "openai", 1),
			node("judge", "jev", 2),
			node("final", "google", 3),
		];
		nodes[1].data.prompt = "Write a draft";
		nodes[1].data.promptMessages = [
			{ role: "user", content: "Example request" },
			{ role: "assistant", content: "Example response" },
		];
		const edges: Edge[] = [
			{ id: "entry", source: "input", target: "first" },
			{ id: "next", source: "first", sourceHandle: "next", target: "judge" },
			{
				id: "choice-1",
				source: "judge",
				sourceHandle: "choice-1",
				target: "final",
			},
			{
				id: "choice-2",
				source: "judge",
				sourceHandle: "choice-2",
				target: "final",
			},
		];
		const routes = routesFromGraph(nodes, edges);
		if (!routes) throw new Error("Expected valid routes");
		expect(routesUseJev(routes)).toBe(true);
		expect(routes?.nodes.find((item) => item.id === "first")).toMatchObject({
			prompt: "Write a draft",
			promptMessages: [
				{ role: "user", content: "Example request" },
				{ role: "assistant", content: "Example response" },
			],
		});
		expect(nodeStepLabels(nodes, edges).get("first")).toBe("02 / MODEL");
		expect(nodeStepLabels(nodes, edges).get("final")).toBe("04 / OUTPUT");
		saveGraph(nodes, edges);
		expect(
			readGraph().nodes.find((item) => item.id === "first")?.data.prompt,
		).toBe("Write a draft");
		expect(
			readGraph().nodes.find((item) => item.id === "first")?.data
				.promptMessages,
		).toEqual([
			{ role: "user", content: "Example request" },
			{ role: "assistant", content: "Example response" },
		]);
	});

	test("keeps Start as the required chatflow entry", () => {
		const nodes = [node("input", "input", 0), node("model", "openai", 1)];
		const edges: Edge[] = [{ id: "entry", source: "input", target: "model" }];
		const withStart = routesFromGraph(nodes, edges);
		expect(withStart?.nodes[0]?.kind).toBe("input");
		const removed = removeGraphNode(nodes, edges, "input");
		expect(removed).toEqual({ nodes, edges });
		expect(
			routesFromGraph(
				nodes.filter((item) => item.id !== "input"),
				[],
			),
		).toBeNull();
	});

	test("Start can launch parallel branches", () => {
		const nodes = [
			node("input", "input", 0),
			node("first", "openai", 1),
			node("second", "google", 2),
			node("join", "jev", 3),
			node("final", "openai", 4),
		];
		const edges: Edge[] = [
			{ id: "first-entry", source: "input", target: "first" },
			{ id: "second-entry", source: "input", target: "second" },
			{
				id: "first-join",
				source: "first",
				sourceHandle: "next",
				target: "join",
			},
			{
				id: "second-join",
				source: "second",
				sourceHandle: "next",
				target: "join",
			},
			{ id: "yes", source: "join", sourceHandle: "choice-1", target: "final" },
			{ id: "no", source: "join", sourceHandle: "choice-2", target: "final" },
		];
		const routes = routesFromGraph(nodes, edges);
		expect(
			routes?.edges
				.filter((edge) => edge.source === "input")
				.map((edge) => edge.target),
		).toEqual(["first", "second"]);
	});

	test("keeps a bounded Jev feedback edge after saving the graph", () => {
		const nodes = [
			node("input", "input", 0),
			node("draft", "openai", 1),
			node("judge", "jev", 2),
			node("final", "openai", 3),
		];
		nodes[2].data.maxRepeats = 2;
		const edges: Edge[] = [
			{ id: "entry", source: "input", target: "draft" },
			{ id: "check", source: "draft", sourceHandle: "next", target: "judge" },
			{
				id: "retry",
				source: "judge",
				sourceHandle: "choice-1",
				target: "draft",
				data: { repeat: true },
			},
			{
				id: "done",
				source: "judge",
				sourceHandle: "choice-2",
				target: "final",
			},
		];
		const routes = routesFromGraph(nodes, edges);
		expect(routes?.edges.find((edge) => edge.id === "retry")?.repeat).toBe(
			true,
		);
		expect(routes?.nodes.find((item) => item.id === "judge")).toMatchObject({
			maxRepeats: 2,
		});
		saveGraph(nodes, edges);
		expect(routesFromGraph(readGraph().nodes, readGraph().edges)).toEqual(
			routes,
		);
	});

	test("allows a Jev choice to answer directly on an unconnected output", () => {
		const nodes = [
			node("input", "input", 0),
			node("judge", "jev", 1),
			node("model", "openai", 2),
		];
		const edges: Edge[] = [
			{ id: "entry", source: "input", target: "judge" },
			{
				id: "choice-1",
				source: "judge",
				sourceHandle: "choice-1",
				target: "model",
			},
		];
		expect(routesFromGraph(nodes, edges)).not.toBeNull();
		expect(
			routesFromGraph(nodes.slice(0, 2), edges.slice(0, 1)),
		).not.toBeNull();
		expect(nodeStepLabels(nodes, edges).get("judge")).toBe("02 / CLASSIFIER");
		expect(
			routesFromGraph(nodes, [
				...edges,
				{
					id: "invalid",
					source: "judge",
					sourceHandle: "unknown",
					target: "model",
				},
			]),
		).toBeNull();
	});

	test("preserves stable Choice edges when labels change", () => {
		const previous = configuredJevQuestion("choice");
		if (previous.type !== "choice") throw new Error("Expected Choice");
		const next = {
			...previous,
			options: previous.options.map((option) =>
				option.id === "choice-1" ? { ...option, label: "Cheap" } : option,
			),
		};
		const edges: Edge[] = [
			{
				id: "choice-1",
				source: "judge",
				sourceHandle: "choice-1",
				target: "model",
			},
		];
		expect(questionOutputs(next)[0].label).toBe("Cheap");
		expect(
			retainQuestionEdges(previous, next, edges, "judge")[0],
		).toMatchObject({
			sourceHandle: "choice-1",
			target: "model",
		});
	});

	test("drops stale Jev connections when the question type changes", () => {
		const previous = configuredJevQuestion("choice");
		if (previous.type !== "choice") throw new Error("Expected Choice");
		previous.options[0].id = "yes";
		const edges: Edge[] = [
			{ id: "entry", source: "input", target: "judge" },
			{
				id: "choice-yes",
				source: "judge",
				sourceHandle: "yes",
				target: "model",
			},
		];
		expect(
			retainQuestionEdges(previous, defaultJevQuestion("noul"), edges, "judge"),
		).toEqual([edges[0]]);
	});

	test("restores the initial graph when Start is missing and rejects malformed nodes", () => {
		saveGraph([], []);
		const initial = readGraph();
		expect(initial.nodes.map((item) => item.id)).toEqual(["input", "jev"]);
		expect(initial.edges).toHaveLength(1);
		expect(routesFromGraph(initial.nodes, initial.edges)).toBeNull();
		saveGraph(initial.nodes, initial.edges);
		expect(readGraph().nodes[1]?.data.question).toEqual(
			defaultJevQuestion("choice"),
		);
		stored.set(
			"router:graph:v3",
			JSON.stringify({
				nodes: [
					{
						id: "input",
						position: { x: 0, y: 0 },
						data: { kind: "input", fields: [] },
					},
					{
						id: "model",
						position: { x: 1, y: 0 },
						data: {
							kind: "openai",
							model: "gpt-6-luna",
							maxOutputTokens: 1400,
						},
					},
					{
						id: "bad",
						position: { x: "oops", y: 0 },
						data: { kind: "openai" },
					},
				],
				edges: [
					{ id: "valid", source: "input", target: "model" },
					{ id: "invalid", source: "input", target: "bad" },
				],
			}),
		);
		const graph = readGraph();
		expect(graph.nodes.map((item) => item.id)).toEqual(["input", "model"]);
		expect(graph.edges.map((item) => item.id)).toEqual(["valid"]);
		expect(routesFromGraph(graph.nodes, graph.edges)?.kind).toBe("workflow");
	});
});
