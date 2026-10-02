import {
	batchOutputs,
	type JevQuestion,
	questionOutputs,
} from "../src/lib/jev-question.ts";
import type {
	JevEvaluation,
	WorkflowDecision,
	WorkflowEdge,
} from "../src/lib/routing.ts";

/** Resolve every answer before releasing any selected path from this batch. */
export function resolveJevBatch({
	nodeId,
	questions,
	evaluation,
	error,
	edges,
	repeatCounts,
	maxRepeats,
}: {
	nodeId: string;
	questions: JevQuestion[];
	evaluation: JevEvaluation | undefined;
	error: string | undefined;
	edges: WorkflowEdge[];
	repeatCounts: Map<string, number>;
	maxRepeats: number;
}) {
	const answers = new Map(
		evaluation?.answers.map((answer) => [answer.questionId, answer]),
	);
	const outgoing = new Map(
		edges
			.filter((edge) => edge.source === nodeId)
			.map((edge) => [edge.sourceHandle, edge]),
	);
	const decisions: WorkflowDecision[] = [];
	const selected: WorkflowEdge[] = [];
	for (const question of questions) {
		const answer = answers.get(question.id);
		const accepted =
			answer &&
			answer.confidence >= question.confidenceThreshold &&
			questionOutputs(question).some(({ id }) => id === answer.branch);
		const branch = accepted ? answer.branch : question.fallbackOutputId;
		if (!branch)
			throw new Error(
				`Jev couldn’t determine a reliable answer for “${question.name}”${error ? `: ${error}` : "."}`,
			);
		const edge = outgoing.get(branch);
		const exhausted =
			edge?.repeat && (repeatCounts.get(edge.id) ?? 0) >= maxRepeats;
		decisions.push({
			nodeId,
			questionId: question.id,
			branch,
			status: exhausted
				? "exhausted"
				: error
					? "provider-error"
					: accepted
						? "accepted"
						: "uncertain",
			selectedBranch: answer?.branch,
			value: answer?.value,
			probabilities: answer?.probabilities,
			confidence: answer?.confidence,
			error,
		});
		if (edge && !exhausted) selected.push(edge);
	}
	const exhausted = decisions.some(
		(decision) => decision.status === "exhausted",
	);
	const outputs = new Map(
		batchOutputs(questions).map(({ id, label }) => [id, label]),
	);
	const text = exhausted
		? "Repeat limit reached. Review did not pass."
		: decisions.map(({ branch }) => outputs.get(branch)).join("\n");
	return { decisions, edges: exhausted ? [] : selected, text, exhausted };
}
