import {
	modelConfiguration,
	modelConfigurationKey,
} from "./model-configuration.ts";
import { textModels } from "./models.ts";
import { type WorkflowRoutes, workflowRoutesSchema } from "./routing.ts";

/** Vary exactly one allowed model/reasoning pair while preserving frozen inputs. */
export function evaluationCandidate(
	routes: WorkflowRoutes,
	nodeId: string,
	configurationId: string,
): WorkflowRoutes {
	const node = routes.nodes.find((node) => node.id === nodeId);
	const configuration = modelConfiguration(configurationId);
	const model = textModels.find((model) => model.id === configuration.model);
	if (
		node?.kind !== "model" ||
		!node.routing ||
		!model ||
		!node.routing.candidates.some(
			(candidate) => modelConfigurationKey(candidate) === configurationId,
		)
	)
		throw new Error(
			"Replay candidate must be an allowed model and reasoning configuration on an evaluated node",
		);
	return workflowRoutesSchema.parse({
		...routes,
		nodes: routes.nodes.map((item) =>
			item.id === nodeId
				? {
						...node,
						provider: model.provider,
						...configuration,
						pricing:
							node.model === configuration.model ? node.pricing : undefined,
						routing: { ...node.routing, mode: "evaluate" },
					}
				: item,
		),
	});
}
