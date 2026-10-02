import type { ContextPolicy } from "../src/lib/context.ts";
import type { NodeOutput, RoutingMetadata } from "../src/lib/routing.ts";

export function resolveInstructions({
	base,
	policy,
	variables,
	inputs,
}: {
	base: string;
	policy?: ContextPolicy;
	variables: RoutingMetadata;
	inputs: NodeOutput[];
}) {
	const rules = policy?.instructions ?? [];
	const selectedStages = new Set(policy?.outputNodeIds);
	const selected = inputs.filter(
		(input) =>
			policy?.upstream !== "none" &&
			(policy?.upstream !== "selected" ||
				selectedStages.has(input.sourceNodeId)),
	);
	const byStage = new Map(selected.map((input) => [input.sourceNodeId, input]));
	const trace = rules.map((rule) => ({
		id: rule.id,
		name: rule.name,
		active:
			rule.condition.kind === "variable"
				? rule.condition.name in variables &&
					variables[rule.condition.name] === rule.condition.value
				: byStage.get(rule.condition.nodeId)?.decision?.status === "accepted" &&
					byStage.get(rule.condition.nodeId)?.decision?.branch ===
						rule.condition.outputId,
	}));
	const instructions = [
		base,
		...rules
			.filter((_, index) => trace[index].active)
			.map((rule) => rule.instructions),
	]
		.filter(Boolean)
		.join("\n\n");
	return { instructions, trace };
}
