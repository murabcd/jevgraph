import { AlignLeft, Ban, FileText } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ContextDocument, ContextPolicy } from "@/lib/context";

export function ContextDocumentBindingFields({
	id,
	value,
	onChange,
	documents,
}: {
	id: string;
	value: ContextPolicy["documents"];
	onChange: (bindings: ContextPolicy["documents"]) => void;
	documents: ContextDocument[];
}) {
	const bindings = new Map(value.map((binding) => [binding.id, binding]));
	return documents.map((document) => {
		const representation = bindings.get(document.id)?.representation ?? "omit";
		return (
			<Field key={document.id}>
				<FieldLabel
					htmlFor={`${id}-document-${document.id}`}
					className="text-xs text-muted-foreground"
				>
					{document.name}
				</FieldLabel>
				<Select
					value={representation}
					onValueChange={(representation) => {
						if (
							representation !== "omit" &&
							representation !== "full" &&
							representation !== "summary"
						)
							return;
						const bindings = value.filter(({ id }) => id !== document.id);
						if (representation !== "omit")
							bindings.push({ id: document.id, representation });
						onChange(bindings);
					}}
				>
					<SelectTrigger
						id={`${id}-document-${document.id}`}
						className="w-full"
					>
						<SelectValue>
							{() =>
								({
									omit: "Omit",
									full: "Full text",
									summary: "Supplied summary",
								})[representation]
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent alignItemWithTrigger={false}>
						<SelectGroup>
							<SelectItem value="omit">
								<Ban />
								Omit
							</SelectItem>
							<SelectItem value="full">
								<FileText />
								Full text
							</SelectItem>
							<SelectItem value="summary" disabled={!document.summary}>
								<AlignLeft />
								Supplied summary
							</SelectItem>
						</SelectGroup>
					</SelectContent>
				</Select>
			</Field>
		);
	});
}
