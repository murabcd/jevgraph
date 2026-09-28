import { useMutation } from "convex/react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { api } from "../../convex/_generated/api";
import { GraphSaveQueue } from "./graph-save-queue";
import type { Workspace } from "./workspace-gate";

export function useSavedGraph(workspace: Workspace) {
	const mutate = useMutation(api.workspaces.save);
	const [queue] = useState(
		() =>
			new GraphSaveQueue(
				workspace.revision,
				workspace.graph,
				(graph, revision) => mutate({ id: workspace.id, graph, revision }),
			),
	);
	const { remote, error } = useSyncExternalStore(
		queue.subscribe,
		queue.getSnapshot,
	);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const flush = useCallback(async () => {
		clearTimeout(timer.current);
		await queue.flush();
	}, [queue]);
	const save = useCallback(
		(graph: string) => {
			queue.enqueue(graph);
			clearTimeout(timer.current);
			timer.current = setTimeout(() => {
				// The queue publishes failures to the visible save error.
				void flush().catch(() => {});
			}, 350);
		},
		[queue, flush],
	);
	useEffect(() => {
		queue.observe(workspace.revision, workspace.graph);
	}, [workspace.revision, workspace.graph, queue]);
	useEffect(() => {
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (queue.busy) {
				event.preventDefault();
			}
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => {
			window.removeEventListener("beforeunload", beforeUnload);
			clearTimeout(timer.current);
			// The queue owns failure reporting; cleanup must not reject unhandled.
			void queue.flush().catch(() => {});
		};
	}, [queue]);
	return { remote, save, flush, error };
}
