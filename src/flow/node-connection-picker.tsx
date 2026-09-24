import {
	Handle,
	type NodeProps,
	Position,
	type Node as ReactFlowNode,
} from "@xyflow/react";
import { useEffect, useRef } from "react";
import type { CreatableNodeKind } from "@/flow/graph";
import { NodeTypeCommand } from "@/flow/node-type-command";

export const NODE_PICKER_NODE_ID = "node-connection-picker";

export type NodePickerNode = ReactFlowNode<
	{
		available: CreatableNodeKind[];
		onSelect: (kind: CreatableNodeKind) => void;
		onDismiss: () => void;
	},
	"node-picker"
>;

export function NodeConnectionPicker({ data }: NodeProps<NodePickerNode>) {
	const rootRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const focusInput = () => inputRef.current?.focus();
		const frame = requestAnimationFrame(focusInput);
		const focusTimeout = window.setTimeout(focusInput, 60);
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) {
				data.onDismiss();
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") data.onDismiss();
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(focusTimeout);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [data.onDismiss]);

	return (
		<div
			ref={rootRef}
			className="nodrag nopan relative w-[280px] rounded-xl border bg-popover shadow-lg"
		>
			<Handle
				type="target"
				position={Position.Left}
				isConnectable={false}
				className="route-handle"
			/>
			<NodeTypeCommand
				inputRef={inputRef}
				available={data.available}
				onSelect={data.onSelect}
			/>
		</div>
	);
}
