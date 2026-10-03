import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectionRow } from "@/flow/selection-row";
import type { PublishedPricing } from "@/lib/model-pricing";
import type { Pricing } from "@/lib/usage";

export function PricingFields({
	id,
	value,
	onChange,
	published,
}: {
	id: string;
	value?: Pricing;
	onChange: (pricing: Pricing | undefined) => void;
	published?: PublishedPricing;
}) {
	return (
		<FieldGroup className="gap-3">
			<SelectionRow
				selected={Boolean(value)}
				onSelectedChange={(selected) =>
					onChange(
						selected
							? published
								? { ...published.rates }
								: { input: NaN, output: NaN }
							: undefined,
					)
				}
			>
				{published ? "Custom rates" : "Estimate cost with supplied rates"}
			</SelectionRow>
			{value && (
				<FieldSet className="gap-3">
					<FieldLegend variant="label" className="mb-0 text-xs">
						Rates (USD / 1M tokens)
					</FieldLegend>
					<FieldGroup className="grid grid-cols-2 gap-3">
						{(
							[
								{ key: "input", label: "Input" },
								{ key: "output", label: "Output" },
								{ key: "cachedInput", label: "Cached input" },
								{ key: "cacheWrite", label: "Cache write" },
							] as const
						).map(({ key, label }) => (
							<Field key={key}>
								<FieldLabel htmlFor={`${id}-price-${key}`} className="text-xs">
									{label}
									{key === "cachedInput" || key === "cacheWrite"
										? " (optional)"
										: ""}
								</FieldLabel>
								<Input
									id={`${id}-price-${key}`}
									inputMode="decimal"
									value={Number.isFinite(value[key]) ? String(value[key]) : ""}
									onChange={(event) =>
										onChange({
											...value,
											[key]: event.target.value.trim()
												? Number(event.target.value)
												: key === "input" || key === "output"
													? NaN
													: undefined,
										})
									}
								/>
							</Field>
						))}
					</FieldGroup>
				</FieldSet>
			)}
		</FieldGroup>
	);
}
