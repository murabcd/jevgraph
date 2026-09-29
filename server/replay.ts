import { z } from "zod";
import {
	assertCurrentCase,
	frozenCaseSchema,
} from "../src/lib/evaluation-case.ts";
import { textModels } from "../src/lib/models.ts";
import {
	routeRequestSchema,
	workflowRoutesSchema,
} from "../src/lib/routing.ts";
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
	const saved = await persistence.replay(request.runId);
	const input = frozenCaseSchema.parse(JSON.parse(saved.input));
	assertCurrentCase(input);
	const routes = workflowRoutesSchema.parse(JSON.parse(saved.routes));
	if (request.candidate) {
		const node = routes.nodes.find(
			(node) => node.id === request.candidate?.nodeId,
		);
		const model = textModels.find(
			(model) => model.id === request.candidate?.model,
		);
		if (
			node?.kind !== "model" ||
			!node.routing ||
			!model ||
			!node.routing.models.includes(model.id)
		)
			throw new Error(
				"Replay candidate must be an allowed model on an evaluated node",
			);
		node.provider = model.provider;
		node.model = model.id;
		node.routing = { ...node.routing, mode: "evaluate" };
	}
	return routeRequestSchema.parse({
		conversationId: request.conversationId,
		requestId: request.requestId,
		messages: input.messages,
		metadata: input.metadata,
		routes,
	});
}
