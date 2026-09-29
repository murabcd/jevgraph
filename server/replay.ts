import { z } from "zod";
import { evaluationCandidate } from "../src/lib/evaluation-candidate.ts";
import { assertCurrentCase } from "../src/lib/evaluation-case.ts";
import { routeRequestSchema } from "../src/lib/routing.ts";
import type { ConvexPersistence } from "./convex-persistence.ts";

export const routeReplayRequestSchema = z.strictObject({
	runId: z.string().min(1).max(100),
	conversationId: z.string().min(1).max(100),
	requestId: z.uuid(),
	candidate: z
		.strictObject({
			nodeId: z.string().min(1).max(100),
			model: z.string().min(1).max(100),
		})
		.optional(),
});

/** Only the selected evaluated model varies; all registered inputs stay frozen. */
export async function resolveReplay(
	persistence: ConvexPersistence,
	request: z.infer<typeof routeReplayRequestSchema>,
) {
	const saved = await persistence.inspect(request.runId);
	const input = saved.input;
	assertCurrentCase(input);
	const routes = request.candidate
		? evaluationCandidate(
				saved.routes,
				request.candidate.nodeId,
				request.candidate.model,
			)
		: saved.routes;
	return routeRequestSchema.parse({
		conversationId: request.conversationId,
		requestId: request.requestId,
		messages: input.messages,
		metadata: input.metadata,
		routes,
	});
}
