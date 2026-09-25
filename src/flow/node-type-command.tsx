import { Bot, GitFork } from "lucide-react";
import type { Ref } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import type { CreatableNodeKind } from "@/flow/graph";

const nodeTypes = {
	jev: { label: "Router", icon: GitFork },
	model: { label: "Model", icon: Bot },
} as const;

export function NodeTypeCommand({
	available,
	onSelect,
	inputRef,
}: {
	available: CreatableNodeKind[];
	onSelect: (kind: CreatableNodeKind) => void;
	inputRef?: Ref<HTMLInputElement>;
}) {
	return (
		<Command>
			<CommandInput
				ref={inputRef}
				autoFocus
				aria-label="Search node types"
				placeholder="Search nodes…"
			/>
			<CommandList>
				<CommandEmpty>No matching nodes.</CommandEmpty>
				<CommandGroup heading="Add node">
					{available.map((kind) => {
						const { label, icon: Icon } = nodeTypes[kind];
						return (
							<CommandItem
								key={kind}
								value={label}
								onSelect={() => onSelect(kind)}
							>
								<Icon className="size-4" />
								{label}
							</CommandItem>
						);
					})}
				</CommandGroup>
			</CommandList>
		</Command>
	);
}
