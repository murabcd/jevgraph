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
				text: "Bonjour",
				provider: "google",
				model: "gemini-test",
				nodeId: "google",
				reason: "test classifier: choice-1",
				path: [{ nodeId: "input" }, { nodeId: "google" }],
				traversedEdges: [],
				jevSteps: [],
				outputs: [],
				calls: [],
				contexts: [],
				modelPlans: [],
				usage: { complete: false, costComplete: false },
				outcome: "completed",
				latencyMs: 12,
			},
		};
		const payload = `${JSON.stringify({ type: "node-start", nodeId: "google" })}\n${JSON.stringify({ type: "delta", text: "Bon" })}\n${JSON.stringify({ type: "delta", text: "jour" })}\n${JSON.stringify(done)}\n`;
		await readRouteStream(
			responseFromChunks([
				payload.slice(0, 9),
				payload.slice(9, 38),
				payload.slice(38),
			]),
			(event) => received.push(event),
		);
		expect(received).toEqual([
			{ type: "node-start", nodeId: "google" },
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
	test("rejects malformed usage rather than trusting streamed data", async () => {
		await expect(
			readRouteStream(
				responseFromChunks([
					'{"type":"progress","trace":{"path":[],"traversedEdges":[],"jevSteps":[],"outputs":[],"contexts":[],"modelPlans":[],"calls":[{"id":"1","nodeId":"model","purpose":"model","provider":"openai","model":"test","status":"completed","durationMs":1,"usage":{"inputTokens":-1}}]}}\n',
				]),
				() => {},
			),
		).rejects.toThrow();
	});
});
