import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval(
	"expire route evaluations",
	{ hours: 1 },
	internal.routeEvaluations.expire,
	{},
);
crons.interval("expire summaries", { hours: 1 }, internal.summaries.expire, {});
crons.interval(
	"expire retrieval sources",
	{ hours: 1 },
	internal.retrieval.expire,
	{},
);
export default crons;
