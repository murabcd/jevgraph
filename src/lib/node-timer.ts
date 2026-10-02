import type { NodeTiming, RouteStreamEvent, RouteTrace } from "./routing.ts";

export type NodeTimer = Omit<NodeTiming, "status"> & {
	status: NodeTiming["status"] | "running" | "interrupted";
	startedAt?: number;
	durationIncomplete?: boolean;
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

/** Settled durations use the persisted provider ledger, never browser clocks. */
export function settledNodeTimers(
	trace: RouteTrace | null,
): Record<string, NodeTimer> {
	const timers: Record<string, NodeTimer> = {};
	if (trace?.path.some((step) => step.nodeId === "input"))
		timers.input = {
			nodeId: "input",
			durationMs: 0,
			attempts: 1,
			status: "completed",
		};
	for (const call of trace?.calls ?? []) {
		const current = timers[call.nodeId];
		timers[call.nodeId] = {
			nodeId: call.nodeId,
			durationMs: (current?.durationMs ?? 0) + (call.durationMs ?? 0),
			...(current?.durationIncomplete || call.durationMs === undefined
				? { durationIncomplete: true }
				: {}),
			attempts: (current?.attempts ?? 0) + 1,
			status: call.status,
		};
	}
	return timers;
}

export function applyNodeTimerEvent(
	current: NodeTimer | undefined,
	event: Extract<RouteStreamEvent, { type: "node-start" | "timing" }>,
	now: number,
): NodeTimer {
	if (event.type === "node-start")
		return {
			nodeId: event.nodeId,
			...(current?.durationIncomplete ? { durationIncomplete: true } : {}),
			durationMs: current?.durationMs ?? 0,
			attempts: (current?.attempts ?? 0) + 1,
			status: "running",
			startedAt: now,
		};
	return {
		...event.timing,
		...(current?.durationIncomplete ? { durationIncomplete: true } : {}),
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
