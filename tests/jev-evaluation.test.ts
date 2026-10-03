import { expect, test } from "bun:test";
import { assessContext } from "../server/context-providers";
import { evaluateJev } from "../server/jev-evaluation";
import { ProviderUsageError } from "../server/provider-usage";
import { rerankContext } from "../server/retrieval-providers";

test("invalid context and rerank answers preserve usage without retrying", async () => {
	for (const purpose of ["context", "rerank"] as const) {
		let calls = 0;
		const access = {
			keys: { TYPESAFE_API_KEY: "test-key" },
			signal: new AbortController().signal,
			providerFetch: async () => {
				calls++;
				return Response.json({
					model: "jev-1.13.0",
					answers: {},
					usage: { input_tokens: 123, output_tokens: 7 },
				});
			},
		};
		const operation =
			purpose === "context"
				? assessContext(
						{
							nodeId: "model",
							query: "Return deadline?",
							task: "Answer from store policy",
							sources: [{ id: "policy", full: "Return within 14 days." }],
						},
						access,
					)
				: rerankContext(
						{
							query: "Return deadline?",
							task: "Answer from store policy",
							candidates: [
								{
									id: "passage",
									sourceId: "policy",
									label: "Return policy",
									kind: "document",
									rank: 1,
									start: 0,
									end: 22,
									text: "Return within 14 days.",
								},
							],
						},
						access,
					);
		try {
			await operation;
			throw new Error("Invalid answers were accepted");
		} catch (error) {
			expect(error).toBeInstanceOf(ProviderUsageError);
			expect(error).toMatchObject({
				model: "jev-1.13.0",
				usage: { inputTokens: 123, outputTokens: 7 },
			});
		}
		expect(calls).toBe(1);
	}
});

test("cancellation after a typed response preserves paid usage and rejects execution", async () => {
	const controller = new AbortController();
	let calls = 0;
	await expect(
		evaluateJev(
			{
				state: "Can return?",
				questions: { eligible: { type: "boolean", instructions: "Eligible?" } },
			},
			{
				keys: { TYPESAFE_API_KEY: "test-key" },
				signal: controller.signal,
				providerFetch: async () => {
					calls++;
					controller.abort(new Error("Cancelled"));
					return Response.json({
						model: "jev-1.13.0",
						answers: { eligible: { type: "noul", noul: 0.99 } },
						usage: { input_tokens: 80, output_tokens: 5 },
					});
				},
			},
			10000,
		),
	).rejects.toMatchObject({
		message: "Cancelled",
		model: "jev-1.13.0",
		usage: { inputTokens: 80, outputTokens: 5 },
	});
	expect(calls).toBe(1);
});
