import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	EvidenceSelector,
	OutcomeReviewFields,
	QualityReviewFields,
} from "@/flow/quality-review-fields";
import { EVALUATION_VERSIONS } from "@/lib/evaluation-version";
import {
	type QualityReview,
	qualityReviewSchema,
	type ReviewSource,
	reviewCriteria,
	validateQualityReview,
} from "@/lib/quality-review";

import type { RunArtifact } from "@/lib/run-artifact";

export function QualityReviewEditor({
	artifact,
	sources,
	criteria: configuredCriteria,
	savedReview,
	onSave,
}: {
	artifact: RunArtifact;
	sources: ReviewSource[];
	criteria: string;
	savedReview?: string;
	onSave: (
		review: QualityReview,
		expectedReview: string | null,
	) => Promise<unknown>;
}) {
	const id = useId();
	const criteria = reviewCriteria(configuredCriteria);
	const [value, setValue] = useState<QualityReview>(() =>
		savedReview
			? qualityReviewSchema.parse(JSON.parse(savedReview))
			: {
					version: EVALUATION_VERSIONS.evaluator,
					criteria: criteria.map((criterion) => ({
						id: criterion.id,
						verdict: "insufficient-evidence",
						reason: "Not assessed",
						evidence: [],
					})),
					task: { outcome: "unknown", reason: "Not assessed", evidence: [] },
					reaction: {
						outcome: "unknown",
						reason: "No assessed later user message",
						evidence: [],
					},
				},
	);
	const [expectedReview, setExpectedReview] = useState(savedReview ?? null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const [sourceId, setSourceId] = useState<string | null>("answer");
	const selectedSource = sources.find((source) => source.id === sourceId);
	const submit = async () => {
		setPending(true);
		setError(undefined);
		try {
			const review = qualityReviewSchema.parse(value);
			validateQualityReview(review, configuredCriteria, artifact, sources);
			await onSave(review, expectedReview);
			setExpectedReview(JSON.stringify(review));
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "Could not save review",
			);
		} finally {
			setPending(false);
		}
	};
	return (
		<fieldset disabled={pending} className="grid gap-3">
			<p className="text-xs text-muted-foreground">
				Execution: {artifact.status} · evidence: {artifact.coverage}. Incomplete
				evidence cannot approve automatic routing.
			</p>
			<details className="rounded-lg border p-3">
				<summary className="cursor-pointer font-medium">
					Inspect recorded inputs and calls
				</summary>
				<div className="mt-3 grid gap-3">
					<EvidenceSelector
						id={`${id}-inspect`}
						sources={sources}
						value={sourceId}
						onChange={setSourceId}
					/>
					<pre className="max-h-96 overflow-auto whitespace-pre-wrap wrap-anywhere text-xs">
						{selectedSource?.text}
					</pre>
				</div>
			</details>
			{criteria.map((criterion, index) => {
				const judgement = value.criteria[index];
				return (
					<div key={criterion.id} className="grid gap-3 rounded-lg border p-3">
						<p className="font-medium">{criterion.text}</p>
						<div className="flex flex-wrap gap-2">
							{(["pass", "fail", "insufficient-evidence"] as const).map(
								(verdict) => (
									<Button
										key={verdict}
										size="sm"
										variant={
											judgement.verdict === verdict ? "default" : "outline"
										}
										aria-pressed={judgement.verdict === verdict}
										onClick={() =>
											setValue({
												...value,
												criteria: value.criteria.map((item, itemIndex) =>
													itemIndex === index ? { ...item, verdict } : item,
												),
											})
										}
									>
										{verdict === "insufficient-evidence"
											? "Insufficient evidence"
											: verdict === "pass"
												? "Pass"
												: "Fail"}
									</Button>
								),
							)}
						</div>
						<QualityReviewFields
							id={`${id}-${criterion.id}`}
							value={judgement}
							sources={sources}
							onChange={(fields) =>
								setValue({
									...value,
									criteria: value.criteria.map((item, itemIndex) =>
										itemIndex === index ? { ...item, ...fields } : item,
									),
								})
							}
						/>
					</div>
				);
			})}
			<details className="rounded-lg border p-3">
				<summary className="cursor-pointer font-medium">
					Task outcome and user reaction
				</summary>
				<div className="mt-3 grid gap-4">
					<OutcomeReviewFields
						id={`${id}-task`}
						label="Task outcome"
						value={value.task}
						outcomes={qualityReviewSchema.shape.task.shape.outcome.options}
						sources={sources}
						onChange={(task) => setValue({ ...value, task })}
					/>
					<OutcomeReviewFields
						id={`${id}-reaction`}
						label="User reaction"
						value={value.reaction}
						outcomes={qualityReviewSchema.shape.reaction.shape.outcome.options}
						sources={sources.filter((source) =>
							source.id.startsWith("reaction:"),
						)}
						onChange={(reaction) => setValue({ ...value, reaction })}
					/>
				</div>
			</details>
			<Button onClick={() => void submit()} disabled={pending}>
				{pending ? "Saving review…" : "Save evidence-backed review"}
			</Button>
			{savedReview && savedReview !== expectedReview && (
				<Button
					variant="outline"
					disabled={pending}
					onClick={() => {
						setValue(qualityReviewSchema.parse(JSON.parse(savedReview ?? "")));
						setExpectedReview(savedReview ?? null);
						setError(undefined);
					}}
				>
					Reload saved review
				</Button>
			)}
			{error && <p className="text-destructive">{error}</p>}
		</fieldset>
	);
}
