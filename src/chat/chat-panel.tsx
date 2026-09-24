import { ArrowUp, CircleAlert, Minus, Trash2, Zap } from "lucide-react";
import { type KeyboardEvent, useRef } from "react";
import { ChatMessageItem } from "@/chat/chat-message-item";
import type { ChatTurn } from "@/chat/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@/components/ui/input-group";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
} from "@/components/ui/popover";
import type { KeyStatus, Routes } from "@/lib/routing";
import { cn } from "@/lib/utils";

export type ChatPanelProps = {
	routes: Routes | null;
	onClose: () => void;
	draft: string;
	onDraftChange: (value: string) => void;
	messages: ChatTurn[];
	error: string;
	running: boolean;
	status?: KeyStatus;
	statusUnavailable: boolean;
	onSend: () => void;
	onClear: () => void;
};

function KeyStatusNotice({
	status,
	unavailable,
	routes,
}: {
	status?: KeyStatus;
	unavailable: boolean;
	routes: Routes | null;
}) {
	const targets = routes
		? routes.kind === "direct"
			? [routes.target]
			: Object.values(routes.targets)
		: [];
	const missing = status
		? [
				routes?.kind === "jev" && !status.jev && "Jev",
				targets.some((target) => target.provider === "openai") &&
					!status.openai &&
					"OpenAI",
				targets.some((target) => target.provider === "google") &&
					!status.google &&
					"Gemini",
			].filter(Boolean)
		: [];
	return (
		<>
			{missing.length > 0 && (
				<Alert className="rounded-none border-0 bg-transparent px-3 py-1">
					<CircleAlert />
					<AlertTitle>Missing API key</AlertTitle>
					<AlertDescription>
						Add {missing.join(", ")} to <code>.env.local</code>.
					</AlertDescription>
				</Alert>
			)}
			{unavailable && (
				<Alert
					variant="destructive"
					className="rounded-none border-0 bg-transparent px-3 py-1"
				>
					<CircleAlert />
					<AlertTitle>Could not check API keys</AlertTitle>
				</Alert>
			)}
		</>
	);
}

export function ChatPanel({
	routes,
	onClose,
	draft,
	onDraftChange,
	messages,
	error,
	running,
	status,
	statusUnavailable,
	onSend,
	onClear,
}: ChatPanelProps) {
	const composerRef = useRef<HTMLTextAreaElement>(null);

	const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!event.nativeEvent.isComposing &&
			!running
		) {
			event.preventDefault();
			onSend();
			composerRef.current?.focus({ preventScroll: true });
		}
	};
	return (
		<PopoverContent
			id="routing-chat"
			aria-label="Routing chat"
			side="top"
			align="end"
			sideOffset={8}
			initialFocus={composerRef}
			className="h-[min(37.5rem,calc(100dvh-5rem))] w-[min(25rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
		>
			<PopoverHeader className="flex-row items-center justify-between p-3">
				<PopoverTitle>Chat</PopoverTitle>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Clear conversation"
						title="Clear conversation"
						disabled={messages.length === 0 || running}
						onClick={onClear}
					>
						<Trash2 />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close chat"
						title="Close chat"
						onClick={onClose}
					>
						<Minus />
					</Button>
				</div>
			</PopoverHeader>

			<KeyStatusNotice
				status={status}
				unavailable={statusUnavailable}
				routes={routes}
			/>

			<MessageScrollerProvider autoScroll>
				<MessageScroller className="min-h-0 flex-1">
					<MessageScrollerViewport>
						<MessageScrollerContent
							className={cn(
								"gap-4 px-3 py-3",
								messages.length > 0 && "justify-end",
							)}
						>
							{messages.map((message) => (
								<ChatMessageItem key={message.id} message={message} />
							))}
							{error && (
								<MessageScrollerItem messageId="routing-error">
									<Alert
										variant="destructive"
										className="rounded-none border-0 bg-transparent"
									>
										<CircleAlert />
										<AlertTitle>Message failed</AlertTitle>
										<AlertDescription>{error}</AlertDescription>
									</Alert>
								</MessageScrollerItem>
							)}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					{messages.length === 0 && !running && !draft.trim() && (
						<Empty className="pointer-events-none absolute inset-0">
							<EmptyHeader>
								<EmptyMedia className="text-muted-foreground">
									<Zap />
								</EmptyMedia>
								<EmptyTitle>Ask anything</EmptyTitle>
								<EmptyDescription>
									{routes?.kind === "direct"
										? "Start a conversation with the connected model."
										: "Start a conversation. Jev chooses a model for every message."}
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					)}
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>

			<form
				className="p-3"
				onSubmit={(event) => {
					event.preventDefault();
					onSend();
					composerRef.current?.focus({ preventScroll: true });
				}}
			>
				<InputGroup className="min-h-[132px] max-h-[min(32rem,calc(100dvh-11rem))] items-stretch flex-col overflow-hidden">
					<InputGroupTextarea
						ref={composerRef}
						aria-label="Message"
						placeholder="Ask anything…"
						rows={1}
						className="max-h-96 px-3 py-3"
						maxLength={12000}
						value={draft}
						onChange={(event) => onDraftChange(event.target.value)}
						onKeyDown={onComposerKeyDown}
					/>
					<InputGroupAddon align="block-end" className="justify-end px-2 pb-2">
						<InputGroupButton
							type="submit"
							variant="default"
							size="icon-sm"
							className="rounded-full"
							aria-label="Send message"
							disabled={!draft.trim() || running}
						>
							<ArrowUp />
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
			</form>
		</PopoverContent>
	);
}
