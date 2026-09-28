import { type RouteStreamEvent, routeStreamEventSchema } from "./routing";

export async function readRouteStream(
	response: Response,
	onEvent: (event: RouteStreamEvent) => void,
): Promise<void> {
	if (!response.ok) {
		const body = await response.json().catch(() => null);
		throw new Error(body?.error ?? "The route could not run");
	}
	if (!response.body) throw new Error("The route returned no stream");

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let pending = "";
	let completed = false;

	const processLine = (line: string) => {
		if (!line.trim()) return;
		const event = routeStreamEventSchema.parse(JSON.parse(line));
		if (event.type === "error") throw new Error(event.error);
		if (event.type === "done") completed = true;
		onEvent(event);
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			pending += decoder.decode(value, { stream: true });
			let end = pending.indexOf("\n");
			while (end !== -1) {
				processLine(pending.slice(0, end));
				pending = pending.slice(end + 1);
				end = pending.indexOf("\n");
			}
		}
		pending += decoder.decode();
		if (pending.trim()) processLine(pending);
		if (!completed)
			throw new Error("The response ended before the model finished");
	} finally {
		reader.releaseLock();
	}
}
