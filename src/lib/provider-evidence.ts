import { z } from "zod";

export const MAX_PROVIDER_EVIDENCE_BYTES = 1_000_000;
const bodyEvidenceSchema = z.strictObject({
	text: z.string(),
	bytes: z.number().int().min(0),
	complete: z.boolean(),
});
export const providerExchangeSchema = z.strictObject({
	id: z.string(),
	callId: z.string(),
	endpoint: z.string(),
	method: z.string(),
	request: bodyEvidenceSchema,
	response: bodyEvidenceSchema,
	httpStatus: z.number().int().min(100).max(599).optional(),
	state: z.enum(["running", "completed", "failed", "interrupted"]),
	error: z.string().optional(),
});
export type ProviderExchange = z.infer<typeof providerExchangeSchema>;
export const providerEvidenceSchema = z
	.array(providerExchangeSchema)
	.max(200)
	.refine(
		(exchanges) =>
			new Set(exchanges.map((exchange) => exchange.id)).size ===
			exchanges.length,
		"Provider exchange identities must be unique",
	);

export function evidenceCoverage(
	exchanges: ProviderExchange[],
	callIds: string[],
) {
	if (!callIds.length) return "complete" as const;
	const captured = new Set(exchanges.map((exchange) => exchange.callId));
	if (!exchanges.length) return "unavailable" as const;
	return callIds.every((id) => captured.has(id)) &&
		exchanges.every(
			(exchange) =>
				exchange.request.complete &&
				exchange.response.complete &&
				exchange.state !== "running",
		)
		? ("complete" as const)
		: ("partial" as const);
}
