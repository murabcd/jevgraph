import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { type StartField, startFieldSchema } from "@/lib/routing";
import { startFieldTypes } from "./start-field-types";

type FieldType = StartField["type"];

function fieldCandidate(
	name: string,
	type: FieldType,
	required: boolean,
	defaultText: string,
) {
	switch (type) {
		case "string":
			return { name, type, required, defaultValue: defaultText || undefined };
		case "number":
			return {
				name,
				type,
				required,
				defaultValue:
					defaultText.trim() === "" ? undefined : Number(defaultText),
			};
		case "boolean":
			return {
				name,
				type,
				required,
				defaultValue: defaultText === "" ? undefined : defaultText === "true",
			};
	}
}

function DefaultValueControl({
	type,
	value,
	onChange,
}: {
	type: FieldType;
	value: string;
	onChange: (value: string) => void;
}) {
	if (type !== "boolean") {
		return (
			<Input
				id="start-field-default"
				type="text"
				inputMode={type === "number" ? "decimal" : undefined}
				value={value}
				maxLength={type === "string" ? 256 : undefined}
				onChange={(event) => onChange(event.target.value)}
			/>
		);
	}
	const label =
		value === "" ? "No default" : value === "true" ? "True" : "False";
	return (
		<Select
			value={value || "unset"}
			onValueChange={(next) => onChange(next === "unset" ? "" : (next ?? ""))}
		>
			<SelectTrigger id="start-field-default" className="w-full">
				<SelectValue>{label}</SelectValue>
			</SelectTrigger>
			<SelectContent alignItemWithTrigger={false}>
				<SelectGroup>
					<SelectItem value="unset">No default</SelectItem>
					<SelectItem value="true">True</SelectItem>
					<SelectItem value="false">False</SelectItem>
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

export function StartFieldDialog({
	field,
	existingNames,
	onSave,
	onClose,
}: {
	field?: StartField;
	existingNames: string[];
	onSave: (field: StartField) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState(field?.name ?? "");
	const [type, setType] = useState<FieldType>(field?.type ?? "string");
	const [defaultText, setDefaultText] = useState(
		field?.defaultValue === undefined ? "" : String(field.defaultValue),
	);
	const [required, setRequired] = useState(field?.required ?? false);
	const [error, setError] = useState("");
	const typeOption = startFieldTypes.find((option) => option.value === type);
	const save = () => {
		const candidate = fieldCandidate(name, type, required, defaultText);
		const parsed = startFieldSchema.safeParse(candidate);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Check the field settings.");
			return;
		}
		if (existingNames.includes(parsed.data.name)) {
			setError("Variable names must be unique.");
			return;
		}
		onSave(parsed.data);
		onClose();
	};
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-md" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>
						{field ? "Edit Input Field" : "Add Input Field"}
					</DialogTitle>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<FieldLabel
							htmlFor="start-field-type"
							className="text-xs text-muted-foreground"
						>
							Field Type
						</FieldLabel>
						<Select
							value={type}
							onValueChange={(value) => {
								const next = startFieldTypes.find(
									(option) => option.value === value,
								);
								if (next) {
									setType(next.value);
									setDefaultText("");
									setError("");
								}
							}}
						>
							<SelectTrigger id="start-field-type" className="w-full">
								<SelectValue>
									<span className="flex items-center gap-2">
										{typeOption && <typeOption.Icon className="size-4" />}
										{typeOption?.label}
									</span>
								</SelectValue>
							</SelectTrigger>
							<SelectContent alignItemWithTrigger={false}>
								<SelectGroup>
									{startFieldTypes.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											<span className="flex items-center gap-2">
												<option.Icon className="size-4" /> {option.label}
											</span>
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<FieldLabel
							htmlFor="start-field-name"
							className="text-xs text-muted-foreground"
						>
							Variable Name
						</FieldLabel>
						<Input
							id="start-field-name"
							value={name}
							maxLength={64}
							placeholder="variableName"
							onChange={(event) => setName(event.target.value)}
						/>
					</Field>
					<Field>
						<FieldLabel
							htmlFor="start-field-default"
							className="text-xs text-muted-foreground"
						>
							Default Value
						</FieldLabel>
						<DefaultValueControl
							type={type}
							value={defaultText}
							onChange={setDefaultText}
						/>
					</Field>
					<label
						htmlFor="start-field-required"
						className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
					>
						<Checkbox
							id="start-field-required"
							checked={required}
							onCheckedChange={setRequired}
						/>
						Required
					</label>
					{error && (
						<p className="text-xs text-destructive" role="alert">
							{error}
						</p>
					)}
				</FieldGroup>
				<DialogFooter className="border-t-0 bg-transparent">
					<Button type="button" variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button type="button" onClick={save}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
