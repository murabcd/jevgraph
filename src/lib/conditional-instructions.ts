import { z } from "zod";

export const conditionalInstructionSchema = z.strictObject({
	id: z.string().min(1).max(100),
	name: z.string().trim().min(1).max(100),
	instructions: z.string().trim().min(1).max(4000),
	condition: z.discriminatedUnion("kind", [
		z.strictObject({
			kind: z.literal("variable"),
			name: z.string().min(1).max(64),
			value: z.union([z.string().max(256), z.number().finite(), z.boolean()]),
		}),
		z.strictObject({
			kind: z.literal("decision"),
			nodeId: z.string().min(1).max(100),
			outputId: z.string().min(1).max(100),
		}),
	]),
});
export const conditionalInstructionsSchema = z
	.array(conditionalInstructionSchema)
	.max(8)
	.refine(
		(rules) => new Set(rules.map(({ id }) => id)).size === rules.length,
		"Instruction IDs must be unique",
	);
export type ConditionalInstruction = z.infer<
	typeof conditionalInstructionSchema
>;
