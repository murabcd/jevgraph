import { afterAll, describe, expect, test } from "bun:test";
import type { Edge } from "@xyflow/react";
import {
	canConnectNodes,
	type FlowNode,
	nodeStepLabels,
	readGraph,
	remapQuestionEdges,
	routesFromGraph,
	saveGraph,
} from "../src/flow/graph";
import {
	defaultJevQuestion,
	type JevQuestionType,
	questionOutputs,
} from "../src/lib/jev-question";

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

function jevRoutes(nodes: FlowNode[], edges: Edge[]) {
	const routes = routesFromGraph(nodes, edges);
	if (routes?.kind !== "jev") throw new Error("Expected Jev route");
	return routes;
}

describe("editable routing graph", () => {
	test("only connects an existing source output to a compatible target", () => {
		const nodes: FlowNode[] = [
			{
				id: "input",
				type: "route",
				position: { x: 0, y: 0 },
				data: { kind: "input", active: false },
			},
			{
				id: "jev",
				type: "route",
				position: { x: 1, y: 0 },
				data: { kind: "jev", active: false, question: defaultJevQuestion() },
			},
			{
				id: "model",
				type: "route",
				position: { x: 2, y: 0 },
				data: { kind: "openai", active: false, model: "gpt-5-mini" },
			},
		];
		expect(canConnectNodes({ source: "input", target: "jev" }, nodes)).toBe(
			true,
		);
		expect(canConnectNodes({ source: "input", target: "model" }, nodes)).toBe(
			true,
		);
		expect(
			canConnectNodes(
				{ source: "jev", sourceHandle: "fast", target: "model" },
				nodes,
			),
		).toBe(true);
		expect(
			canConnectNodes(
				{ source: "jev", sourceHandle: "missing", target: "model" },
				nodes,
			),
		).toBe(false);
		expect(canConnectNodes({ source: "model", target: "jev" }, nodes)).toBe(
			false,
		);
		expect(canConnectNodes({ source: "input", target: "input" }, nodes)).toBe(
			false,
		);
	});

	test("keeps an intentionally empty graph after refresh", () => {
		saveGraph([], []);
		expect(readGraph()).toEqual({ nodes: [], edges: [] });
	});

	test("loads valid graph entries without trusting malformed persisted data", () => {
		stored.set(
			"router:graph:v2",
			JSON.stringify({
				nodes: [
					{ id: "input", position: { x: 0, y: 0 }, data: { kind: "input" } },
					{
						id: "model",
						position: { x: 1, y: 0 },
						data: { kind: "openai", model: "gpt-5-mini" },
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
		expect(graph.nodes.map((node) => node.id)).toEqual(["input", "model"]);
		expect(graph.edges.map((edge) => edge.id)).toEqual(["valid"]);
		expect(routesFromGraph(graph.nodes, graph.edges)?.kind).toBe("direct");
	});

	test("requires Input to connect to Jev before chat can run", () => {
		const nodes: FlowNode[] = [
			{
				id: "input",
				type: "route",
				position: { x: 0, y: 0 },
				data: { kind: "input", active: false },
			},
			{
				id: "jev",
				type: "route",
				position: { x: 1, y: 0 },
				data: { kind: "jev", active: false, question: defaultJevQuestion() },
			},
			{
				id: "fast",
				type: "route",
				position: { x: 2, y: 0 },
				data: { kind: "google", active: false, model: "gemini-3.5-flash-lite" },
			},
			{
				id: "deep",
				type: "route",
				position: { x: 2, y: 1 },
				data: { kind: "openai", active: false, model: "gpt-5-mini" },
			},
		];
		const branches: Edge[] = [
			{ id: "fast-edge", source: "jev", sourceHandle: "fast", target: "fast" },
			{ id: "deep-edge", source: "jev", sourceHandle: "deep", target: "deep" },
		];
		expect(routesFromGraph(nodes, branches)).toBeNull();
		expect(
			routesFromGraph(nodes.slice(1), [
				{ id: "input-edge", source: "input", target: "jev" },
				...branches,
			]),
		).toBeNull();
		expect(
			jevRoutes(nodes, [
				{ id: "input-edge", source: "input", target: "jev" },
				...branches,
			]).targets.fast.nodeId,
		).toBe("fast");
	});

	test("requires every configured Choice output to have a model connection", () => {
		const question = defaultJevQuestion("choice");
		if (question.type !== "choice") throw new Error("Expected Choice question");
		question.options.push({
			id: "balanced",
			label: "Balanced",
			description: "Moderate reasoning.",
		});
		const nodes: FlowNode[] = [
			{
				id: "input",
				type: "route",
				position: { x: 0, y: 0 },
				data: { kind: "input", active: false },
			},
			{
				id: "jev",
				type: "route",
				position: { x: 1, y: 0 },
				data: { kind: "jev", active: false, question },
			},
			{
				id: "model",
				type: "route",
				position: { x: 2, y: 0 },
				data: { kind: "google", active: false, model: "gemini-3.5-flash-lite" },
			},
		];
		const edges: Edge[] = [
			{ id: "input-jev", source: "input", target: "jev" },
			{ id: "fast", source: "jev", sourceHandle: "fast", target: "model" },
			{ id: "deep", source: "jev", sourceHandle: "deep", target: "model" },
		];
		expect(routesFromGraph(nodes, edges)).toBeNull();
		expect(
			jevRoutes(nodes, [
				...edges,
				{
					id: "balanced",
					source: "jev",
					sourceHandle: "balanced",
					target: "model",
				},
			]).targets.balanced.nodeId,
		).toBe("model");
	});

	test("keeps the simpler and deeper model connections across question types", () => {
		const types: JevQuestionType[] = ["choice", "noul", "score"];
		const branchIds = {
			choice: ["fast", "deep"],
			noul: ["no", "yes"],
			score: ["score-0", "score-2"],
		} as const;
		const nodes: FlowNode[] = [
			{
				id: "input",
				type: "route",
				position: { x: 0, y: 0 },
				data: { kind: "input", active: false },
			},
			{
				id: "jev",
				type: "route",
				position: { x: 1, y: 0 },
				data: { kind: "jev", active: false },
			},
			{
				id: "simple",
				type: "route",
				position: { x: 2, y: 0 },
				data: { kind: "google", active: false, model: "gemini-3.5-flash-lite" },
			},
			{
				id: "complex",
				type: "route",
				position: { x: 2, y: 1 },
				data: { kind: "openai", active: false, model: "gpt-5-mini" },
			},
		];
		for (const previousType of types) {
			const previousQuestion = defaultJevQuestion(previousType);
			const [previousLow, previousHigh] = branchIds[previousType];
			const edges: Edge[] = [
				{ id: "input-jev", source: "input", target: "jev" },
				{
					id: "simple",
					source: "jev",
					sourceHandle: previousLow,
					target: "simple",
				},
				{
					id: "complex",
					source: "jev",
					sourceHandle: previousHigh,
					target: "complex",
				},
				...(previousType === "score"
					? [
							{
								id: "middle",
								source: "jev",
								sourceHandle: "score-1",
								target: "simple",
							},
						]
					: []),
			];
			for (const nextType of types) {
				const question = defaultJevQuestion(nextType);
				const [low, high] = branchIds[nextType];
				const remapped = remapQuestionEdges(previousQuestion, question, edges);
				const nextNodes = nodes.map((node) =>
					node.id === "jev"
						? { ...node, data: { ...node.data, question } }
						: node,
				);
				const connected = jevRoutes(nextNodes, remapped);
				expect(connected.targets[low].nodeId).toBe("simple");
				expect(connected.targets[high].nodeId).toBe("complex");
				if (nextType === "score")
					expect(connected.targets["score-1"].nodeId).toBe("simple");
				expect(remapped).toHaveLength(nextType === "score" ? 4 : 3);
			}
		}
	});

	test("keeps a Choice connection when its label changes", () => {
		const previous = defaultJevQuestion("choice");
		if (previous.type !== "choice") throw new Error("Expected Choice");
		const next = {
			...previous,
			options: previous.options.map((option) =>
				option.id === "fast" ? { ...option, label: "Cheap" } : option,
			),
		};
		const edges: Edge[] = [
			{
				id: "fast-model",
				source: "jev",
				sourceHandle: "fast",
				target: "model",
			},
		];
		expect(questionOutputs(next)[0].label).toBe("Cheap");
		expect(remapQuestionEdges(previous, next, edges)[0]).toMatchObject({
			sourceHandle: "fast",
			target: "model",
		});
	});

	test("keeps surviving Score connections when a level is removed", () => {
		const previous = defaultJevQuestion("score");
		if (previous.type !== "score") throw new Error("Expected Score");
		const next = { ...previous, levels: previous.levels.slice(1) };
		const edges: Edge[] = previous.levels.map((level) => ({
			id: level.id,
			source: "jev",
			sourceHandle: level.id,
			target: level.id,
		}));
		expect(
			remapQuestionEdges(previous, next, edges).map(
				(edge) => edge.sourceHandle,
			),
		).toEqual(["score-1", "score-2"]);
		expect(questionOutputs(next).map((output) => output.label)).toEqual([
			"Level 0",
			"Level 1",
		]);
	});

	test("connects Input directly to a selected model without Jev", () => {
		const nodes: FlowNode[] = [
			{
				id: "input",
				type: "route",
				position: { x: 0, y: 0 },
				data: { kind: "input", active: false },
			},
			{
				id: "selected-model",
				type: "route",
				position: { x: 1, y: 0 },
				data: { kind: "openai", active: false, model: "gpt-4.1" },
			},
		];
		const edges: Edge[] = [
			{ id: "input-model", source: "input", target: "selected-model" },
		];
		expect(routesFromGraph(nodes, edges)).toEqual({
			kind: "direct",
			target: {
				nodeId: "selected-model",
				provider: "openai",
				model: "gpt-4.1",
			},
		});
		expect(nodeStepLabels(nodes, edges).get("selected-model")).toBe(
			"02 / OUTPUT",
		);
		saveGraph(nodes, edges);
		const saved = readGraph();
		expect(routesFromGraph(saved.nodes, saved.edges)).toEqual(
			routesFromGraph(nodes, edges),
		);
	});

	test("numbers routing outputs uniquely even when node storage order differs", () => {
		const nodes: FlowNode[] = [
			{
				id: "high",
				type: "route",
				position: { x: 2, y: 1 },
				data: { kind: "openai", active: false, model: "gpt-5-mini" },
			},
			{
				id: "input",
				type: "route",
				position: { x: 0, y: 0 },
				data: { kind: "input", active: false },
			},
			{
				id: "low",
				type: "route",
				position: { x: 2, y: 0 },
				data: { kind: "google", active: false, model: "gemini-3.5-flash-lite" },
			},
			{
				id: "jev",
				type: "route",
				position: { x: 1, y: 0 },
				data: { kind: "jev", active: false, question: defaultJevQuestion() },
			},
		];
		const edges: Edge[] = [
			{ id: "input-jev", source: "input", target: "jev" },
			{ id: "jev-low", source: "jev", sourceHandle: "fast", target: "low" },
			{ id: "jev-high", source: "jev", sourceHandle: "deep", target: "high" },
		];
		expect([...nodeStepLabels(nodes, edges)]).toEqual([
			["input", "01 / INPUT"],
			["jev", "02 / ROUTER"],
			["low", "03 / OUTPUT"],
			["high", "04 / OUTPUT"],
		]);
	});
});
