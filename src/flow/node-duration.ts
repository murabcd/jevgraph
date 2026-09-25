export function formatNodeDuration(durationMs: number) {
	if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
	return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 2 : 1)} s`;
}
