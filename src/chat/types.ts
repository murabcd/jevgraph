import type { ChatMessage, RouteResult } from "@/lib/routing";

export type ChatTurn = ChatMessage & {
	id: string;
	route?: RouteResult;
	mode?: "direct" | "jev";
	streaming?: boolean;
	failed?: boolean;
};
