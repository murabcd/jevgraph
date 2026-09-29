import { textModels } from "./models.ts";
import { type WorkflowRoutes, workflowRoutesSchema } from "./routing.ts";

/** Varies one allowed model and validates its reasoning settings before any call. */
export function evaluationCandidate(
	routes: WorkflowRoutes,
	nodeId: string,
	modelId: string,
): WorkflowRoutes {
	const node = routes.nodes.find((node) => node.id === nodeId);
	const model = textModels.find((model) => model.id === modelId);
	if (
		node?.kind !== "model" ||
		!node.routing ||
		!model ||
		!node.routing.models.includes(model.id)
	)
		throw new Error(
			"Replay candidate must be an allowed model on an evaluated node",
		);
	return workflowRoutesSchema.parse({
		...routes,
		nodes: routes.nodes.map((item) =>
			item.id === nodeId
				? {
						...node,
						provider: model.provider,
						model: model.id,
						routing: { ...node.routing, mode: "evaluate" },
					}
				: item,
		),
	});
}
