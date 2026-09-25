import { type JevQuestion, questionOutputs } from "../src/lib/jev-question.ts";
import type {
	ChatMessage,
	JevDecision,
	RoutePathStep,
	RouteTarget,
	RoutingConfig,
	RoutingMetadata,
	WorkflowDecision,
	WorkflowRoutes,
} from "../src/lib/routing.ts";

export function workflowRoutingState(
	messages: ChatMessage[],
	requestPrompt: string,
	metadata: RoutingMetadata,
): string {
	return [
		...(Object.keys(metadata).length > 0
			? [`Routing metadata: ${JSON.stringify(metadata)}`]
			: []),
		...(requestPrompt ? [`System instructions: ${requestPrompt}`] : []),
		...messages
			.slice(-6)
			.map((message) => `${message.role}: ${message.content}`),
	].join("\n");
}

export async function selectWorkflow(
	routes: WorkflowRoutes,
	config: RoutingConfig,
	evaluate: (nodeId: string, question: JevQuestion) => Promise<JevDecision>,
): Promise<{
	target: RouteTarget;
	fallback?: RouteTarget;
	path: RoutePathStep[];
	decisions: WorkflowDecision[];
}> {
	const byId = new Map(routes.nodes.map((node) => [node.id, node]));
	const path: RoutePathStep[] = [{ nodeId: "input" }];
	const decisions: WorkflowDecision[] = [];
	let current = "input";
	for (let hops = 0; hops < routes.nodes.length; hops++) {
		const node = byId.get(current);
		if (!node) throw new Error("Workflow node is missing");
		if (node.kind === "model") {
			const target = {
				nodeId: node.id,
				provider: node.provider,
				model: node.model,
			};
			const fallbackEdge = routes.edges.find(
				(edge) => edge.source === node.id && edge.sourceHandle === "fallback",
			);
			const backup = fallbackEdge ? byId.get(fallbackEdge.target) : undefined;
			return {
				target,
				fallback:
					backup?.kind === "model"
						? {
								nodeId: backup.id,
								provider: backup.provider,
								model: backup.model,
							}
						: undefined,
				path,
				decisions,
			};
		}
		let handle: string | undefined;
		if (node.kind === "jev") {
			const outputs = questionOutputs(node.question);
			let decision: JevDecision | undefined;
			let error: string | undefined;
			try {
				decision = await evaluate(node.id, node.question);
			} catch (caught) {
				error = caught instanceof Error ? caught.message : "Unknown Jev error";
			}
			handle =
				decision &&
				decision.confidence >= config.confidenceThreshold &&
				outputs.some((output) => output.id === decision.branch)
					? decision.branch
					: outputs[0].id;
			decisions.push({
				nodeId: node.id,
				branch: handle,
				confidence: decision?.confidence,
				error,
			});
		}
		const edge = routes.edges.find(
			(candidate) =>
				candidate.source === current && candidate.sourceHandle === handle,
		);
		if (!edge) throw new Error("Workflow branch is missing");
		path.push({ nodeId: edge.target, ...(handle ? { via: handle } : {}) });
		current = edge.target;
	}
	throw new Error("Workflow cycle detected");
}
