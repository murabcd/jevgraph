import type { FunctionReturnType } from "convex/server";
import { History, MessageCircle } from "lucide-react";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
} from "@/components/ui/select";
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
		<Select<Id<"conversations">>
			value={
				history.some((conversation) => conversation.id === currentId)
					? currentId
					: null
			}
			disabled={disabled || history.length === 0}
			onValueChange={(id) => {
				if (id && id !== currentId) onOpen(id);
			}}
		>
			<SelectTrigger size="icon" aria-label="Conversation history">
				<History />
			</SelectTrigger>
			<SelectContent align="end" alignItemWithTrigger={false} className="w-72">
				<SelectGroup>
					{history.map((conversation) => (
						<SelectItem
							key={conversation.id}
							value={conversation.id}
							label={conversation.title}
						>
							<MessageCircle />
							<span className="min-w-0 flex-1 truncate">
								{conversation.title}
							</span>
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}
