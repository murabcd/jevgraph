import { useAuthToken } from "@convex-dev/auth/react";
import { useCallback, useMemo, useState } from "react";
import type { ChatTurn } from "@/chat/types";
import { useSavedConversation } from "@/chat/use-saved-conversation";
import {
	applyNodeTimerEvent,
	interruptNodeTimers,
	type NodeTimer,
} from "@/lib/node-timer";
import { readRouteStream } from "@/lib/route-stream";
import type {
	ChatMessage,
	RouteResult,
	RouteStreamEvent,
	RouteTrace,
	WorkflowRoutes,
} from "@/lib/routing";
import type { Workspace } from "@/storage/workspace-gate";
import type { Id } from "../../convex/_generated/dataModel";

const EMPTY_TURNS: ChatTurn[] = [];

export function useRouteChat(
	routes: WorkflowRoutes | null,
	onRequestStarted: () => void,
	workspace: Workspace,
	flushGraph: () => Promise<void>,
) {
	const token = useAuthToken();
	const [draft, setDraft] = useState("");
	const [liveMessages, setMessages] = useState<ChatTurn[]>([]);
	const [result, setResult] = useState<RouteResult | null>(null);
	const [trace, setTrace] = useState<RouteTrace | null>(null);
	const [resultRouteKey, setResultRouteKey] = useState<string | null>(null);
	const [nodeTimings, setNodeTimings] = useState<Record<string, NodeTimer>>({});
	const [error, setError] = useState("");
	const [running, setRunning] = useState(false);
	const routeKey = useMemo(
		() => (routes ? JSON.stringify(routes) : null),
		[routes],
	);
	const saved = useSavedConversation(workspace, routeKey);
	const remoteRunning = saved.running;
	const [liveConversationId, setLiveConversationId] = useState(
		workspace.conversationId,
	);
	const messages: ChatTurn[] = running
		? liveMessages
		: (saved.messages ??
			(liveConversationId === workspace.conversationId
				? liveMessages
				: EMPTY_TURNS));

	const run = useCallback(async () => {
		const question = draft.trim();
		if (!question || running || remoteRunning) return;
		if (!routes) {
			setError("Finish configuring the chatflow before sending a message.");
			return;
		}
		const history: ChatMessage[] = [
			...messages
				.filter((message) => !message.failed && message.content.trim())
				.slice(-28)
				.map(({ role, content }) => ({ role, content })),
			{ role: "user", content: question },
		];
		const requestId = crypto.randomUUID();
		const assistantId = `${requestId}:assistant`;
		setMessages([
			...messages,
			{ id: `${requestId}:user`, role: "user", content: question },
			{
				id: assistantId,
				role: "assistant",
				content: "",
				streaming: true,
			},
		]);
		setDraft("");
		setRunning(true);
		setError("");
		setResult(null);
		setTrace(null);
		setNodeTimings({});
		setResultRouteKey(routeKey);
		setLiveConversationId(workspace.conversationId);
		onRequestStarted();
		try {
			await flushGraph();
			if (!token) throw new Error("Your session is not connected");
			const response = await fetch("/api/route", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					conversationId: workspace.conversationId,
					requestId,
					messages: history,
					routes,
				}),
			});
			await readRouteStream(response, (event: RouteStreamEvent) => {
				if (event.type === "progress") setTrace(event.trace);
				if (event.type === "node-start" || event.type === "timing") {
					const nodeId =
						event.type === "node-start" ? event.nodeId : event.timing.nodeId;
					const receivedAt = performance.now();
					setNodeTimings((current) => ({
						...current,
						[nodeId]: applyNodeTimerEvent(current[nodeId], event, receivedAt),
					}));
				}
				if (event.type === "route") {
					const preview: RouteResult = {
						...event.route,
						usage: { complete: false, costComplete: false },
						outcome: "completed",
						text: "",
						latencyMs: 0,
					};
					setResult(preview);
					setTrace(event.route);
					setMessages((previous) =>
						previous.map((message) =>
							message.id === assistantId
								? { ...message, route: preview }
								: message,
						),
					);
				}
				if (event.type === "delta") {
					setMessages((previous) =>
						previous.map((message) =>
							message.id === assistantId
								? { ...message, content: message.content + event.text }
								: message,
						),
					);
				}
				if (event.type === "done") {
					setResult(event.route);
					setTrace(event.route);
					setMessages((previous) =>
						previous.map((message) =>
							message.id === assistantId
								? {
										...message,
										content: event.route.text,
										route: event.route,
										streaming: false,
									}
								: message,
						),
					);
				}
			});
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "The route could not run",
			);
			setMessages((previous) =>
				previous.flatMap((message) =>
					message.id !== assistantId
						? [message]
						: message.content
							? [{ ...message, streaming: false, failed: true }]
							: [],
				),
			);
		} finally {
			const stoppedAt = performance.now();
			setNodeTimings((current) => interruptNodeTimers(current, stoppedAt));
			setRunning(false);
		}
	}, [
		draft,
		messages,
		routes,
		routeKey,
		running,
		remoteRunning,
		onRequestStarted,
		token,
		workspace.conversationId,
		flushGraph,
	]);

	const resetChat = () => {
		setMessages([]);
		setResult(null);
		setTrace(null);
		setNodeTimings({});
		setResultRouteKey(null);
		setError("");
		setDraft("");
	};
	const changeConversation = async (conversationId?: Id<"conversations">) => {
		if (running || remoteRunning) return;
		try {
			if (conversationId) await saved.open(conversationId);
			else await saved.start();
			resetChat();
		} catch (caught) {
			setError(
				caught instanceof Error
					? caught.message
					: "Could not open the conversation",
			);
		}
	};

	const clearResultForNode = (nodeId: string) => {
		setNodeTimings((current) => {
			const next = { ...current };
			delete next[nodeId];
			return next;
		});
		setResult((current) =>
			current?.path.some((step) => step.nodeId === nodeId) ? null : current,
		);
		setTrace((current) =>
			current?.path.some((step) => step.nodeId === nodeId) ? null : current,
		);
	};

	const hasLiveResult =
		routeKey === resultRouteKey &&
		liveConversationId === workspace.conversationId;
	return {
		draft,
		setDraft,
		messages,
		result: hasLiveResult ? result : saved.result,
		trace: hasLiveResult ? trace : saved.trace,
		nodeTimings: hasLiveResult ? nodeTimings : {},
		error:
			(liveConversationId === workspace.conversationId ? error : "") ||
			saved.error,
		running: running || remoteRunning,
		run,
		clearChat: () => changeConversation(),
		openConversation: (id: Id<"conversations">) => changeConversation(id),
		history: saved.history,
		clearResultForNode,
	};
}
