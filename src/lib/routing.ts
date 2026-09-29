import { z } from "zod";
import {
	contextDocumentsSchema,
	contextPolicySchema,
	nodeContextTraceSchema,
	resolveContextDocuments,
} from "./context.ts";
import {
	configuredJevQuestionSchema,
	questionOutputs,
} from "./jev-question.ts";
import {
	modelPlanSchema,
	modelRoutingSchema,
	routingReasoningEfforts,
} from "./model-routing.ts";
import {
	type Provider,
	providers,
	type ReasoningEffort,
	reasoningEfforts,
	textModel,
} from "./models.ts";
import {
	pricingSchema,
	providerCallSchema,
	type TokenUsage,
	workflowUsageSchema,
} from "./usage.ts";

export const providerSchema = z.enum(providers);

export type KeyStatus = { jev: boolean; openai: boolean; google: boolean };

export const JEV_MODEL_ID = "jev-latest";
export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";
export const DEFAULT_GOOGLE_MODEL = "gemini-3.8-flash";
export const DEFAULT_JEV_CONFIDENCE_THRESHOLD = 0.7;
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 1400;
export const MAX_PROMPT_LENGTH = 12000;
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_MODEL_PROMPT_MESSAGES = 8;
export const modelPromptMessageSchema = z.strictObject({
	role: z.enum(["user", "assistant"]),
	content: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
});
export const modelPromptMessagesSchema = z
	.array(modelPromptMessageSchema)
	.max(MAX_MODEL_PROMPT_MESSAGES);
export type ModelPromptMessage = z.infer<typeof modelPromptMessageSchema>;
export const confidenceThresholdSchema = z.number().min(0).max(1);
export const maxOutputTokensSchema = z.number().int().min(1).max(8192);
export const reasoningEffortSchema = z.enum(reasoningEfforts);

export function modelReasoningEffort(
	provider: Provider,
	model: string,
	effort?: ReasoningEffort,
): ReasoningEffort | undefined {
	const reasoning = textModel(provider, model)?.reasoning;
	if (!reasoning) return undefined;
	return effort !== undefined && reasoning.efforts.includes(effort)
		? effort
		: reasoning.defaultEffort;
}

function validModelReasoning(
	provider: Provider,
	model: string,
	effort: ReasoningEffort | undefined,
): boolean {
	const reasoning = textModel(provider, model)?.reasoning;
	return Boolean(
		reasoning && (effort === undefined || reasoning.efforts.includes(effort)),
	);
}

const nodeIdSchema = z.string().min(1).max(100);
export const modelIdSchema = z
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
	promptMessages: modelPromptMessagesSchema.optional(),
	variables: z.array(inputNameSchema).optional(),
	context: contextPolicySchema.optional(),
	pricing: pricingSchema.optional(),
	routing: modelRoutingSchema.optional(),
	maxOutputTokens: maxOutputTokensSchema,
	reasoningEffort: reasoningEffortSchema.optional(),
});
export type RouteTarget = z.infer<typeof routeTargetSchema>;

const workflowNodeSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		id: z.literal("input"),
		kind: z.literal("input"),
		fields: startFieldsSchema,
		documents: contextDocumentsSchema.optional(),
	}),
	z.strictObject({
		id: nodeIdSchema,
		kind: z.literal("jev"),
		question: configuredJevQuestionSchema,
		confidenceThreshold: confidenceThresholdSchema.optional(),
		fallbackOutputId: z.string().min(1).max(100).optional(),
		variables: variableNamesSchema.optional(),
		maxRepeats: z.number().int().min(1).max(5).optional(),
		context: contextPolicySchema.optional(),
		pricing: pricingSchema.optional(),
	}),
	z.strictObject({
		id: nodeIdSchema,
		kind: z.literal("model"),
		routing: modelRoutingSchema.optional(),
		provider: providerSchema,
		model: modelIdSchema,
		prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
		promptMessages: modelPromptMessagesSchema.optional(),
		variables: variableNamesSchema.optional(),
		maxOutputTokens: maxOutputTokensSchema.optional(),
		reasoningEffort: reasoningEffortSchema.optional(),
		context: contextPolicySchema.optional(),
		pricing: pricingSchema.optional(),
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

function validModelNode(
	node: Extract<WorkflowNode, { kind: "model" }>,
): boolean {
	if (!textModel(node.provider, node.model)) return false;
	if (!node.routing)
		return validModelReasoning(node.provider, node.model, node.reasoningEffort);
	return (
		node.routing.expectedOutputTokens <=
			(node.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS) &&
		(node.reasoningEffort === undefined ||
			routingReasoningEfforts(node.routing.models).includes(
				node.reasoningEffort,
			))
	);
}

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
	const documentIds = new Set((start.documents ?? []).map(({ id }) => id));
	if (
		nodes.some(
			(node) =>
				node.kind !== "input" &&
				node.context &&
				(node.context.documents.some(({ id }) => !documentIds.has(id)) ||
					node.context.outputNodeIds.some(
						(id) => id === "input" || !byId.has(id),
					)),
		)
	)
		return false;
	const availableVariables = new Set(start.fields.map((field) => field.name));
	if (
		nodes.some(
			(node) =>
				(node.kind === "jev" || node.kind === "model") &&
				(node.variables ?? []).some((name) => !availableVariables.has(name)),
		)
	)
		return false;
	if (nodes.some((node) => node.kind === "model" && !validModelNode(node)))
		return false;
	const outgoingEdges = edges.filter(
		(edge) => edge.sourceHandle !== "fallback",
	);
	const normal = outgoingEdges.filter((edge) => !edge.repeat);
	const backups = edges.filter((edge) => edge.sourceHandle === "fallback");
	const backupIds = new Set(backups.map((edge) => edge.target));
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
				(node.fallbackOutputId !== undefined &&
					!outputs.some((output) => output.id === node.fallbackOutputId)) ||
				(outgoing.some((edge) => edge.repeat) &&
					outgoing.filter((edge) => !edge.repeat).length !== 1) ||
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
				!backupIds.has(node.id) &&
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
		conversationId: z.string().min(1).max(100),
		requestId: z.uuid(),
		metadata: routingMetadataSchema.optional(),
		documents: contextDocumentsSchema.optional(),
		messages: z
			.array(chatMessageSchema)
			.min(1)
			.max(30)
			.refine((messages) => messages.at(-1)?.role === "user"),
		routes: workflowRoutesSchema,
	})
	.superRefine((request, context) => {
		const start = request.routes.nodes.find((node) => node.kind === "input");
		if (start?.kind !== "input") return;
		try {
			resolveStartVariables(start.fields, request.metadata ?? {});
			const documents = resolveContextDocuments(
				start.documents ?? [],
				request.documents,
			);
			for (const node of request.routes.nodes) {
				if (node.kind === "input") continue;
				for (const binding of node.context?.documents ?? []) {
					if (
						!node.context?.automatic &&
						binding.representation === "summary" &&
						!documents.find(({ id }) => id === binding.id)?.summary
					)
						throw new Error(`Context document ${binding.id} needs a summary`);
				}
			}
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
	usage?: TokenUsage;
};

export type RoutePathStep = RouteTrace["path"][number];
export const nodeTimingSchema = z.strictObject({
	nodeId: z.string(),
	durationMs: z.number().finite().min(0),
	status: z.enum(["completed", "failed"]),
	attempts: z.number().int().min(1).optional(),
});
export type NodeTiming = z.infer<typeof nodeTimingSchema>;
export const workflowDecisionSchema = z.strictObject({
	nodeId: z.string(),
	branch: z.string(),
	status: z.enum(["accepted", "uncertain", "provider-error", "exhausted"]),
	selectedBranch: z.string().optional(),
	value: z.union([z.string(), z.number().finite()]).optional(),
	probabilities: z.record(z.string(), confidenceThresholdSchema).optional(),
	confidence: confidenceThresholdSchema.optional(),
	error: z.string().optional(),
});
export type WorkflowDecision = z.infer<typeof workflowDecisionSchema>;
export const nodeOutputSchema = z.strictObject({
	nodeId: z.string(),
	sourceNodeId: z.string(),
	kind: z.enum(["jev", "model"]),
	text: z.string(),
	revision: z.number().int().min(1),
	decision: workflowDecisionSchema.optional(),
});
export type NodeOutput = z.infer<typeof nodeOutputSchema>;
export const routeTraceSchema = z.strictObject({
	path: z.array(
		z.strictObject({ nodeId: z.string(), via: z.string().optional() }),
	),
	traversedEdges: z.array(workflowEdgeSchema),
	jevSteps: z.array(workflowDecisionSchema),
	outputs: z.array(nodeOutputSchema),
	calls: z.array(providerCallSchema),
	contexts: z.array(nodeContextTraceSchema),
	modelPlans: z.array(modelPlanSchema),
});
export type RouteTrace = z.infer<typeof routeTraceSchema>;
export const routeSelectionSchema = routeTraceSchema.extend({
	provider: z.enum(["openai", "google", "jev"]),
	model: z.string(),
	nodeId: z.string(),
	reason: z.string(),
	fallbackReason: z.string().optional(),
});
export type RouteSelectionResult = z.infer<typeof routeSelectionSchema>;
export const routeResultSchema = routeSelectionSchema.extend({
	text: z.string(),
	usage: workflowUsageSchema,
	outcome: z.enum(["completed", "repeat-exhausted"]),
	latencyMs: z.number().finite().min(0),
});
export type RouteResult = z.infer<typeof routeResultSchema>;
export const routeStreamEventSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("progress"), trace: routeTraceSchema }),
	z.strictObject({ type: z.literal("route"), route: routeSelectionSchema }),
	z.strictObject({ type: z.literal("node-start"), nodeId: z.string().min(1) }),
	z.strictObject({ type: z.literal("timing"), timing: nodeTimingSchema }),
	z.strictObject({ type: z.literal("delta"), text: z.string() }),
	z.strictObject({ type: z.literal("done"), route: routeResultSchema }),
	z.strictObject({ type: z.literal("error"), error: z.string() }),
]);
export type RouteStreamEvent = z.infer<typeof routeStreamEventSchema>;

export function modelTarget(
	node: Extract<WorkflowNode, { kind: "model" }>,
): RouteTarget {
	return {
		nodeId: node.id,
		provider: node.provider,
		model: node.model,
		prompt: node.prompt,
		promptMessages: node.promptMessages,
		variables: node.variables,
		context: node.context,
		pricing: node.pricing,
		routing: node.routing,
		maxOutputTokens: node.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
		reasoningEffort: node.reasoningEffort,
	};
}

export function routeTargets(routes: WorkflowRoutes): RouteTarget[] {
	return routes.nodes.flatMap((node) =>
		node.kind === "model" ? [modelTarget(node)] : [],
	);
}

export function routesUseJev(routes: WorkflowRoutes): boolean {
	return routes.nodes.some(
		(node) =>
			node.kind === "jev" ||
			(node.kind === "model" &&
				(node.context?.relevance !== undefined ||
					node.context?.automatic !== undefined)),
	);
}
