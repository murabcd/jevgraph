import { expect, test } from "bun:test";
import { selectWorkflow, workflowRoutingState } from "../server/workflow";
import { removeGraphNode, routesFromGraph } from "../src/flow/graph";
import { defaultConfig, type JevDecision } from "../src/lib/routing";
import { connectedWorkflowGraph } from "./workflow-graph";

const example = connectedWorkflowGraph();
const routes = routesFromGraph(example.nodes, example.edges);
if (routes?.kind !== "workflow")
	throw new Error("Fixture must compile as a workflow");

function answer(branch: "yes" | "no"): JevDecision {
	return {
		type: "noul",
		branch,
		value: branch,
		confidence: 0.95,
		model: "jev-latest",
		latencyMs: 1,
	};
}

test("a first-node decision selects a model with a backup", async () => {
	const questions: string[] = [];
	const result = await selectWorkflow(
		routes,
		defaultConfig,
		async (_nodeId, question) => {
			questions.push(question.instructions);
			return answer("yes");
		},
	);
	expect(questions).toEqual(["Does this request require complex reasoning?"]);
	expect(result.target.nodeId).toBe("primary-model");
	expect(result.fallback?.nodeId).toBe("backup-model");
	expect(result.path.map((step) => step.nodeId)).toEqual([
		"input",
		"first-router",
		"primary-model",
	]);
});

test("a second Jev decision selects either connected branch", async () => {
	for (const [second, expected] of [
		["yes", "second-yes-model"],
		["no", "second-no-model"],
	] as const) {
		let calls = 0;
		const result = await selectWorkflow(routes, defaultConfig, async () =>
			answer(++calls === 1 ? "no" : second),
		);
		expect(calls).toBe(2);
		expect(result.target.nodeId).toBe(expected);
		expect(result.path).toEqual([
			{ nodeId: "input" },
			{ nodeId: "first-router" },
			{ nodeId: "second-router", via: "no" },
			{ nodeId: expected, via: second },
		]);
	}
});

test("a multi-Jev workflow runs without a System node", async () => {
	const graph = removeGraphNode(example.nodes, example.edges, "input");
	const rootlessRoutes = routesFromGraph(graph.nodes, graph.edges);
	if (rootlessRoutes?.kind !== "workflow")
		throw new Error("Expected workflow route");
	const result = await selectWorkflow(rootlessRoutes, defaultConfig, async () =>
		answer("yes"),
	);
	expect(result.target.nodeId).toBe("primary-model");
	expect(result.decisions.map((decision) => decision.nodeId)).toEqual([
		"first-router",
	]);
});

test("a Jev failure uses that node's first configured output and records the error", async () => {
	const result = await selectWorkflow(routes, defaultConfig, async () => {
		throw new Error("Jev unavailable");
	});
	expect(result.target.nodeId).toBe("second-no-model");
	expect(result.decisions).toHaveLength(2);
	expect(result.decisions[0].error).toBe("Jev unavailable");
});

test("passes recent conversation, optional System instructions, and supplied metadata to Jev", () => {
	const state = workflowRoutingState(
		[{ role: "user", content: "Help with an invoice" }],
		"Be concise",
		{ accountTier: "paid", currentLoad: 2.4 },
	);
	expect(state).toContain(
		'Routing metadata: {"accountTier":"paid","currentLoad":2.4}',
	);
	expect(state).toContain("System instructions: Be concise");
	expect(state).toContain("user: Help with an invoice");
	expect(
		workflowRoutingState([{ role: "user", content: "Hello" }], "", {}),
	).toBe("user: Hello");
});
