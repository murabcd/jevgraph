import {
	artifactTrace,
	MAX_ARTIFACT_BYTES,
	type RunArtifact,
} from "../src/lib/run-artifact.ts";

/** Retains ordinary full traces and explicitly marks exceptional size loss. */
export function serializeRunArtifact(artifact: RunArtifact): string {
	const serialized = JSON.stringify(artifact);
	if (new TextEncoder().encode(serialized).length <= MAX_ARTIFACT_BYTES)
		return serialized;
	const trace = artifactTrace(artifact);
	const reduced = {
		...trace,
		outputs: trace.outputs.map((output) => ({
			...output,
			text: output.text.slice(0, 4000),
		})),
		contexts: [],
	};
	const bounded: RunArtifact =
		artifact.status === "completed"
			? {
					...artifact,
					coverage: "partial",
					result: { ...artifact.result, ...reduced },
				}
			: { ...artifact, coverage: "partial", trace: reduced };
	const result = JSON.stringify(bounded);
	if (new TextEncoder().encode(result).length > MAX_ARTIFACT_BYTES)
		throw new Error(
			"Run evidence exceeds the artifact budget even without full output and context details",
		);
	return result;
}
