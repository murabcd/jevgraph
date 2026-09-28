import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceGate } from "@/storage/workspace-gate";

import "./index.css";
import { ReactFlowProvider } from "@xyflow/react";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App.tsx";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (typeof convexUrl !== "string" || !convexUrl)
	throw new Error("Convex deployment is not configured");
const convex = new ConvexReactClient(convexUrl);

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
	<StrictMode>
		<ThemeProvider defaultTheme="light" storageKey="router:theme">
			<TooltipProvider>
				<ReactFlowProvider>
					<ConvexAuthProvider client={convex}>
						<WorkspaceGate>
							{(workspace) => <App key={workspace.id} workspace={workspace} />}
						</WorkspaceGate>
					</ConvexAuthProvider>
				</ReactFlowProvider>
			</TooltipProvider>
		</ThemeProvider>
	</StrictMode>,
);
