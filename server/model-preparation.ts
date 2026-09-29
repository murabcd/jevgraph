import type { RouteEvidence } from "../src/lib/route-evidence.ts";
import {
	modelTarget,
	selectedVariables,
	type WorkflowRoutes,
} from "../src/lib/routing.ts";
import { planModel } from "./model-planner.ts";
import { prepareNodeContext } from "./node-context.ts";

/** Qualify before paid preparation, then quote the actual effective context. */
export async function prepareModelExecution(
	request: Parameters<typeof prepareNodeContext>[0] & {
		node: Extract<WorkflowRoutes["nodes"][number], { kind: "model" }>;
		evidence: RouteEvidence[];
	},
	environment: Parameters<typeof prepareNodeContext>[1],
) {
	const {
		node,
		messages,
		variables: startVariables,
		evidence,
		callId,
	} = request;
	const { memory, availableModels, ledger } = environment;
	const variables = selectedVariables(startVariables, node.variables);
	const target = modelTarget(node);
	const preflight = node.routing
		? planModel(
				{
					target,
					context: { messages: messages.slice(-1), inputs: [], documents: [] },
					variables,
					evidence,
				},
				memory,
				availableModels,
				callId,
			)
		: undefined;
	const contextModels = preflight
		? new Set(
				preflight.plan.candidates
					.filter(
						(candidate) =>
							!candidate.excluded &&
							(node.routing?.mode === "automatic" ||
								candidate.model === node.model),
					)
					.map((candidate) => candidate.model),
			)
		: availableModels;
	const context = await prepareNodeContext(request, {
		...environment,
		availableModels: contextModels,
	});
	const effectiveTarget = { ...target, prompt: context.instructions };
	const planned = node.routing
		? planModel(
				{ target: effectiveTarget, context, variables, evidence },
				memory,
				availableModels,
				callId,
			)
		: undefined;
	if (planned)
		planned.plan.preparationCostUsd = ledger.preparationCost(node.id);
	return {
		context,
		variables,
		target: planned?.target ?? effectiveTarget,
		plan: planned?.plan,
		quote: planned?.quote,
	};
}
