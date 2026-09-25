import { expect, test } from "bun:test";
import { measureNode } from "../server/node-timing";
import { formatNodeDuration } from "../src/flow/node-duration";
import type { RouteStreamEvent } from "../src/lib/routing";

test("reports completed and failed node attempts without replacing their errors", async () => {
	const events: RouteStreamEvent[] = [];
	const emit = (event: RouteStreamEvent) => events.push(event);
	expect(await measureNode("primary", async () => "ok", emit)).toBe("ok");
	await expect(
		measureNode(
			"backup",
			async () => {
				throw new Error("model unavailable");
			},
			emit,
		),
	).rejects.toThrow("model unavailable");
	expect(events.map((event) => event.type)).toEqual(["timing", "timing"]);
	if (events[0]?.type !== "timing" || events[1]?.type !== "timing")
		throw new Error("Expected timing events");
	expect(events[0].timing).toMatchObject({
		nodeId: "primary",
		status: "completed",
	});
	expect(events[1].timing).toMatchObject({
		nodeId: "backup",
		status: "failed",
	});
	expect(
		events.every(
			(event) => event.type !== "timing" || event.timing.durationMs >= 0,
		),
	).toBe(true);
});

test("shows milliseconds, then seconds", () => {
	expect(formatNodeDuration(45)).toBe("45 ms");
	expect(formatNodeDuration(999)).toBe("999 ms");
	expect(formatNodeDuration(1234)).toBe("1.23 s");
});
