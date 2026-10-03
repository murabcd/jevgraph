import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import * as serverFunctions from "../convex/_generated/server.js";
import * as checkpoints from "../convex/checkpoints";
import * as conversations from "../convex/conversations";
import * as results from "../convex/results";
import * as retrieval from "../convex/retrieval";
import * as routeEvaluations from "../convex/routeEvaluations";
import * as runs from "../convex/runs";
import schema from "../convex/schema";
import * as summaries from "../convex/summaries";
import * as workspaces from "../convex/workspaces";

const modules = {
	"./_generated/server.js": async () => serverFunctions,
	"./workspaces.ts": async () => workspaces,
	"./conversations.ts": async () => conversations,
	"./runs.ts": async () => runs,
	"./checkpoints.ts": async () => checkpoints,
	"./results.ts": async () => results,
	"./summaries.ts": async () => summaries,
	"./retrieval.ts": async () => retrieval,
	"./routeEvaluations.ts": async () => routeEvaluations,
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
