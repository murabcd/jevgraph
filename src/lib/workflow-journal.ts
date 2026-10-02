import { z } from "zod";
import { nodeContextTraceSchema } from "./context.ts";
import { modelPlanSchema } from "./model-routing.ts";
import { providerEvidenceSchema } from "./provider-evidence.ts";
import {
	nodeOutputSchema,
	type RouteTrace,
	workflowEdgeSchema,
} from "./routing.ts";
import {
	type ProviderCall,
	providerCallSchema,
	tokenUsageSchema,
} from "./usage.ts";

export const MAX_JOURNAL_BYTES = 8_000_000;
export const MAX_NODE_ATTEMPTS = 100;
export const ACTIVE_EXECUTION_MS = 120_000;
const terminalSchema = z.strictObject({
	target: z.strictObject({
		nodeId: z.string(),
		provider: z.enum(["jev", "openai", "google"]),
		model: z.string(),
	}),
	response: z.strictObject({
		text: z.string(),
		model: z.string(),
		usage: tokenUsageSchema.optional(),
	}),
});
export const workflowStepSchema = z.strictObject({
	key: z.string(),
	nodeId: z.string(),
	edges: z.array(workflowEdgeSchema).max(200),
	output: nodeOutputSchema.optional(),
	terminal: terminalSchema.optional(),
	fallback: z
		.strictObject({ edge: workflowEdgeSchema, reason: z.string() })
		.optional(),
	exhausted: z.boolean(),
});
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export const pendingCallSchema = providerCallSchema.pick({
	id: true,
	nodeId: true,
	purpose: true,
	provider: true,
	model: true,
});
export type PendingCall = z.infer<typeof pendingCallSchema>;
export const workflowJournalSchema = z
	.strictObject({
		version: z.literal(1),
		runId: z.string().min(1).max(100),
		steps: z.array(workflowStepSchema).max(MAX_NODE_ATTEMPTS),
		calls: z.array(providerCallSchema).max(200),
		pendingCalls: z.array(pendingCallSchema).max(200),
		sequence: z.number().int().min(0).max(2000),
		nodeAttempts: z.number().int().min(0).max(MAX_NODE_ATTEMPTS),
		providerEvidence: providerEvidenceSchema,
		contexts: z.array(nodeContextTraceSchema).max(200),
		modelPlans: z.array(modelPlanSchema).max(200),
	})
	.superRefine((journal, ctx) => {
		const callIds = [...journal.calls, ...journal.pendingCalls].map(
			(call) => call.id,
		);
		if (
			new Set(callIds).size !== callIds.length ||
			callIds.length > 200 ||
			journal.sequence < callIds.length ||
			journal.steps.length > journal.nodeAttempts ||
			new Set(journal.steps.map((step) => step.key)).size !==
				journal.steps.length
		)
			ctx.addIssue({
				code: "custom",
				message: "Journal identities and attempt budgets must be consistent",
			});
	});
export type WorkflowJournalState = z.infer<typeof workflowJournalSchema>;
export function emptyWorkflowJournal(runId: string): WorkflowJournalState {
	return {
		version: 1,
		runId,
		steps: [],
		calls: [],
		pendingCalls: [],
		sequence: 0,
		nodeAttempts: 0,
		providerEvidence: [],
		contexts: [],
		modelPlans: [],
	};
}
export const resumeRequestSchema = z.strictObject({
	runId: z.string().min(1).max(100),
});

export type ResumeRequest = z.infer<typeof resumeRequestSchema>;

export function interruptedJournalCalls(
	state: WorkflowJournalState,
): ProviderCall[] {
	return [
		...state.calls,
		...state.pendingCalls.map(
			(identity): ProviderCall => ({
				...identity,
				status: "failed",
				error:
					"Server interrupted this attempt; completion, usage and duration are unknown",
			}),
		),
	];
}
export function journalTrace(state: WorkflowJournalState): RouteTrace {
	return {
		path: state.steps.flatMap((step) => [
			{ nodeId: step.nodeId },
			...(step.fallback
				? [{ nodeId: step.fallback.edge.target, via: "fallback" }]
				: []),
		]),
		traversedEdges: state.steps.flatMap((step) => [
			...(step.fallback ? [step.fallback.edge] : []),
			...step.edges,
		]),
		jevSteps: state.steps.flatMap((step) =>
			step.output?.kind === "jev" ? step.output.decisions : [],
		),
		outputs: state.steps.flatMap((step) => (step.output ? [step.output] : [])),
		calls: interruptedJournalCalls(state),
		contexts: state.contexts,
		modelPlans: state.modelPlans,
	};
}
