import type { ChatMessage, RouteResult, Routes } from "@/lib/routing";

export type ChatTurn = ChatMessage & {
	id: string;
	route?: RouteResult;
	mode?: Routes["kind"];
	streaming?: boolean;
	failed?: boolean;
};
