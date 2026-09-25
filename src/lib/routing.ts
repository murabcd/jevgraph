import { z } from "zod";
import { jevQuestionSchema, questionOutputs } from "./jev-question.ts";

export const providerSchema = z.enum(["openai", "google"]);
export type Provider = z.infer<typeof providerSchema>;

export type KeyStatus = { jev: boolean; openai: boolean; google: boolean };

export const JEV_MODEL_ID = "jev-latest";
export const MAX_REQUEST_PROMPT_LENGTH = 12000;

export const routingConfigSchema = z.object({
	openaiModel: z
		.string()
		.trim()
		.min(1)
		.max(100)
		.regex(/^[a-zA-Z0-9._:-]+$/),
	googleModel: z
		.string()
		.trim()
		.min(1)
		.max(100)
		.regex(/^[a-zA-Z0-9._:-]+$/),
	confidenceThreshold: z.number().min(0).max(1),
	defaultProvider: providerSchema,
	fallbackEnabled: z.boolean(),
});

export type RoutingConfig = z.infer<typeof routingConfigSchema>;

export const routeTargetSchema = z.object({
	nodeId: z.string().min(1).max(100),
	provider: providerSchema,
	model: z
		.string()
		.trim()
		.min(1)
		.max(100)
		.regex(/^[a-zA-Z0-9._:-]+$/),
});
export type RouteTarget = z.infer<typeof routeTargetSchema>;
const jevRoutesSchema = z
	.strictObject({
		kind: z.literal("jev"),
		nodeId: routeTargetSchema.shape.nodeId,
		systemNodeId: z.literal("input").optional(),
		question: jevQuestionSchema,
		targets: z.record(z.string(), routeTargetSchema),
	})
	.refine(
		(routes) => {
			const outputIds = questionOutputs(routes.question).map(({ id }) => id);
			return (
				Object.keys(routes.targets).length === outputIds.length &&
				outputIds.every((id) => Boolean(routes.targets[id]))
			);
		},
		{ message: "Every Jev output must connect to a model" },
	);
const directRoutesSchema = z.strictObject({
	kind: z.literal("direct"),
	systemNodeId: z.literal("input").optional(),
	target: routeTargetSchema,
});
const workflowNodeSchema = z.discriminatedUnion("kind", [
	z.strictObject({ id: z.string().min(1).max(100), kind: z.literal("input") }),
	z.strictObject({
		id: z.string().min(1).max(100),
		kind: z.literal("jev"),
		question: jevQuestionSchema,
	}),
	z.strictObject({
		id: z.string().min(1).max(100),
		kind: z.literal("model"),
		provider: providerSchema,
		model: routeTargetSchema.shape.model,
	}),
]);
const workflowEdgeSchema = z.strictObject({
	source: z.string().min(1).max(100),
	sourceHandle: z.string().min(1).max(100).optional(),
	target: z.string().min(1).max(100),
});
type WorkflowNode = z.infer<typeof workflowNodeSchema>;
type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

function validWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	if (byId.size !== nodes.length || byId.get("input")?.kind !== "input")
		return false;
	if (edges.some((edge) => !byId.has(edge.source) || !byId.has(edge.target)))
		return false;
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const check = (id: string): boolean => {
		if (visiting.has(id)) return false;
		if (visited.has(id)) return true;
		const node = byId.get(id);
		if (!node) return false;
		const outgoing = edges.filter((edge) => edge.source === id);
		visiting.add(id);
		let valid = false;
		if (node.kind === "input") {
			valid =
				outgoing.length === 1 &&
				!outgoing[0].sourceHandle &&
				check(outgoing[0].target);
		} else if (node.kind === "jev") {
			const outputs = questionOutputs(node.question);
			valid =
				outgoing.length === outputs.length &&
				outputs.every((output) => {
					const edge = outgoing.find(
						(candidate) => candidate.sourceHandle === output.id,
					);
					return Boolean(edge && check(edge.target));
				});
		} else {
			valid =
				outgoing.length === 0 ||
				(outgoing.length === 1 &&
					outgoing[0].sourceHandle === "fallback" &&
					byId.get(outgoing[0].target)?.kind === "model" &&
					edges.every((edge) => edge.source !== outgoing[0].target));
		}
		visiting.delete(id);
		if (valid) visited.add(id);
		return valid;
	};
	return check("input");
}

