import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { contentHash } from "../../src/lib/content-identity.ts";
import { canonicalEvaluationInput } from "../../src/lib/evaluation-case.ts";
import {
	resolveStartVariables,
	routeRequestSchema,
	type WorkflowRoutes,
	workflowRoutesSchema,
} from "../../src/lib/routing.ts";

export const evaluationDatasetSchema = z
	.strictObject({
		version: z.string().min(1).max(100),
		provenance: z.string().min(1).max(2000),
		labels: z.discriminatedUnion("status", [
			z.strictObject({ status: z.literal("seed") }),
			z.strictObject({
				status: z.literal("owner-approved"),
				reviewer: z.string().min(1).max(200),
				reviewedAt: z.iso.datetime(),
			}),
		]),
		graph: workflowRoutesSchema,
		evaluationNodeId: z.string().min(1).max(100),
		cases: z
			.array(
				z.strictObject({
					id: z.string().min(1).max(100),
					label: z.string().min(1).max(200),
					split: z.enum(["dev", "test"]),
					messages: routeRequestSchema.shape.messages,
					metadata: routeRequestSchema.shape.metadata,
					expectations: z.array(z.string().min(1).max(2000)).min(1).max(20),
					decisions: z
						.array(
							z.strictObject({
								nodeId: z.string().min(1).max(100),
								branch: z.string().min(1).max(100),
							}),
						)
						.max(100)
						.refine(
							(labels) =>
								new Set(labels.map((label) => label.nodeId)).size ===
								labels.length,
							"Label each final Jev decision once",
						),
				}),
			)
			.min(2)
			.max(100),
	})
	.superRefine((dataset, ctx) => {
		if (
			new Set(dataset.cases.map((item) => item.id)).size !==
			dataset.cases.length
		)
			ctx.addIssue({
				code: "custom",
				message: "Case identities must be unique",
			});
		const node = dataset.graph.nodes.find(
			(node) => node.id === dataset.evaluationNodeId,
		);
		if (node?.kind !== "model" || node.routing?.mode !== "evaluate")
			ctx.addIssue({
				code: "custom",
				message: "Dataset requires an evaluated Model node",
			});
		const identities: string[] = [];
		for (const item of dataset.cases) {
			const request = routeRequestSchema.safeParse({
				conversationId: "validation",
				requestId: "00000000-0000-4000-8000-000000000000",
				messages: item.messages,
				metadata: item.metadata,
				routes: dataset.graph,
			});
			if (!request.success)
				ctx.addIssue({
					code: "custom",
					message: `Invalid inputs for ${item.id}: ${request.error.message}`,
				});
			else
				identities.push(
					JSON.stringify(evaluationCaseInput(dataset.graph, item)),
				);
			for (const expected of item.decisions) {
				const judge = dataset.graph.nodes.find(
					(node) => node.id === expected.nodeId,
				);
				if (
					judge?.kind !== "jev" ||
					!dataset.graph.edges.some(
						(edge) =>
							edge.source === judge.id && edge.sourceHandle === expected.branch,
					)
				)
					ctx.addIssue({
						code: "custom",
						message: `Invalid decision label for ${item.id}`,
					});
			}
		}

		if (new Set(identities).size !== identities.length)
			ctx.addIssue({
				code: "custom",
				message:
					"Duplicate inputs cannot count as distinct cases or cross dev/test splits",
			});
		if (
			!dataset.cases.some((item) => item.split === "dev") ||
			!dataset.cases.some((item) => item.split === "test")
		)
			ctx.addIssue({
				code: "custom",
				message: "Include separate dev and held-out test cases",
			});
	});
export type EvaluationDataset = z.infer<typeof evaluationDatasetSchema>;

export async function loadEvaluationDataset(path: string) {
	const file = await stat(path);
	if (file.size > 2_000_000)
		throw new Error("Dataset exceeds two million bytes");
	return evaluationDatasetSchema.parse(
		JSON.parse(await readFile(path, "utf8")),
	);
}

export function datasetKey(dataset: EvaluationDataset) {
	return contentHash(
		JSON.stringify({
			version: dataset.version,
			graph: dataset.graph,
			evaluationNodeId: dataset.evaluationNodeId,
			cases: dataset.cases,
		}),
	);
}

export function evaluationCaseInput(
	graph: WorkflowRoutes,
	item: Pick<EvaluationDataset["cases"][number], "messages" | "metadata">,
) {
	const start = graph.nodes.find((node) => node.kind === "input");
	if (start?.kind !== "input")
		throw new Error("Dataset Start node unavailable");
	return canonicalEvaluationInput({
		messages: item.messages,
		metadata: resolveStartVariables(start.fields, item.metadata ?? {}),
	});
}
