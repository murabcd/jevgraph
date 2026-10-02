import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	ContextPolicyFields,
	type ContextSourceOption,
} from "@/flow/context-policy-fields";
import type { JevNodeSettings } from "@/flow/graph";
import { JevQuestionFields } from "@/flow/jev-question-fields";
import { PricingFields } from "@/flow/pricing-fields";
import { StartVariableBinding } from "@/flow/start-variable-binding";
import {
	type ContextDocument,
	type ContextPolicy,
	contextPolicySchema,
	DEFAULT_CONTEXT_POLICY,
	retainBoundInstructions,
} from "@/lib/context";
import {
	configuredJevQuestionsSchema,
	defaultJevQuestion,
	type JevQuestion,
	MAX_JEV_QUESTIONS,
} from "@/lib/jev-question";
import { JEV_PUBLISHED_PRICING } from "@/lib/model-pricing";
import type { StartField } from "@/lib/routing";
import { type Pricing, pricingSchema } from "@/lib/usage";

type Props = {
	title: string;
	questions: JevQuestion[];
	fields: StartField[];
	variables: string[];
	context?: ContextPolicy;
	pricing?: Pricing;
	contextSources: ContextSourceOption[];
	documents: ContextDocument[];
	hasRepeat?: boolean;
	maxRepeats: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (settings: JevNodeSettings) => void;
};

export function JevQuestionEditor({
	title,
	questions,
	fields,
	variables,
	context,
	pricing,
	contextSources,
	documents,
	hasRepeat,
	maxRepeats,
	open,
	onOpenChange,
	onSave,
}: Props) {
	const [draft, setDraft] = useState(questions);
	const [repeatDraft, setRepeatDraft] = useState(maxRepeats);
	const [variablesDraft, setVariablesDraft] = useState(variables);
	const [contextDraft, setContextDraft] = useState(
		context ?? DEFAULT_CONTEXT_POLICY,
	);
	const [pricingDraft, setPricingDraft] = useState(pricing);
	const [error, setError] = useState("");
	const selected = new Set(variablesDraft);
	const save = () => {
		const parsed = configuredJevQuestionsSchema.safeParse(draft);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Complete every question.");
			return;
		}
		const parsedContext = contextPolicySchema.safeParse(contextDraft);
		const parsedPricing = pricingSchema.optional().safeParse(pricingDraft);
		if (!parsedContext.success || !parsedPricing.success) {
			setError("Check context settings and pricing rates.");
			return;
		}
		if (hasRepeat && draft.length !== 1) {
			setError(
				"A repeat node must contain one question. Remove the repeat connection before adding questions.",
			);
			return;
		}
		onSave({
			questions: parsed.data,
			variables: variablesDraft,
			context: parsedContext.data,
			pricing: parsedPricing.data,
			maxRepeats: repeatDraft,
		});
		onOpenChange(false);
	};
	return (
		<Sheet
			modal={false}
			disablePointerDismissal
			open={open}
			onOpenChange={onOpenChange}
		>
			<SheetContent variant="floating">
				<SheetHeader>
					<SheetTitle>{title}</SheetTitle>
				</SheetHeader>
				<ScrollArea
					className="min-h-0 flex-1"
					viewportClassName="scroll-fade-b"
				>
					<div className="flex flex-col gap-6 px-4 pb-4">
						{draft.map((question) => (
							<section
								key={question.id}
								className="relative grid gap-4 rounded-lg border p-3"
								aria-label={question.name}
							>
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">{question.name}</span>
									{draft.length > 1 && (
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={`Remove ${question.name}`}
											onClick={() =>
												setDraft((items) =>
													items.filter(({ id }) => id !== question.id),
												)
											}
										>
											<X />
										</Button>
									)}
								</div>
								<JevQuestionFields
									question={question}
									onChange={(value) =>
										setDraft((items) =>
											items.map((item) =>
												item.id === question.id ? value : item,
											),
										)
									}
								/>
							</section>
						))}
						<Button
							type="button"
							variant="outline"
							disabled={!!hasRepeat || draft.length >= MAX_JEV_QUESTIONS}
							onClick={() =>
								setDraft((items) => {
									const names = new Set(items.map((item) => item.name));
									const name = Array.from(
										{ length: MAX_JEV_QUESTIONS + 1 },
										(_, index) => `Question ${index + 1}`,
									).find((candidate) => !names.has(candidate));
									return [
										...items,
										{
											...defaultJevQuestion(),
											id: crypto.randomUUID(),
											name: name ?? "Question",
										},
									];
								})
							}
						>
							<Plus /> Add question
						</Button>
						<StartVariableBinding
							fields={fields}
							selected={variablesDraft}
							onChange={(values) => {
								setVariablesDraft(values);
								setContextDraft((policy) =>
									retainBoundInstructions(
										policy,
										values,
										contextSources.map(({ id }) => id),
									),
								);
							}}
						/>
						{hasRepeat && (
							<Field>
								<FieldLabel htmlFor="jev-repeat-limit">Repeat limit</FieldLabel>
								<Select
									value={String(repeatDraft)}
									onValueChange={(value) => {
										if (value) setRepeatDraft(Number(value));
									}}
								>
									<SelectTrigger id="jev-repeat-limit" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent alignItemWithTrigger={false}>
										<SelectGroup>
											{[1, 2, 3, 4, 5].map((limit) => (
												<SelectItem key={limit} value={String(limit)}>
													{limit} repeats
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</Field>
						)}
						<ContextPolicyFields
							fields={fields.filter(({ name }) => selected.has(name))}
							id="jev"
							value={contextDraft}
							onChange={setContextDraft}
							sources={contextSources}
							documents={documents}
						/>
						<PricingFields
							id="jev"
							published={JEV_PUBLISHED_PRICING}
							value={pricingDraft}
							onChange={setPricingDraft}
						/>
						{error && <FieldError>{error}</FieldError>}
					</div>
				</ScrollArea>
				<SheetFooter>
					<Button onClick={save}>Save</Button>
					<SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
