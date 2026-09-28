import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { graphSnapshot, readGraph, removeImportedGraph } from "@/flow/graph";
import { api } from "../../convex/_generated/api";

export type Workspace = NonNullable<
	FunctionReturnType<typeof api.workspaces.current>
>;
let signingIn: Promise<unknown> | undefined;

export function WorkspaceGate({
	children,
}: {
	children: (workspace: Workspace) => ReactNode;
}) {
	const { signIn } = useAuthActions();
	const { isLoading, isAuthenticated } = useConvexAuth();
	const workspace = useQuery(
		api.workspaces.current,
		isAuthenticated ? {} : "skip",
	);
	const initialize = useMutation(api.workspaces.initialize);
	const initializing = useRef(false);
	const [error, setError] = useState("");
	useEffect(() => {
		if (isLoading || isAuthenticated) return;
		signingIn ??= signIn("anonymous").finally(() => {
			signingIn = undefined;
		});
		void signingIn.catch((caught) =>
			setError(caught instanceof Error ? caught.message : "Could not connect"),
		);
	}, [isLoading, isAuthenticated, signIn]);
	useEffect(() => {
		if (workspace !== null || initializing.current) return;
		initializing.current = true;
		const local = readGraph();
		void initialize({
			graph: JSON.stringify(graphSnapshot(local.nodes, local.edges)),
		})
			.then(removeImportedGraph)
			.catch((caught) =>
				setError(
					caught instanceof Error
						? caught.message
						: "Could not save the workspace",
				),
			);
	}, [workspace, initialize]);
	if (workspace) return children(workspace);
	return (
		<main className="studio grid place-items-center">
			<div role="status" className="flex items-center gap-3">
				{error ? (
					<>
						<span>{error}</span>
						<Button variant="outline" onClick={() => window.location.reload()}>
							Retry
						</Button>
					</>
				) : (
					<>
						<LoaderCircle className="size-5 animate-spin" />
						<span>Connecting…</span>
					</>
				)}
			</div>
		</main>
	);
}
