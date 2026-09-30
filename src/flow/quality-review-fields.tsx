import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	QUALITY_REVIEW_LIMITS,
	type QualityReview,
	type ReviewSource,
} from "@/lib/quality-review";

type Judgement = Pick<QualityReview["task"], "reason" | "evidence">;

export function EvidenceSelector({
	sources,
	value,
	onChange,
	id,
}: {
	sources: ReviewSource[];
	value: string | null;
	onChange: (value: string | null) => void;
	id: string;
}) {
	return (
		<Select<string> value={value} onValueChange={onChange}>
			<SelectTrigger id={id} className="w-full">
				<SelectValue>
					{sources.find((source) => source.id === value)?.label ??
						"Select recorded evidence"}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{sources.map((source) => (
					<SelectItem key={source.id} value={source.id} label={source.label}>
						{source.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function QualityReviewFields({
	value,
	sources,
	onChange,
	id,
}: {
	value: Judgement;
	sources: ReviewSource[];
	onChange: (value: Judgement) => void;
	id: string;
}) {
	const update = (index: number, ref: Judgement["evidence"][number]) =>
		onChange({
			...value,
			evidence: value.evidence.map((item, position) =>
				position === index ? ref : item,
			),
		});
	return (
		<div className="grid gap-2">
			<Field>
				<FieldLabel htmlFor={`${id}-reason`}>Reason</FieldLabel>
				<InputGroup>
					<InputGroupTextarea
						id={`${id}-reason`}
						value={value.reason}
						maxLength={QUALITY_REVIEW_LIMITS.reason}
						onChange={(event) =>
							onChange({ ...value, reason: event.target.value })
						}
					/>
				</InputGroup>
			</Field>
			{value.evidence.map((ref, index) => (
				<div key={ref.id} className="grid gap-2 border-l pl-3">
					<Field>
						<FieldLabel htmlFor={`${id}-source-${index}`}>
							Recorded source {index + 1}
						</FieldLabel>
						<EvidenceSelector
							id={`${id}-source-${index}`}
							sources={sources}
							value={ref.sourceId || null}
							onChange={(sourceId) =>
								update(index, {
									id: ref.id,
									sourceId: sourceId ?? "",
									quote: "",
								})
							}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${id}-quote-${index}`}>
							Exact supporting quote {index + 1}
						</FieldLabel>
						<InputGroup>
							<InputGroupTextarea
								id={`${id}-quote-${index}`}
								value={ref.quote}
								maxLength={QUALITY_REVIEW_LIMITS.quote}
								onChange={(event) =>
									update(index, { ...ref, quote: event.target.value })
								}
							/>
						</InputGroup>
					</Field>
					<Button
						variant="ghost"
						size="sm"
						onClick={() =>
							onChange({
								...value,
								evidence: value.evidence.filter(
									(_, position) => position !== index,
								),
							})
						}
					>
						Remove evidence {index + 1}
					</Button>
				</div>
			))}
			{sources.length > 0 && (
				<Button
					variant="outline"
					size="sm"
					disabled={value.evidence.length >= QUALITY_REVIEW_LIMITS.evidence}
					onClick={() =>
						onChange({
							...value,
							evidence: [
								...value.evidence,
								{ id: crypto.randomUUID(), sourceId: "", quote: "" },
							],
						})
					}
				>
					Add supporting evidence
				</Button>
			)}
		</div>
	);
}

export function OutcomeReviewFields<T extends string>({
	id,
	label,
	value,
	outcomes,
	sources,
	onChange,
}: {
	id: string;
	label: string;
	value: Judgement & { outcome: T };
	outcomes: readonly T[];
	sources: ReviewSource[];
	onChange: (value: Judgement & { outcome: T }) => void;
}) {
	return (
		<div className="grid gap-3">
			<Field>
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				<Select<T>
					value={value.outcome}
					onValueChange={(selected) => {
						const outcome = outcomes.find((item) => item === selected);
						if (outcome) onChange({ ...value, outcome });
					}}
				>
					<SelectTrigger id={id} className="w-full">
						<SelectValue>{value.outcome}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{outcomes.map((outcome) => (
							<SelectItem key={outcome} value={outcome}>
								{outcome}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Field>
			<QualityReviewFields
				id={id}
				value={value}
				sources={sources}
				onChange={(fields) => onChange({ ...value, ...fields })}
			/>
		</div>
	);
}
