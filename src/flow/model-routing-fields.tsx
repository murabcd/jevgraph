import { Sparkles } from "lucide-react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModelOption } from "@/flow/model-option";
import { SelectionRow } from "@/flow/selection-row";
import type { ModelRouting } from "@/lib/model-routing";
import { textModels } from "@/lib/models";

export function ModelRoutingFields({
	id,
	value,
	onChange,
	maxOutputTokens,
}: {
	id: string;
	value?: ModelRouting;
	onChange: (value: ModelRouting | undefined) => void;
	maxOutputTokens: number;
}) {
	return (
		<FieldGroup className="gap-3">
			<SelectionRow
				selected={Boolean(value)}
				onSelectedChange={(selected) =>
					onChange(
						selected
							? {
									models: textModels.map((model) => model.id),
									expectedOutputTokens: Math.min(
										256,
										Number.isFinite(maxOutputTokens)
											? Math.max(1, maxOutputTokens)
											: 1400,
									),
									expectedRequests: 2,
								}
							: undefined,
					)
				}
			>
				<span className="flex items-center gap-2">
					<Sparkles className="size-4 shrink-0" />
					Route by expected cost
				</span>
			</SelectionRow>
			{value && (
				<>
					<FieldGroup className="gap-2">
						<span className="text-xs text-muted-foreground">
							Allowed models
						</span>
						{textModels.map((model) => (
							<SelectionRow
								key={model.id}
								selected={value.models.includes(model.id)}
								onSelectedChange={(selected) =>
									onChange({
										...value,
										models: selected
											? [...value.models, model.id]
											: value.models.filter((id) => id !== model.id),
									})
								}
							>
								<ModelOption model={model} />
							</SelectionRow>
						))}
					</FieldGroup>
					<Field>
						<FieldLabel
							htmlFor={`${id}-expected-output`}
							className="text-xs text-muted-foreground"
						>
							Expected output tokens
						</FieldLabel>
						<Input
							id={`${id}-expected-output`}
							inputMode="numeric"
							value={
								Number.isFinite(value.expectedOutputTokens)
									? String(value.expectedOutputTokens)
									: ""
							}
							onChange={(event) =>
								onChange({
									...value,
									expectedOutputTokens: event.target.value.trim()
										? Number(event.target.value)
										: NaN,
								})
							}
						/>
					</Field>
					<Field>
						<FieldLabel
							htmlFor={`${id}-expected-requests`}
							className="text-xs text-muted-foreground"
						>
							Expected requests with the same context
						</FieldLabel>
						<Input
							id={`${id}-expected-requests`}
							inputMode="numeric"
							value={
								Number.isFinite(value.expectedRequests)
									? String(value.expectedRequests)
									: ""
							}
							onChange={(event) =>
								onChange({
									...value,
									expectedRequests: event.target.value.trim()
										? Number(event.target.value)
										: NaN,
								})
							}
						/>
					</Field>
				</>
			)}
		</FieldGroup>
	);
}
