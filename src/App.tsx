import { useCallback, useState } from "react";
import useSWR from "swr";
import { ChatPanel } from "@/chat/chat-panel";
import { useRouteChat } from "@/chat/use-route-chat";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Popover } from "@/components/ui/popover";
import { RoutingCanvas } from "@/flow/routing-canvas";
import { useRoutingGraph } from "@/flow/use-routing-graph";
import type { KeyStatus } from "@/lib/routing";
import type { Workspace } from "@/storage/workspace-gate";
import "./app.css";

const CHAT_OPEN_STORAGE_KEY = "router:chat-open";

async function readKeyStatus(): Promise<KeyStatus> {
	const response = await fetch("/api/status", { cache: "no-store" });
	if (!response.ok) throw new Error("Could not read key status");
	return response.json() as Promise<KeyStatus>;
}

function App({ workspace }: { workspace: Workspace }) {
	const [chatOpen, setChatOpen] = useState(
		() => localStorage.getItem(CHAT_OPEN_STORAGE_KEY) === "true",
	);
	const onChatOpenChange = useCallback((open: boolean) => {
		localStorage.setItem(CHAT_OPEN_STORAGE_KEY, String(open));
		setChatOpen(open);
	}, []);
	const graph = useRoutingGraph(workspace);
	const storage = graph.storage;
	const {
		data: status,
		error: statusError,
		mutate: refreshStatus,
	} = useSWR<KeyStatus>("/api/status", readKeyStatus);
	const onRequestStarted = useCallback(() => {
		void refreshStatus();
	}, [refreshStatus]);
	const chat = useRouteChat(
		graph.routes,
		onRequestStarted,
		workspace,
		storage.flush,
	);

	const duplicateNode = (nodeId: string) => {
		if (!chat.running) graph.onDuplicateNode(nodeId);
	};
	const removeNode = (nodeId: string) => {
		if (chat.running) return;
		graph.onRemoveNode(nodeId);
		chat.clearResultForNode(nodeId);
	};
	const removeNodes = (nodeIds: string[]) => {
		if (chat.running) return;
		graph.onRemoveNodes(nodeIds);
		for (const nodeId of nodeIds) chat.clearResultForNode(nodeId);
	};

	return (
		<main className="studio">
			{storage.error && (
				<Alert
					variant="destructive"
					className="absolute top-4 left-4 z-50 max-w-md"
				>
					<AlertDescription>{storage.error}</AlertDescription>
				</Alert>
			)}
			<Popover
				open={chatOpen}
				onOpenChange={(open, details) => {
					if (
						!open &&
						(details.reason === "outside-press" ||
							details.reason === "focus-out")
					)
						return;
					onChatOpenChange(open);
				}}
			>
				<RoutingCanvas
					graph={graph}
					result={chat.trace}
					timings={chat.nodeTimings}
					running={chat.running}
					chatOpen={chatOpen}
					onDuplicateNode={duplicateNode}
					onRemoveNode={removeNode}
					onNodesDeleted={removeNodes}
				/>
				{chatOpen && (
					<ChatPanel
						routes={graph.routes}
						onClose={() => onChatOpenChange(false)}
						draft={chat.draft}
						onDraftChange={chat.setDraft}
						messages={chat.messages}
						error={chat.error}
						running={chat.running}
						status={status}
						statusUnavailable={Boolean(statusError)}
						onSend={() => void chat.run()}
						onClear={() => void chat.clearChat()}
						history={chat.history}
						currentConversationId={workspace.conversationId}
						onOpenConversation={(id) => void chat.openConversation(id)}
					/>
				)}
			</Popover>
		</main>
	);
}

export default App;
