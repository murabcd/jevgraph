import type { NodeTiming, RouteStreamEvent } from "./routing.ts";

export type NodeTimer = Omit<NodeTiming, "status"> & {
	status: NodeTiming["status"] | "running" | "interrupted";
	startedAt?: number;
};

export const nodeTimerStatusLabels = {
	running: "Running",
	completed: "Completed",
	failed: "Failed",
	interrupted: "Interrupted",
} satisfies Record<NodeTimer["status"], string>;

export function nodeTimerDuration(timer: NodeTimer, now: number): number {
	return (
		timer.durationMs +
		(timer.status === "running" && timer.startedAt !== undefined
			? Math.max(0, now - timer.startedAt)
			: 0)
	);
}

export function applyNodeTimerEvent(
	current: NodeTimer | undefined,
	event: Extract<RouteStreamEvent, { type: "node-start" | "timing" }>,
	now: number,
): NodeTimer {
	if (event.type === "node-start")
		return {
			nodeId: event.nodeId,
			durationMs: current?.durationMs ?? 0,
			attempts: (current?.attempts ?? 0) + 1,
			status: "running",
			startedAt: now,
		};
	return {
		...event.timing,
		durationMs: (current?.durationMs ?? 0) + event.timing.durationMs,
		attempts:
			current?.status === "running"
				? current.attempts
				: (current?.attempts ?? 0) + 1,
	};
}

export function interruptNodeTimers(
	timers: Record<string, NodeTimer>,
	now: number,
): Record<string, NodeTimer> {
	return Object.fromEntries(
		Object.entries(timers).map(([id, timer]) => [
			id,
			timer.status === "running"
				? {
						...timer,
						status: "interrupted",
						startedAt: undefined,
						durationMs: nodeTimerDuration(timer, now),
					}
				: timer,
		]),
	);
}
