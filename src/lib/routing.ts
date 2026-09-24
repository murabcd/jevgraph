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
	target: routeTargetSchema,
});
export const routesSchema = z.union([jevRoutesSchema, directRoutesSchema]);
export type Routes = z.infer<typeof routesSchema>;
export type JevRoutes = Extract<Routes, { kind: "jev" }>;

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

export const routeRequestSchema = z.object({
	requestPrompt: z.string().trim().max(MAX_REQUEST_PROMPT_LENGTH),
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
	reason: string;
	classificationError?: string;
	fallbackReason?: string;
	jev?: JevDecision;
	usage?: { inputTokens?: number; outputTokens?: number };
	latencyMs: number;
};

export type RouteSelectionResult = Omit<
	RouteResult,
	"text" | "usage" | "latencyMs"
>;

export type RouteStreamEvent =
	| { type: "route"; route: RouteSelectionResult }
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
