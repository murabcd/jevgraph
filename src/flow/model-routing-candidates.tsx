import { FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import { ModelOption } from "@/flow/model-option";
import { SelectionRow } from "@/flow/selection-row";
import { modelConfigurationKey } from "@/lib/model-configuration";
import type { ModelRouting } from "@/lib/model-routing";
import { textModels } from "@/lib/models";

export function ModelRoutingCandidates({
	id,
	value,
	onChange,
}: {
	id: string;
	value: ModelRouting["candidates"];
	onChange: (value: ModelRouting["candidates"]) => void;
}) {
	const selected = new Map(
		value.map((candidate) => [modelConfigurationKey(candidate), candidate]),
	);
	return (
		<div className="grid gap-2">
			<span className="text-xs text-muted-foreground">
				Allowed model and reasoning configurations
			</span>
			{textModels.flatMap((model) =>
				model.reasoning.efforts.map((reasoningEffort) => {
					const configuration = { model: model.id, reasoningEffort };
					const key = modelConfigurationKey(configuration);
					const candidate = selected.get(key);
					return (
						<div key={key} className="grid gap-2">
							<SelectionRow
								selected={Boolean(candidate)}
								onSelectedChange={(enabled) =>
									onChange(
										enabled
											? [...value, { ...configuration, criteria: "" }]
											: value.filter(
													(item) => modelConfigurationKey(item) !== key,
												),
									)
								}
							>
								<span className="flex items-center gap-2">
									<ModelOption model={model} /> · {reasoningEffort}
								</span>
							</SelectionRow>
							{candidate && (
								<div className="grid gap-2">
									<FieldLabel
										htmlFor={`${id}-${key}-criteria`}
										className="text-xs text-muted-foreground"
									>
										Use for
									</FieldLabel>
									<InputGroup>
										<InputGroupTextarea
											id={`${id}-${key}-criteria`}
											value={candidate.criteria}
											placeholder="Describe the tasks this configuration can handle"
											maxLength={500}
											onChange={(event) =>
												onChange(
													value.map((item) =>
														modelConfigurationKey(item) === key
															? { ...item, criteria: event.target.value }
															: item,
													),
												)
											}
										/>
									</InputGroup>
								</div>
							)}
						</div>
					);
				}),
			)}
		</div>
	);
}
