import { useAuthToken } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatTurn } from "@/chat/types";
import { useSavedConversation } from "@/chat/use-saved-conversation";
import {
	applyNodeTimerEvent,
	interruptNodeTimers,
	type NodeTimer,
	settledNodeTimers,
} from "@/lib/node-timer";
import { readRouteStream } from "@/lib/route-stream";
import type {
	ChatMessage,
	RouteRequest,
	RouteResult,
	RouteStreamEvent,
	RouteTrace,
	WorkflowRoutes,
} from "@/lib/routing";
import type { ResumeRequest } from "@/lib/workflow-journal";
import type { Workspace } from "@/storage/workspace-gate";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const EMPTY_TURNS: ChatTurn[] = [];

export function useRouteChat(
	routes: WorkflowRoutes | null,
	onRequestStarted: () => void,
	workspace: Workspace,
	flushGraph: () => Promise<void>,
) {
	const token = useAuthToken();
	const cancelRun = useMutation(api.checkpoints.stop);
	const abortRef = useRef<AbortController | null>(null);
	const [runId, setRunId] = useState<string | null>(null);
	useEffect(() => () => abortRef.current?.abort(), []);
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

	const execute = useCallback(
		async ({
			endpoint,
			payload,
			assistantId,
			nextMessages,
			capturedKey,
		}: {
			endpoint: "/api/route" | "/api/resume";
			payload: RouteRequest | ResumeRequest;
			assistantId: string;
			nextMessages: ChatTurn[];
			capturedKey: string | null;
		}) => {
			if (abortRef.current) return;
			const abort = new AbortController();
			abortRef.current = abort;
			setMessages(nextMessages);
			setRunning(true);
			setError("");
			setResult(null);
			setTrace(null);
			setNodeTimings({});
			setResultRouteKey(capturedKey);
			setLiveConversationId(workspace.conversationId);
			onRequestStarted();
			try {
				await flushGraph();
				if (!token) throw new Error("Your session is not connected");
				const response = await fetch(endpoint, {
					signal: abort.signal,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify(payload),
				});
				setRunId(response.headers.get("X-Run-Id"));
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
						setNodeTimings(settledNodeTimers(event.route));
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
				setRunId(null);
				abortRef.current = null;
			}
		},
		[onRequestStarted, token, workspace.conversationId, flushGraph],
	);
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
		setDraft("");
		await execute({
			endpoint: "/api/route",
			payload: {
				conversationId: workspace.conversationId,
				requestId,
				messages: history,
				routes,
			},
			assistantId,
			nextMessages: [
				...messages,
				{ id: `${requestId}:user`, role: "user", content: question },
				{ id: assistantId, role: "assistant", content: "", streaming: true },
			],
			capturedKey: routeKey,
		});
	}, [
		draft,
		running,
		remoteRunning,
		routes,
		messages,
		workspace.conversationId,
		execute,
		routeKey,
	]);
	const resume = async () => {
		if (running || remoteRunning || !saved.resume) return;
		const assistantId = `${saved.resume.requestId}:assistant`;
		await execute({
			endpoint: "/api/resume",
			payload: { runId: saved.resume.runId },
			assistantId,
			nextMessages: messages.map((message) =>
				message.id === assistantId
					? {
							...message,
							content: "",
							failed: false,
							streaming: true,
							route: undefined,
						}
					: message,
			),
			capturedKey: saved.resume.routes,
		});
	};
	const stop = async () => {
		const currentId = runId ?? saved.activeRunId;
		if (!currentId) return;
		try {
			await cancelRun({ runId: currentId });
			abortRef.current?.abort();
		} catch (caught) {
			setError(
				caught instanceof Error
					? caught.message
					: "Could not stop the response",
			);
		}
	};

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
		nodeTimings: hasLiveResult ? nodeTimings : saved.nodeTimings,
		error:
			(liveConversationId === workspace.conversationId ? error : "") ||
			saved.error,
		running: running || remoteRunning,
		run,
		resume,
		canResume: !!saved.resume && !running && !remoteRunning,
		stop,
		canStop: !!(runId ?? saved.activeRunId),
		clearChat: () => changeConversation(),
		openConversation: (id: Id<"conversations">) => changeConversation(id),
		history: saved.history,
		clearResultForNode,
	};
}
