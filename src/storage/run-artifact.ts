import { runArtifactSchema } from "@/lib/run-artifact";

export async function loadRunArtifact(url: string) {
	const response = await fetch(url);
	if (!response.ok) throw new Error("Could not load recorded run evidence");
	return runArtifactSchema.parse(await response.json());
}
