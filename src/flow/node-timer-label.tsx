import { useEffect, useState } from "react";
import { formatNodeDuration } from "@/flow/node-duration";
import {
	type NodeTimer,
	nodeTimerDuration,
	nodeTimerStatusLabels,
} from "@/lib/node-timer";
import { cn } from "@/lib/utils";

export function NodeTimerLabel({
	timer,
	details = false,
}: {
	timer: NodeTimer;
	details?: boolean;
}) {
	const [now, setNow] = useState(() => performance.now());
	const startedAt = timer.status === "running" ? timer.startedAt : undefined;
	useEffect(() => {
		if (startedAt === undefined) return;
		const interval = window.setInterval(() => setNow(performance.now()), 100);
		return () => window.clearInterval(interval);
	}, [startedAt]);
	const duration = `${timer.durationIncomplete ? "≥" : ""}${formatNodeDuration(
		nodeTimerDuration(timer, Math.max(now, startedAt ?? 0)),
	)}`;
	const status = nodeTimerStatusLabels[timer.status];
	const label = `${status} ${timer.status === "running" ? "for" : "in"} ${duration}`;
	return (
		<span
			className={cn(
				"tabular-nums",
				!details && "font-mono text-[10px]",
				timer.status === "failed" || timer.status === "interrupted"
					? "text-destructive"
					: "text-muted-foreground",
			)}
			title={label}
		>
			{details ? label : duration}
			{timer.attempts && timer.attempts > 1
				? details
					? ` across ${timer.attempts} provider calls`
					: ` ×${timer.attempts}`
				: ""}
		</span>
	);
}
