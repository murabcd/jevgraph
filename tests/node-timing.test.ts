import { expect, test } from "bun:test";
import { measureNode } from "../server/node-timing";
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
	expect(events.map((event) => event.type)).toEqual([
		"node-start",
		"timing",
		"node-start",
		"timing",
	]);
	const settled = events.filter((event) => event.type === "timing");
	expect(settled[0].timing).toMatchObject({
		nodeId: "primary",
		status: "completed",
	});
	expect(settled[1].timing).toMatchObject({
		nodeId: "backup",
		status: "failed",
	});

	expect(
		events.every(
			(event) => event.type !== "timing" || event.timing.durationMs >= 0,
		),
	).toBe(true);
});

test("announces a running node before its pending operation finishes", async () => {
	const events: RouteStreamEvent[] = [];
	const operation = Promise.withResolvers<string>();
	const run = measureNode(
		"slow",
		() => operation.promise,
		(event) => events.push(event),
	);
	expect(events).toEqual([{ type: "node-start", nodeId: "slow" }]);
	operation.resolve("finished");
	expect(await run).toBe("finished");
	expect(events[1]).toMatchObject({
		type: "timing",
		timing: { nodeId: "slow", status: "completed" },
	});
});
