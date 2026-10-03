import {
	datasetKey,
	evaluationCaseInput,
	evaluationDatasetSchema,
} from "../server/evaluation/dataset";
import {
	type EvaluationTrial,
	evaluationRunSchema,
} from "../server/evaluation/trial";
import { executeWorkflow } from "../server/workflow";
import { evaluationCandidate } from "../src/lib/evaluation-candidate";
import { EVALUATION_VERSIONS } from "../src/lib/evaluation-version";
import { reviewCriteria } from "../src/lib/quality-review";
import { EVIDENCE_TTL_MS } from "../src/lib/route-evidence";
import { runArtifactSchema } from "../src/lib/run-artifact";

export function evaluationDatasetFixture() {
	return evaluationDatasetSchema.parse({
		version: "controlled:1",
		provenance: "Controlled inputs for evaluation contract tests.",
		labels: { status: "seed" },
		evaluationNodeId: "answer",
		graph: {
			kind: "workflow",
			nodes: [
				{
					id: "input",
					kind: "input",
					fields: [
						{
							name: "priority",
							type: "string",
							required: true,
							defaultValue: "standard",
						},
					],
					documents: [],
				},
				{
					id: "intent",
					kind: "jev",
					questions: [
						{
							...{
								id: "question",
								name: "Question",
								confidenceThreshold: 0.7,
								type: "choice",
								instructions: "Select the configured fixture branch.",
								options: [
									{
										id: "accept",
										label: "Accept",
										description: "Accepted request.",
									},
									{
										id: "clarify",
										label: "Clarify",
										description: "Request needs clarification.",
									},
								],
							},
							confidenceThreshold: 0.7,
							uncertainOutputId: "question/clarify",
						},
					],

					variables: ["priority"],
					context: {
						historyMessages: 10,
						maxCharacters: 24000,
						upstream: "all",
						outputNodeIds: [],
						documents: [],
					},
				},
				{
					id: "answer",
					kind: "model",
					provider: "openai",
					model: "gpt-6-luna",
					prompt: "Return the controlled fixture answer.",
					variables: ["priority"],
					maxOutputTokens: 1400,
					reasoningEffort: "low",
					context: {
						historyMessages: 10,
						maxCharacters: 24000,
						upstream: "all",
						outputNodeIds: [],
						documents: [],
					},
					routing: {
						mode: "evaluate",
						models: ["gpt-6-luna", "gemini-3.8-flash"],
						quality: {
							criteria: "Answer meets the configured expectation.",
							minimumCases: 5,
							minimumPassRate: 0.95,
							maximumLatencyMs: 20000,
						},
						expectedOutputTokens: 256,
						expectedRequests: 1,
					},
				},
			],
			edges: [
				{ id: "entry", source: "input", target: "intent" },
				{
					id: "accepted",
					source: "intent",
					sourceHandle: "question/accept",
					target: "answer",
				},
				{
					id: "clarification",
					source: "intent",
					sourceHandle: "question/clarify",
					target: "answer",
				},
			],
		},
		cases: Array.from({ length: 6 }, (_, index) => ({
			id: `case:${index}`,
			label: `Controlled case ${index}`,
			split: index === 0 ? "dev" : "test",
			messages: [{ role: "user", content: `Fixture request ${index}` }],
			metadata: { priority: "standard" },
			expectations: ["Controlled fixture answer"],
			decisions: [
				{
					nodeId: "intent",
					branch: index === 5 ? "question/clarify" : "question/accept",
				},
			],
		})),
	});
}

export async function evaluationFixture() {
	const seed = evaluationDatasetFixture();
	const now = Date.now();
	const dataset = evaluationDatasetSchema.parse({
		...seed,
		labels: {
			status: "owner-approved",
			reviewer: "controlled test fixture",
			reviewedAt: new Date(now - 1000).toISOString(),
		},
	});
	const run = evaluationRunSchema.parse({
		datasetKey: await datasetKey(dataset),
		startedAt: new Date(now).toISOString(),
		candidates: ["gpt-6-luna", "gemini-3.8-flash"],
		repeats: 1,
		split: "test",
		trials: [],
	});
	for (const item of dataset.cases.filter((item) => item.split === "test")) {
		for (const candidate of run.candidates) {
			const routes = evaluationCandidate(
				dataset.graph,
				dataset.evaluationNodeId,
				candidate,
			);
			const input = {
				...evaluationCaseInput(routes, item),
				versions: EVALUATION_VERSIONS,
				history: {
					conversationId: `fixture:${item.id}`,
					sources: [],
					limited: false,
				},
			};
			const result = await executeWorkflow({
				routes,
				messages: input.messages,
				metadata: input.metadata,
				evaluate: async () => ({
					answers: [
						{
							questionId: "question",
							type: "choice",
							branch: item.decisions[0].branch,
							value: item.decisions[0].branch,
							confidence: 0.9,
						},
					],
					latencyMs: 1,
					model: "jev-1.13.0",
					usage: { inputTokens: 20, outputTokens: 0 },
				}),
				runModel: async ({ target }) => ({
					text: "Controlled fixture answer",
					model: target.model,
					usage: { inputTokens: 10, outputTokens: 10 },
				}),
				onDelta: () => {},
				onProgress: () => {},
				onRoute: () => {},
			});
			const artifact = runArtifactSchema.parse({
				status: "completed",
				result: { ...result, latencyMs: 100 },
				coverage: "complete",
				providerEvidence: result.calls.map((call) => ({
					id: `exchange:${call.id}`,
					callId: call.id,
					endpoint: "https://fixture.example",
					method: "POST",
					request: { text: "{}", bytes: 2, complete: true },
					response: { text: "{}", bytes: 2, complete: true },
					state: "completed",
				})),
			});
			const node = routes.nodes.find(
				(node) => node.id === dataset.evaluationNodeId,
			);
			if (node?.kind !== "model" || !node.routing)
				throw new Error("Missing fixture model");
			const trial: EvaluationTrial = {
				caseId: item.id,
				candidate,
				repetition: 1,
				record: {
					input,
					routes,
					credentialScope: "a".repeat(64),
					artifact,
					review: {
						reviewerId: "fixture-owner",
						reviewedAt: now,
						expiresAt: now + EVIDENCE_TTL_MS,
						value: {
							version: EVALUATION_VERSIONS.evaluator,
							criteria: reviewCriteria(node.routing.quality.criteria).map(
								(criterion) => ({
									id: criterion.id,
									verdict: "pass",
									reason: "Controlled fixture label",
									evidence: [
										{
											id: "ref:1",
											sourceId: "answer",
											quote: "Controlled fixture answer",
										},
									],
								}),
							),
							task: {
								outcome: "unknown",
								reason: "Fixture has no downstream resolution",
								evidence: [],
							},
							reaction: {
								outcome: "unknown",
								reason: "Fixture has no user feedback",
								evidence: [],
							},
						},
					},
				},
			};
			run.trials.push(trial);
		}
	}
	return { dataset, run, now };
}
