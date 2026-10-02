import { useMutation, useQuery } from "convex/react";
import { useMemo } from "react";
import useSWR from "swr";
import type { ChatTurn } from "@/chat/types";
import { settledNodeTimers } from "@/lib/node-timer";
import { artifactTrace } from "@/lib/run-artifact";
import { loadRunArtifact, loadWorkflowJournal } from "@/lib/run-artifact-load";
import { runFooterSchema } from "@/lib/run-footer";
import { journalTrace } from "@/lib/workflow-journal";
import type { Workspace } from "@/storage/workspace-gate";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export function useSavedConversation(
	workspace: Workspace,
	routeKey: string | null,
) {
	const turns = useQuery(api.conversations.turns, {
		conversationId: workspace.conversationId,
	});
	const latest = useQuery(api.runs.latest, {
		conversationId: workspace.conversationId,
	});
	const history = useQuery(api.conversations.list, {
		workspaceId: workspace.id,
	});
	const start = useMutation(api.conversations.start);
	const open = useMutation(api.conversations.open);
	const { data, error } = useSWR(latest?.resultUrl ?? null, loadRunArtifact);
	const { data: checkpoint, error: checkpointError } = useSWR(
		latest?.checkpointUrl ?? null,
		loadWorkflowJournal,
	);
	const trace = useMemo(
		() =>
			latest?.routes === routeKey
				? data
					? artifactTrace(data)
					: checkpoint
						? journalTrace(checkpoint)
						: null
				: null,
		[latest?.routes, routeKey, data, checkpoint],
	);
	const nodeTimings = useMemo(() => settledNodeTimers(trace), [trace]);
	const messages = useMemo(
		() =>
			turns?.map(
				({ footer, ...turn }): ChatTurn => ({
					...turn,
					route: footer ? runFooterSchema.parse(JSON.parse(footer)) : undefined,
				}),
			),
		[turns],
	);
	return {
		messages,
		running: turns?.some((turn) => turn.streaming) ?? false,
		result:
			latest?.routes === routeKey && data?.status === "completed"
				? data.result
				: null,
		trace,
		nodeTimings,
		error:
			error instanceof Error
				? error.message
				: checkpointError instanceof Error
					? checkpointError.message
					: (latest?.error ?? ""),
		resume: latest?.resumable
			? {
					runId: latest.runId,
					requestId: latest.requestId,
					routes: latest.routes,
				}
			: null,
		activeRunId: latest?.status === "running" ? latest.runId : null,
		history: history ?? [],
		start: () => start({ workspaceId: workspace.id }),
		open: (conversationId: Id<"conversations">) =>
			open({ workspaceId: workspace.id, conversationId }),
	};
}
