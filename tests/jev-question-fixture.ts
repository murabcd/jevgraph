import { defaultJevQuestion, type JevQuestion } from "../src/lib/jev-question";

export function configuredJevQuestion(
	type: JevQuestion["type"] = "choice",
): JevQuestion {
	const question = defaultJevQuestion(type);
	if (question.type === "choice")
		return {
			...question,
			instructions: "Choose the category that matches the input.",
			options: question.options.map((option, index) => ({
				...option,
				description: `Matches category ${index + 1}.`,
			})),
		};
	if (question.type === "noul")
		return {
			...question,
			instructions: "Does the input match the condition?",
			yesDescription: "The condition is met.",
			noDescription: "The condition is not met.",
		};
	return {
		...question,
		instructions: "Rate the input using the ordered levels.",
		levels: question.levels.map((level, index) => ({
			...level,
			description: `Level ${index} criteria.`,
		})),
	};
}
