import { lazy, Suspense } from "react";
import type { ChatTurn } from "@/chat/types";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
	Message,
	MessageContent,
	MessageFooter,
} from "@/components/ui/message";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import type { Provider } from "@/lib/routing";

const Streamdown = lazy(() =>
	import("streamdown").then((module) => ({ default: module.Streamdown })),
);

function providerName(provider: Provider) {
	return provider === "google" ? "Gemini" : "OpenAI";
}

function pendingLabel(message: ChatTurn) {
	if (message.route) {
		return `Waiting for ${providerName(message.route.provider)}…`;
	}

	return message.mode === "direct" ? "Connecting to model…" : "Jev is routing…";
}

function AssistantContent({ message }: { message: ChatTurn }) {
	if (!message.content) {
		return (
			<span className="text-muted-foreground">{pendingLabel(message)}</span>
		);
	}

	return (
		<Suspense
			fallback={<span className="whitespace-pre-wrap">{message.content}</span>}
		>
			<Streamdown
				mode={message.streaming ? "streaming" : "static"}
				isAnimating={message.streaming}
				caret="block"
				className="w-full wrap-break-word"
			>
				{message.content}
			</Streamdown>
		</Suspense>
	);
}

function RouteBadge({ message }: { message: ChatTurn }) {
	if (!message.route || message.streaming || message.failed) {
		return null;
	}

	return (
		<MessageFooter>
			<Badge
				variant="outline"
				title={`${message.route.reason}${message.route.jev ? ` · Jev ${Math.round(message.route.jev.confidence * 100)}%` : ""}`}
			>
				{providerName(message.route.provider)} · {message.route.model}
			</Badge>
			{message.route.classificationError && (
				<Badge variant="destructive" title={message.route.classificationError}>
					Jev fallback
				</Badge>
			)}
		</MessageFooter>
	);
}

export function ChatMessageItem({ message }: { message: ChatTurn }) {
	const isUser = message.role === "user";
	const align = isUser ? "end" : "start";

	return (
		<MessageScrollerItem messageId={message.id} scrollAnchor={isUser}>
			<Message align={align}>
				<MessageContent>
					<Bubble variant={isUser ? "secondary" : "ghost"} align={align}>
						<BubbleContent
							className={
								isUser ? "whitespace-pre-wrap" : "w-full text-sm leading-6"
							}
						>
							{isUser ? (
								message.content
							) : (
								<AssistantContent message={message} />
							)}
						</BubbleContent>
					</Bubble>
					<RouteBadge message={message} />
				</MessageContent>
			</Message>
		</MessageScrollerItem>
	);
}
