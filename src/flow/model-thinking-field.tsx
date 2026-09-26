import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ReasoningEffort, TextModel } from "@/lib/models";
import {
	reasoningEffortSchema,
	thinkingBudgetSchema,
	validThinkingBudget,
} from "@/lib/routing";

export type ThinkingDraft =
	| { kind: "effort"; effort: ReasoningEffort }
	| { kind: "budget"; budget: string }
	| { kind: "none" };

type ThinkingSettings = {
	reasoningEffort?: ReasoningEffort;
	thinkingBudget?: number;
};

export function thinkingDraftForModel(
	model: TextModel,
	settings: ThinkingSettings = {},
): ThinkingDraft {
	const { thinking } = model;
	if (thinking.kind === "effort")
		return {
			kind: "effort",
			effort:
				settings.reasoningEffort &&
				thinking.efforts.includes(settings.reasoningEffort)
					? settings.reasoningEffort
					: thinking.defaultEffort,
		};
	if (thinking.kind === "budget")
		return {
			kind: "budget",
			budget: String(settings.thinkingBudget ?? thinking.defaultBudget),
		};
	return { kind: "none" };
}

export function parseThinkingDraft(
	model: TextModel,
	draft: ThinkingDraft,
	maxOutputTokens: number,
): { success: true; settings: ThinkingSettings } | { success: false } {
	if (model.thinking.kind === "effort" && draft.kind === "effort")
		return model.thinking.efforts.includes(draft.effort)
			? { success: true, settings: { reasoningEffort: draft.effort } }
			: { success: false };
	if (model.thinking.kind === "budget" && draft.kind === "budget") {
		const budget = thinkingBudgetSchema.safeParse(
			draft.budget.trim() === "" ? NaN : Number(draft.budget),
		);
		return budget.success &&
			validThinkingBudget(
				model.provider,
				model.id,
				budget.data,
				maxOutputTokens,
			)
			? { success: true, settings: { thinkingBudget: budget.data } }
			: { success: false };
	}
	return model.thinking.kind === "none" && draft.kind === "none"
		? { success: true, settings: {} }
		: { success: false };
}

function effortLabel(value: string | null): string | null {
	return value ? value[0].toUpperCase() + value.slice(1) : null;
}

export function ModelThinkingField({
	id,
	model,
	draft,
	onChange,
}: {
	id: string;
	model: TextModel;
	draft: ThinkingDraft;
	onChange: (draft: ThinkingDraft) => void;
}) {
	const thinking = model.thinking;
	if (thinking.kind === "effort" && draft.kind === "effort")
		return (
			<Field>
				<FieldLabel
					htmlFor={`${id}-reasoning`}
					className="text-xs text-muted-foreground"
				>
					Reasoning effort
				</FieldLabel>
				<Select
					value={draft.effort}
					onValueChange={(value) => {
						const parsed = reasoningEffortSchema.safeParse(value);
						if (parsed.success && thinking.efforts.includes(parsed.data))
							onChange({ kind: "effort", effort: parsed.data });
					}}
				>
					<SelectTrigger id={`${id}-reasoning`} className="w-full">
						<SelectValue>{effortLabel}</SelectValue>
					</SelectTrigger>
					<SelectContent alignItemWithTrigger={false}>
						<SelectGroup>
							{thinking.efforts.map((effort) => (
								<SelectItem key={effort} value={effort}>
									{effortLabel(effort)}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</Field>
		);
	if (thinking.kind === "budget" && draft.kind === "budget")
		return (
			<Field>
				<FieldLabel
					htmlFor={`${id}-thinking-budget`}
					className="text-xs text-muted-foreground"
				>
					Thinking budget
				</FieldLabel>
				<Input
					id={`${id}-thinking-budget`}
					type="text"
					inputMode="numeric"
					value={draft.budget}
					onChange={(event) =>
						onChange({ kind: "budget", budget: event.target.value })
					}
				/>
				<p className="text-xs text-muted-foreground">
					-1 uses dynamic thinking; 0 turns it off where supported.
				</p>
			</Field>
		);
	return null;
}
