import { GoogleIcon, OpenAIIcon } from "@/components/icons/provider-icons";
import type { TextModel } from "@/lib/models";

export function ModelOption({ model }: { model: TextModel }) {
	return (
		<span className="flex items-center gap-2">
			{model.provider === "openai" ? (
				<OpenAIIcon className="size-4" />
			) : (
				<GoogleIcon className="size-4" />
			)}
			{model.label}
		</span>
	);
}
