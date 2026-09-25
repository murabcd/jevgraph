import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { type StartField, startFieldsSchema } from "@/lib/routing";
import { StartFieldDialog } from "./start-field-dialog";
import { startFieldTypes } from "./start-field-types";

type FieldEditor = { kind: "add" } | { kind: "edit"; index: number };
type FieldRow = { id: string; field: StartField };

export function StartEditor({
	fields,
	onSave,
	onOpenChange,
}: {
	fields: StartField[];
	onSave: (fields: StartField[]) => void;
	onOpenChange: (open: boolean) => void;
}) {
	const [rows, setRows] = useState<FieldRow[]>(() =>
		fields.map((field) => ({ id: crypto.randomUUID(), field })),
	);
	const [editor, setEditor] = useState<FieldEditor | null>(null);
	const [error, setError] = useState("");

	const save = () => {
		const parsed = startFieldsSchema.safeParse(rows.map((row) => row.field));
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Check the input fields.");
			return;
		}
		onSave(parsed.data);
		onOpenChange(false);
	};

	return (
		<Sheet
			modal={false}
			disablePointerDismissal
			open
			onOpenChange={onOpenChange}
		>
			<SheetContent variant="floating">
				<SheetHeader>
					<SheetTitle>Start</SheetTitle>
				</SheetHeader>
				<ScrollArea
					className="min-h-0 flex-1"
					viewportClassName="scroll-fade-b"
				>
					<div className="grid gap-4 px-4 pb-4">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-muted-foreground">
								Input fields
							</span>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={rows.length >= 20}
								onClick={() => setEditor({ kind: "add" })}
							>
								<Plus /> Add field
							</Button>
						</div>
						<div className="grid gap-2">
							{rows.map(({ id, field }, index) => {
								const typeLabel = startFieldTypes.find(
									(option) => option.value === field.type,
								)?.label;
								return (
									<div
										key={id}
										className="group flex min-h-8 items-center gap-2 rounded-lg border border-input bg-muted/30 px-2.5 hover:bg-muted/50 dark:bg-input/30 dark:hover:bg-input/50"
									>
										<button
											type="button"
											className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
											onClick={() => setEditor({ kind: "edit", index })}
											aria-label={`Edit field ${field.name}`}
										>
											<span className="truncate font-medium">{field.name}</span>
											<span className="truncate text-xs text-muted-foreground">
												{typeLabel}
											</span>
										</button>
										<div className="flex items-center">
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
												aria-label={`Edit field ${field.name}`}
												onClick={() => setEditor({ kind: "edit", index })}
											>
												<Pencil />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
												aria-label={`Remove field ${field.name}`}
												onClick={() => {
													setRows((current) =>
														current.filter(
															(_, itemIndex) => itemIndex !== index,
														),
													);
													setError("");
												}}
											>
												<Trash2 />
											</Button>
										</div>
									</div>
								);
							})}
						</div>
						{error && (
							<p className="text-xs text-destructive" role="alert">
								{error}
							</p>
						)}
					</div>
				</ScrollArea>
				<SheetFooter>
					<Button onClick={save}>Save</Button>
					<SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
				</SheetFooter>
			</SheetContent>
			{editor && (
				<StartFieldDialog
					key={editor.kind === "add" ? "add" : rows[editor.index]?.id}
					field={editor.kind === "edit" ? rows[editor.index]?.field : undefined}
					existingNames={rows
						.filter(
							(_, index) => editor.kind === "add" || index !== editor.index,
						)
						.map((row) => row.field.name)}
					onSave={(field) => {
						if (editor.kind === "add") {
							setRows((current) => [
								...current,
								{ id: crypto.randomUUID(), field },
							]);
						} else {
							setRows((current) =>
								current.map((row, index) =>
									index === editor.index ? { ...row, field } : row,
								),
							);
						}
						setError("");
					}}
					onClose={() => setEditor(null)}
				/>
			)}
		</Sheet>
	);
}
