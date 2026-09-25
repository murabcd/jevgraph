import type { FlowNode, NodeKind } from "@/flow/graph";
import { questionTypeLabels } from "@/lib/jev-question";

export const nodeMeta = {
	input: {
		title: "Prompt",
		subtitle: "Reusable instructions",
		footerLabel: "SYSTEM",
	},
	jev: {
		title: "Jev",
		subtitle: "Evaluate and route",
		footerLabel: "QUESTION",
	},
	google: {
		title: "Gemini",
		subtitle: "Select a model",
		footerLabel: "MODEL",
	},
	openai: {
		title: "OpenAI",
		subtitle: "Select a model",
		footerLabel: "MODEL",
	},
} satisfies Record<
	NodeKind,
	{ title: string; subtitle: string; footerLabel: string }
>;

export function nodeFooterValue(data: FlowNode["data"]) {
	if (data.kind === "input") return data.prompt || "No prompt";
	if (data.kind === "jev") return questionTypeLabels[data.question.type];
	return data.model;
}
