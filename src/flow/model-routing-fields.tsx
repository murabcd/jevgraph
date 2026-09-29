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
import { ModelOption } from "@/flow/model-option";
import { SelectionRow } from "@/flow/selection-row";
import type { ModelRouting } from "@/lib/model-routing";
import { textModels } from "@/lib/models";

export function ModelRoutingFields({
	id,
	value,
	onChange,
	maxOutputTokens,
	modelId,
}: {
	id: string;
	value?: ModelRouting;
	onChange: (value: ModelRouting | undefined) => void;
	maxOutputTokens: number;
	modelId: string;
}) {
	const selectedModels = new Set(value?.models);
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
									models: [modelId],
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
					Evaluate and route models
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
											? "Evaluate selected model"
											: "Route using reviewed results"
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent alignItemWithTrigger={false}>
								<SelectItem value="evaluate">
									Evaluate selected model
								</SelectItem>
								<SelectItem value="automatic">
									Route using reviewed results
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
					<FieldGroup className="gap-2">
						<span className="text-xs text-muted-foreground">
							Allowed models
						</span>
						{textModels.map((model) => (
							<SelectionRow
								key={model.id}
								selected={selectedModels.has(model.id)}
								onSelectedChange={(selected) =>
									onChange({
										...value,
										models: selected
											? [...value.models, model.id]
											: value.models.filter((id) => id !== model.id),
									})
								}
							>
								<ModelOption model={model} />
							</SelectionRow>
						))}
					</FieldGroup>
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
