import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
	datasetKey,
	evaluationDatasetSchema,
	loadEvaluationDataset,
} from "../server/evaluation/dataset";
import { applyLocalLabels, labelTemplate } from "../server/evaluation/labels";
import {
	confidenceReport,
	evaluationReport,
} from "../server/evaluation/report";
import { EVALUATION_VERSIONS } from "../src/lib/evaluation-version";
import { artifactTrace } from "../src/lib/run-artifact";
import { evaluationFixture } from "./evaluation-fixture";

test("dataset prevents default-value duplicates across splits and pins installed provider SDKs", async () => {
	const seed = await loadEvaluationDataset("evals/shop-support.json");
	expect(seed.labels.status).toBe("seed");
	expect(seed.cases.filter((item) => item.split === "test")).toHaveLength(8);
	expect(() =>
		evaluationDatasetSchema.parse({
			...seed,
			cases: [
				seed.cases[0],
				{ ...seed.cases[0], id: "duplicate", split: "test", metadata: {} },
			],
		}),
	).toThrow("Duplicate inputs");
	const packages = [
		"ai",
		"@ai-sdk/openai",
		"@ai-sdk/google",
		"@ai-sdk/typesafe-ai",
	];
	const installed = await Promise.all(
		packages.map(
			async (name) =>
				z
					.object({ version: z.string() })
					.parse(await Bun.file(`node_modules/${name}/package.json`).json())
					.version,
		),
	);
	expect(EVALUATION_VERSIONS.providerSdk).toBe(
		`ai@${installed[0]};openai@${installed[1]};google@${installed[2]};typesafe@${installed[3]}`,
	);
});

test("decision confidence is tested against correctness and reports missing decisions", () => {
	const report = confidenceReport(
		[
			{ caseId: "a", correct: false, confidence: 0.9 },
			{ caseId: "a", correct: true, confidence: 0.9 },
			{ caseId: "b", correct: true },
		],
		4,
		[0.87, 0.13, 0.9, 0.87],
	);
	expect(report.accuracy).toBeCloseTo(2 / 3);
	expect(report.meanSquaredConfidenceError).toBeCloseTo(0.41);
	expect(report.expectedCalibrationError).toBeCloseTo(0.4);
	expect(report.missingDecisions).toBe(1);
	expect(report.thresholds.map((row) => row.threshold)).toEqual([
		0.13, 0.87, 0.9,
	]);
	expect(report.thresholds.find((row) => row.threshold === 0.9)).toMatchObject({
		decisions: 2,
		distinctCases: 1,
		coverage: 0.5,
		errorRate: 0.5,
	});
});

test("confidence reports use configured Jev thresholds and omit rows when no thresholds are configured", async () => {
	const { dataset, run, now } = await evaluationFixture();
	const configure = (nodes: typeof dataset.graph.nodes) =>
		nodes.map((node) =>
			node.kind === "jev" ? { ...node, confidenceThreshold: 0.83 } : node,
		);
	dataset.graph.nodes = configure(dataset.graph.nodes);
	for (const trial of run.trials)
		if (trial.record)
			trial.record.routes.nodes = configure(trial.record.routes.nodes);
	run.datasetKey = await datasetKey(dataset);
	const report = await evaluationReport(dataset, run, now);
	for (const model of report.models)
		expect(model.decisions.thresholds.map((row) => row.threshold)).toEqual([
			0.83,
		]);
	expect(confidenceReport([], 0, []).thresholds).toEqual([]);
});

test("complete paired reports require pre-approved labels, bounded policy evidence and independent outcomes", async () => {
	const { dataset, run, now } = await evaluationFixture();
	const report = await evaluationReport(dataset, run, now);
	expect(report.comparisonComplete).toBe(true);
	expect(report.models.every((model) => model.meetsRoutingPolicy)).toBe(true);
	expect(report.models[0]).toMatchObject({
		distinctCases: 5,
		humanReviews: 5,
		passingRoutes: 5,
		p95LatencyMs: 100,
		unknownCosts: 0,
	});
	expect(
		report.models[0].taskOutcomes.every((row) => row.outcome === "unknown"),
	).toBe(true);
	expect(
		report.models[0].userReactions.every((row) => row.outcome === "unknown"),
	).toBe(true);
	expect(report.thresholdUse).toContain("do not tune");
	const seed = { ...dataset, labels: { status: "seed" as const } };
	expect(await datasetKey(seed)).toBe(run.datasetKey);
	expect((await evaluationReport(seed, run, now)).comparisonComplete).toBe(
		false,
	);
	const late = {
		...dataset,
		labels: {
			status: "owner-approved" as const,
			reviewer: "fixture",
			reviewedAt: new Date(now + 1).toISOString(),
		},
	};
	expect((await evaluationReport(late, run, now)).labelsApprovedBeforeRun).toBe(
		false,
	);
});

