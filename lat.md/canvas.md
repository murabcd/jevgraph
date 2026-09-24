# Canvas

The canvas defines a direct Input-to-Model path or a Jev route with one Model per output. The graph sent with each chat turn determines which Model runs. See [[routing]] and [[chat]].

## Graph and interaction

[src/flow/graph.ts](../src/flow/graph.ts) defines graph structure, route conversion, and persistence. [src/flow/use-routing-graph.ts](../src/flow/use-routing-graph.ts) owns canvas state and edits.

[src/flow/routing-canvas.tsx](../src/flow/routing-canvas.tsx) renders the flow; [src/flow/route-node.tsx](../src/flow/route-node.tsx) renders nodes and selection actions. [src/flow/model-command.tsx](../src/flow/model-command.tsx) provides the model list for a selected model node, while [src/flow/node-connection-picker.tsx](../src/flow/node-connection-picker.tsx) displays the available node types at a loose connection endpoint.

Node badges use unique numbers in connection order. Connected terminal Model nodes are labeled OUTPUT; unconnected Model nodes retain MODEL. The Model picker and node footer identify the provider model regardless of that badge.

The Jev footer displays its current question type as metadata. The selected Jev router toolbar opens a searchable command with one row per question type: Choice, Noul, and Score. Selecting a type changes the question sent to Jev and its output handles. [src/flow/jev-question-editor.tsx](../src/flow/jev-question-editor.tsx) edits instructions, Choice labels and criteria, Noul yes/no criteria, or Score levels and its Low/High threshold. When changing types, the graph maps the first and last Choice outputs to the simpler and deeper paths: No/Low keeps the simpler model, while Yes/High keeps the deeper model. A middle Choice output has no equivalent in the two-output types, so its edge is removed. Choice edits preserve connections by stable output ID; removing an output removes its edge.

Selecting the Input node reveals a multiline prompt field in the node and focuses it for editing. It shares the draft with the [[chat]] composer, so edits in either place update the other; after sending, the node shows the latest submitted prompt until a new draft is entered. The draft remains in memory with the chat rather than in the persisted graph.

Every node, including Input and Jev, can be removed. The Add node control in the bottom toolbar opens a searchable list of available node types: Input and Router appear only when absent, while Model can be added repeatedly. A new node appears at the center of the visible canvas and can be connected with handles. An empty or incomplete workflow persists across refresh; chat runs when Input connects directly to a Model or when Input connects to Jev and every current Jev output connects to a Model.

Dragging from Input into empty space opens a temporary picker offering Model and, when absent, Router. Dragging from a Jev output into empty space offers Model. Choosing a type creates a connected, selected node at the drop point. A new direct Model starts with OpenAI; new Jev branch models use the branch's default model. The selected node toolbar can then change provider and model. Escape or clicking outside dismisses the picker without changing the saved graph. Connecting to an existing compatible node changes that connection directly. Replaced Jev branch models with no remaining connection are removed. The graph and node positions persist locally; temporary pickers and preview edges do not.
