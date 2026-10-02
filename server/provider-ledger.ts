import { publishedRates } from "../src/lib/model-pricing.ts";
import {
	estimateCost,
	type Pricing,
	type ProviderCall,
	type TokenUsage,
} from "../src/lib/usage.ts";
import { ProviderEvidence } from "./provider-evidence.ts";
import { ProviderUsageError } from "./provider-usage.ts";
import type { WorkflowJournal } from "./workflow-journal.ts";

/** Owns call identities, the execution budget, and completed or failed usage. */
export class ProviderLedger {
	readonly calls: ProviderCall[] = [];
	private sequence = 0;
	private started = 0;
	private onRecorded: () => void;
	private evidence: ProviderEvidence;
	private journal?: WorkflowJournal;

	constructor(
		onRecorded: () => void,
		evidence: ProviderEvidence = new ProviderEvidence(),
		journal?: WorkflowJournal,
	) {
		this.journal = journal;
		this.onRecorded = onRecorded;
		this.evidence = evidence;
		if (journal) {
			this.calls.push(...journal.state.calls);
			this.sequence = journal.state.sequence;
			this.started = this.calls.length;
		}
	}

	nextId(): string {
		return `call:${++this.sequence}`;
	}

	preparationCost(nodeId: string): number | undefined {
		let total = 0;
		for (const call of this.calls) {
			if (call.nodeId !== nodeId || call.purpose === "model") continue;
			if (call.estimatedCostUsd === undefined) return undefined;
			total += call.estimatedCostUsd;
		}
		return total;
	}

	async run<T extends { usage?: TokenUsage; model?: string }>(
		identity: Pick<ProviderCall, "nodeId" | "purpose" | "provider" | "model">,
		pricing: Pricing | undefined,
		callId: string,
		run: () => Promise<T>,
	): Promise<T> {
		if (this.started >= 200)
			throw new Error("Chatflow exceeded its provider call budget");
		this.started++;
		await this.journal?.beforeCall({ ...identity, id: callId }, this.sequence);
		const began = performance.now();
		let usage: TokenUsage | undefined;
		let model = identity.model;
		let error: string | undefined;
		let status: ProviderCall["status"] = "completed";
		try {
			const result = await this.evidence.run(callId, run);
			usage = result.usage;
			model = result.model ?? model;
			return result;
		} catch (caught) {
			status = "failed";
			usage = caught instanceof ProviderUsageError ? caught.usage : undefined;
			error = this.evidence.redact(
				caught instanceof Error ? caught.message : "Provider call failed",
			);
			throw caught;
		} finally {
			const call: ProviderCall = {
				...identity,
				model,
				id: callId,
				status,
				durationMs: Math.round(performance.now() - began),
				usage,
				estimatedCostUsd: estimateCost(
					usage,
					pricing ??
						publishedRates(identity.provider, model, usage?.inputTokens),
				),
				error,
			};
			this.calls.push(call);
			this.onRecorded();
			await this.journal?.afterCall(call);
		}
	}
}
