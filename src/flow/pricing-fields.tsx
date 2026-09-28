import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
			{published && (
				<Button
					variant="link"
					size="sm"
					className="h-auto justify-start px-0"
					render={
						<a
							href={published.source}
							target="_blank"
							rel="noreferrer"
							aria-label={`${published.model} pricing: $${published.rates.input} input and $${published.rates.output} output per million tokens`}
						/>
					}
					title={`${published.model} rates verified ${published.verifiedAt}`}
				>
					${published.rates.input} input · ${published.rates.output} output / 1M
				</Button>
			)}
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
				<>
					<FieldLabel className="text-xs">Rates (USD / 1M tokens)</FieldLabel>
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
				</>
			)}
		</FieldGroup>
	);
}
