import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("expire summaries", { hours: 1 }, internal.summaries.expire, {});
export default crons;
