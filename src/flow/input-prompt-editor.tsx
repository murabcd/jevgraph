import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type Props = {
	value: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (value: string) => void;
};

export function InputPromptEditor({
	value,
	open,
	onOpenChange,
	onSave,
}: Props) {
	const [draft, setDraft] = useState(value);
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Request</SheetTitle>
				</SheetHeader>
				<ScrollArea className="min-h-0 flex-1">
					<FieldGroup className="px-4 pb-4">
						<Field>
							<FieldLabel htmlFor="input-prompt">Prompt</FieldLabel>
							<Textarea
								id="input-prompt"
								className="min-h-[60dvh] max-h-[75dvh]"
								placeholder="Write a prompt..."
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								autoFocus
							/>
						</Field>
					</FieldGroup>
				</ScrollArea>
				<SheetFooter>
					<Button
						onClick={() => {
							onSave(draft);
							onOpenChange(false);
						}}
					>
						Save prompt
					</Button>
					<SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
