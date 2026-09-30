import { expect, test } from "bun:test";
import {
	applyNodeTimerEvent,
	interruptNodeTimers,
	nodeTimerDuration,
	settledNodeTimers,
} from "../src/lib/node-timer";
import { routeTraceSchema } from "../src/lib/routing";
import { emptyRouteTrace } from "../src/lib/run-artifact";
import type { ProviderCall } from "../src/lib/usage";

test("settled clocks restore preparation, repeated generation and failed backups from saved evidence", () => {
	const call = (
		nodeId: string,
		purpose: ProviderCall["purpose"],
		durationMs: number,
		status: ProviderCall["status"] = "completed",
	): ProviderCall => ({
		id: crypto.randomUUID(),
		nodeId,
		purpose,
		durationMs,
		status,
		provider: "openai",
		model: "gpt-6-luna",
	});
	const trace = {
		...emptyRouteTrace(),
		path: [{ nodeId: "input" }, { nodeId: "primary" }, { nodeId: "backup" }],
		calls: [
			call("primary", "embedding", 50),
			call("primary", "model", 900),
			call("primary", "model", 300, "failed"),
			call("backup", "model", 600, "failed"),
		],
	};
	const restored = settledNodeTimers(
		routeTraceSchema.parse(JSON.parse(JSON.stringify(trace))),
	);
	expect(restored).toEqual({
		input: { nodeId: "input", durationMs: 0, attempts: 1, status: "completed" },
		primary: {
			nodeId: "primary",
			durationMs: 1250,
			attempts: 3,
			status: "failed",
		},
		backup: {
			nodeId: "backup",
			durationMs: 600,
			attempts: 1,
			status: "failed",
		},
	});
	expect(nodeTimerDuration(restored.primary, 100000)).toBe(1250);
	expect(restored.unreached).toBeUndefined();
	expect(settledNodeTimers(null)).toEqual({});
	expect(settledNodeTimers(emptyRouteTrace())).toEqual({});
});

test("live time settles to server time without double-counting repeat attempts", () => {
	const start = { type: "node-start", nodeId: "model" } as const;
	const first = applyNodeTimerEvent(undefined, start, 100);
	expect(first).toMatchObject({
		status: "running",
		attempts: 1,
		durationMs: 0,
	});
	expect(nodeTimerDuration(first, 100)).toBe(0);
	expect(nodeTimerDuration(first, 600)).toBe(500);
	const settled = applyNodeTimerEvent(
		first,
		{
			type: "timing",
			timing: { nodeId: "model", status: "completed", durationMs: 900 },
		},
		1100,
	);
	expect(nodeTimerDuration(settled, 1500)).toBe(900);
	expect(settled.attempts).toBe(1);
	const repeat = applyNodeTimerEvent(settled, start, 2000);
	expect(nodeTimerDuration(repeat, 2500)).toBe(1400);
	const finished = applyNodeTimerEvent(
		repeat,
		{
			type: "timing",
			timing: { nodeId: "model", status: "failed", durationMs: 600 },
		},
		2600,
	);
	expect(finished).toMatchObject({
		status: "failed",
		durationMs: 1500,
		attempts: 2,
	});
	expect(nodeTimerDuration(finished, 5000)).toBe(1500);
});

test("parallel clocks run independently and unfinished streams freeze as interrupted", () => {
	const a = applyNodeTimerEvent(
		undefined,
		{ type: "node-start", nodeId: "a" },
		100,
	);
	const b = applyNodeTimerEvent(
		undefined,
		{ type: "node-start", nodeId: "b" },
		200,
	);
	expect(nodeTimerDuration(a, 300)).toBe(200);
	expect(nodeTimerDuration(b, 300)).toBe(100);
	const settledA = applyNodeTimerEvent(
		a,
		{
			type: "timing",
			timing: { nodeId: "a", status: "completed", durationMs: 180 },
		},
		300,
	);
	const stopped = interruptNodeTimers({ a: settledA, b }, 400);
	expect(stopped.a).toBe(settledA);
	expect(stopped.b).toMatchObject({ status: "interrupted", durationMs: 200 });
	expect(nodeTimerDuration(stopped.b, 1000)).toBe(200);
	const fresh = applyNodeTimerEvent(
		undefined,
		{ type: "node-start", nodeId: "b" },
		2000,
	);
	expect(nodeTimerDuration(fresh, 2000)).toBe(0);
	expect(fresh.attempts).toBe(1);
});

test("local Start settles immediately and cached-clock regressions cannot make time negative", () => {
	const input = applyNodeTimerEvent(
		undefined,
		{
			type: "timing",
			timing: { nodeId: "input", status: "completed", durationMs: 0 },
		},
		100,
	);
	expect(input).toMatchObject({
		durationMs: 0,
		status: "completed",
		attempts: 1,
	});
	const running = applyNodeTimerEvent(
		undefined,
		{ type: "node-start", nodeId: "model" },
		100,
	);
	expect(nodeTimerDuration(running, 50)).toBe(0);
});
