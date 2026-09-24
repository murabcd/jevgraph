import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp } from "lucide-react";
import type { Ref } from "react";
import { GoogleIcon, OpenAIIcon } from "@/components/icons/provider-icons";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { type CostBracket, textModels } from "@/lib/models";
import { cn } from "@/lib/utils";

const costIndicators = {
	lowest: {
		icon: ChevronsDown,
		label: "Much lower estimated cost",
		color: "text-green-500 dark:text-green-400",
	},
	low: {
		icon: ChevronDown,
		label: "Lower estimated cost",
		color: "text-green-500 dark:text-green-400",
	},
	high: {
		icon: ChevronUp,
		label: "Higher estimated cost",
		color: "text-orange-500 dark:text-orange-400",
	},
	highest: {
		icon: ChevronsUp,
		label: "Much higher estimated cost",
		color: "text-red-500 dark:text-red-400",
	},
} satisfies Record<
	CostBracket,
	{ icon: typeof ChevronDown; label: string; color: string }
>;

function CostIndicator({ bracket }: { bracket: CostBracket }) {
	const { icon: Icon, label, color } = costIndicators[bracket];
	return (
		<span
			role="img"
			aria-label={label}
			title={label}
			className="ml-auto shrink-0"
		>
			<Icon aria-hidden="true" className={cn("size-4", color)} />
		</span>
	);
}

export function ModelCommand({
	modelId,
	onSelect,
	inputRef,
}: {
	modelId?: string;
	onSelect: (modelId: string) => void;
	inputRef?: Ref<HTMLInputElement>;
}) {
	return (
		<Command>
			<CommandInput ref={inputRef} placeholder="Search models…" autoFocus />
			<CommandList>
				<CommandEmpty>No matching models.</CommandEmpty>
				{(["openai", "google"] as const).map((provider) => (
					<CommandGroup
						key={provider}
						heading={provider === "openai" ? "OpenAI" : "Gemini"}
					>
						{textModels
							.filter((model) => model.provider === provider)
							.map((model) => (
								<CommandItem
									key={model.id}
									value={`${model.label} ${model.id} ${provider}`}
									data-checked={model.id === modelId}
									onSelect={() => onSelect(model.id)}
								>
									{provider === "openai" ? (
										<OpenAIIcon className="size-4" />
									) : (
										<GoogleIcon className="size-4" />
									)}
									<span className="min-w-0 flex-1 truncate">{model.label}</span>
									<CostIndicator bracket={model.costBracket} />
								</CommandItem>
							))}
					</CommandGroup>
				))}
			</CommandList>
		</Command>
	);
}
