# Canvas

The canvas edits the chatflow that runs on each message and highlights only the current turn's reached path. Outputs and timing details also belong to that turn. Chat remains the only runner. See [[routing]] and [[chat]].

## Graph and editors

The graph compiler and editor own the visible node connections and settings.

[src/flow/graph.ts](../src/flow/graph.ts) owns connection rules, graph compilation, and local persistence. [src/flow/use-routing-graph.ts](../src/flow/use-routing-graph.ts) owns edits. [src/flow/routing-canvas.tsx](../src/flow/routing-canvas.tsx) renders the React Flow graph while [src/flow/canvas-presentation.ts](../src/flow/canvas-presentation.ts) derives the visible nodes, edges, and latest-turn highlights. [src/flow/route-node.tsx](../src/flow/route-node.tsx) renders node actions and execution state, and [src/flow/node-meta.ts](../src/flow/node-meta.ts) owns display names and footer summaries. [src/flow/canvas-controls.tsx](../src/flow/canvas-controls.tsx) renders the canvas toolbar. [src/flow/route-node-panel.tsx](../src/flow/route-node-panel.tsx) renders one editor or inspection Sheet for the selected node outside the React Flow nodes.

Start is the single required root. Its [editor](../src/flow/start-editor.tsx) defines typed input fields and optional defaults. The chat message is the built-in query input. Jev and Model editors use [Start variable binding](../src/flow/start-variable-binding.tsx) to select only the custom fields they need. Jev evaluates its configured Choice, Noul, or Score question. Model calls OpenAI or Gemini and can have its own prompt, several Continue connections, and one backup Model. A Model's two output rows label the regular path Continue and the failure path On error. Once On error has a backup connection, its handle cannot start another connection; removing that edge makes the handle available again. A backup Model is a leaf and shows no outgoing handles. Clicking a node opens its settings in a floating, nonmodal Sheet on the left. The Sheet has no backdrop, so the canvas remains visible and interactive; clicking another node switches the editor. [src/flow/prompt-editor.tsx](../src/flow/prompt-editor.tsx) and [src/flow/jev-question-editor.tsx](../src/flow/jev-question-editor.tsx) own the Model and Jev forms, and [src/components/ui/sheet.tsx](../src/components/ui/sheet.tsx) owns the floating variant.

The toolbar can add Router or Model. Dragging a loose output opens [src/flow/node-connection-picker.tsx](../src/flow/node-connection-picker.tsx) with compatible types. Start can launch several parallel branches and cannot be removed. Jev outputs each have one connection. A Jev output connected back to an earlier Model becomes a dashed Repeat edge; the Jev editor exposes its repeat limit. Forward edges cannot cycle. An incomplete graph persists but chat cannot send it.

The floating editors use [src/components/ui/select.tsx](../src/components/ui/select.tsx) for Jev question type, repeat limit, and model selection. The question type menu uses the Jev icon for each option; all menus have an inset around their options and follow the app theme. The editor saves each node's settings together; Cancel discards the draft. Choice and Score output IDs preserve their edges when labels change; changing type remaps lower and upper outputs.

## Observation and persistence

Starting a message clears the previous path immediately. Progress events highlight reached nodes, traversed edges, and their output handles for that message. The path, timings, and node details remain visible after its answer but are not persisted.

Clearing chat removes the highlight; changing the graph hides a trace recorded for a different configuration.

Node badges show connection order and role; the Start footer shows only Input. Every node footer has the same fixed height even when the node body grows to show more outputs or connections. Node cards leave their handle circles visible past the card edge. A selected node has a neutral ring; selection does not color its unused outputs as executed. Unused branches, including a backup that did not run, remain unhighlighted. The top-right time uses tabular numerals, milliseconds below one second and seconds afterward. Repeated runs of a node show cumulative time and count. Clicking a node edits it; other nodes' options menu can inspect the latest output or decision, focus, duplicate a Model, or remove the node. Failed attempts retain their error-colored time. These observations are not saved with the graph.

The graph and node positions persist locally. [src/flow/canvas-viewport.ts](../src/flow/canvas-viewport.ts) persists pan and zoom separately; refresh restores the saved viewport, and Fit saves a new one. Opening a node editor leaves the canvas pan and zoom unchanged. The floating chat panel opens without resizing the canvas.
