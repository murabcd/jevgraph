import type { RouteTarget } from "../src/lib/routing.ts";

export async function runWithOneFallback<T>(
	primary: RouteTarget,
	fallback: RouteTarget | undefined,
	run: (target: RouteTarget, onDelta: (text: string) => void) => Promise<T>,
	onDelta: (text: string) => void,
	onFallback: (reason: string) => void,
	shouldRetry: () => boolean = () => true,
): Promise<{ response: T; target: RouteTarget }> {
	let streamed = false;
	try {
		const response = await run(primary, (text) => {
			streamed = true;
			onDelta(text);
		});
		return { response, target: primary };
	} catch (error) {
		const primaryError =
			error instanceof Error ? error.message : "Unknown model error";
		if (!fallback || streamed || !shouldRetry())
			throw new Error(
				`${primary.routing ? "Automatic model" : primary.provider} failed: ${primaryError}`,
				{
					cause: error,
				},
			);
		onFallback(
			`${primary.routing ? "Automatic model" : primary.provider} failed: ${primaryError}`,
		);
		try {
			const response = await run(fallback, onDelta);
			return { response, target: fallback };
		} catch (fallbackError) {
			const secondary =
				fallbackError instanceof Error
					? fallbackError.message
					: "Unknown model error";
			throw new Error(
				`Both models failed. ${primary.routing ? "Automatic model" : primary.model}: ${primaryError}. ${fallback.routing ? "Automatic model" : fallback.model}: ${secondary}`,
				{ cause: fallbackError },
			);
		}
	}
}
