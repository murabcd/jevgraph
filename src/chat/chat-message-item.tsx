import { Suspense } from "react";
import { Streamdown } from "streamdown";
import type { ChatTurn } from "@/chat/types";
import { WorkflowUsage } from "@/chat/workflow-usage";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
	Message,
	MessageContent,
	MessageFooter,
} from "@/components/ui/message";
import { MessageScrollerItem } from "@/components/ui/message-scroller";

function AssistantContent({ message }: { message: ChatTurn }) {
	if (!message.content) {
		return message.streaming ? (
			<Suspense
				fallback={<span className="text-muted-foreground">Thinking</span>}
			>
				<Shimmer>Thinking</Shimmer>
			</Suspense>
		) : null;
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

function JevErrorBadge({ message }: { message: ChatTurn }) {
	const errors = message.route?.jevSteps
		.map((step) => step.error)
		.filter((error): error is string => Boolean(error));
	if (!errors?.length || message.streaming || message.failed) {
		return null;
	}

	return (
		<MessageFooter>
			<Badge variant="destructive" title={errors.join("; ")}>
				Jev unavailable
			</Badge>
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
					<JevErrorBadge message={message} />
					{!isUser &&
						message.route &&
						!message.streaming &&
						!message.failed && <WorkflowUsage route={message.route} />}
				</MessageContent>
			</Message>
		</MessageScrollerItem>
	);
}
