import { MAX_ARTIFACT_BYTES, runArtifactSchema } from "./run-artifact.ts";

export async function loadRunArtifact(
	url: string,
	transport: typeof fetch = globalThis.fetch,
) {
	const response = await transport(url, { signal: AbortSignal.timeout(30000) });
	if (!response.ok || !response.body)
		throw new Error("Could not load recorded run evidence");
	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let text = "",
		bytes = 0;
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			bytes += part.value.byteLength;
			if (bytes > MAX_ARTIFACT_BYTES)
				throw new Error("Recorded evidence exceeds eight million bytes");
			text += decoder.decode(part.value, { stream: true });
		}
		text += decoder.decode();
		return runArtifactSchema.parse(JSON.parse(text));
	} finally {
		try {
			await reader.cancel();
		} finally {
			reader.releaseLock();
		}
	}
}
