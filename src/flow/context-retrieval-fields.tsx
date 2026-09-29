import { Search } from "lucide-react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectionRow } from "@/flow/selection-row";
import {
	DEFAULT_RETRIEVAL_POLICY,
	type RetrievalPolicy,
} from "@/lib/retrieval";

export function ContextRetrievalFields({
	id,
	value,
	onChange,
}: {
	id: string;
	value?: RetrievalPolicy;
	onChange: (value: RetrievalPolicy | undefined) => void;
}) {
	return (
		<FieldGroup className="gap-3">
			<SelectionRow
				selected={Boolean(value)}
				onSelectedChange={(selected) =>
					onChange(selected ? { ...DEFAULT_RETRIEVAL_POLICY } : undefined)
				}
			>
				<span className="flex items-center gap-2">
					<Search className="size-4 shrink-0" />
					Retrieve relevant passages
				</span>
			</SelectionRow>
			{value &&
				(
					[
						["historyMessages", "Search previous messages", 1],
						["candidates", "Retrieval candidates", 1],
						["maxResults", "Retrieved passages", 1],
						["minimumConfidence", "Minimum rerank confidence (%)", 100],
					] as const
				).map(([key, label, factor]) => (
					<Field key={key}>
						<FieldLabel
							htmlFor={`${id}-retrieval-${key}`}
							className="text-xs text-muted-foreground"
						>
							{label}
						</FieldLabel>
						<Input
							id={`${id}-retrieval-${key}`}
							inputMode={factor === 100 ? "decimal" : "numeric"}
							value={
								Number.isFinite(value[key]) ? String(value[key] * factor) : ""
							}
							onChange={(event) =>
								onChange({
									...value,
									[key]: event.target.value.trim()
										? Number(event.target.value) / factor
										: NaN,
								})
							}
						/>
					</Field>
				))}
		</FieldGroup>
	);
}
