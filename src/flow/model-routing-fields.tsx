import { Sparkles } from "lucide-react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ModelRoutingCandidates } from "@/flow/model-routing-candidates";
import { SelectionRow } from "@/flow/selection-row";
import type { ModelRouting } from "@/lib/model-routing";
import type { ReasoningEffort } from "@/lib/models";

export function ModelRoutingFields({
	id,
	value,
	onChange,
	maxOutputTokens,
	modelId,
	reasoningEffort,
}: {
	id: string;
	value?: ModelRouting;
	onChange: (value: ModelRouting | undefined) => void;
	maxOutputTokens: number;
	modelId: string;
	reasoningEffort: ReasoningEffort;
}) {
	return (
		<FieldGroup className="gap-3">
			<SelectionRow
				selected={Boolean(value)}
				onSelectedChange={(selected) =>
					onChange(
						selected
							? {
									mode: "evaluate",
									quality: {
										criteria:
											"Answer from the selected documents.\nPreserve conditions, deadlines and exceptions.\nAsk for missing order details.\nNever invent order status or completed actions.",
										minimumCases: 20,
										minimumPassRate: 0.95,
										maximumLatencyMs: 20000,
									},
									minimumConfidence: 0.7,
									candidates: [
										{ model: modelId, reasoningEffort, criteria: "" },
									],
									expectedOutputTokens: Math.min(
										256,
										Number.isFinite(maxOutputTokens)
											? Math.max(1, maxOutputTokens)
											: 1400,
									),
									expectedRequests: 2,
								}
							: undefined,
					)
				}
			>
				<span className="flex items-center gap-2">
					<Sparkles className="size-4 shrink-0" />
					Evaluate and route models and reasoning
				</span>
			</SelectionRow>
			{value && (
				<>
					<Field>
						<FieldLabel
							htmlFor={`${id}-routing-mode`}
							className="text-xs text-muted-foreground"
						>
							Mode
						</FieldLabel>
						<Select
							value={value.mode}
							onValueChange={(mode) => {
								if (mode === "evaluate" || mode === "automatic")
									onChange({ ...value, mode });
							}}
						>
							<SelectTrigger id={`${id}-routing-mode`} className="w-full">
								<SelectValue>
									{() =>
										value.mode === "evaluate"
											? "Evaluate selected configuration"
											: "Route by task and reviewed results"
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent alignItemWithTrigger={false}>
								<SelectItem value="evaluate">
									Evaluate selected configuration
								</SelectItem>
								<SelectItem value="automatic">
									Route by task and reviewed results
								</SelectItem>
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<FieldLabel
							htmlFor={`${id}-quality-criteria`}
							className="text-xs text-muted-foreground"
						>
							Answer review criteria · one per line
						</FieldLabel>
						<InputGroup>
							<InputGroupTextarea
								id={`${id}-quality-criteria`}
								value={value.quality.criteria}
								onChange={(event) =>
									onChange({
										...value,
										quality: { ...value.quality, criteria: event.target.value },
									})
								}
							/>
						</InputGroup>
					</Field>
					{(
						[
							["minimumCases", "Minimum distinct cases", 1],
							["minimumPassRate", "Minimum reviewed pass rate (%)", 100],
							["maximumLatencyMs", "Maximum full-turn p95 latency (ms)", 1],
						] as const
					).map(([key, label, scale]) => (
						<Field key={key}>
							<FieldLabel
								htmlFor={`${id}-${key}`}
								className="text-xs text-muted-foreground"
							>
								{label}
							</FieldLabel>
							<Input
								id={`${id}-${key}`}
								inputMode="decimal"
								value={
									Number.isFinite(value.quality[key])
										? String(value.quality[key] * scale)
										: ""
								}
								onChange={(event) =>
									onChange({
										...value,
										quality: {
											...value.quality,
											[key]: event.target.value.trim()
												? Number(event.target.value) / scale
												: NaN,
										},
									})
								}
							/>
						</Field>
					))}
					<ModelRoutingCandidates
						id={id}
						value={value.candidates}
						onChange={(candidates) => onChange({ ...value, candidates })}
					/>
					<Field>
						<FieldLabel
							htmlFor={`${id}-routing-confidence`}
							className="text-xs text-muted-foreground"
						>
							Minimum task suitability (%)
						</FieldLabel>
						<Input
							id={`${id}-routing-confidence`}
							inputMode="decimal"
							value={
								Number.isFinite(value.minimumConfidence)
									? value.minimumConfidence * 100
									: ""
							}
							onChange={(event) =>
								onChange({
									...value,
									minimumConfidence: event.target.value.trim()
										? Number(event.target.value) / 100
										: NaN,
								})
							}
						/>
					</Field>
					<Field>
						<FieldLabel
							htmlFor={`${id}-expected-output`}
							className="text-xs text-muted-foreground"
						>
							Expected output tokens
						</FieldLabel>
						<Input
							id={`${id}-expected-output`}
							inputMode="numeric"
							value={
								Number.isFinite(value.expectedOutputTokens)
									? String(value.expectedOutputTokens)
									: ""
							}
							onChange={(event) =>
								onChange({
									...value,
									expectedOutputTokens: event.target.value.trim()
										? Number(event.target.value)
										: NaN,
								})
							}
						/>
					</Field>
					<Field>
						<FieldLabel
							htmlFor={`${id}-expected-requests`}
							className="text-xs text-muted-foreground"
						>
							Expected requests with the same context
						</FieldLabel>
						<Input
							id={`${id}-expected-requests`}
							inputMode="numeric"
							value={
								Number.isFinite(value.expectedRequests)
									? String(value.expectedRequests)
									: ""
							}
							onChange={(event) =>
								onChange({
									...value,
									expectedRequests: event.target.value.trim()
										? Number(event.target.value)
										: NaN,
								})
							}
						/>
					</Field>
				</>
			)}
		</FieldGroup>
	);
}
