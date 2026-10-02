import { z } from "zod";
import { contextDocumentsSchema, contextPolicySchema } from "./context.ts";
import { defaultJevQuestion, jevQuestionsSchema } from "./jev-question.ts";
import { modelRoutingSchema } from "./model-routing.ts";
import {
	MAX_PROMPT_LENGTH,
	maxOutputTokensSchema,
	modelIdSchema,
	modelPromptMessagesSchema,
	reasoningEffortSchema,
	startFieldsSchema,
} from "./routing.ts";
import { pricingSchema } from "./usage.ts";
export const MAX_GRAPH_NODES = 100;
export const MAX_GRAPH_EDGES = 400;

export const persistedNodeSchema = z.object({
	id: z.string(),
	position: z.object({ x: z.number().finite(), y: z.number().finite() }),
	data: z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("input"),
			fields: startFieldsSchema,
			documents: contextDocumentsSchema.optional(),
		}),
		z.object({
			kind: z.literal("jev"),
			questions: jevQuestionsSchema,
			maxRepeats: z.number().int().min(1).max(5).optional(),
			variables: z.array(z.string()).optional(),
			context: contextPolicySchema.optional(),
			pricing: pricingSchema.optional(),
		}),
		z.object({
			kind: z.enum(["google", "openai"]),
			routing: modelRoutingSchema.optional(),
			model: modelIdSchema,
			maxOutputTokens: maxOutputTokensSchema,
			reasoningEffort: reasoningEffortSchema.optional(),
			prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
			promptMessages: modelPromptMessagesSchema.optional(),
			variables: z.array(z.string()).optional(),
			context: contextPolicySchema.optional(),
			pricing: pricingSchema.optional(),
		}),
	]),
});

export const persistedEdgeSchema = z.object({
	id: z.string(),
	source: z.string(),
	sourceHandle: z.string().nullish(),
	target: z.string(),
	data: z.object({ repeat: z.boolean() }).optional(),
});

export const graphSnapshotSchema = z
	.strictObject({
		nodes: z.array(persistedNodeSchema).min(1).max(MAX_GRAPH_NODES),
		edges: z.array(persistedEdgeSchema).max(MAX_GRAPH_EDGES),
	})
	.superRefine((graph, ctx) => {
		const ids = new Set(graph.nodes.map((node) => node.id));
		if (
			ids.size !== graph.nodes.length ||
			graph.nodes.filter((node) => node.data.kind === "input").length !== 1 ||
			!graph.nodes.some(
				(node) => node.id === "input" && node.data.kind === "input",
			)
		)
			ctx.addIssue({
				code: "custom",
				message: "Graph needs exactly one Start and unique node IDs",
			});
		if (
			new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length ||
			graph.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))
		)
			ctx.addIssue({ code: "custom", message: "Invalid graph connections" });
	});
export type GraphSnapshot = z.infer<typeof graphSnapshotSchema>;
export function parseGraphJson(json: string): GraphSnapshot {
	if (new TextEncoder().encode(json).length > 900000)
		throw new Error("Graph is too large to save");
	return graphSnapshotSchema.parse(JSON.parse(json));
}

export function createInitialGraph(): GraphSnapshot {
	return {
		nodes: [
			{
				id: "input",
				position: { x: 0, y: 235 },
				data: { kind: "input", fields: [] },
			},
			{
				id: "jev",
				position: { x: 355, y: 235 },
				data: {
					kind: "jev",
					questions: [defaultJevQuestion()],
				},
			},
		],
		edges: [{ id: "input-jev", source: "input", target: "jev" }],
	};
}
