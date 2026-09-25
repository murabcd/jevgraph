import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
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
			<FieldLabel className="text-xs text-muted-foreground">
				Select variables
			</FieldLabel>
			<div className="grid gap-2">
				{fields.map((field) => {
					const active = selectedNames.has(field.name);
					const typeLabel = startFieldTypes.find(
						(option) => option.value === field.type,
					)?.label;
					return (
						<Button
							key={field.name}
							type="button"
							variant={active ? "secondary" : "outline"}
							className="justify-between"
							aria-pressed={active}
							onClick={() =>
								onChange(
									active
										? selected.filter((name) => name !== field.name)
										: [...selected, field.name],
								)
							}
						>
							<span>
								{field.name}{" "}
								<span className="text-muted-foreground">· {typeLabel}</span>
							</span>
							{active && <Check className="size-4" />}
						</Button>
					);
				})}
			</div>
		</Field>
	);
}
