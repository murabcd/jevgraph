import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { evaluationCandidate } from "../../src/lib/evaluation-candidate.ts";
import { ConvexPersistence } from "../convex-persistence.ts";
import { datasetKey, loadEvaluationDataset } from "./dataset.ts";
import { applyLocalLabels, labelSources, labelTemplate } from "./labels.ts";
import { evaluationReport } from "./report.ts";
import { collectTrial, runEvaluation, saveEvaluationRun } from "./runner.ts";
import {
	evaluationRunSchema,
	loadEvaluationRun,
	MAX_EVALUATION_FILE_BYTES,
} from "./trial.ts";

const { positionals, values } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: {
		dataset: { type: "string", default: "evals/shop-support.json" },
		input: { type: "string" },
		out: { type: "string" },
		labels: { type: "string" },
		split: { type: "string", default: "test" },
		candidates: { type: "string", default: "gpt-6-luna,gemini-3.8-flash" },
		repeats: { type: "string", default: "1" },
		live: { type: "boolean", default: false },
		help: { type: "boolean", default: false },
	},
});

async function writeNew(path: string, value: string) {
	if (Buffer.byteLength(value) > MAX_EVALUATION_FILE_BYTES)
		throw new Error("Output exceeds 64 MB");
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, `${value}\n`, { flag: "wx", mode: 0o600 });
}

function connection() {
	const token = process.env.EVAL_CONVEX_TOKEN;
	const convexUrl = process.env.VITE_CONVEX_URL;
	if (!token || !convexUrl)
		throw new Error(
			"EVAL_CONVEX_TOKEN and VITE_CONVEX_URL are required for owned run access",
		);
	const client = new ConvexHttpClient(convexUrl);
	client.setAuth(token);
	return {
		client,
		token,
		apiUrl: process.env.EVAL_API_URL ?? "http://localhost:5173",
	};
}

async function main() {
	if (values.help) {
		console.log(
			"bun run eval [validate | run --live --out FILE | collect --input FILE --out FILE | labels --input FILE --out FILE | sources --input FILE --out FILE | report --input FILE [--labels FILE] [--out FILE]] [--dataset FILE] [--split dev|test|all] [--candidates IDS] [--repeats 1..3]",
		);
		return;
	}
	const dataset = await loadEvaluationDataset(values.dataset);
	const command = positionals[0] ?? "validate";
	if (command === "validate") {
		console.log(
			JSON.stringify(
				{
					version: dataset.version,
					datasetKey: await datasetKey(dataset),
					labelStatus: dataset.labels.status,
					devCases: dataset.cases.filter((item) => item.split === "dev").length,
					testCases: dataset.cases.filter((item) => item.split === "test")
						.length,
				},
				null,
				2,
			),
		);
		return;
	}
	if (command === "run") {
		if (!values.live || !values.out)
			throw new Error(
				"Run requires explicit --live and a new --out file; it makes paid provider calls",
			);
		const run = evaluationRunSchema.parse({
			datasetKey: await datasetKey(dataset),
			startedAt: new Date().toISOString(),
			split: values.split,
			candidates: values.candidates.split(","),
			repeats: Number(values.repeats),
			trials: [],
		});
		for (const candidate of run.candidates)
			evaluationCandidate(dataset.graph, dataset.evaluationNodeId, candidate);
		const session = connection();
		await writeNew(values.out, JSON.stringify(run, null, 2));
		await runEvaluation(
			dataset,
			run,
			values.out,
			session.client,
			(path, body) =>
				fetch(new URL(path, session.apiUrl), {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${session.token}`,
					},
					body,
					signal: AbortSignal.timeout(150000),
				}),
		);
		console.log(
			`Recorded ${run.trials.length} trials in ${values.out}; semantic quality remains unreviewed until an owner supplies evidence-backed labels.`,
		);
		return;
	}
	if (!values.input) throw new Error("This command requires --input FILE");
	let run = await loadEvaluationRun(values.input);
	if (run.datasetKey !== (await datasetKey(dataset)))
		throw new Error("Dataset does not match the recorded run");
	if (command === "collect") {
		if (!values.out) throw new Error("Collect requires a new --out file");
		const session = connection();
		const persistence = new ConvexPersistence(session.client);
		await writeNew(values.out, JSON.stringify(run, null, 2));
		for (let index = 0; index < run.trials.length; index++) {
			run.trials[index] = await collectTrial(
				persistence,
				run.trials[index],
				dataset.evaluationNodeId,
			);
			await saveEvaluationRun(values.out, run);
		}
		console.log(
			`Collected owned artifacts and reviews in ${values.out}; no provider calls.`,
		);
		return;
	}
	if (command === "labels" || command === "sources") {
		if (!values.out) throw new Error("A new --out file is required");
		await writeNew(
			values.out,
			JSON.stringify(
				command === "labels"
					? labelTemplate(dataset, run)
					: labelSources(dataset, run),
				null,
				2,
			),
		);
		return;
	}
	if (command !== "report") throw new Error("Unknown evaluation command");
	if (values.labels) run = await applyLocalLabels(values.labels, run);
	const report = JSON.stringify(await evaluationReport(dataset, run), null, 2);
	if (values.out) await writeNew(values.out, report);
	else console.log(report);
}

try {
	await main();
} catch (error) {
	let message = error instanceof Error ? error.message : "Evaluation failed";
	const token = process.env.EVAL_CONVEX_TOKEN;
	if (token) message = message.replaceAll(token, "*");
	console.error(message);
	process.exitCode = 1;
}
