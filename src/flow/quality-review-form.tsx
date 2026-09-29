import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import useSWR from "swr";
import { QualityReviewEditor } from "@/flow/quality-review-editor";
import { frozenCaseSchema } from "@/lib/evaluation-case";
import { reviewSources } from "@/lib/quality-review";
import { workflowRoutesSchema } from "@/lib/routing";
import { loadRunArtifact } from "@/storage/run-artifact";
import { api } from "../../convex/_generated/api";

type Evaluation = NonNullable<
	FunctionReturnType<typeof api.routeEvaluations.latest>
>;

export function QualityReviewForm({
	evaluation,
	nodeId,
}: {
	evaluation: Evaluation;
	nodeId: string;
}) {
	const { data: artifact, error } = useSWR(
		evaluation.resultUrl,
		loadRunArtifact,
	);
	const save = useAction(api.routeEvaluations.review);
	if (error)
		return (
			<p className="text-destructive">
				{error instanceof Error ? error.message : "Could not load evidence"}
			</p>
		);
	if (!artifact)
		return (
			<p className="text-muted-foreground">
				{evaluation.resultUrl
					? "Loading recorded evidence…"
					: "Recorded evidence unavailable"}
			</p>
		);
	const sources = reviewSources(
		frozenCaseSchema.parse(JSON.parse(evaluation.input)),
		workflowRoutesSchema.parse(JSON.parse(evaluation.routes)),
		artifact,
		evaluation.followup,
	);
	return (
		<QualityReviewEditor
			artifact={artifact}
			sources={sources}
			criteria={evaluation.criteria}
			savedReview={evaluation.review}
			onSave={(review, expectedReview) =>
				save({
					runId: evaluation.runId,
					nodeId,
					review: JSON.stringify(review),
					expectedReview,
				})
			}
		/>
	);
}
