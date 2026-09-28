import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function SelectionRow({
	selected,
	onSelectedChange,
	children,
}: {
	selected: boolean;
	onSelectedChange: (selected: boolean) => void;
	children: ReactNode;
}) {
	return (
		<Button
			type="button"
			variant={selected ? "secondary" : "outline"}
			className="w-full justify-between aria-pressed:border-border has-data-[icon=inline-end]:pr-2.5 dark:aria-pressed:border-input"
			aria-pressed={selected}
			onClick={() => onSelectedChange(!selected)}
		>
			<span className="min-w-0 truncate text-left">{children}</span>
			{selected && <Check data-icon="inline-end" aria-hidden="true" />}
		</Button>
	);
}
