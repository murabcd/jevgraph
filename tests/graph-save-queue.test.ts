import { expect, test } from "bun:test";
import { GraphSaveQueue } from "../src/storage/graph-save-queue";

test("graph saves coalesce, serialize revisions, and ignore their own realtime echoes", async () => {
	const calls: { graph: string; revision: number }[] = [];
	let release: (revision: number) => void = () => {};
	const queue = new GraphSaveQueue(0, "initial", async (graph, revision) => {
		calls.push({ graph, revision });
		if (calls.length === 1)
			return new Promise((resolve) => {
				release = resolve;
			});
		return revision + 1;
	});
	queue.enqueue("first");
	const flushing = queue.flush();
	queue.enqueue("middle");
	queue.enqueue("last");
	queue.observe(1, "first");
	release(1);
	await flushing;
	expect(calls).toEqual([
		{ graph: "first", revision: 0 },
		{ graph: "last", revision: 1 },
	]);
	expect(queue.busy).toBe(false);
	expect(queue.getSnapshot().remote).toEqual({ graph: "initial", revision: 0 });
	queue.observe(2, "last");
	queue.enqueue("last");
	await queue.flush();
	expect(calls).toHaveLength(2);
	queue.observe(3, "remote");
	expect(queue.getSnapshot().remote).toEqual({ graph: "remote", revision: 3 });
});

test("a remote update received during flush is applied after acknowledgement", async () => {
	let release: (revision: number) => void = () => {};
	const queue = new GraphSaveQueue(
		0,
		"initial",
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	queue.enqueue("local");
	const flushing = queue.flush();
	queue.observe(2, "remote");
	release(1);
	await flushing;
	expect(queue.getSnapshot().remote).toEqual({ graph: "remote", revision: 2 });
});

test("a save conflict freezes the queue instead of silently overwriting another tab", async () => {
	let writes = 0;
	const queue = new GraphSaveQueue(0, "initial", async () => {
		writes++;
		throw new Error("Reload latest graph");
	});
	queue.enqueue("local");
	await expect(queue.flush()).rejects.toThrow("Reload latest graph");
	queue.observe(1, "remote");
	queue.enqueue("overwrite");
	await expect(queue.flush()).rejects.toThrow("Reload latest graph");
	expect(writes).toBe(1);
	expect(queue.getSnapshot().error).toBe("Reload latest graph");
});
