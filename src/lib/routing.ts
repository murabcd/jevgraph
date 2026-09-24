import { z } from "zod";

export const providerSchema = z.enum(["openai", "google"]);
export type Provider = z.infer<typeof providerSchema>;

export type KeyStatus = { jev: boolean; openai: boolean; google: boolean };

export const JEV_MODEL_ID = "jev-latest";

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
export const routesSchema = z.object({
	fast: routeTargetSchema,
	deep: routeTargetSchema,
});
export type Routes = z.infer<typeof routesSchema>;

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
	messages: z
		.array(chatMessageSchema)
		.min(1)
		.max(30)
		.refine((messages) => messages.at(-1)?.role === "user"),
	config: routingConfigSchema,
	routes: routesSchema,
});

export type JevDecision = {
	choice: "fast" | "deep";
	confidence: number;
	probabilities: { fast: number; deep: number };
	model: string;
	latencyMs: number;
};

export type RouteResult = {
	text: string;
	provider: Provider;
	model: string;
	initialProvider: Provider;
	nodeId: string;
	initialNodeId: string;
	branch: "fast" | "deep";
	finalBranch: "fast" | "deep";
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
	decision: Pick<JevDecision, "choice" | "confidence"> | undefined,
	config: RoutingConfig,
	routes: Routes,
): { branch: "fast" | "deep"; target: RouteTarget; reason: string } {
	const branch =
		!decision || decision.confidence < config.confidenceThreshold
			? config.defaultProvider === "google"
				? "fast"
				: "deep"
			: decision.choice;
	const reason = !decision
		? "Jev unavailable · default route"
		: decision.confidence < config.confidenceThreshold
			? "Below confidence threshold · default route"
			: `${branch === "fast" ? "Fast" : "Deep"} task · ${routes[branch].model}`;
	return { branch, target: routes[branch], reason };
}
