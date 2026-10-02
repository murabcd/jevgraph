import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = {
	"./_generated/server.js": () => import("../convex/_generated/server.js"),
	"./workspaces.ts": () => import("../convex/workspaces"),
	"./conversations.ts": () => import("../convex/conversations"),
	"./runs.ts": () => import("../convex/runs"),
	"./checkpoints.ts": () => import("../convex/checkpoints"),
	"./results.ts": () => import("../convex/results"),
	"./summaries.ts": () => import("../convex/summaries"),
	"./retrieval.ts": () => import("../convex/retrieval"),
	"./routeEvaluations.ts": () => import("../convex/routeEvaluations"),
};

export async function createConvexFixture(
	t = convexTest({ schema, modules, transactionLimits: true }),
) {
	const userId = await t.run((ctx) =>
		ctx.db.insert("users", { isAnonymous: true }),
	);
	const owner = t.withIdentity({ subject: `${userId}|session` });
	const id = await owner.mutation(api.workspaces.initialize, {});
	const workspace = await owner.query(api.workspaces.current, {});
	if (!workspace) throw new Error("Workspace missing");
	return { t, owner, id, workspace };
}
