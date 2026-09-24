# Canvas

The React Flow canvas edits model connections. Each Jev branch has one active connection; the graph sent with a chat turn determines which models the server can run. See [[routing]] and [[chat]].

## Graph and interaction

[src/flow/graph.ts](../src/flow/graph.ts) defines graph structure, route conversion, and persistence. [src/flow/use-routing-graph.ts](../src/flow/use-routing-graph.ts) owns canvas state and edits.

[src/flow/routing-canvas.tsx](../src/flow/routing-canvas.tsx) renders the flow; [src/flow/route-node.tsx](../src/flow/route-node.tsx) renders nodes, selection actions, and model picking.

Dragging from a Jev output to empty space creates and connects a model node. Connecting to an existing model node changes that branch. Replaced model nodes with no remaining connection are removed. The selected model and node positions persist locally.
