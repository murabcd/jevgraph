import { useCallback, useState } from "react";
import type { ChatTurn } from "@/chat/types";
import { readRouteStream } from "@/lib/route-stream";
import {
	type ChatMessage,
	defaultConfig,
	type RouteResult,
	type RouteStreamEvent,
	type Routes,
} from "@/lib/routing";

export function useRouteChat(
	routes: Routes | null,
	onRequestStarted: () => void,
) {
	const [draft, setDraft] = useState("");
	const [messages, setMessages] = useState<ChatTurn[]>([]);
	const [result, setResult] = useState<RouteResult | null>(null);
	const [error, setError] = useState("");
	const [running, setRunning] = useState(false);

	const run = useCallback(async () => {
		const question = draft.trim();
		if (!question || running) return;
		if (!routes) {
			setError(
				"Connect both Jev branches to model nodes before sending a message.",
			);
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
			{ id: assistantId, role: "assistant", content: "", streaming: true },
		]);
		setDraft("");
		setRunning(true);
		setError("");
		setResult(null);
		onRequestStarted();
		try {
			const response = await fetch("/api/route", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					messages: history,
					config: defaultConfig,
					routes,
				}),
			});
			await readRouteStream(response, (event: RouteStreamEvent) => {
				if (event.type === "route") {
					const preview: RouteResult = {
						...event.route,
						text: "",
						latencyMs: 0,
					};
					setResult(preview);
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
			setResult(null);
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
	}, [draft, messages, routes, running, onRequestStarted]);

	const clearChat = () => {
		setMessages([]);
		setResult(null);
		setError("");
		setDraft("");
	};

	const clearResultForNode = (nodeId: string) => {
		setResult((current) => (current?.nodeId === nodeId ? null : current));
	};

	return {
		draft,
		setDraft,
		messages,
		result,
		error,
		running,
		run,
		clearChat,
		clearResultForNode,
	};
}
