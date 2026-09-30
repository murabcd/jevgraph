import { rename, rm, writeFile } from "node:fs/promises";
import { api } from "../../convex/_generated/api.js";
import { evaluationCandidate } from "../../src/lib/evaluation-candidate.ts";
import { readRouteStream } from "../../src/lib/route-stream.ts";
import { loadRunArtifact } from "../../src/lib/run-artifact-load.ts";
import { ConvexPersistence } from "../convex-persistence.ts";
import { datasetKey, type EvaluationDataset } from "./dataset.ts";
import {
	type EvaluationRun,
	type EvaluationTrial,
	evaluationTrialSchema,
	MAX_EVALUATION_FILE_BYTES,
	MAX_EVALUATION_TRIALS,
} from "./trial.ts";

const errorLimit =
	evaluationTrialSchema.shape.error.unwrap().maxLength ?? undefined;

export async function saveEvaluationRun(path: string, run: EvaluationRun) {
	const text = JSON.stringify(run, null, 2);
	if (Buffer.byteLength(text) > MAX_EVALUATION_FILE_BYTES)
		throw new Error(
			"Evaluation exceeds its 64 MB budget; retained runs remain in Convex",
		);
	const temporary = `${path}.tmp-${crypto.randomUUID()}`;
	try {
		await writeFile(temporary, `${text}\n`, { flag: "wx", mode: 0o600 });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

export async function collectTrial(
	persistence: ConvexPersistence,
	trial: EvaluationTrial,
	nodeId: string,
	artifactFetch: typeof fetch = globalThis.fetch,
): Promise<EvaluationTrial> {
	if (!trial.runId) return trial;
	const saved = await persistence.inspect(trial.runId);
	const artifact = saved.artifactUrl
		? await loadRunArtifact(saved.artifactUrl, artifactFetch)
		: null;
	return {
		...trial,
		record: {
			input: saved.input,
			routes: saved.routes,
			credentialScope: saved.credentialScope,
			artifact,
			review: saved.reviews.find((row) => row.nodeId === nodeId)?.review,
			followup: saved.followup,
		},
	};
}

/** Sequential cases respect the owner's active conversation and normal paid-call registration. */
export async function runEvaluation(
	dataset: EvaluationDataset,
	run: EvaluationRun,
	out: string,
	client: ConstructorParameters<typeof ConvexPersistence>[0],
	submit: (
		path: "/api/route" | "/api/replay",
		body: string,
	) => Promise<Response>,
	artifactFetch: typeof fetch = globalThis.fetch,
) {
	const persistence = new ConvexPersistence(client);
	const workspace = await client.query(api.workspaces.current, {});
	if (!workspace)
		throw new Error(
			"Initialize an authenticated workspace before running evaluations",
		);
	if (run.datasetKey !== (await datasetKey(dataset)))
		throw new Error("Dataset identity changed before execution");
	const cases = dataset.cases.filter(
		(item) => run.split === "all" || item.split === run.split,
	);
	if (
		cases.length * run.candidates.length * run.repeats >
		MAX_EVALUATION_TRIALS
	)
		throw new Error(
			`An evaluation may plan at most ${MAX_EVALUATION_TRIALS} trials`,
		);
	for (const item of cases) {
		const conversationId = await client.mutation(api.conversations.start, {
			workspaceId: workspace.id,
		});
		let original: string | undefined;
		let registrationFailed = false;
		for (const candidate of run.candidates) {
			for (let repetition = 1; repetition <= run.repeats; repetition++) {
				let trial: EvaluationTrial = {
					caseId: item.id,
					candidate,
					repetition,
					record: null,
				};
				try {
					if (registrationFailed)
						throw new Error(
							"Original case registration failed; remaining paired trials were skipped",
						);
					const requestId = crypto.randomUUID();
					const input = original
						? {
								runId: original,
								conversationId,
								requestId,
								candidate: {
									nodeId: dataset.evaluationNodeId,
									model: candidate,
								},
							}
						: {
								conversationId,
								requestId,
								messages: item.messages,
								metadata: item.metadata,
								routes: evaluationCandidate(
									dataset.graph,
									dataset.evaluationNodeId,
									candidate,
								),
							};
					const response = await submit(
						original ? "/api/replay" : "/api/route",
						JSON.stringify(input),
					);
					trial.runId = response.headers.get("X-Run-Id") ?? undefined;
					if (trial.runId) original ??= trial.runId;
					else {
						if (!original) registrationFailed = true;
						await response.body?.cancel();
						throw new Error(
							`Evaluation API returned HTTP ${response.status} without a registered run`,
						);
					}
					if (!response.ok) {
						await response.body?.cancel();
						throw new Error(`Evaluation API returned HTTP ${response.status}`);
					}
					await readRouteStream(response, (event) => {
						if (event.type === "error")
							trial.error = event.error.slice(0, errorLimit);
					});
					trial = await collectTrial(
						persistence,
						trial,
						dataset.evaluationNodeId,
						artifactFetch,
					);
				} catch (error) {
					if (!original) registrationFailed = true;
					trial.error = (
						error instanceof Error ? error.message : "Evaluation failed"
					).slice(0, errorLimit);
				}
				run.trials.push(trial);
				await saveEvaluationRun(out, run);
			}
		}
	}
}
