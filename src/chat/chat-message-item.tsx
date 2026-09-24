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

export function ChatMessageItem({ message }: { message: ChatTurn }) {
	return (
		<MessageScrollerItem
			messageId={message.id}
			scrollAnchor={message.role === "user"}
		>
			<Message align={message.role === "user" ? "end" : "start"}>
				<MessageContent>
					<Bubble
						variant={message.role === "user" ? "secondary" : "ghost"}
						align={message.role === "user" ? "end" : "start"}
					>
						<BubbleContent
							className={
								message.role === "user"
									? "whitespace-pre-wrap"
									: "w-full text-sm leading-6"
							}
						>
							{message.role === "user" ? (
								message.content
							) : message.content ? (
								<Suspense
									fallback={
										<span className="whitespace-pre-wrap">
											{message.content}
										</span>
									}
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
							) : (
								<span className="text-muted-foreground">
									{message.route
										? `Waiting for ${providerName(message.route.provider)}…`
										: "Jev is routing…"}
								</span>
							)}
						</BubbleContent>
					</Bubble>
					{message.route && !message.streaming && !message.failed && (
						<MessageFooter>
							<Badge
								variant="outline"
								title={`${message.route.reason}${message.route.jev ? ` · Jev ${Math.round(message.route.jev.confidence * 100)}%` : ""}`}
							>
								{providerName(message.route.provider)} · {message.route.model}
							</Badge>
						</MessageFooter>
					)}
				</MessageContent>
			</Message>
		</MessageScrollerItem>
	);
}
