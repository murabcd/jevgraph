import type { ChatMessage, RouteResult } from "@/lib/routing";

export type ChatTurn = ChatMessage & {
	id: string;
	route?: RouteResult;
	streaming?: boolean;
	failed?: boolean;
};
