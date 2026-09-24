import { useCallback, useState } from "react";
import useSWR from "swr";
import { ChatPanel } from "@/chat/chat-panel";
import { useRouteChat } from "@/chat/use-route-chat";
import { RoutingCanvas } from "@/flow/routing-canvas";
import { useRoutingGraph } from "@/flow/use-routing-graph";
import type { KeyStatus } from "@/lib/routing";
import "./app.css";

async function readKeyStatus(): Promise<KeyStatus> {
	const response = await fetch("/api/status", { cache: "no-store" });
	if (!response.ok) throw new Error("Could not read key status");
	return response.json() as Promise<KeyStatus>;
}

function App() {
	const [chatOpen, setChatOpen] = useState(true);
	const graph = useRoutingGraph();
	const {
		data: status,
		error: statusError,
		mutate: refreshStatus,
	} = useSWR<KeyStatus>("/api/status", readKeyStatus);
	const onRequestStarted = useCallback(() => {
		void refreshStatus();
	}, [refreshStatus]);
	const chat = useRouteChat(graph.routes, onRequestStarted);

	const duplicateNode = (nodeId: string) => {
		if (!chat.running) graph.onDuplicateNode(nodeId);
	};
	const removeNode = (nodeId: string) => {
		if (chat.running) return;
		graph.onRemoveNode(nodeId);
		chat.clearResultForNode(nodeId);
	};

	return (
		<main className="studio">
			<RoutingCanvas
				graph={graph}
				result={chat.result}
				running={chat.running}
				messages={chat.messages}
				draft={chat.draft}
				chatOpen={chatOpen}
				onOpenChat={() => setChatOpen(true)}
				onDuplicateNode={duplicateNode}
				onRemoveNode={removeNode}
			/>
			<ChatPanel
				open={chatOpen}
				onClose={() => setChatOpen(false)}
				draft={chat.draft}
				onDraftChange={chat.setDraft}
				messages={chat.messages}
				error={chat.error}
				running={chat.running}
				status={status}
				statusUnavailable={Boolean(statusError)}
				onSend={() => void chat.run()}
				onClear={chat.clearChat}
			/>
		</main>
	);
}

export default App;
