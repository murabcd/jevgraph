import { z } from "zod";
import { jevQuestionSchema, questionOutputs } from "./jev-question.ts";

export const providerSchema = z.enum(["openai", "google"]);
export type Provider = z.infer<typeof providerSchema>;

export type KeyStatus = { jev: boolean; openai: boolean; google: boolean };

export const JEV_MODEL_ID = "jev-latest";
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
export const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash-lite";
export const MAX_PROMPT_LENGTH = 12000;

export const routingConfigSchema = z.strictObject({
	confidenceThreshold: z.number().min(0).max(1),
	fallbackEnabled: z.boolean(),
});
export type RoutingConfig = z.infer<typeof routingConfigSchema>;

export const defaultConfig: RoutingConfig = {
	confidenceThreshold: 0.7,
	fallbackEnabled: true,
};

const nodeIdSchema = z.string().min(1).max(100);
const modelIdSchema = z
	.string()
	.trim()
	.min(1)
	.max(100)
	.regex(/^[a-zA-Z0-9._:-]+$/);

const inputNameSchema = z
	.string()
	.regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
	.max(64)
	.refine((name) => name !== "query", "query is supplied by chat");
export const startFieldSchema = z.discriminatedUnion("type", [
	z.strictObject({
		name: inputNameSchema,
		type: z.literal("string"),
		required: z.boolean(),
		defaultValue: z.string().max(256).optional(),
	}),
	z.strictObject({
		name: inputNameSchema,
		type: z.literal("number"),
		required: z.boolean(),
		defaultValue: z.number().finite().optional(),
	}),
	z.strictObject({
		name: inputNameSchema,
		type: z.literal("boolean"),
		required: z.boolean(),
		defaultValue: z.boolean().optional(),
	}),
]);
export type StartField = z.infer<typeof startFieldSchema>;
export const startFieldsSchema = z
	.array(startFieldSchema)
	.max(20)
	.refine(
		(fields) =>
			new Set(fields.map((field) => field.name)).size === fields.length,
		"Input names must be unique",
	);
const variableNamesSchema = z
	.array(inputNameSchema)
	.max(20)
	.refine((names) => new Set(names).size === names.length);

export const routeTargetSchema = z.strictObject({
	nodeId: nodeIdSchema,
	provider: providerSchema,
	model: modelIdSchema,
	prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
	variables: z.array(inputNameSchema).optional(),
});
export type RouteTarget = z.infer<typeof routeTargetSchema>;

const workflowNodeSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		id: z.literal("input"),
		kind: z.literal("input"),
		fields: startFieldsSchema,
	}),
	z.strictObject({
		id: nodeIdSchema,
		kind: z.literal("jev"),
		question: jevQuestionSchema,
		variables: variableNamesSchema.optional(),
		maxRepeats: z.number().int().min(1).max(5).optional(),
	}),
	z.strictObject({
		id: nodeIdSchema,
		kind: z.literal("model"),
		provider: providerSchema,
		model: modelIdSchema,
		prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
		variables: variableNamesSchema.optional(),
	}),
]);
const workflowEdgeSchema = z.strictObject({
	id: nodeIdSchema,
	source: nodeIdSchema,
	sourceHandle: z.string().min(1).max(100).optional(),
	target: nodeIdSchema,
	repeat: z.boolean().optional(),
});
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

function validWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	if (
		byId.size !== nodes.length ||
		byId.get("input")?.kind !== "input" ||
		nodes.filter((node) => node.kind === "input").length !== 1 ||
		new Set(edges.map((edge) => edge.id)).size !== edges.length
	)
		return false;
	if (edges.some((edge) => !byId.has(edge.source) || !byId.has(edge.target)))
		return false;
	const start = byId.get("input");
	if (start?.kind !== "input") return false;
	const availableVariables = new Set(start.fields.map((field) => field.name));
	if (
		nodes.some(
			(node) =>
				(node.kind === "jev" || node.kind === "model") &&
				(node.variables ?? []).some((name) => !availableVariables.has(name)),
		)
	)
		return false;
	const outgoingEdges = edges.filter(
		(edge) => edge.sourceHandle !== "fallback",
	);
	const normal = outgoingEdges.filter((edge) => !edge.repeat);
	const backups = edges.filter((edge) => edge.sourceHandle === "fallback");
	if (
		backups.some(
			(edge) =>
				byId.get(edge.source)?.kind !== "model" ||
				byId.get(edge.target)?.kind !== "model" ||
				edges.some((other) => other !== edge && other.target === edge.target) ||
				edges.some((other) => other.source === edge.target),
		)
	)
		return false;
	if (
		edges.some(
			(edge) =>
				edge.repeat &&
				(edge.sourceHandle === "fallback" ||
					byId.get(edge.source)?.kind !== "jev" ||
					byId.get(edge.target)?.kind !== "model"),
		) ||
		nodes.some(
			(node) =>
				node.kind === "jev" &&
				outgoingEdges.filter((edge) => edge.source === node.id && edge.repeat)
					.length > 1,
		)
	)
		return false;
	for (const node of nodes) {
		const outgoing = outgoingEdges.filter((edge) => edge.source === node.id);
		if (node.kind === "input") {
			if (outgoing.length === 0 || outgoing.some((edge) => edge.sourceHandle))
				return false;
		} else if (node.kind === "jev") {
			const outputs = questionOutputs(node.question);
			if (
				(outgoing.some((edge) => edge.repeat) &&
					outgoing.every((edge) => edge.repeat)) ||
				outputs.some(
					(output) =>
						outgoing.filter((edge) => edge.sourceHandle === output.id).length >
						1,
				) ||
				outgoing.some(
					(edge) => !outputs.some((output) => output.id === edge.sourceHandle),
				)
			)
				return false;
		} else if (outgoing.some((edge) => edge.sourceHandle !== "next")) {
			return false;
		}
		if (node.kind !== "jev" && outgoing.some((edge) => edge.repeat))
			return false;
		if (backups.filter((edge) => edge.source === node.id).length > 1)
			return false;
	}
	if (normal.some((edge) => edge.target === "input")) return false;
	if (
		nodes.every((node) => node.kind !== "jev") &&
		nodes.filter(
			(node) =>
				node.kind === "model" &&
				!normal.some((edge) => edge.source === node.id),
		).length > 1
	)
		return false;
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): boolean => {
		if (visiting.has(id)) return false;
		if (visited.has(id)) return true;
		visiting.add(id);
		for (const edge of normal.filter((entry) => entry.source === id)) {
			if (!visit(edge.target)) return false;
		}
		visiting.delete(id);
		visited.add(id);
		return true;
	};
	if (!visit("input")) return false;
	for (const edge of outgoingEdges.filter((candidate) => candidate.repeat)) {
		const pending = [edge.target];
		const seen = new Set<string>();
		while (pending.length > 0) {
			const current = pending.pop();
			if (!current || seen.has(current)) continue;
			seen.add(current);
			pending.push(
				...normal
					.filter((entry) => entry.source === current)
					.map((entry) => entry.target),
			);
		}
		if (!seen.has(edge.source)) return false;
	}
	const backupIds = new Set(backups.map((edge) => edge.target));
	return nodes.every((node) => visited.has(node.id) || backupIds.has(node.id));
}

export const workflowRoutesSchema = z
	.strictObject({
		kind: z.literal("workflow"),
		nodes: z.array(workflowNodeSchema).min(2).max(100),
		edges: z.array(workflowEdgeSchema).min(1).max(200),
	})
	.refine((routes) => validWorkflow(routes.nodes, routes.edges), {
		message: "Keep Jev branches valid and the chatflow acyclic",
	});
export type WorkflowRoutes = z.infer<typeof workflowRoutesSchema>;

