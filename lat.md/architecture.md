# Architecture

Route Studio is a local Vite and React chatflow editor. Every chat turn runs the current graph on the local API; the canvas observes execution and edits the graph for later turns. See [[routing]], [[canvas]], and [[chat]].

## Module ownership

The browser owns graph editing and conversation display; the server owns execution and provider access.

- [src/lib/routing.ts](../src/lib/routing.ts) owns the single workflow request schema, node and edge contracts, and stream types.
- [src/flow/graph.ts](../src/flow/graph.ts) compiles canvas nodes and edges and persists the editable graph. [src/flow/use-routing-graph.ts](../src/flow/use-routing-graph.ts) owns graph edits.
- [server/workflow.ts](../server/workflow.ts) schedules stages, joins parallel results, bounds repeats, and emits progress. [server/model-failover.ts](../server/model-failover.ts) limits an explicit backup model to one attempt.
- [server/api.ts](../server/api.ts) owns the local API and direct provider calls.
- [src/chat/use-route-chat.ts](../src/chat/use-route-chat.ts) owns the in-memory conversation and stream lifecycle. [src/App.tsx](../src/App.tsx) composes chat and canvas.
- [vite.config.ts](../vite.config.ts) mounts the API in development and preview. A static-only deployment has no API.

## State and trust boundaries

Browser storage, in-memory chat, and server-only secrets have separate owners.

Graph configuration, node positions, theme, viewport, and chat panel visibility live in browser local storage. Messages and the latest execution trace live in memory and reset on reload. API keys stay in the server's .env.local; the browser receives key availability, not key values.

The browser sends the graph with each turn, and the server validates Start fields, any supplied values, and node bindings before provider calls. The browser's configured defaults support local testing; trusted production values must be mapped by the server or an API caller. Intermediate model outputs are bounded data for downstream stages. Chat has no separate workflow-run action.

## Validation

bun run check runs Lat, Konsistent, and read-only Biome checks. bun run typecheck, bun run test, and bun run build cover TypeScript, behavior, and the production bundle.
