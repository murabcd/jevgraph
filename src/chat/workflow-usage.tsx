import { Badge } from "@/components/ui/badge";
import { MessageFooter } from "@/components/ui/message";
import type { RouteResult } from "@/lib/routing";
import { formatCostUsd } from "@/lib/usage";

export function WorkflowUsage({ route }: { route: RouteResult }) {
	return (
		<MessageFooter className="flex-wrap gap-2 text-xs text-muted-foreground">
			{route.outcome === "repeat-exhausted" && (
				<Badge variant="destructive">Review incomplete</Badge>
			)}
			<span className="tabular-nums">
				{route.calls.length} calls · input{" "}
				{route.usage.inputTokens?.toLocaleString() ?? "unknown"} · output{" "}
				{route.usage.outputTokens?.toLocaleString() ?? "unknown"}
				{route.usage.complete ? "" : " · usage incomplete"}
			</span>
			{route.usage.cachedInputTokens !== undefined && (
				<span>Cached: {route.usage.cachedInputTokens.toLocaleString()}</span>
			)}
			<span>
				{route.usage.estimatedCostUsd === undefined
					? "Cost unavailable"
					: `${formatCostUsd(route.usage.estimatedCostUsd)} estimated${route.usage.costComplete ? "" : " · partial"}`}
			</span>
		</MessageFooter>
	);
}