export const workflowRoutesSchema = z
	.strictObject({
		kind: z.literal("workflow"),
		systemNodeId: z.literal("input").optional(),
		nodes: z.array(workflowNodeSchema).min(2).max(100),
		edges: z.array(workflowEdgeSchema).min(1).max(200),
	})
	.refine((routes) => validWorkflow(routes.nodes, routes.edges), {
		message: "Every Jev output must reach a model without a cycle",
	});
export const routesSchema = z.union([
	jevRoutesSchema,
	directRoutesSchema,
	workflowRoutesSchema,
]);
export type Routes = z.infer<typeof routesSchema>;
export type DirectRoutes = Extract<Routes, { kind: "direct" }>;
export type JevRoutes = Extract<Routes, { kind: "jev" }>;
export type WorkflowRoutes = Extract<Routes, { kind: "workflow" }>;

export const defaultConfig: RoutingConfig = {
	openaiModel: "gpt-5-mini",
	googleModel: "gemini-3.5-flash-lite",
	confidenceThreshold: 0.7,
	defaultProvider: "openai",
	fallbackEnabled: true,
};

export const chatMessageSchema = z.object({
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

export const routeRequestSchema = z.strictObject({
	requestPrompt: z.string().trim().max(MAX_REQUEST_PROMPT_LENGTH),
	metadata: routingMetadataSchema.optional(),
	messages: z
		.array(chatMessageSchema)
		.min(1)
		.max(30)
		.refine((messages) => messages.at(-1)?.role === "user"),
	config: routingConfigSchema,
	routes: routesSchema,
});

export type JevDecision = {
	type: "choice" | "noul" | "score";
	branch: string;
	value: string | number;
	confidence: number;
	probabilities?: Record<string, number>;
	model: string;
	latencyMs: number;
};

export type RoutePathStep = { nodeId: string; via?: string };
export type NodeTiming = {
	nodeId: string;
	durationMs: number;
	status: "completed" | "failed";
};
export type WorkflowDecision = {
	nodeId: string;
	branch: string;
	confidence?: number;
	error?: string;
};

export type RouteResult = {
	mode: Routes["kind"];
	text: string;
	provider: Provider;
	model: string;
	initialProvider: Provider;
	nodeId: string;
	initialNodeId: string;
	branch: string;
	finalBranch: string;
	path: RoutePathStep[];
	reason: string;
	classificationError?: string;
	fallbackReason?: string;
	jev?: JevDecision;
	jevSteps?: WorkflowDecision[];
	usage?: { inputTokens?: number; outputTokens?: number };
	latencyMs: number;
};

export type RouteSelectionResult = Omit<
	RouteResult,
	"text" | "usage" | "latencyMs"
>;

export type RouteStreamEvent =
	| { type: "route"; route: RouteSelectionResult }
	| { type: "timing"; timing: NodeTiming }
	| { type: "delta"; text: string }
	| { type: "done"; route: RouteResult }
	| { type: "error"; error: string };

export function selectRoute(
	decision: Pick<JevDecision, "branch" | "confidence"> | undefined,
	config: RoutingConfig,
	routes: JevRoutes,
): { branch: string; target: RouteTarget; reason: string } {
	const outputs = questionOutputs(routes.question);
	const defaultBranch =
		outputs.find(
			({ id }) => routes.targets[id]?.provider === config.defaultProvider,
		)?.id ?? outputs[0].id;
	const branch =
		!decision ||
		decision.confidence < config.confidenceThreshold ||
		!routes.targets[decision.branch]
			? defaultBranch
			: decision.branch;
	const reason = !decision
		? "Jev unavailable · default route"
		: decision.confidence < config.confidenceThreshold
			? "Below confidence threshold · default route"
			: `${outputs.find((output) => output.id === branch)?.label ?? branch} · ${routes.targets[branch].model}`;
	return { branch, target: routes.targets[branch], reason };
}

export function routeTargets(routes: Routes) {
	return routes.kind === "direct"
		? [routes.target]
		: routes.kind === "jev"
			? Object.values(routes.targets)
			: routes.nodes.filter((node) => node.kind === "model");
}

export function routesUseJev(routes: Routes): boolean {
	return (
		routes.kind === "jev" ||
		(routes.kind === "workflow" &&
			routes.nodes.some((node) => node.kind === "jev"))
	);
}
