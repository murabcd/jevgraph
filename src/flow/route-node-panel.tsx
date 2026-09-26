import { ScrollArea } from "@/components/ui/scroll-area";
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
import { StartEditor } from "@/flow/start-editor";
import type { useRoutingGraph } from "@/flow/use-routing-graph";
import type { StartField } from "@/lib/routing";

type EditorActions = Pick<
	ReturnType<typeof useRoutingGraph>,
	"onModelSettingsChange" | "onQuestionChange" | "onStartFieldsChange"
>;
type PanelProps = {
	id: string;
	data: FlowNode["data"];
	title: string;
	view: "edit" | "inspect";
	startFields: StartField[];
	onClose: () => void;
	actions: EditorActions;
};

type EditProps = Omit<PanelProps, "view"> & {
	onOpenChange: (open: boolean) => void;
};

function LastTurnPanel({
	data,
	title,
	onOpenChange,
}: Pick<EditProps, "data" | "title" | "onOpenChange">) {
	return (
		<Sheet
			modal={false}
			disablePointerDismissal
			open
			onOpenChange={onOpenChange}
		>
			<SheetContent variant="floating">
				<SheetHeader>
					<SheetTitle>{title} · last turn</SheetTitle>
				</SheetHeader>
				<ScrollArea
					className="min-h-0 flex-1"
					viewportClassName="scroll-fade-b"
				>
					<div className="px-4 pb-4">
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
				</ScrollArea>
			</SheetContent>
		</Sheet>
	);
}

function JevPanel({
	id,
	data,
	startFields,
	actions,
	onOpenChange,
}: EditProps & {
	data: Extract<FlowNode["data"], { kind: "jev" }>;
}) {
	return (
		<JevQuestionEditor
			question={data.question}
			confidenceThreshold={data.confidenceThreshold}
			fallbackOutputId={data.fallbackOutputId}
			fields={startFields}
			variables={data.variables ?? []}
			hasRepeat={data.hasRepeat}
			maxRepeats={data.maxRepeats ?? 3}
			open
			onOpenChange={onOpenChange}
			onSave={(settings) => actions.onQuestionChange(id, settings)}
		/>
	);
}

function ModelPanel({
	id,
	data,
	title,
	startFields,
	actions,
	onOpenChange,
}: EditProps & {
	data: Extract<FlowNode["data"], { kind: "google" | "openai" }>;
}) {
	return (
		<PromptEditor
			value={data.prompt ?? ""}
			promptMessages={data.promptMessages ?? []}
			open
			onOpenChange={onOpenChange}
			onSave={(settings) => actions.onModelSettingsChange(id, settings)}
			modelId={data.model}
			maxOutputTokens={data.maxOutputTokens}
			reasoningEffort={data.reasoningEffort}
			thinkingBudget={data.thinkingBudget}
			fields={startFields}
			variables={data.variables ?? []}
			title={title}
			id={`model-prompt-${id}`}
		/>
	);
}

export function RouteNodePanel(props: PanelProps) {
	const onOpenChange = (open: boolean) => {
		if (!open) props.onClose();
	};
	if (props.view === "inspect") {
		return <LastTurnPanel {...props} onOpenChange={onOpenChange} />;
	}
	if (props.data.kind === "jev") {
		return (
			<JevPanel {...props} data={props.data} onOpenChange={onOpenChange} />
		);
	}
	if (props.data.kind === "input") {
		return (
			<StartEditor
				fields={props.data.fields}
				onOpenChange={onOpenChange}
				onSave={props.actions.onStartFieldsChange}
			/>
		);
	}
	return (
		<ModelPanel {...props} data={props.data} onOpenChange={onOpenChange} />
	);
}
