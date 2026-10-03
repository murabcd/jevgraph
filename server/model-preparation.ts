import { modelConfigurationKey } from "../src/lib/model-configuration.ts";
import type { RouteEvidence } from "../src/lib/route-evidence.ts";
import {
	modelTarget,
	selectedVariables,
	type WorkflowRoutes,
} from "../src/lib/routing.ts";
import { planModel } from "./model-planner.ts";
import { prepareNodeContext } from "./node-context.ts";
import { assessRoutingTask, type RoutingEvaluator } from "./task-router.ts";

/** Qualify before paid preparation, then quote the actual effective context. */
export async function prepareModelExecution(
	request: Parameters<typeof prepareNodeContext>[0] & {
		node: Extract<WorkflowRoutes["nodes"][number], { kind: "model" }>;
		evidence: RouteEvidence[];
		evaluate: RoutingEvaluator;
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
	const eligibleKeys = new Set(
		preflight?.plan.candidates
			.filter(
				(candidate) =>
					!candidate.excluded &&
					(node.routing?.mode === "automatic" ||
						(candidate.model === preflight.plan.selectedModel &&
							candidate.reasoningEffort ===
								preflight.plan.selectedReasoningEffort)),
			)
			.map(modelConfigurationKey),
	);
	const contextNode = node.routing
		? {
				...node,
				routing: {
					...node.routing,
					candidates: node.routing.candidates.filter((candidate) =>
						eligibleKeys.has(modelConfigurationKey(candidate)),
					),
				},
			}
		: node;
	const context = await prepareNodeContext(
		{
			...request,
			node: contextNode,
		},
		environment,
	);
	const effectiveTarget = { ...target, prompt: context.instructions };
	const planning = { target: effectiveTarget, context, variables, evidence };
	const assessment =
		node.routing?.mode === "automatic" && preflight
			? await assessRoutingTask(
					planning,
					preflight.plan.candidates,
					ledger,
					request.evaluate,
					environment.signal,
				)
			: undefined;
	const planned = node.routing
		? planModel(
				{
					...planning,
					assessment,
				},
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
