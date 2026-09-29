import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useId, useState } from "react";
import { z } from "zod";
import { Field, FieldLabel } from "@/components/ui/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { QualityReviewForm } from "@/flow/quality-review-form";
import { routeEvidenceSchema } from "@/lib/route-evidence";
import { formatCostUsd } from "@/lib/usage";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const reviewTime = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
});

function recordLabel(
	record: FunctionReturnType<typeof api.routeEvaluations.list>[number],
) {
	return `${reviewTime.format(record.createdAt)} · ${record.model} · ${record.passed === undefined ? "unreviewed" : record.passed ? "passed" : "failed"}`;
}

export function RouteEvaluationReview({
	conversationId,
	nodeId,
}: {
	conversationId: Id<"conversations">;
	nodeId: string;
}) {
	const id = useId();
	const [selectedRunId, setSelectedRunId] = useState<Id<"runs"> | null>(null);
	const records = useQuery(api.routeEvaluations.list, {
		conversationId,
		nodeId,
	});
	const evaluation = useQuery(api.routeEvaluations.latest, {
		conversationId,
		nodeId,
		...(selectedRunId ? { runId: selectedRunId } : {}),
	});

	if (!evaluation && !records?.length) return null;
	const selected = records?.find(
		(record) => record.runId === (selectedRunId ?? evaluation?.runId),
	);
	const selector = (
		<Field>
			<FieldLabel htmlFor={id} className="text-xs text-muted-foreground">
				Recorded answer
			</FieldLabel>
			<Select<Id<"runs">>
				value={selected?.runId ?? null}
				onValueChange={setSelectedRunId}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue className="truncate">
						{selected ? recordLabel(selected) : "Select an answer to review"}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{records?.map((record) => (
							<SelectItem
								key={record.runId}
								value={record.runId}
								label={recordLabel(record)}
							>
								<span className="truncate">{recordLabel(record)}</span>
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</Field>
	);
	if (!evaluation) return <div className="my-4 grid gap-3">{selector}</div>;
	const report = z
		.array(routeEvidenceSchema)
		.max(2)
		.parse(JSON.parse(evaluation.report));

	return (
		<div className="my-4 grid gap-3 text-sm">
			{selector}
			<h3 className="font-medium">
				Answer review · {evaluation.model} ·{" "}
				{evaluation.passed === undefined
					? evaluation.review
						? "insufficient evidence"
						: "unreviewed"
					: evaluation.passed
						? "passed"
						: "failed"}
			</h3>
			<p className="text-muted-foreground">{evaluation.question}</p>
			{evaluation.answer && (
				<pre className="whitespace-pre-wrap wrap-break-word font-sans leading-6">
					{evaluation.answer}
				</pre>
			)}
			{evaluation.error && (
				<p className="text-destructive">{evaluation.error}</p>
			)}
			<p className="whitespace-pre-wrap text-muted-foreground">
				{evaluation.criteria}
			</p>
			<p className="text-xs text-muted-foreground">
				Full turn · {Math.round(evaluation.latencyMs)} ms ·{" "}
				{evaluation.costUsd === undefined
					? "cost unknown"
					: formatCostUsd(evaluation.costUsd)}
			</p>
			<QualityReviewForm
				key={evaluation.runId}
				evaluation={evaluation}
				nodeId={nodeId}
			/>
			{report.map((model) => (
				<p key={model.model} className="text-xs text-muted-foreground">
					{model.model} · {model.cases} distinct cases · {model.reviewed}/
					{model.attempts} reviewed · {Math.round(model.passRate * 100)}% pass ·
					p95 {Math.round(model.p95LatencyMs)} ms · cost per pass{" "}
					{model.costPerPassUsd === undefined
						? "unknown"
						: formatCostUsd(model.costPerPassUsd)}
				</p>
			))}
		</div>
	);
}
