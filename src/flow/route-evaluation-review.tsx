import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useId, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
	output,
}: {
	conversationId: Id<"conversations">;
	nodeId: string;
	output?: string;
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
	const review = useMutation(api.routeEvaluations.review);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	if (!evaluation && !records?.length) return null;
	const selected = records?.find(
		(record) => record.runId === (selectedRunId ?? evaluation?.runId),
	);
	const selector = ((records?.length ?? 0) > 1 || !evaluation) && (
		<Field>
			<FieldLabel htmlFor={id} className="text-xs text-muted-foreground">
				Recorded answer
			</FieldLabel>
			<Select<Id<"runs">>
				value={selected?.runId ?? null}
				disabled={pending}
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
	const save = async (passed: boolean) => {
		setPending(true);
		setError(undefined);
		try {
			await review({ runId: evaluation.runId, nodeId, passed });
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "Could not save review",
			);
		} finally {
			setPending(false);
		}
	};
	return (
		<div className="my-4 grid gap-3 text-sm">
			{selector}
			<h3 className="font-medium">
				Answer review · {evaluation.model} ·{" "}
				{evaluation.passed === undefined
					? "unreviewed"
					: evaluation.passed
						? "passed"
						: "failed"}
			</h3>
			<p className="text-muted-foreground">{evaluation.question}</p>
			{(selectedRunId || evaluation.answer !== output) && evaluation.answer && (
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
			<div className="flex gap-2">
				<Button
					variant={evaluation.passed ? "default" : "outline"}
					disabled={pending || !evaluation.completed}
					onClick={() => void save(true)}
				>
					Pass
				</Button>
				<Button
					variant={evaluation.passed === false ? "default" : "outline"}
					disabled={pending}
					onClick={() => void save(false)}
				>
					Fail
				</Button>
			</div>
			{error && <p className="text-destructive">{error}</p>}
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
