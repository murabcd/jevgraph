import { Field, FieldLegend } from "@/components/ui/field";
import { SelectionRow } from "@/flow/selection-row";
import type { StartField } from "@/lib/routing";
import { startFieldTypes } from "./start-field-types";

export function StartVariableBinding({
	fields,
	selected,
	onChange,
}: {
	fields: StartField[];
	selected: string[];
	onChange: (names: string[]) => void;
}) {
	if (fields.length === 0) return null;
	const selectedNames = new Set(selected);

	return (
		<Field>
			<FieldLegend
				variant="label"
				className="mb-0 text-xs text-muted-foreground"
			>
				Select variables
			</FieldLegend>
			<div className="grid gap-2">
				{fields.map((field) => {
					const active = selectedNames.has(field.name);
					const typeLabel = startFieldTypes.find(
						(option) => option.value === field.type,
					)?.label;
					return (
						<SelectionRow
							key={field.name}
							selected={active}
							onSelectedChange={(selectedValue) =>
								onChange(
									selectedValue
										? [...selected, field.name]
										: selected.filter((name) => name !== field.name),
								)
							}
						>
							<span>
								{field.name}{" "}
								<span className="text-muted-foreground">· {typeLabel}</span>
							</span>
						</SelectionRow>
					);
				})}
			</div>
		</Field>
	);
}