export const chatMessageSchema = z.strictObject({
	role: z.enum(["user", "assistant"]),
	content: z.string().trim().min(1).max(12000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const routingMetadataSchema = z
	.record(
		z
			.string()
			.regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
			.max(64),
		z.union([z.string().max(256), z.number().finite(), z.boolean()]),
	)
	.refine((metadata) => Object.keys(metadata).length <= 20);
export type RoutingMetadata = z.infer<typeof routingMetadataSchema>;

export function resolveStartVariables(
	fields: StartField[],
	supplied: RoutingMetadata,
): RoutingMetadata {
	const resolved: RoutingMetadata = {};
	const declared = new Map(fields.map((field) => [field.name, field]));
	for (const [name, value] of Object.entries(supplied)) {
		const field = declared.get(name);
		if (!field || typeof value !== field.type)
			throw new Error(`Invalid Start input: ${name}`);
		resolved[name] = value;
	}
	for (const field of fields) {
		if (field.name in resolved) continue;
		if (field.defaultValue !== undefined)
			resolved[field.name] = field.defaultValue;
		else if (field.required)
			throw new Error(`Missing Start input: ${field.name}`);
	}
	return resolved;
}

export function selectedVariables(
	values: RoutingMetadata,
	names: string[] = [],
): RoutingMetadata {
	return Object.fromEntries(
		names.filter((name) => name in values).map((name) => [name, values[name]]),
	);
}

export const routeRequestSchema = z
	.strictObject({
		metadata: routingMetadataSchema.optional(),
		messages: z
			.array(chatMessageSchema)
			.min(1)
			.max(30)
			.refine((messages) => messages.at(-1)?.role === "user"),
		config: routingConfigSchema,
		routes: workflowRoutesSchema,
	})
	.superRefine((request, context) => {
		const start = request.routes.nodes.find((node) => node.kind === "input");
		if (start?.kind !== "input") return;
		try {
			resolveStartVariables(start.fields, request.metadata ?? {});
		} catch (error) {
			context.addIssue({
				code: "custom",
				path: ["metadata"],
				message:
					error instanceof Error ? error.message : "Invalid Start inputs",
			});
		}
	});

export type JevDecision = {
	type: "choice" | "noul" | "score";
	branch: string;
	value: string | number;
	confidence: number;
	probabilities?: Record<string, number>;
	model: string;
	latencyMs: number;
	usage?: RouteResult["usage"];
};

export type RoutePathStep = { nodeId: string; via?: string };
export type NodeTiming = {
	nodeId: string;
	durationMs: number;
	status: "completed" | "failed";
	attempts?: number;
};
export type WorkflowDecision = {
	nodeId: string;
	branch: string;
	confidence?: number;
	error?: string;
	limitReached?: boolean;
};
export type NodeOutput = {
	nodeId: string;
	kind: "jev" | "model";
	text: string;
};

export type RouteTrace = {
	path: RoutePathStep[];
	traversedEdges: WorkflowEdge[];
	jevSteps: WorkflowDecision[];
	outputs: NodeOutput[];
};

export type RouteResult = RouteTrace & {
	text: string;
	provider: Provider | "jev";
	model: string;
	nodeId: string;
	reason: string;
	fallbackReason?: string;
	usage?: { inputTokens?: number; outputTokens?: number };
	latencyMs: number;
};
export type RouteSelectionResult = Omit<
	RouteResult,
	"text" | "usage" | "latencyMs"
>;

export type RouteStreamEvent =
	| { type: "progress"; trace: RouteTrace }
	| { type: "route"; route: RouteSelectionResult }
	| { type: "timing"; timing: NodeTiming }
	| { type: "delta"; text: string }
	| { type: "done"; route: RouteResult }
	| { type: "error"; error: string };

export function routeTargets(routes: WorkflowRoutes): RouteTarget[] {
	return routes.nodes.flatMap((node) =>
		node.kind === "model"
			? [
					{
						nodeId: node.id,
						provider: node.provider,
						model: node.model,
						prompt: node.prompt,
						variables: node.variables,
					},
				]
			: [],
	);
}

export function routesUseJev(routes: WorkflowRoutes): boolean {
	return routes.nodes.some((node) => node.kind === "jev");
}
