import { useMutation, useQuery } from "convex/react";
import { useMemo } from "react";
import useSWR from "swr";
import type { ChatTurn } from "@/chat/types";
import { artifactTrace } from "@/lib/run-artifact";
import { runFooterSchema } from "@/lib/run-footer";
import { loadRunArtifact } from "@/storage/run-artifact";
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
		trace: latest?.routes === routeKey && data ? artifactTrace(data) : null,
		error: error instanceof Error ? error.message : (latest?.error ?? ""),
		history: history ?? [],
		start: () => start({ workspaceId: workspace.id }),
		open: (conversationId: Id<"conversations">) =>
			open({ workspaceId: workspace.id, conversationId }),
	};
}
