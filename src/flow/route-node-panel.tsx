import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import type { ContextSourceOption } from "@/flow/context-policy-fields";
import type { FlowNode } from "@/flow/graph";
import { JevQuestionEditor } from "@/flow/jev-question-editor";
import { NodeRunDetails } from "@/flow/node-run-details";
import { NodeTimerLabel } from "@/flow/node-timer-label";
import { PromptEditor } from "@/flow/prompt-editor";
import { StartEditor } from "@/flow/start-editor";
import type { useRoutingGraph } from "@/flow/use-routing-graph";
import type { ContextDocument } from "@/lib/context";
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
	documents: ContextDocument[];
	contextSources: ContextSourceOption[];
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
								<NodeTimerLabel timer={data.timing} details />
							</p>
						)}
						{data.decision && (
							<p className="mb-4 text-sm">Jev decision: {data.decision}</p>
						)}
						<NodeRunDetails
							contexts={data.contexts}
							calls={data.calls}
							decision={data.decisionDetails}
						/>
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
	title,
	startFields,
	documents,
	contextSources,
	actions,
	onOpenChange,
}: EditProps & {
	data: Extract<FlowNode["data"], { kind: "jev" }>;
}) {
	return (
		<JevQuestionEditor
			title={title}
			question={data.question}
			confidenceThreshold={data.confidenceThreshold}
			fallbackOutputId={data.fallbackOutputId}
			fields={startFields}
			variables={data.variables ?? []}
			context={data.context}
			pricing={data.pricing}
			documents={documents}
			contextSources={contextSources}
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
	documents,
	contextSources,
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
			fields={startFields}
			variables={data.variables ?? []}
			context={data.context}
			pricing={data.pricing}
			documents={documents}
			contextSources={contextSources}
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
				documents={props.data.documents ?? []}
				onOpenChange={onOpenChange}
				onSave={props.actions.onStartFieldsChange}
			/>
		);
	}
	return (
		<ModelPanel {...props} data={props.data} onOpenChange={onOpenChange} />
	);
}
