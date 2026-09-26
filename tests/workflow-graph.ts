import type { Edge } from "@xyflow/react";
import type { FlowNode } from "../src/flow/graph";
import {
	DEFAULT_JEV_CONFIDENCE_THRESHOLD,
	DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
} from "../src/lib/routing";
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
					question: configuredJevQuestion("noul"),
					confidenceThreshold: DEFAULT_JEV_CONFIDENCE_THRESHOLD,
				},
			},
			{
				id: "second-router",
				type: "route",
				position: { x: 600, y: 0 },
				data: {
					kind: "jev",
					active: false,
					question: configuredJevQuestion("noul"),
					confidenceThreshold: DEFAULT_JEV_CONFIDENCE_THRESHOLD,
				},
			},
			{
				id: "primary-model",
				type: "route",
				position: { x: 600, y: 240 },
				data: {
					kind: "openai",
					active: false,
					model: "gpt-5-mini",
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
					model: "gemini-3.5-flash-lite",
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
					model: "gemini-3.5-flash-lite",
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
					model: "gpt-5-nano",
					maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
				},
			},
		],
		edges: [
			{ id: "entry", source: "input", target: "first-router" },
			{
				id: "first-yes",
				source: "first-router",
				sourceHandle: "yes",
				target: "primary-model",
			},
			{
				id: "first-no",
				source: "first-router",
				sourceHandle: "no",
				target: "second-router",
			},
			{
				id: "second-yes",
				source: "second-router",
				sourceHandle: "yes",
				target: "second-yes-model",
			},
			{
				id: "second-no",
				source: "second-router",
				sourceHandle: "no",
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
