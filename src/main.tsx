import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { ReactFlowProvider } from "@xyflow/react";
import { ThemeProvider } from "@/components/theme-provider";
import App from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
	<StrictMode>
		<ThemeProvider defaultTheme="light" storageKey="router:theme">
			<ReactFlowProvider>
				<App />
			</ReactFlowProvider>
		</ThemeProvider>
	</StrictMode>,
);
