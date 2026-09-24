import { ChevronDown, GitFork } from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	defaultJevQuestion,
	type JevQuestion,
	jevQuestionTypes,
	questionTypeLabels,
} from "@/lib/jev-question";

type Props = {
	question: JevQuestion;
	onChange?: (question: JevQuestion) => void;
};

export function JevQuestionPicker({ question, onChange }: Props) {
	const [open, setOpen] = useState(false);
	const label = questionTypeLabels[question.type];
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						className="nodrag nopan w-[200px] min-w-0 justify-between gap-2 rounded-full"
						aria-label={`Jev question type: ${label}`}
					/>
				}
			>
				<Avatar className="size-4 rounded-sm after:hidden">
					<AvatarImage
						src="/brands/typesafe.png"
						alt=""
						className="object-contain"
					/>
					<AvatarFallback className="bg-transparent">
						<GitFork />
					</AvatarFallback>
				</Avatar>
				<span className="truncate">{label}</span>
				<ChevronDown className="shrink-0" />
			</DialogTrigger>
			<DialogContent
				className="w-[min(440px,calc(100vw-2rem))] gap-0 p-0"
				showCloseButton={false}
			>
				<DialogHeader className="sr-only">
					<DialogTitle>Select Jev question type</DialogTitle>
				</DialogHeader>
				<Command>
					<CommandInput placeholder="Search question types…" autoFocus />
					<CommandList>
						<CommandEmpty>No matching types.</CommandEmpty>
						<CommandGroup heading="Jev question types">
							{jevQuestionTypes.map((type) => (
								<CommandItem
									key={type}
									value={type}
									data-checked={type === question.type}
									onSelect={() => {
										if (type !== question.type)
											onChange?.(defaultJevQuestion(type));
										setOpen(false);
									}}
								>
									<Avatar className="size-4 rounded-sm after:hidden">
										<AvatarImage src="/brands/typesafe.png" alt="" />
										<AvatarFallback className="bg-transparent">
											<GitFork />
										</AvatarFallback>
									</Avatar>
									<span className="min-w-0 flex-1 truncate">
										{questionTypeLabels[type]}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
