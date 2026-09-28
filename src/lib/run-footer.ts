import type { z } from "zod";
import { type RouteResult, routeResultSchema } from "./routing";

export const runFooterSchema = routeResultSchema.pick({
	outcome: true,
	usage: true,
	calls: true,
	jevSteps: true,
});
export type RunFooter = z.infer<typeof runFooterSchema>;
export function runFooter(route: RouteResult): RunFooter {
	return {
		outcome: route.outcome,
		usage: route.usage,
		calls: route.calls,
		jevSteps: route.jevSteps,
	};
}
