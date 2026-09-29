import { expect, test } from "bun:test";
import { ProviderEvidence } from "../server/provider-evidence";
import {
	evidenceCoverage,
	MAX_PROVIDER_EVIDENCE_BYTES,
} from "../src/lib/provider-evidence";

test("provider capture correlates concurrent requests and excludes credentials from stored evidence", async () => {
	const recorder = new ProviderEvidence(["private-key"]);
	const transport = recorder.fetch(async (_url, init) => {
		await Bun.sleep(String(init?.body).includes("first") ? 5 : 1);
		return Response.json(
			{ echoed: String(init?.body), warning: "private-key" },
			{ headers: { "X-Private": "private-key" } },
		);
	});
	await Promise.all(
		["first", "second"].map((callId) =>
			recorder.run(callId, async () => {
				const response = await transport(
					"https://provider.example/generate?key=private-key",
					{
						method: "POST",
						headers: { Authorization: "Bearer private-key" },
						body: JSON.stringify({ task: callId }),
					},
				);
				await response.text();
			}),
		),
	);
	const captured = recorder.snapshot();
	expect(captured.map((entry) => entry.callId)).toEqual(["first", "second"]);
	expect(
		captured.every(
			(entry) => JSON.parse(entry.response.text).echoed === entry.request.text,
		),
	).toBe(true);
	expect(
		captured.every(
			(entry) => entry.endpoint === "https://provider.example/generate",
		),
	).toBe(true);
	expect(JSON.stringify(captured)).not.toContain("private-key");
	expect(evidenceCoverage(captured, ["first", "second"])).toBe("partial");
	await expect(transport("https://provider.example")).rejects.toThrow(
		"no ledger call identity",
	);
});

test("capture bounds retained JSON bytes while preserving the provider response and Unicode", async () => {
	const recorder = new ProviderEvidence();
	const text = '😀\\"\n'.repeat(250000);
	const transport = recorder.fetch(async () => new Response(text));
	const actual = await recorder.run("large", async () =>
		(
			await transport("https://provider.example", {
				method: "POST",
				body: "{}",
			})
		).text(),
	);
	expect(actual).toBe(text);
	const [captured] = recorder.snapshot();
	expect(captured.response.complete).toBe(false);
	expect(captured.response.text.isWellFormed()).toBe(true);
	expect(
		new TextEncoder().encode(
			JSON.stringify(captured.request.text) +
				JSON.stringify(captured.response.text),
		).length,
	).toBeLessThanOrEqual(MAX_PROVIDER_EVIDENCE_BYTES + 4);
	expect(evidenceCoverage([captured], ["large"])).toBe("partial");
});

test("cancelled provider streams retain consumed output and cancel their source", async () => {
	const recorder = new ProviderEvidence();
	let cancelled = false;
	const transport = recorder.fetch(
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("Partial output"));
					},
					cancel() {
						cancelled = true;
					},
				}),
			),
	);
	await recorder.run("cancel", async () => {
		const response = await transport("https://provider.example");
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Stream missing");
		await reader.read();
		await reader.cancel();
	});
	expect(cancelled).toBe(true);
	expect(recorder.snapshot()[0]).toMatchObject({
		state: "interrupted",
		response: { text: "Partial output", complete: false },
	});
	expect(evidenceCoverage(recorder.snapshot(), ["cancel"])).toBe("partial");
});

test("raw byte counts survive split Unicode and malformed UTF-8 without claiming complete evidence", async () => {
	const recorder = new ProviderEvidence();
	const chunks = [
		new Uint8Array([0xf0, 0x9f]),
		new Uint8Array([0x98, 0x80, 0xff]),
	];
	const transport = recorder.fetch(
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						for (const chunk of chunks) controller.enqueue(chunk);
						controller.close();
					},
				}),
			),
	);
	const bytes = await recorder.run(
		"invalid",
		async () =>
			new Uint8Array(
				await (
					await transport("https://fixture.example", {
						method: "POST",
						body: new Uint8Array([0xff]),
					})
				).arrayBuffer(),
			),
	);
	expect([...bytes]).toEqual([0xf0, 0x9f, 0x98, 0x80, 0xff]);
	expect(recorder.snapshot()[0]).toMatchObject({
		request: { bytes: 1, complete: false },
		response: { bytes: 5, complete: false },
		state: "completed",
	});
	expect(evidenceCoverage(recorder.snapshot(), ["invalid"])).toBe("partial");
	const valid = new ProviderEvidence();
	const validFetch = valid.fetch(
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array([0xef, 0xbb, 0xbf]));
						controller.enqueue(chunks[0]);
						controller.enqueue(new Uint8Array([0x98, 0x80]));
						controller.close();
					},
				}),
			),
	);
	await valid.run("unicode", async () =>
		(await validFetch("https://fixture.example")).text(),
	);
	expect(valid.snapshot()[0].response).toEqual({
		text: "\ufeff😀",
		bytes: 7,
		complete: true,
	});
});

test("stream redaction protects every credential split and preserves ordinary text", () => {
	const credential = "private-key-echo";
	const recorder = new ProviderEvidence([credential]);
	for (let split = 1; split < credential.length; split++) {
		const stream = recorder.streamRedactor();
		expect(
			stream.write(`Before ${credential.slice(0, split)}`) +
				stream.write(`${credential.slice(split)} after`) +
				stream.finish(),
		).toBe("Before * after");
	}
	const stream = recorder.streamRedactor();
	expect(stream.write("Plain p") + stream.write("rose") + stream.finish()).toBe(
		"Plain prose",
	);
});
