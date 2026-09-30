import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	evaluationDatasetSchema,
	loadEvaluationDataset,
} from "../server/evaluation/dataset";
import { textModels } from "../src/lib/models";

async function cli(args: string[]) {
	const subprocess = Bun.spawn(
		[process.execPath, "server/evaluation/cli.ts", ...args],
		{
			cwd: join(import.meta.dir, ".."),
			env: { ...process.env, EVAL_CONVEX_TOKEN: "", VITE_CONVEX_URL: "" },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [code, stdout, stderr] = await Promise.all([
		subprocess.exited,
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
	]);
	return { code, stdout, stderr };
}

test("evaluation CLI requires an explicit suite and has no implicit demo dataset", async () => {
	const result = await cli(["validate"]);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("--dataset FILE");
	expect(result.stdout).toBe("");
});

test("evaluation CLI uses each suite's selected candidate and rejects disallowed overrides before connecting", async () => {
	const seed = await loadEvaluationDataset("evals/shop-support.json");
	const dir = await mkdtemp(join(tmpdir(), "jev-eval-cli-"));
	try {
		for (const model of textModels) {
			const dataset = evaluationDatasetSchema.parse({
				...seed,
				version: `selected:${model.id}`,
				graph: {
					...seed.graph,
					nodes: seed.graph.nodes.map((node) =>
						node.id === seed.evaluationNodeId &&
						node.kind === "model" &&
						node.routing
							? {
									...node,
									provider: model.provider,
									model: model.id,
									reasoningEffort: model.reasoning.defaultEffort,
									routing: { ...node.routing, models: [model.id] },
								}
							: node,
					),
				},
			});
			const path = join(dir, "suite.json");
			const out = join(dir, "run.json");
			await writeFile(path, JSON.stringify(dataset));
			const validated = await cli(["validate", "--dataset", path]);
			expect(validated.code).toBe(0);
			expect(validated.stdout).toContain(dataset.version);
			const args = ["run", "--dataset", path, "--live", "--out", out];
			for (const options of [[], ["--candidates", model.id]]) {
				const result = await cli([...args, ...options]);
				expect(result.code).toBe(1);
				expect(result.stderr).toContain(
					"EVAL_CONVEX_TOKEN and VITE_CONVEX_URL",
				);
			}
			const other = textModels.find((item) => item.id !== model.id);
			if (!other) throw new Error("Fixture needs an alternative candidate");
			const rejected = await cli([...args, "--candidates", other.id]);
			expect(rejected.code).toBe(1);
			expect(rejected.stderr).toContain("allowed model");
			expect(await Bun.file(out).exists()).toBe(false);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
