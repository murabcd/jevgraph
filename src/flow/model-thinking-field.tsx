import { Brain } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ReasoningEffort, TextModel } from "@/lib/models";
import { reasoningEffortSchema } from "@/lib/routing";

function effortLabel(value: string | null) {
	return value ? (
		<span className="flex items-center gap-2">
			<Brain className="size-4" />
			{value[0].toUpperCase() + value.slice(1)}
		</span>
	) : null;
}

export function ModelThinkingField({
	id,
	model,
	efforts = model.reasoning.efforts,
	value,
	onChange,
}: {
	id: string;
	model: TextModel;
	efforts?: readonly ReasoningEffort[];
	value: ReasoningEffort;
	onChange: (effort: ReasoningEffort) => void;
}) {
	return (
		<Field>
			<FieldLabel
				htmlFor={`${id}-reasoning`}
				className="text-xs text-muted-foreground"
			>
				Reasoning effort
			</FieldLabel>
			<Select
				value={value}
				onValueChange={(value) => {
					const parsed = reasoningEffortSchema.safeParse(value);
					if (parsed.success && efforts.includes(parsed.data))
						onChange(parsed.data);
				}}
			>
				<SelectTrigger id={`${id}-reasoning`} className="w-full">
					<SelectValue>{effortLabel}</SelectValue>
				</SelectTrigger>
				<SelectContent alignItemWithTrigger={false}>
					<SelectGroup>
						{efforts.map((effort) => (
							<SelectItem key={effort} value={effort}>
								{effortLabel(effort)}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</Field>
	);
}
