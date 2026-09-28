import type { FlowNode, NodeKind } from "@/flow/graph";
import { type JevQuestionType, questionTypeLabels } from "@/lib/jev-question";

export const jevRoleLabels = {
	choice: "Classifier",
	noul: "Router",
	score: "Router",
} satisfies Record<JevQuestionType, string>;

export const nodeMeta = {
	input: {
		subtitle: "Chat input and variables",
		footerLabel: "INPUT",
	},
	jev: {
		subtitle: "Evaluate and decide",
		footerLabel: "QUESTION",
	},
	google: {
		subtitle: "Select a model",
		footerLabel: "MODEL",
	},
	openai: {
		subtitle: "Select a model",
		footerLabel: "MODEL",
	},
} satisfies Record<NodeKind, { subtitle: string; footerLabel: string }>;

export function nodeFooterValue(data: FlowNode["data"]) {
	if (data.kind === "input") return "";
	if (data.kind === "jev") return questionTypeLabels[data.question.type];
	return data.model;
}

export function nodeTitle(data: FlowNode["data"]) {
	if (data.kind === "jev") return "Jev";
	if (data.kind === "input") return "Start";
	return data.kind === "google" ? "Gemini" : "OpenAI";
}
