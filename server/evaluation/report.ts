import {
	assertCurrentCase,
	canonicalEvaluationInput,
	frozenCaseKey,
} from "../../src/lib/evaluation-case.ts";
import {
	reviewSources,
	validateQualityReview,
} from "../../src/lib/quality-review.ts";
import { routeEvidenceKey } from "../../src/lib/route-evidence.ts";
import type { WorkflowDecision } from "../../src/lib/routing.ts";
import { artifactTrace } from "../../src/lib/run-artifact.ts";
import { totalUsage } from "../../src/lib/usage.ts";
import { mapConcurrent } from "../concurrency.ts";
import {
	datasetKey,
	type EvaluationDataset,
	evaluationCaseInput,
} from "./dataset.ts";
import type { EvaluationRun, EvaluationTrial } from "./trial.ts";

type DecisionObservation = {
	correct: boolean;
	confidence?: number;
	caseId: string;
};

/** Confidence is compared to labelled correctness, never interpreted as accuracy. */
export function confidenceReport(
	observations: DecisionObservation[],
	expected: number,
	configuredThresholds: readonly number[],
) {
	const known = observations.filter(
		(item): item is DecisionObservation & { confidence: number } =>
			item.confidence !== undefined,
	);
	const bins = Array.from({ length: 10 }, (_, index) => {
		const samples = known.filter(
			(item) => Math.min(9, Math.floor(item.confidence * 10)) === index,
		);
		return {
			lower: index / 10,
			upper: (index + 1) / 10,
			count: samples.length,
			meanConfidence: samples.length
				? samples.reduce((sum, item) => sum + item.confidence, 0) /
					samples.length
				: null,
			accuracy: samples.length
				? samples.filter((item) => item.correct).length / samples.length
				: null,
		};
	});
	return {
		labelledDecisions: observations.length,
		expectedDecisions: expected,
		missingDecisions: expected - observations.length,
		confidenceReports: known.length,
		accuracy: observations.length
			? observations.filter((item) => item.correct).length / observations.length
			: null,
		meanSquaredConfidenceError: known.length
			? known.reduce(
					(sum, item) => sum + (item.confidence - Number(item.correct)) ** 2,
					0,
				) / known.length
			: null,
		expectedCalibrationError: known.length
			? bins.reduce(
					(sum, bin) =>
						sum +
						bin.count *
							Math.abs((bin.meanConfidence ?? 0) - (bin.accuracy ?? 0)),
					0,
				) / known.length
			: null,
		bins,
		thresholds: [...new Set(configuredThresholds)]
			.sort((a, b) => a - b)
			.map((threshold) => {
				const accepted = known.filter((item) => item.confidence >= threshold);
				return {
					threshold,
					decisions: accepted.length,
					distinctCases: new Set(accepted.map((item) => item.caseId)).size,
					coverage: expected ? accepted.length / expected : 0,
					errorRate: accepted.length
						? accepted.filter((item) => !item.correct).length / accepted.length
						: null,
				};
			}),
	};
}

function answerGrade(
	trial: EvaluationTrial,
	dataset: EvaluationDataset,
	now: number,
) {
	const record = trial.record;
	const artifact = record?.artifact;
	if (!record || !artifact) return undefined;
	const node = record.routes.nodes.find(
		(node) => node.id === dataset.evaluationNodeId,
	);
	if (node?.kind !== "model" || !node.routing)
		throw new Error("Evaluated node unavailable");
	const reviewed = record.review
		? validateQualityReview(
				record.review.value,
				node.routing.quality.criteria,
				artifact,
				reviewSources(record.input, record.routes, artifact, record.followup),
			)
		: undefined;
	if (
		artifact.status !== "completed" ||
		artifact.result.outcome !== "completed"
	)
		return false;
	if (!record.review || record.review.expiresAt <= now) return undefined;
	return reviewed;
}

