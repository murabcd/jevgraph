import { expect, test } from "bun:test";
import { api } from "../convex/_generated/api";
import { ProviderEvidence } from "../server/provider-evidence";
import { serializeRunArtifact } from "../server/serialize-run-artifact";
import { executeWorkflow } from "../server/workflow";
import { type RouteTrace, workflowRoutesSchema } from "../src/lib/routing";
import {
	artifactTrace,
	emptyRouteTrace,
	runArtifactSchema,
} from "../src/lib/run-artifact";
import { createConvexFixture } from "./convex-fixture";

const routes = workflowRoutesSchema.parse({
	kind: "workflow",
	nodes: [
		{ id: "input", kind: "input", fields: [] },
		{ id: "first", kind: "model", provider: "openai", model: "gpt-6-luna" },
		{ id: "second", kind: "model", provider: "openai", model: "gpt-6-luna" },
		{ id: "join", kind: "model", provider: "openai", model: "gpt-6-luna" },
	],
	edges: [
		{ id: "a", source: "input", target: "first" },
		{ id: "b", source: "input", target: "second" },
		{ id: "c", source: "first", sourceHandle: "next", target: "join" },
		{ id: "d", source: "second", sourceHandle: "next", target: "join" },
	],
});

test("failed parallel execution retains completed sibling evidence without streaming full outputs", async () => {
	let snapshot: RouteTrace = emptyRouteTrace();
	let longestPreview = 0;
	const text = "Evidence ".repeat(1000);
	await expect(
		executeWorkflow({
			routes,
			messages: [{ role: "user", content: "Review both sources" }],
			metadata: {},
			evaluate: async () => {
				throw new Error("unreached");
			},
			runModel: async ({ target }) => {
				if (target.nodeId === "second") {
					await Bun.sleep(5);
					throw new Error("Provider failed");
				}
				return {
					text,
					model: target.model,
					usage: { inputTokens: 10, outputTokens: 10 },
				};
			},
			onSnapshot: (value) => {
				snapshot = value;
			},
			onProgress: (value) => {
				longestPreview = Math.max(
					longestPreview,
					...value.outputs.map((output) => output.text.length),
				);
			},
			onRoute: () => {},
			onDelta: () => {},
		}),
	).rejects.toThrow("Provider failed");
	expect(snapshot.outputs[0].text).toBe(text);
	expect(snapshot.calls.map((call) => call.status)).toEqual([
		"completed",
		"failed",
	]);
	expect(snapshot.path.some((step) => step.nodeId === "join")).toBe(false);
	expect(longestPreview).toBeLessThan(4100);
});

test("failure artifacts preserve traces, isolate owners, and delete files when settlement loses its race", async () => {
	const { t, owner, workspace } = await createConvexFixture();
	const run = await owner.mutation(api.runs.begin, {
		conversationId: workspace.conversationId,
		requestId: crypto.randomUUID(),
		input: JSON.stringify({
			messages: [{ role: "user", content: "Review" }],
			metadata: {},
		}),
		routes: JSON.stringify(routes),
	});
	const artifact = runArtifactSchema.parse({
		status: "failed",
		providerEvidence: [],
		text: "Partial answer",
		error: "Provider failed",
		latencyMs: 100,
		trace: {
			...emptyRouteTrace(),
			path: [{ nodeId: "input" }, { nodeId: "first" }],
		},
		coverage: "partial",
	});
	const other = await createConvexFixture(t);
	await expect(
		other.owner.action(api.results.save, {
			runId: run.runId,
			executionId: run.executionId,
			result: JSON.stringify(artifact),
		}),
	).rejects.toThrow("Conversation unavailable");
	await owner.action(api.results.save, {
		runId: run.runId,
		executionId: run.executionId,
		result: JSON.stringify(artifact),
	});
	const saved = await t.run(async (ctx) => {
		const row = await ctx.db.get(run.runId);
		if (!row?.resultFile) throw new Error("Artifact missing");
		const file = await ctx.storage.get(row.resultFile);
		if (!file) throw new Error("Artifact bytes missing");
		return runArtifactSchema.parse(JSON.parse(await file.text()));
	});
	expect(saved).toEqual(artifact);
	const before = await t.run((ctx) =>
		ctx.db.system.query("_storage").collect(),
	);
	await expect(
		owner.action(api.results.save, {
			runId: run.runId,
			executionId: run.executionId,
			result: JSON.stringify(artifact),
		}),
	).rejects.toThrow("already settled");
	expect(
		await t.run((ctx) => ctx.db.system.query("_storage").collect()),
	).toEqual(before);
});

test("oversized artifacts preserve settlement and mark lost trace evidence", async () => {
	const trace = emptyRouteTrace();
	trace.outputs.push({
		nodeId: "draft",
		sourceNodeId: "draft",
		kind: "model",
		revision: 1,
		text: "x".repeat(8_000_001),
	});
	const artifact = runArtifactSchema.parse(
		JSON.parse(
			serializeRunArtifact(
				{
					status: "failed",
					text: "Partial answer",
					error: "Provider failed",
					latencyMs: 1,
					trace,
					providerEvidence: [],
					coverage: "unavailable",
				},
				(text) => text,
			),
		),
	);
	expect(artifact.coverage).toBe("partial");
	expect(artifactTrace(artifact).outputs[0].text).toHaveLength(4000);
});

test("credential echoes are removed from all persisted trace text and prevent complete coverage", () => {
	const credential = 'private"key\\echo';
	const trace = emptyRouteTrace();
	trace.calls.push({
		id: "call:1",
		nodeId: "draft",
		purpose: "model",
		provider: "openai",
		model: "gpt-6-luna",
		status: "failed",
		durationMs: 1,
		error: `Call failed: ${credential}`,
	});
	trace.outputs.push({
		nodeId: "draft",
		sourceNodeId: "draft",
		kind: "model",
		revision: 1,
		text: `Partial ${credential}`,
	});
	const input = {
		status: "failed" as const,
		text: `Partial ${credential}`,
		error: `Failure ${credential}`,
		latencyMs: 1,
		trace,
		providerEvidence: [],
		coverage: "unavailable" as const,
	};
	const serialized = serializeRunArtifact(
		input,
		new ProviderEvidence([credential]).redact,
	);
	expect(serialized).not.toContain("private");
	const artifact = runArtifactSchema.parse(JSON.parse(serialized));
	expect(artifact.coverage).toBe("partial");
	expect(artifact.status === "failed" && artifact.text).toBe("Partial *");
	expect(() =>
		runArtifactSchema.parse({ ...input, coverage: "complete" }),
	).toThrow("all recorded provider bodies");
});
