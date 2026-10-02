import { ArrowUp, Play, Square } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@/components/ui/input-group";

export function ChatComposer({
	composerRef,
	draft,
	onDraftChange,
	running,
	onSend,
	onResume,
	canResume,
	onStop,
	canStop,
}: {
	composerRef: RefObject<HTMLTextAreaElement | null>;
	draft: string;
	onDraftChange: (value: string) => void;
	running: boolean;
	onSend: () => void;
	onResume: () => void;
	canResume: boolean;
	onStop: () => void;
	canStop: boolean;
}) {
	const resumeReady = canResume && !draft.trim();
	const submit = () => {
		if (resumeReady) onResume();
		else onSend();
		composerRef.current?.focus({ preventScroll: true });
	};
	const action = running ? "stop" : resumeReady ? "resume" : "send";
	const label = {
		stop: "Stop response",
		resume: "Resume response",
		send: "Send message",
	}[action];
	const Icon = { stop: Square, resume: Play, send: ArrowUp }[action];
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!event.nativeEvent.isComposing &&
			!running
		) {
			event.preventDefault();
			submit();
		}
	};
	return (
		<form
			className="p-3"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
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
					onKeyDown={onKeyDown}
				/>
				<InputGroupAddon align="block-end" className="justify-end px-2 pb-2">
					<InputGroupButton
						type={action === "send" ? "submit" : "button"}
						variant="default"
						size="icon-sm"
						className="rounded-full"
						aria-label={label}
						title={label}
						disabled={running ? !canStop : !resumeReady && !draft.trim()}
						onClick={running ? onStop : resumeReady ? submit : undefined}
					>
						<Icon
							className={action === "send" ? undefined : "size-3 fill-current"}
						/>
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
		</form>
	);
}
