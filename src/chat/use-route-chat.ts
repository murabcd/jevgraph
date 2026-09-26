import { useCallback, useMemo, useState } from "react";
import type { ChatTurn } from "@/chat/types";
import { readRouteStream } from "@/lib/route-stream";
import type {
	ChatMessage,
	NodeTiming,
	RouteResult,
	RouteStreamEvent,
	RouteTrace,
	WorkflowRoutes,
} from "@/lib/routing";

export function useRouteChat(
	routes: WorkflowRoutes | null,
	onRequestStarted: () => void,
) {
	const [draft, setDraft] = useState("");
	const [messages, setMessages] = useState<ChatTurn[]>([]);
	const [result, setResult] = useState<RouteResult | null>(null);
	const [trace, setTrace] = useState<RouteTrace | null>(null);
	const [resultRouteKey, setResultRouteKey] = useState<string | null>(null);
	const [nodeTimings, setNodeTimings] = useState<Record<string, NodeTiming>>(
		{},
	);
	const [error, setError] = useState("");
	const [running, setRunning] = useState(false);
	const routeKey = useMemo(
		() => (routes ? JSON.stringify(routes) : null),
		[routes],
	);

	const run = useCallback(async () => {
		const question = draft.trim();
		if (!question || running) return;
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
		const assistantId = crypto.randomUUID();
		setMessages((previous) => [
			...previous,
			{ id: crypto.randomUUID(), role: "user", content: question },
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
		onRequestStarted();
		try {
			const response = await fetch("/api/route", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					messages: history,
					routes,
				}),
			});
			await readRouteStream(response, (event: RouteStreamEvent) => {
				if (event.type === "progress") setTrace(event.trace);
				if (event.type === "timing") {
					setNodeTimings((current) => ({
						...current,
						[event.timing.nodeId]: current[event.timing.nodeId]
							? {
									...event.timing,
									durationMs:
										current[event.timing.nodeId].durationMs +
										event.timing.durationMs,
									attempts: (current[event.timing.nodeId].attempts ?? 1) + 1,
								}
							: event.timing,
					}));
				}
				if (event.type === "route") {
					const preview: RouteResult = {
						...event.route,
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
			setRunning(false);
		}
	}, [draft, messages, routes, routeKey, running, onRequestStarted]);

	const clearChat = () => {
		setMessages([]);
		setResult(null);
		setTrace(null);
		setNodeTimings({});
		setResultRouteKey(null);
		setError("");
		setDraft("");
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

	return {
		draft,
		setDraft,
		messages,
		result: routeKey === resultRouteKey ? result : null,
		trace: routeKey === resultRouteKey ? trace : null,
		nodeTimings: routeKey === resultRouteKey ? nodeTimings : {},
		error,
		running,
		run,
		clearChat,
		clearResultForNode,
	};
}
