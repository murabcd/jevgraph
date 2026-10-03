import { z } from "zod";
import { reasoningEfforts, textModels } from "./models.ts";

export const MAX_MODEL_CONFIGURATIONS = 16;
export const modelConfigurationSchema = z
	.strictObject({
		model: z.string().min(1).max(100),
		reasoningEffort: z.enum(reasoningEfforts),
	})
	.refine(
		(value) =>
			textModels.some(
				(model) =>
					model.id === value.model &&
					model.reasoning.efforts.includes(value.reasoningEffort),
			),
		"Choose a supported model and reasoning effort",
	);
export type ModelConfiguration = z.infer<typeof modelConfigurationSchema>;

export function modelConfigurationKey(value: ModelConfiguration): string {
	return `${value.model}@${value.reasoningEffort}`;
}
export const modelConfigurations = textModels.flatMap((model) =>
	model.reasoning.efforts.map((reasoningEffort) => ({
		model: model.id,
		reasoningEffort,
	})),
);
export const modelConfigurationIdSchema = z
	.string()
	.refine(
		(id) =>
			modelConfigurations.some((value) => modelConfigurationKey(value) === id),
		"Choose a supported model@reasoning configuration",
	);
export function modelConfiguration(id: string): ModelConfiguration {
	const configuration = modelConfigurations.find(
		(value) => modelConfigurationKey(value) === id,
	);
	if (!configuration)
		throw new Error("Unsupported model and reasoning configuration");
	return configuration;
}

/** Resolve a manual node's default and reject unsupported settings at their owner. */
export function effectiveModelConfiguration(value: {
	model: string;
	reasoningEffort?: ModelConfiguration["reasoningEffort"];
}): ModelConfiguration {
	const model = textModels.find((model) => model.id === value.model);
	if (!model) throw new Error("Unsupported model");
	const reasoningEffort =
		value.reasoningEffort ?? model.reasoning.defaultEffort;
	if (!model.reasoning.efforts.includes(reasoningEffort))
		throw new Error("Unsupported reasoning effort");
	return { model: model.id, reasoningEffort };
}