/** Reports observed trials and missing planned slots separately; nothing missing becomes zero cost. */
export async function evaluationReport(
	dataset: EvaluationDataset,
	run: EvaluationRun,
	now = Date.now(),
) {
	if (run.datasetKey !== (await datasetKey(dataset)))
		throw new Error("Results do not match the versioned dataset");
	if (new Set(run.candidates).size !== run.candidates.length)
		throw new Error("Candidates must be unique");
	const cases = dataset.cases.filter(
		(item) => run.split === "all" || item.split === run.split,
	);
	const caseById = new Map(cases.map((item) => [item.id, item]));
	const strategy = await routeEvidenceKey(
		dataset.graph,
		dataset.evaluationNodeId,
	);
	const slots = new Map<string, EvaluationTrial>();
	const scopes = new Set<string | null>();
	const identities = new Map<string, Set<string>>();
	const candidates = new Set(run.candidates);
	const keysByTrial = new Map(
		await mapConcurrent(run.trials, 4, async (trial) => {
			if (!trial.record) return [trial, null] as const;
			const [strategyKey, caseKey] = await Promise.all([
				routeEvidenceKey(trial.record.routes, dataset.evaluationNodeId),
				frozenCaseKey(trial.record.input),
			]);
			return [trial, { strategyKey, caseKey }] as const;
		}),
	);
	for (const trial of run.trials) {
		const item = caseById.get(trial.caseId);
		if (
			!item ||
			!candidates.has(trial.candidate) ||
			trial.repetition > run.repeats
		)
			throw new Error("Trial is outside the planned case/candidate slots");
		const slot = JSON.stringify([
			trial.caseId,
			trial.candidate,
			trial.repetition,
		]);
		if (slots.has(slot)) throw new Error("Duplicate trial slot");
		slots.set(slot, trial);
		if (!trial.record) continue;
		assertCurrentCase(trial.record.input);
		scopes.add(trial.record.credentialScope);
		if (
			trial.record.review &&
			(trial.record.review.reviewedAt < Date.parse(run.startedAt) ||
				trial.record.review.reviewedAt > now ||
				trial.record.review.expiresAt <= trial.record.review.reviewedAt)
		)
			throw new Error("Invalid review time or expiry");
		if (
			JSON.stringify(canonicalEvaluationInput(trial.record.input)) !==
			JSON.stringify(evaluationCaseInput(dataset.graph, item))
		)
			throw new Error(`Frozen inputs differ from the labelled case ${item.id}`);
		if (keysByTrial.get(trial)?.strategyKey !== strategy)
			throw new Error("Strategies differ; quality/cost comparison is invalid");
		const node = trial.record.routes.nodes.find(
			(node) => node.id === dataset.evaluationNodeId,
		);
		if (node?.kind !== "model" || node.model !== trial.candidate)
			throw new Error("Candidate identity differs from the registered graph");
		const keys = identities.get(item.id) ?? new Set<string>();
		const caseKey = keysByTrial.get(trial)?.caseKey;
		if (!caseKey) throw new Error("Trial identity unavailable");
		keys.add(caseKey);
		identities.set(item.id, keys);
	}
	const credentialScopesMatch = scopes.size === 1 && !scopes.has(null);
	const pairedInputs = [...identities.values()].every(
		(keys) => keys.size === 1,
	);
	const labelsApprovedBeforeRun =
		dataset.labels.status === "owner-approved" &&
		Date.parse(dataset.labels.reviewedAt) <= Date.parse(run.startedAt);
	const questions = dataset.graph.nodes.flatMap((node) =>
		node.kind === "jev"
			? node.questions.map((question) => ({ nodeId: node.id, question }))
			: [],
	);
	const thresholds = questions.map(
		({ question }) => question.confidenceThreshold,
	);
	const models = run.candidates.map((candidate) => {
		const observations: (DecisionObservation &
			Pick<WorkflowDecision, "nodeId" | "questionId">)[] = [];
		const rows = cases.flatMap((item) =>
			Array.from({ length: run.repeats }, (_, index) => {
				const trial = slots.get(
					JSON.stringify([item.id, candidate, index + 1]),
				);
				const artifact = trial?.record?.artifact;
				const trace = artifact ? artifactTrace(artifact) : undefined;
				let routeCorrect: boolean | undefined = true;
				for (const label of item.decisions) {
					const decision = trace?.jevSteps.findLast(
						(step) =>
							step.nodeId === label.nodeId &&
							label.branch.startsWith(`${step.questionId}/`),
					);
					if (
						!decision ||
						decision.status === "provider-error" ||
						decision.error !== undefined
					) {
						if (routeCorrect !== false) routeCorrect = undefined;
						continue;
					}
					observations.push({
						nodeId: decision.nodeId,
						questionId: decision.questionId,
						caseId: item.id,
						correct:
							(decision.selectedBranch ?? decision.branch) === label.branch,
						confidence: decision.confidence,
					});
					if (decision.branch !== label.branch) routeCorrect = false;
				}
				const answer = trial ? answerGrade(trial, dataset, now) : undefined;
				const grade =
					answer === false || routeCorrect === false
						? false
						: answer === true && routeCorrect === true
							? true
							: undefined;
				const usage = trace ? totalUsage(trace.calls) : undefined;
				return {
					caseId: item.id,
					trial,
					artifact,
					trace,
					answer,
					grade,
					costUsd:
						trace?.calls.length && usage?.costComplete
							? usage.estimatedCostUsd
							: undefined,
					latencyMs: artifact
						? artifact.status === "completed"
							? artifact.result.latencyMs
							: artifact.latencyMs
						: undefined,
				};
			}),
		);
		const costsKnown = rows.every((row) => row.costUsd !== undefined);
		const latencies = rows
			.flatMap((row) => (row.latencyMs === undefined ? [] : [row.latencyMs]))
			.sort((a, b) => a - b);
		const passing = rows.filter((row) => row.grade === true).length;
		const totalCost = costsKnown
			? rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0)
			: null;
		return {
			candidate,
			plannedAttempts: rows.length,
			recordedAttempts: rows.filter((row) => row.trial).length,
			registeredAttempts: rows.filter((row) => row.trial?.runId).length,
			missingAttempts: rows.filter((row) => !row.trial).length,
			distinctCases: cases.length,
			humanReviews: rows.filter((row) => row.trial?.record?.review).length,
			expiredReviews: rows.filter(
				(row) =>
					row.trial?.record?.review && row.trial.record.review.expiresAt <= now,
			).length,
			successfulExecutions: rows.filter(
				(row) =>
					row.artifact?.status === "completed" &&
					row.artifact.result.outcome === "completed",
			).length,
			failedExecutions: rows.filter(
				(row) =>
					row.artifact &&
					(row.artifact.status !== "completed" ||
						row.artifact.result.outcome !== "completed"),
			).length,
			unknownExecutions: rows.filter((row) => !row.artifact).length,
			passingAnswers: rows.filter((row) => row.answer === true).length,
			passingRoutes: passing,
			unknownGrades: rows.filter((row) => row.grade === undefined).length,
			routePassRate: rows.length ? passing / rows.length : 0,
			p95LatencyMs:
				latencies.length === rows.length && latencies.length
					? latencies[Math.ceil(latencies.length * 0.95) - 1]
					: null,
			unknownCosts: rows.filter((row) => row.costUsd === undefined).length,
			totalCostUsd: totalCost,
			costPerPassingRouteUsd:
				totalCost !== null && passing ? totalCost / passing : null,
			actualModels: [
				...new Set(
					rows.flatMap(
						(row) =>
							row.trace?.calls
								.filter((call) => call.purpose === "model")
								.map((call) => call.model) ?? [],
					),
				),
			],
			taskOutcomes: rows.map((row) => ({
				caseId: row.caseId,
				outcome: row.trial?.record?.review?.value.task.outcome ?? "unknown",
			})),
			userReactions: rows.map((row) => ({
				caseId: row.caseId,
				outcome: row.trial?.record?.review?.value.reaction.outcome ?? "unknown",
			})),
			decisionsByQuestion: questions.map(({ nodeId, question }) => ({
				nodeId,
				questionId: question.id,
				name: question.name,
				type: question.type,
				measure:
					question.type === "noul"
						? "chosen-answer-probability"
						: "provider-confidence",
				...confidenceReport(
					observations.filter(
						(item) => item.nodeId === nodeId && item.questionId === question.id,
					),
					cases.reduce(
						(sum, item) =>
							sum +
							item.decisions.filter(
								(label) =>
									label.nodeId === nodeId &&
									label.branch.startsWith(`${question.id}/`),
							).length,
						0,
					) * run.repeats,
					[question.confidenceThreshold],
				),
			})),
			decisions: confidenceReport(
				observations,
				cases.reduce((sum, item) => sum + item.decisions.length, 0) *
					run.repeats,
				thresholds,
			),
		};
	});
	const comparisonComplete =
		labelsApprovedBeforeRun &&
		run.split === "test" &&
		pairedInputs &&
		credentialScopesMatch &&
		models.every(
			(model) =>
				!model.missingAttempts && !model.unknownGrades && !model.unknownCosts,
		);
	const node = dataset.graph.nodes.find(
		(node) => node.id === dataset.evaluationNodeId,
	);
	if (node?.kind !== "model" || !node.routing)
		throw new Error("Evaluated node unavailable");
	const policy = node.routing.quality;
	return {
		datasetVersion: dataset.version,
		datasetKey: run.datasetKey,
		labelStatus: dataset.labels.status,
		labelsApprovedBeforeRun,
		split: run.split,
		strategyKey: strategy,
		pairedInputs,
		credentialScopesMatch,
		comparisonComplete,
		thresholdUse:
			run.split === "dev" && labelsApprovedBeforeRun
				? "Explore on dev; freeze before held-out test. Never changes runtime settings."
				: "Descriptive only; do not tune thresholds on held-out results or unapproved labels.",
		models: models.map((model) => {
			const policyExclusions = [
				...(!comparisonComplete ? ["incomplete-comparison"] : []),
				...(model.distinctCases < policy.minimumCases
					? ["insufficient-cases"]
					: []),
				...(model.routePassRate < policy.minimumPassRate ? ["quality"] : []),
				...(model.p95LatencyMs === null ||
				model.p95LatencyMs > policy.maximumLatencyMs
					? ["latency"]
					: []),
			];
			return {
				...model,
				policyExclusions,
				meetsRoutingPolicy: policyExclusions.length === 0,
			};
		}),
	};
}
