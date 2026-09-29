import { Ban, Layers, ListChecks, MessageSquare, Sparkles } from "lucide-react";
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
import { ConditionalInstructionsFields } from "@/flow/conditional-instructions-fields";
import { ContextDocumentBindingFields } from "@/flow/context-document-binding-fields";
import { ContextRelevanceFields } from "@/flow/context-relevance-fields";
import { ContextRetrievalFields } from "@/flow/context-retrieval-fields";
import { SelectionRow } from "@/flow/selection-row";
import {
	type ContextDocument,
	type ContextPolicy,
	retainBoundInstructions,
} from "@/lib/context";
import type { StartField } from "@/lib/routing";

export type ContextSourceOption = {
	id: string;
	name: string;
	outputs?: { id: string; label: string }[];
};

export function ContextPolicyFields({
	id,
	value,
	onChange: onPolicyChange,
	sources,
	documents,
	fields,
}: {
	id: string;
	value: ContextPolicy;
	onChange: (policy: ContextPolicy) => void;
	sources: ContextSourceOption[];
	documents: ContextDocument[];
	fields: StartField[];
}) {
	const selectedOutputs = new Set(value.outputNodeIds);
	const onChange = (policy: ContextPolicy) =>
		onPolicyChange(
			retainBoundInstructions(
				policy,
				fields.map(({ name }) => name),
				sources.map(({ id }) => id),
			),
		);
	return (
		<FieldGroup className="gap-4">
			<span className="text-sm font-medium">Context</span>
			<ContextRetrievalFields
				id={id}
				value={value.retrieval}
				onChange={(retrieval) => onChange({ ...value, retrieval })}
			/>
			<SelectionRow
				selected={Boolean(value.automatic)}
				onSelectedChange={(selected) =>
					onChange({
						...value,
						automatic: selected ? { minimumConfidence: 0.9 } : undefined,
						relevance: undefined,
					})
				}
			>
				<span className="flex items-center gap-2">
					<Sparkles className="size-4 shrink-0" />
					Automatic context
				</span>
			</SelectionRow>
			{value.automatic && (
				<>
					<Field>
						<FieldLabel
							htmlFor={`${id}-adequacy`}
							className="text-xs text-muted-foreground"
						>
							Minimum adequacy probability (%)
						</FieldLabel>
						<Input
							id={`${id}-adequacy`}
							inputMode="decimal"
							value={
								Number.isFinite(value.automatic.minimumConfidence)
									? String(value.automatic.minimumConfidence * 100)
									: ""
							}
							onChange={(event) =>
								onChange({
									...value,
									automatic: {
										...value.automatic,
										minimumConfidence: event.target.value.trim()
											? Number(event.target.value) / 100
											: NaN,
									},
								})
							}
						/>
					</Field>
					<SelectionRow
						selected={Boolean(value.automatic.economics)}
						onSelectedChange={(selected) =>
							onChange({
								...value,
								automatic: {
									...value.automatic,
									minimumConfidence: value.automatic?.minimumConfidence ?? 0.9,
									economics: selected ? { minimumReturn: 1.1 } : undefined,
								},
							})
						}
					>
						Prepare when projected savings cover cost
					</SelectionRow>
					{value.automatic.economics && (
						<Field>
							<FieldLabel
								htmlFor={`${id}-preparation-return`}
								className="text-xs text-muted-foreground"
							>
								Minimum savings / preparation cost
							</FieldLabel>
							<Input
								id={`${id}-preparation-return`}
								inputMode="decimal"
								value={
									Number.isFinite(value.automatic.economics.minimumReturn)
										? String(value.automatic.economics.minimumReturn)
										: ""
								}
								onChange={(event) =>
									onChange({
										...value,
										automatic: {
											...value.automatic,
											minimumConfidence:
												value.automatic?.minimumConfidence ?? 0.9,
											economics: {
												minimumReturn: event.target.value.trim()
													? Number(event.target.value)
													: NaN,
											},
										},
									})
								}
							/>
						</Field>
					)}
				</>
			)}
			<Field>
				<FieldLabel
					htmlFor={`${id}-history`}
					className="text-xs text-muted-foreground"
				>
					Previous messages
				</FieldLabel>
				<Select
					value={String(value.historyMessages)}
					onValueChange={(count) =>
						count && onChange({ ...value, historyMessages: Number(count) })
					}
				>
					<SelectTrigger id={`${id}-history`} className="w-full">
						<SelectValue>
							{() =>
								value.historyMessages
									? `Latest ${value.historyMessages} messages`
									: "Current query only"
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent alignItemWithTrigger={false}>
						<SelectGroup>
							{[...new Set([0, 2, 6, 12, 28, value.historyMessages])]
								.sort((a, b) => a - b)
								.map((count) => (
									<SelectItem key={count} value={String(count)}>
										<MessageSquare />
										{count ? `Latest ${count} messages` : "Current query only"}
									</SelectItem>
								))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</Field>
			<Field>
				<FieldLabel
					htmlFor={`${id}-context-budget`}
					className="text-xs text-muted-foreground"
				>
					Context character budget
				</FieldLabel>
				<Input
					id={`${id}-context-budget`}
					inputMode="numeric"
					value={
						Number.isFinite(value.maxCharacters)
							? String(value.maxCharacters)
							: ""
					}
					onChange={(event) =>
						onChange({
							...value,
							maxCharacters: event.target.value.trim()
								? Number(event.target.value)
								: NaN,
						})
					}
				/>
			</Field>
			<Field>
				<FieldLabel
					htmlFor={`${id}-upstream`}
					className="text-xs text-muted-foreground"
				>
					Earlier results
				</FieldLabel>
				<Select
					value={value.upstream}
					onValueChange={(upstream) => {
						if (
							upstream === "all" ||
							upstream === "selected" ||
							upstream === "none"
						)
							onChange({ ...value, upstream });
					}}
				>
					<SelectTrigger id={`${id}-upstream`} className="w-full">
						<SelectValue>
							{() =>
								({
									all: "All reached results",
									selected: "Selected results",
									none: "No earlier results",
								})[value.upstream]
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent alignItemWithTrigger={false}>
						<SelectGroup>
							<SelectItem value="all">
								<Layers />
								All reached results
							</SelectItem>
							<SelectItem value="selected">
								<ListChecks />
								Selected results
							</SelectItem>
							<SelectItem value="none">
								<Ban />
								No earlier results
							</SelectItem>
						</SelectGroup>
					</SelectContent>
				</Select>
			</Field>
			{value.upstream === "selected" && (
				<div className="grid gap-2">
					{sources.length === 0 && (
						<p className="text-xs text-muted-foreground">
							Connect an earlier node to select its result.
						</p>
					)}
					{sources.map((source) => (
						<SelectionRow
							key={source.id}
							selected={selectedOutputs.has(source.id)}
							onSelectedChange={(selected) =>
								onChange({
									...value,
									outputNodeIds: selected
										? [...value.outputNodeIds, source.id]
										: value.outputNodeIds.filter(
												(nodeId) => nodeId !== source.id,
											),
								})
							}
						>
							{source.name}
						</SelectionRow>
					))}
				</div>
			)}
			<ContextDocumentBindingFields
				id={id}
				documents={documents}
				value={value.documents}
				automatic={Boolean(value.automatic || value.retrieval)}
				onChange={(documents) => onChange({ ...value, documents })}
			/>
			{!value.automatic && (
				<ContextRelevanceFields
					id={id}
					value={value.relevance}
					onChange={(relevance) => onChange({ ...value, relevance })}
				/>
			)}
			<ConditionalInstructionsFields
				id={id}
				value={value.instructions ?? []}
				fields={fields}
				sources={sources.filter(
					(source) =>
						value.upstream === "all" ||
						(value.upstream === "selected" && selectedOutputs.has(source.id)),
				)}
				onChange={(instructions) => onChange({ ...value, instructions })}
			/>
		</FieldGroup>
	);
}
