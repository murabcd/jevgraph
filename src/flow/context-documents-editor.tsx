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
import type { ContextDocument } from "@/lib/context";

export function ContextDocumentsEditor({
	documents,
	onChange,
}: {
	documents: ContextDocument[];
	onChange: (documents: ContextDocument[]) => void;
}) {
	const update = (id: string, patch: Partial<ContextDocument>) =>
		onChange(
			documents.map((document) =>
				document.id === id ? { ...document, ...patch } : document,
			),
		);
	return (
		<FieldGroup className="gap-3">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-muted-foreground">
					Context documents
				</span>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={documents.length >= 20}
					onClick={() =>
						onChange([
							...documents,
							{ id: crypto.randomUUID(), name: "", content: "" },
						])
					}
				>
					<Plus data-icon="inline-start" /> Add document
				</Button>
			</div>
			{documents.map((document, index) => (
				<FieldGroup key={document.id} className="gap-3">
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs font-medium">Document {index + 1}</span>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={<Button variant="ghost" size="icon-sm" />}
								aria-label={`Document ${index + 1} options`}
							>
								<MoreHorizontal />
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="end"
								className="w-max whitespace-nowrap"
							>
								<DropdownMenuGroup>
									<DropdownMenuItem
										variant="destructive"
										onClick={() =>
											onChange(documents.filter(({ id }) => id !== document.id))
										}
									>
										<Trash2 /> Remove document
									</DropdownMenuItem>
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
					<Field>
						<FieldLabel
							htmlFor={`document-name-${document.id}`}
							className="text-xs text-muted-foreground"
						>
							Name
						</FieldLabel>
						<Input
							id={`document-name-${document.id}`}
							value={document.name}
							maxLength={100}
							onChange={(event) =>
								update(document.id, { name: event.target.value })
							}
						/>
					</Field>
					<Field>
						<FieldLabel
							htmlFor={`document-content-${document.id}`}
							className="text-xs text-muted-foreground"
						>
							Full text
						</FieldLabel>
						<InputGroup>
							<InputGroupTextarea
								id={`document-content-${document.id}`}
								value={document.content}
								maxLength={120000}
								rows={3}
								className="min-h-[132px] max-h-52"
								onChange={(event) =>
									update(document.id, { content: event.target.value })
								}
							/>
						</InputGroup>
					</Field>
					<Field>
						<FieldLabel
							htmlFor={`document-summary-${document.id}`}
							className="text-xs text-muted-foreground"
						>
							Summary (optional)
						</FieldLabel>
						<InputGroup>
							<InputGroupTextarea
								id={`document-summary-${document.id}`}
								value={document.summary ?? ""}
								maxLength={12000}
								rows={2}
								className="min-h-[132px] max-h-52"
								onChange={(event) =>
									update(document.id, {
										summary: event.target.value.trim()
											? event.target.value
											: undefined,
									})
								}
							/>
						</InputGroup>
					</Field>
				</FieldGroup>
			))}
		</FieldGroup>
	);
}
