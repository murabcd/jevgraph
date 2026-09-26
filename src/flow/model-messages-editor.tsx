import { Plus, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup } from "@/components/ui/field";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@/components/ui/input-group";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	MAX_MODEL_PROMPT_MESSAGES,
	MAX_PROMPT_LENGTH,
	type ModelPromptMessage,
} from "@/lib/routing";

export type DraftPromptMessage = ModelPromptMessage & { id: string };

type Props = {
	messages: DraftPromptMessage[];
	onMessagesChange: Dispatch<SetStateAction<DraftPromptMessage[]>>;
};

export function ModelMessagesEditor({ messages, onMessagesChange }: Props) {
	return (
		<FieldGroup className="gap-3">
			<div className="flex items-center justify-between gap-2">
				<p className="text-xs text-muted-foreground">Messages</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={messages.length >= MAX_MODEL_PROMPT_MESSAGES}
					onClick={() =>
						onMessagesChange((current) => [
							...current,
							{ id: crypto.randomUUID(), role: "user", content: "" },
						])
					}
				>
					<Plus className="size-4" /> Add message
				</Button>
			</div>
			{messages.map((message, index) => (
				<Field key={message.id} className="gap-0">
					<InputGroup className="min-h-[132px] max-h-52 items-stretch overflow-hidden">
						<InputGroupTextarea
							aria-label={`Message ${index + 1} content`}
							className="min-h-20 max-h-44"
							value={message.content}
							maxLength={MAX_PROMPT_LENGTH}
							rows={2}
							placeholder={
								message.role === "user"
									? "Example user message..."
									: "Example assistant response..."
							}
							onChange={(event) =>
								onMessagesChange((current) =>
									current.map((item) =>
										item.id === message.id
											? { ...item, content: event.target.value }
											: item,
									),
								)
							}
						/>
						<InputGroupAddon
							align="block-start"
							className="justify-between gap-2 px-0 pt-1.5 pr-1.5 pb-0"
						>
							<Select
								value={message.role}
								onValueChange={(role) => {
									if (role !== "user" && role !== "assistant") return;
									onMessagesChange((current) =>
										current.map((item) =>
											item.id === message.id ? { ...item, role } : item,
										),
									);
								}}
							>
								<SelectTrigger
									aria-label={`Message ${index + 1} role`}
									size="sm"
									className="w-32 border-0 bg-transparent text-foreground shadow-none hover:bg-muted/70 dark:bg-transparent dark:hover:bg-muted/50"
								>
									<SelectValue>
										{(selected: string | null) =>
											selected === "assistant" ? "Assistant" : "User"
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent align="start" alignItemWithTrigger={false}>
									<SelectGroup>
										<SelectItem value="user">User</SelectItem>
										<SelectItem value="assistant">Assistant</SelectItem>
									</SelectGroup>
								</SelectContent>
							</Select>
							<InputGroupButton
								type="button"
								size="icon-xs"
								aria-label={`Remove message ${index + 1}`}
								className="text-muted-foreground"
								onClick={() =>
									onMessagesChange((current) =>
										current.filter((item) => item.id !== message.id),
									)
								}
							>
								<X />
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
				</Field>
			))}
		</FieldGroup>
	);
}
