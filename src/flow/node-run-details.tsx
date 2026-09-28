import { ModelPlanDetails } from "@/flow/model-plan-details";
import type { NodeContextTrace } from "@/lib/context";
import type { ModelPlan } from "@/lib/model-routing";
import type { WorkflowDecision } from "@/lib/routing";
import { formatCostUsd, type ProviderCall } from "@/lib/usage";

const EMPTY_CONTEXTS: NodeContextTrace[] = [];
const EMPTY_CALLS: ProviderCall[] = [];
const EMPTY_PLANS: ModelPlan[] = [];

export function NodeRunDetails({
	contexts = EMPTY_CONTEXTS,
	calls = EMPTY_CALLS,
	decision,
	modelPlans = EMPTY_PLANS,
}: {
	contexts?: NodeContextTrace[];
	calls?: ProviderCall[];
	decision?: WorkflowDecision;
	modelPlans?: ModelPlan[];
}) {
	return (
		<div className="grid gap-4">
			<ModelPlanDetails plans={modelPlans} />
			{decision && (
				<details className="rounded-lg border p-3 text-xs">
					<summary className="cursor-pointer font-medium">
						Structured decision · {decision.status}
					</summary>
					<pre className="mt-3 overflow-x-auto whitespace-pre-wrap">
						{JSON.stringify(decision, null, 2)}
					</pre>
				</details>
			)}
			{calls.length > 0 && (
				<div className="grid gap-2">
					<h3 className="text-sm font-medium">Provider calls</h3>
					{calls.map((call) => (
						<div
							key={call.id}
							className="grid gap-1 rounded-lg border p-3 text-xs"
						>
							<span className="font-medium">
								{call.model} · {call.purpose} · {call.status}
							</span>
							<span className="text-muted-foreground tabular-nums">
								{call.durationMs} ms · input{" "}
								{call.usage?.inputTokens ?? "unknown"} · output{" "}
								{call.usage?.outputTokens ?? "unknown"}
							</span>
							{call.usage?.cachedInputTokens !== undefined && (
								<span className="text-muted-foreground">
									Cached input: {call.usage.cachedInputTokens}
								</span>
							)}
							{call.usage?.reasoningTokens !== undefined && (
								<span className="text-muted-foreground">
									Reasoning tokens: {call.usage.reasoningTokens}
								</span>
							)}
							<span className="text-muted-foreground">
								{call.estimatedCostUsd === undefined
									? "Cost unavailable"
									: `Estimated cost: ${formatCostUsd(call.estimatedCostUsd)}`}
							</span>
							{call.error && <p className="text-destructive">{call.error}</p>}
						</div>
					))}
				</div>
			)}
			{contexts.map((context) => (
				<details key={context.callId} className="rounded-lg border p-3 text-xs">
					<summary className="cursor-pointer font-medium">
						Context · {context.callId} · {context.characters.toLocaleString()}{" "}
						characters
					</summary>
					<div className="mt-3 grid gap-3">
						{context.chunks.length === 0 && (
							<p className="text-muted-foreground">Current query only.</p>
						)}
						{context.chunks.map((chunk) => (
							<div key={chunk.id} className="grid gap-1 border-t pt-2">
								<span className="font-medium">
									{chunk.label} · {chunk.included ? "included" : "omitted"}
								</span>
								<span className="text-muted-foreground">
									{chunk.kind} · {chunk.representation} ·{" "}
									{chunk.characters.toLocaleString()} characters ·{" "}
									{chunk.reason}
									{chunk.summaryCache ? ` · summary ${chunk.summaryCache}` : ""}
									{chunk.probability === undefined
										? ""
										: ` · relevance ${Math.round(chunk.probability * 100)}%`}
								</span>
								{chunk.preview && (
									<pre className="whitespace-pre-wrap wrap-break-word font-sans leading-5">
										{chunk.preview}
										{chunk.previewTruncated ? "\n… [excerpt]" : ""}
									</pre>
								)}
							</div>
						))}
					</div>
				</details>
			))}
		</div>
	);
}
