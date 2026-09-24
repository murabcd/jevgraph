import { describe, expect, test } from "bun:test";
import { readRouteStream } from "../src/lib/route-stream";
import type { RouteStreamEvent } from "../src/lib/routing";

function responseFromChunks(chunks: string[]) {
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
				controller.close();
			},
		}),
	);
}

describe("route stream", () => {
	test("delivers events across chunk boundaries without losing text", async () => {
		const received: RouteStreamEvent[] = [];
		const done: RouteStreamEvent = {
			type: "done",
			route: {
				mode: "jev",
				text: "Bonjour",
				provider: "google",
				model: "gemini-test",
				initialProvider: "google",
				nodeId: "google",
				initialNodeId: "google",
				branch: "fast",
				finalBranch: "fast",
				reason: "Fast task",
				latencyMs: 12,
			},
		};
		const payload = `${JSON.stringify({ type: "delta", text: "Bon" })}\n${JSON.stringify({ type: "delta", text: "jour" })}\n${JSON.stringify(done)}\n`;
		await readRouteStream(
			responseFromChunks([
				payload.slice(0, 9),
				payload.slice(9, 38),
				payload.slice(38),
			]),
			(event) => received.push(event),
		);
		expect(received).toEqual([
			{ type: "delta", text: "Bon" },
			{ type: "delta", text: "jour" },
			done,
		]);
	});

	test("reports an incomplete response", async () => {
		await expect(
			readRouteStream(
				responseFromChunks(['{"type":"delta","text":"partial"}\n']),
				() => {},
			),
		).rejects.toThrow("ended before");
	});
});
