import type { ModelPlan } from "@/lib/model-routing";
import { formatCostUsd } from "@/lib/usage";

export function ModelPlanDetails({ plans }: { plans: ModelPlan[] }) {
	return plans.map((plan) => (
		<details key={plan.callId} className="rounded-lg border p-3 text-xs">
			<summary className="cursor-pointer font-medium">
				Model selection · {plan.selectedModel}
			</summary>
			<div className="mt-3 grid gap-3">
				<span className="text-muted-foreground">
					{plan.expectedRequests} expected requests with the same context ·
					estimated tokens
				</span>
				{plan.candidates.map((quote) => (
					<div key={quote.model} className="grid gap-1 border-t pt-2">
						<span className="font-medium">
							{quote.model}
							{quote.model === plan.selectedModel ? " · selected" : ""}
						</span>
						{quote.excluded ? (
							<span className="text-muted-foreground">
								{quote.excluded === "unavailable"
									? "Provider unavailable"
									: "Price unavailable"}
							</span>
						) : (
							<>
								<span className="text-muted-foreground">
									Estimated input {quote.inputTokens.toLocaleString()} · output{" "}
									{quote.expectedOutputTokens.toLocaleString()}
								</span>
								<span className="text-muted-foreground">
									Cache: {quote.cache} ·{" "}
									{quote.expectedCachedTokens.toLocaleString()} tokens expected
									from observed cache
								</span>
								<span className="text-muted-foreground">
									Estimated now:{" "}
									{quote.estimatedCostUsd === undefined
										? "unknown"
										: formatCostUsd(quote.estimatedCostUsd)}
								</span>
								<span className="text-muted-foreground">
									Estimated for {plan.expectedRequests} requests:{" "}
									{quote.estimatedTotalUsd === undefined
										? "unknown"
										: formatCostUsd(quote.estimatedTotalUsd)}
								</span>
							</>
						)}
					</div>
				))}
				<span className="text-muted-foreground">
					Context preparation so far:{" "}
					{plan.preparationCostUsd === undefined
						? "unknown"
						: formatCostUsd(plan.preparationCostUsd)}
				</span>
				{plan.candidates.some((quote) => quote.cache === "write") && (
					<span className="text-muted-foreground">
						Projection assumes the new cache prefix is reused on later requests.
						Actual cache usage is reported below.
					</span>
				)}
			</div>
		</details>
	));
}
