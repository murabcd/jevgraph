import type { FunctionReturnType } from "convex/server";
import { Check, History, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export function ChatHistoryMenu({
	history,
	currentId,
	disabled,
	onOpen,
}: {
	history: FunctionReturnType<typeof api.conversations.list>;
	currentId: Id<"conversations">;
	disabled: boolean;
	onOpen: (id: Id<"conversations">) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Conversation history"
						disabled={disabled}
					/>
				}
			>
				<History />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72 space-y-1 p-2">
				{history.map((conversation) => (
					<DropdownMenuItem
						key={conversation.id}
						onClick={() => onOpen(conversation.id)}
						className="min-h-9 rounded-lg border border-border px-2.5 py-2 data-selected:bg-secondary"
						data-selected={conversation.id === currentId || undefined}
					>
						<MessageSquare />
						<span className="min-w-0 flex-1 truncate">
							{conversation.title}
						</span>
						{conversation.id === currentId && <Check />}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
