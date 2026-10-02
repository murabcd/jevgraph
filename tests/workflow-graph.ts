import type { Edge } from "@xyflow/react";
import type { FlowNode } from "../src/flow/graph";
import { DEFAULT_MODEL_MAX_OUTPUT_TOKENS } from "../src/lib/routing";
import { configuredJevQuestion } from "./jev-question-fixture";

export function connectedWorkflowGraph(): { nodes: FlowNode[]; edges: Edge[] } {
	return {
		nodes: [
			{
				id: "input",
				type: "route",
				position: { x: 0, y: 0 },
				data: { kind: "input", active: false, fields: [] },
			},
			{
				id: "first-router",
				type: "route",
				position: { x: 300, y: 0 },
				data: {
					kind: "jev",
					active: false,
					questions: [configuredJevQuestion("noul")],
				},
			},
			{
				id: "second-router",
				type: "route",
				position: { x: 600, y: 0 },
				data: {
					kind: "jev",
					active: false,
					questions: [configuredJevQuestion("noul")],
				},
			},
			{
				id: "primary-model",
				type: "route",
				position: { x: 600, y: 240 },
				data: {
					kind: "openai",
					active: false,
					model: "gpt-6-luna",
					maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
				},
			},
			{
				id: "backup-model",
				type: "route",
				position: { x: 900, y: 240 },
				data: {
					kind: "google",
					active: false,
					model: "gemini-3.8-flash",
					maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
				},
			},
			{
				id: "second-yes-model",
				type: "route",
				position: { x: 900, y: 0 },
				data: {
					kind: "google",
					active: false,
					model: "gemini-3.8-flash",
					maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
				},
			},
			{
				id: "second-no-model",
				type: "route",
				position: { x: 900, y: -240 },
				data: {
					kind: "openai",
					active: false,
					model: "gpt-6-luna",
					maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
				},
			},
		],
		edges: [
			{ id: "entry", source: "input", target: "first-router" },
			{
				id: "first-yes",
				source: "first-router",
				sourceHandle: "question/yes",
				target: "primary-model",
			},
			{
				id: "first-no",
				source: "first-router",
				sourceHandle: "question/no",
				target: "second-router",
			},
			{
				id: "second-yes",
				source: "second-router",
				sourceHandle: "question/yes",
				target: "second-yes-model",
			},
			{
				id: "second-no",
				source: "second-router",
				sourceHandle: "question/no",
				target: "second-no-model",
			},
			{
				id: "fallback",
				source: "primary-model",
				sourceHandle: "fallback",
				target: "backup-model",
			},
		],
	};
}
