import { ArrowUp, CircleAlert, PanelRight, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { ChatMessageItem } from "@/chat/chat-message-item";
import type { ChatTurn } from "@/chat/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
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
import type { KeyStatus } from "@/lib/routing";
import { cn } from "@/lib/utils";

export type ChatPanelProps = {
	open: boolean;
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
}: {
	status?: KeyStatus;
	unavailable: boolean;
}) {
	return (
		<>
			{status && (!status.jev || !status.openai || !status.google) && (
				<Alert className="mx-4 mt-4 w-auto">
					<CircleAlert />
					<AlertTitle>Missing API key</AlertTitle>
					<AlertDescription>
						Add{" "}
						{[
							!status.jev && "Jev",
							!status.openai && "OpenAI",
							!status.google && "Gemini",
						]
							.filter(Boolean)
							.join(", ")}{" "}
						to <code>.env.local</code>.
					</AlertDescription>
				</Alert>
			)}
			{unavailable && (
				<Alert variant="destructive" className="mx-4 mt-4 w-auto">
					<CircleAlert />
					<AlertTitle>Could not check API keys</AlertTitle>
				</Alert>
			)}
		</>
	);
}

export function ChatPanel({
	open,
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
	useEffect(() => {
		if (!open) return;
		const activeElement = document.activeElement;
		if (
			activeElement instanceof HTMLElement &&
			(activeElement instanceof HTMLInputElement ||
				activeElement instanceof HTMLTextAreaElement ||
				activeElement instanceof HTMLSelectElement ||
				activeElement.isContentEditable) &&
			activeElement !== composerRef.current
		)
			return;
		composerRef.current?.focus({ preventScroll: true });
	}, [open]);

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
		<aside
			className={cn("workbench", !open && "workbench--closed")}
			aria-label="Routing chat"
			aria-hidden={!open}
			inert={!open}
		>
			<div className="workbench__inner">
				<header className="workbench__header">
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
							aria-label="Collapse chat"
							title="Collapse chat"
							onClick={onClose}
						>
							<PanelRight />
						</Button>
					</div>
				</header>

				<KeyStatusNotice status={status} unavailable={statusUnavailable} />

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
										<Alert variant="destructive">
											<CircleAlert />
											<AlertTitle>Message failed</AlertTitle>
											<AlertDescription>{error}</AlertDescription>
										</Alert>
									</MessageScrollerItem>
								)}
							</MessageScrollerContent>
						</MessageScrollerViewport>
						{messages.length === 0 && !running && (
							<Empty className="pointer-events-none absolute inset-0">
								<EmptyHeader>
									<EmptyTitle>Ask anything</EmptyTitle>
									<EmptyDescription>
										Start a conversation. Jev chooses a model for every message.
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						)}
						<MessageScrollerButton />
					</MessageScroller>
				</MessageScrollerProvider>

				<div className="workbench__footer">
					<form
						onSubmit={(event) => {
							event.preventDefault();
							onSend();
							composerRef.current?.focus({ preventScroll: true });
						}}
					>
						<InputGroup className="min-h-28 max-h-[24rem] overflow-hidden">
							<InputGroupTextarea
								ref={composerRef}
								aria-label="Message"
								placeholder="Ask anything…"
								rows={1}
								className="min-h-28 max-h-[24rem] overflow-y-auto py-4 pr-14 pl-4"
								maxLength={12000}
								value={draft}
								onChange={(event) => onDraftChange(event.target.value)}
								onKeyDown={onComposerKeyDown}
							/>
							<InputGroupAddon
								align="inline-end"
								className="absolute right-0 bottom-0 z-10 pb-2"
							>
								<InputGroupButton
									type="submit"
									size="icon-sm"
									variant="default"
									aria-label="Send message"
									disabled={!draft.trim() || running}
								>
									<ArrowUp />
								</InputGroupButton>
							</InputGroupAddon>
						</InputGroup>
					</form>
				</div>
			</div>
		</aside>
	);
}
