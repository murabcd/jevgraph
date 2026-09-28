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
import { ContextDocumentBindingFields } from "@/flow/context-document-binding-fields";
import { ContextRelevanceFields } from "@/flow/context-relevance-fields";
import { SelectionRow } from "@/flow/selection-row";
import type { ContextDocument, ContextPolicy } from "@/lib/context";

export type ContextSourceOption = { id: string; name: string };

export function ContextPolicyFields({
	id,
	value,
	onChange,
	sources,
	documents,
}: {
	id: string;
	value: ContextPolicy;
	onChange: (policy: ContextPolicy) => void;
	sources: ContextSourceOption[];
	documents: ContextDocument[];
}) {
	const selectedOutputs = new Set(value.outputNodeIds);
	return (
		<FieldGroup className="gap-4">
			<span className="text-sm font-medium">Context</span>
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
									minimumConfidence: event.target.value.trim()
										? Number(event.target.value) / 100
										: NaN,
								},
							})
						}
					/>
				</Field>
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
				automatic={Boolean(value.automatic)}
				onChange={(documents) => onChange({ ...value, documents })}
			/>
			{!value.automatic && (
				<ContextRelevanceFields
					id={id}
					value={value.relevance}
					onChange={(relevance) => onChange({ ...value, relevance })}
				/>
			)}
		</FieldGroup>
	);
}