test("failed attempts, unknown costs, expired reviews and missing slots remain explicit", async () => {
	const { dataset, run, now } = await evaluationFixture();
	const first = run.trials[0].record;
	if (!first?.artifact || !first.review) throw new Error("Fixture missing");
	const trace = artifactTrace(first.artifact);
	first.artifact = {
		status: "failed",
		text: "Partial answer",
		error: "Provider unavailable",
		latencyMs: 25000,
		providerEvidence: first.artifact.providerEvidence,
		coverage: "partial",
		trace: {
			...trace,
			calls: trace.calls.map((call) => ({
				...call,
				estimatedCostUsd: undefined,
				usage: undefined,
			})),
		},
	};
	first.review = undefined;
	const second = run.trials[2].record;
	if (!second?.review) throw new Error("Fixture missing");
	second.review.expiresAt = now + 1;
	run.trials.pop();
	const report = await evaluationReport(dataset, run, now + 2);
	expect(report.comparisonComplete).toBe(false);
	expect(report.models[0]).toMatchObject({
		failedExecutions: 1,
		unknownCosts: 1,
		expiredReviews: 1,
		unknownGrades: 1,
		totalCostUsd: null,
		costPerPassingRouteUsd: null,
		meetsRoutingPolicy: false,
	});
	expect(report.models[1]).toMatchObject({
		missingAttempts: 1,
		unknownExecutions: 1,
		p95LatencyMs: null,
	});
});

test("a high-confidence wrong decision fails route quality; provenance and credentials cannot silently differ", async () => {
	const { dataset, run, now } = await evaluationFixture();
	const record = run.trials[0].record;
	if (!record?.artifact) throw new Error("Fixture missing");
	const decision = artifactTrace(record.artifact).jevSteps[0];
	decision.branch = "delivery";
	decision.selectedBranch = "delivery";
	const report = await evaluationReport(dataset, run, now);
	expect(report.models[0].passingAnswers).toBe(5);
	expect(report.models[0].passingRoutes).toBe(4);
	expect(report.models[0].decisions.accuracy).toBe(0.8);
	record.credentialScope = "b".repeat(64);
	expect(
		(await evaluationReport(dataset, run, now)).credentialScopesMatch,
	).toBe(false);
	record.input.history.limited = true;
	expect((await evaluationReport(dataset, run, now)).pairedInputs).toBe(false);
	record.input.messages[0].content = "Changed input";
	await expect(evaluationReport(dataset, run, now)).rejects.toThrow(
		"Frozen inputs differ",
	);
});

test("local human templates start unassessed and invalid evidence never becomes an approval", async () => {
	const { dataset, run, now } = await evaluationFixture();
	const dir = await mkdtemp(join(tmpdir(), "jev-eval-labels-"));
	try {
		const labels = labelTemplate(dataset, run);
		expect(labels.reviewer).toBe("");
		expect(labels.judgements[0].review.criteria[0].verdict).toBe(
			"insufficient-evidence",
		);
		labels.reviewer = "controlled test reviewer";
		labels.reviewedAt = new Date(now).toISOString();
		const path = join(dir, "labels.json");
		await writeFile(path, JSON.stringify(labels));
		const labelled = await applyLocalLabels(path, run);
		expect(
			(await evaluationReport(dataset, labelled, now)).models[0].unknownGrades,
		).toBe(5);
		const validReview = run.trials[0].record?.review?.value;
		if (!validReview) throw new Error("Fixture missing");
		labels.judgements[0].review = structuredClone(validReview);
		labels.judgements[0].review.criteria[0].evidence[0].quote =
			"Invented quote";
		await writeFile(path, JSON.stringify(labels));
		await expect(
			evaluationReport(dataset, await applyLocalLabels(path, run), now),
		).rejects.toThrow("not present");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
