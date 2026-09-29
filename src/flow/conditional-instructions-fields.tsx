import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ContextSourceOption } from "@/flow/context-policy-fields";
import type { ConditionalInstruction } from "@/lib/conditional-instructions";
import type { StartField } from "@/lib/routing";

export function ConditionalInstructionsFields({
	id,
	value,
	onChange,
	fields,
	sources,
}: {
	id: string;
	value: ConditionalInstruction[];
	onChange: (value: ConditionalInstruction[]) => void;
	fields: StartField[];
	sources: ContextSourceOption[];
}) {
	const conditions: {
		label: string;
		condition: ConditionalInstruction["condition"];
	}[] = [
		...fields.map((field) => ({
			label: `Start · ${field.name}`,
			condition: {
				kind: "variable" as const,
				name: field.name,
				value:
					field.defaultValue ??
					(field.type === "boolean" ? false : field.type === "number" ? 0 : ""),
			},
		})),
		...sources.flatMap((source) =>
			(source.outputs ?? []).map((output) => ({
				label: `${source.name} · ${output.label}`,
				condition: {
					kind: "decision" as const,
					nodeId: source.id,
					outputId: output.id,
				},
			})),
		),
	];
	const update = (ruleId: string, patch: Partial<ConditionalInstruction>) =>
		onChange(
			value.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
		);
	return (
		<FieldGroup className="gap-3">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium">Conditional instructions</span>
				<Button
					variant="outline"
					size="sm"
					type="button"
					disabled={value.length >= 8 || conditions.length === 0}
					onClick={() =>
						onChange([
							...value,
							{
								id: crypto.randomUUID(),
								name: "",
								instructions: "",
								condition: conditions[0].condition,
							},
						])
					}
				>
					<Plus data-icon="inline-start" />
					Add instruction
				</Button>
			</div>
			{value.map((rule, index) => {
				const condition = rule.condition;
				const choice = conditions.findIndex((option) =>
					condition.kind === "variable"
						? option.condition.kind === "variable" &&
							option.condition.name === condition.name
						: option.condition.kind === "decision" &&
							option.condition.nodeId === condition.nodeId &&
							option.condition.outputId === condition.outputId,
				);
				const field =
					condition.kind === "variable"
						? fields.find((field) => field.name === condition.name)
						: undefined;
				return (
					<FieldGroup key={rule.id} className="gap-3">
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs font-medium">
								Instruction {index + 1}
							</span>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={<Button variant="ghost" size="icon-sm" />}
									aria-label={`Instruction ${index + 1} options`}
								>
									<MoreHorizontal />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuGroup>
										<DropdownMenuItem
											variant="destructive"
											onClick={() =>
												onChange(value.filter((item) => item.id !== rule.id))
											}
										>
											<Trash2 />
											Remove instruction
										</DropdownMenuItem>
									</DropdownMenuGroup>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
						<Field>
							<FieldLabel
								htmlFor={`${id}-${rule.id}-name`}
								className="text-xs text-muted-foreground"
							>
								Name
							</FieldLabel>
							<Input
								id={`${id}-${rule.id}-name`}
								value={rule.name}
								maxLength={100}
								onChange={(event) =>
									update(rule.id, { name: event.target.value })
								}
							/>
						</Field>
						<Field>
							<FieldLabel
								htmlFor={`${id}-${rule.id}-when`}
								className="text-xs text-muted-foreground"
							>
								When
							</FieldLabel>
							<Select
								value={choice >= 0 ? String(choice) : null}
								onValueChange={(selected) => {
									const next =
										selected === null
											? undefined
											: conditions[Number(selected)];
									if (next) update(rule.id, { condition: next.condition });
								}}
							>
								<SelectTrigger id={`${id}-${rule.id}-when`} className="w-full">
									<SelectValue>
										{() =>
											choice >= 0
												? conditions[choice].label
												: "Select a condition"
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent alignItemWithTrigger={false}>
									<SelectGroup>
										{conditions.map((option, index) => (
											<SelectItem key={option.label} value={String(index)}>
												{option.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>
						{condition.kind === "variable" && (
							<Field>
								<FieldLabel
									htmlFor={`${id}-${rule.id}-equals`}
									className="text-xs text-muted-foreground"
								>
									Equals
								</FieldLabel>
								{field?.type === "boolean" ? (
									<Select
										value={String(condition.value)}
										onValueChange={(selected) => {
											if (selected === "true" || selected === "false")
												update(rule.id, {
													condition: {
														...condition,
														value: selected === "true",
													},
												});
										}}
									>
										<SelectTrigger
											id={`${id}-${rule.id}-equals`}
											className="w-full"
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent alignItemWithTrigger={false}>
											<SelectGroup>
												<SelectItem value="true">True</SelectItem>
												<SelectItem value="false">False</SelectItem>
											</SelectGroup>
										</SelectContent>
									</Select>
								) : (
									<Input
										id={`${id}-${rule.id}-equals`}
										inputMode={field?.type === "number" ? "decimal" : "text"}
										value={
											typeof condition.value === "number" &&
											!Number.isFinite(condition.value)
												? ""
												: String(condition.value)
										}
										maxLength={256}
										onChange={(event) =>
											update(rule.id, {
												condition: {
													...condition,
													value:
														field?.type === "number"
															? event.target.value.trim()
																? Number(event.target.value)
																: NaN
															: event.target.value,
												},
											})
										}
									/>
								)}
							</Field>
						)}
						<Field>
							<FieldLabel
								htmlFor={`${id}-${rule.id}-instructions`}
								className="text-xs text-muted-foreground"
							>
								Instructions
							</FieldLabel>
							<InputGroup>
								<InputGroupTextarea
									id={`${id}-${rule.id}-instructions`}
									value={rule.instructions}
									maxLength={4000}
									rows={3}
									className="min-h-[132px] max-h-52"
									onChange={(event) =>
										update(rule.id, { instructions: event.target.value })
									}
								/>
							</InputGroup>
						</Field>
					</FieldGroup>
				);
			})}
		</FieldGroup>
	);
}
