import type { RouteStreamEvent } from "../src/lib/routing.ts";

type Emit = (event: RouteStreamEvent) => void;

export function emitStartTiming(emit: Emit) {
	// Start resolves local inputs; it has no remote execution.
	emit({
		type: "timing",
		timing: { nodeId: "input", durationMs: 0, status: "completed" },
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
