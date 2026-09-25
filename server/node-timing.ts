import type { RouteStreamEvent } from "../src/lib/routing.ts";

type Emit = (event: RouteStreamEvent) => void;

export function emitSystemTiming(
	systemNodeId: "input" | undefined,
	emit: Emit,
) {
	if (!systemNodeId) return;
	// System instructions are static configuration; they have no remote execution.
	emit({
		type: "timing",
		timing: { nodeId: systemNodeId, durationMs: 0, status: "completed" },
	});
}

export async function measureNode<T>(
	nodeId: string,
	run: () => Promise<T>,
	emit: Emit,
): Promise<T> {
	const start = performance.now();
	try {
		const result = await run();
		emit({
			type: "timing",
			timing: {
				nodeId,
				durationMs: Math.max(0, Math.round(performance.now() - start)),
				status: "completed",
			},
		});
		return result;
	} catch (error) {
		emit({
			type: "timing",
			timing: {
				nodeId,
				durationMs: Math.max(0, Math.round(performance.now() - start)),
				status: "failed",
			},
		});
		throw error;
	}
}
