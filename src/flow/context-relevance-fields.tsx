import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import { PricingFields } from "@/flow/pricing-fields";
import { SelectionRow } from "@/flow/selection-row";
import type { ContextPolicy } from "@/lib/context";
import { JEV_PUBLISHED_PRICING } from "@/lib/model-pricing";

export function ContextRelevanceFields({
	id,
	value,
	onChange,
}: {
	id: string;
	value: ContextPolicy["relevance"];
	onChange: (relevance: ContextPolicy["relevance"]) => void;
}) {
	return (
		<>
			<SelectionRow
				selected={Boolean(value)}
				onSelectedChange={(selected) =>
					onChange(
						selected
							? {
									instructions:
										"Keep information needed to answer the current query, including constraints and previous decisions.",
									minimumConfidence: 0.9,
								}
							: undefined,
					)
				}
			>
				Filter context relevance with Jev
			</SelectionRow>
			{value && (
				<FieldGroup className="gap-3">
					<Field>
						<FieldLabel
							htmlFor={`${id}-relevance-instructions`}
							className="text-xs"
						>
							Relevance instructions
						</FieldLabel>
						<InputGroup>
							<InputGroupTextarea
								id={`${id}-relevance-instructions`}
								maxLength={500}
								rows={3}
								className="min-h-20 max-h-44"
								value={value.instructions}
								onChange={(event) =>
									onChange({ ...value, instructions: event.target.value })
								}
							/>
						</InputGroup>
					</Field>
					<Field>
						<FieldLabel
							htmlFor={`${id}-relevance-confidence`}
							className="text-xs"
						>
							Minimum probability to omit (%)
						</FieldLabel>
						<Input
							id={`${id}-relevance-confidence`}
							inputMode="decimal"
							value={
								Number.isFinite(value.minimumConfidence)
									? String(value.minimumConfidence * 100)
									: ""
							}
							onChange={(event) =>
								onChange({
									...value,
									minimumConfidence: event.target.value.trim()
										? Number(event.target.value) / 100
										: NaN,
								})
							}
						/>
					</Field>
					<PricingFields
						id={`${id}-relevance`}
						published={JEV_PUBLISHED_PRICING}
						value={value.pricing}
						onChange={(pricing) => onChange({ ...value, pricing })}
					/>
				</FieldGroup>
			)}
		</>
	);
}
