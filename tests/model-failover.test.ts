import { expect, test } from "bun:test";
import { runWithOneFallback } from "../server/model-failover";
import type { RouteTarget } from "../src/lib/routing";

const primary: RouteTarget = {
	nodeId: "primary",
	provider: "openai",
	model: "gpt-5-mini",
};
const backup: RouteTarget = {
	nodeId: "backup",
	provider: "google",
	model: "gemini-2.5-flash",
};

test("tries the connected backup once when the primary fails before text", async () => {
	const attempts: string[] = [];
	const response = await runWithOneFallback(
		primary,
		backup,
		async (target, onDelta) => {
			attempts.push(target.nodeId);
			if (target.nodeId === "primary") throw new Error("unavailable");
			onDelta("ok");
			return "ok";
		},
		() => {},
		() => {},
	);
	expect(attempts).toEqual(["primary", "backup"]);
	expect(response.target.nodeId).toBe("backup");
});

test("does not retry a model after partial text or a failed backup", async () => {
	let attempts = 0;
	await expect(
		runWithOneFallback(
			primary,
			backup,
			async (_target, onDelta) => {
				attempts++;
				onDelta("partial");
				throw new Error("stream failed");
			},
			() => {},
			() => {},
		),
	).rejects.toThrow("stream failed");
	expect(attempts).toBe(1);
	attempts = 0;
	await expect(
		runWithOneFallback(
			primary,
			backup,
			async () => {
				attempts++;
				throw new Error("unavailable");
			},
			() => {},
			() => {},
		),
	).rejects.toThrow("Both models failed");
	expect(attempts).toBe(2);
});

test("reports the primary provider when no backup is available", async () => {
	await expect(
		runWithOneFallback(
			primary,
			undefined,
			async () => {
				throw new Error("unavailable");
			},
			() => {},
			() => {},
		),
	).rejects.toThrow("openai failed: unavailable");
});

test("does not call the backup after the request is cancelled", async () => {
	const attempts: string[] = [];
	let cancelled = false;
	await expect(
		runWithOneFallback(
			primary,
			backup,
			async (target) => {
				attempts.push(target.nodeId);
				cancelled = true;
				throw new Error("cancelled");
			},
			() => {},
			() => {},
			() => !cancelled,
		),
	).rejects.toThrow("cancelled");
	expect(attempts).toEqual(["primary"]);
});
