import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import type { FlowNode } from "@/flow/graph";
import { JevQuestionEditor } from "@/flow/jev-question-editor";
import { formatNodeDuration } from "@/flow/node-duration";
import { PromptEditor } from "@/flow/prompt-editor";
import type { useRoutingGraph } from "@/flow/use-routing-graph";

type EditorActions = Pick<
	ReturnType<typeof useRoutingGraph>,
	| "onModelChange"
	| "onModelPromptChange"
	| "onRepeatLimitChange"
	| "onPromptChange"
	| "onQuestionChange"
>;
export function RouteNodePanel({
	id,
	data,
	title,
	view,
	onClose,
	actions,
}: {
	id: string;
	data: FlowNode["data"];
	title: string;
	view: "edit" | "inspect";
	onClose: () => void;
	actions: EditorActions;
}) {
	const close = (open: boolean) => {
		if (!open) onClose();
	};
	if (view === "inspect") {
		return (
			<Sheet modal={false} disablePointerDismissal open onOpenChange={close}>
				<SheetContent variant="floating">
					<SheetHeader>
						<SheetTitle>{title} · last turn</SheetTitle>
					</SheetHeader>
					<div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
						{data.timing && (
							<p className="mb-4 text-xs text-muted-foreground tabular-nums">
								{data.timing.status === "failed" ? "Failed" : "Completed"} in{" "}
								{formatNodeDuration(data.timing.durationMs)}
								{data.timing.attempts && data.timing.attempts > 1
									? ` across ${data.timing.attempts} runs`
									: ""}
							</p>
						)}
						{data.decision && (
							<p className="mb-4 text-sm">Jev decision: {data.decision}</p>
						)}
						{data.output && (
							<pre className="whitespace-pre-wrap wrap-break-word font-sans text-sm leading-6">
								{data.output}
							</pre>
						)}
					</div>
				</SheetContent>
			</Sheet>
		);
	}
	if (data.kind === "jev") {
		return (
			<JevQuestionEditor
				question={data.question}
				hasRepeat={data.hasRepeat}
				maxRepeats={data.maxRepeats ?? 3}
				open
				onOpenChange={close}
				onSave={(question) => actions.onQuestionChange(id, question)}
				onRepeatLimitChange={(limit) => actions.onRepeatLimitChange(id, limit)}
			/>
		);
	}
	return (
		<PromptEditor
			value={data.prompt ?? ""}
			open
			onOpenChange={close}
			onSave={(prompt) => {
				if (data.kind === "input") actions.onPromptChange(prompt);
				else actions.onModelPromptChange(id, prompt);
			}}
			modelId={data.kind === "input" ? undefined : data.model}
			onModelChange={(model) => actions.onModelChange(id, model)}
			title={title}
			id={data.kind === "input" ? "system-prompt" : `model-prompt-${id}`}
		/>
	);
}
