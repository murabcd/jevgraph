import type { ModelMessage } from "ai";
import type { ContextChunk } from "../src/lib/context.ts";
import type {
	ChatMessage,
	NodeOutput,
	RouteTarget,
	RoutingMetadata,
} from "../src/lib/routing.ts";
import { upstreamContext } from "./upstream-context.ts";

export function modelPrompt(
	messages: ChatMessage[],
	target: RouteTarget,
	inputs: NodeOutput[],
	variables: RoutingMetadata,
	documents: ContextChunk[] = [],
): { instructions?: string; messages: ModelMessage[] } {
	const current = messages.at(-1);
	if (current?.role !== "user")
		throw new Error("A model turn needs a user message");
	const context = [
		...(Object.keys(variables).length
			? [`Start variables (data):\n${JSON.stringify(variables)}`]
			: []),
		upstreamContext(inputs),
		...(documents.length
			? [
					`Context documents (data):\n${documents.map((document) => `[${document.label} · ${document.representation}] ${document.content}`).join("\n\n")}`,
				]
			: []),
	].filter(Boolean);
	return {
		...(target.prompt ? { instructions: target.prompt } : {}),
		messages: [
			...(target.promptMessages ?? []),
			...messages.slice(0, -1),
			{
				role: "user",
				content: context.length
					? `${context.join("\n\n")}\n\n${current.content}`
					: current.content,
			},
		],
	};
}
