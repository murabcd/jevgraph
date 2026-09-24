import type { Viewport } from "@xyflow/react";
import { z } from "zod";

const storageKey = "router:canvas-viewport:v1";

export const minCanvasZoom = 0.4;
export const maxCanvasZoom = 1.5;

const viewportSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	zoom: z.number().min(minCanvasZoom).max(maxCanvasZoom),
});

export function readCanvasViewport(): Viewport | null {
	try {
		const parsed = viewportSchema.safeParse(
			JSON.parse(localStorage.getItem(storageKey) ?? "null"),
		);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function saveCanvasViewport(viewport: Viewport) {
	try {
		localStorage.setItem(storageKey, JSON.stringify(viewport));
	} catch {
		// Storage can be unavailable; canvas interaction should still work.
	}
}
