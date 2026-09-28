import type { ChatMessage } from "@/lib/routing";
import type { RunFooter } from "@/lib/run-footer";

export type ChatTurn = ChatMessage & {
	id: string;
	route?: RunFooter;
	streaming?: boolean;
	failed?: boolean;
};
