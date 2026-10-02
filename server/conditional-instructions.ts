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
	const trace = rules.map(({ id, name, condition }) => {
		const output =
			condition.kind === "decision" ? byStage.get(condition.nodeId) : undefined;
		return {
			id,
			name,
			active:
				condition.kind === "variable"
					? condition.name in variables &&
						variables[condition.name] === condition.value
					: output?.kind === "jev" &&
						output.decisions.some(
							(decision) =>
								decision.status === "accepted" &&
								decision.branch === condition.outputId,
						),
		};
	});
	const activeInstructions = rules
		.filter((_, index) => trace[index].active)
		.map((rule) => rule.instructions);
	const instructions = [base, ...activeInstructions]
		.filter(Boolean)
		.join("\n\n");
	return { instructions, trace, activeInstructions };
}
