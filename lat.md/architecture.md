# Architecture

JevGraph is a local Vite and React chatflow editor. Every chat turn runs the current graph on the local API; the canvas observes execution and edits the graph for later turns. See [[routing]], [[canvas]], [[chat]], [[optimization]], and [[persistence]].

## Module ownership

The browser owns graph editing and conversation display; the server owns execution and provider access.

- [src/lib/routing.ts](../src/lib/routing.ts) owns the single workflow request schema, node and edge contracts, and stream types.
- [src/flow/graph.ts](../src/flow/graph.ts) compiles canvas nodes and edges and projects editable configuration. [src/flow/use-routing-graph.ts](../src/flow/use-routing-graph.ts) owns graph edits.
- [server/workflow.ts](../server/workflow.ts) schedules stages, joins parallel results, bounds repeats, and emits progress. [server/model-failover.ts](../server/model-failover.ts) limits an explicit backup model to one attempt.
- [[server/provider-ledger.ts]] owns provider call identities, the shared call budget, completed and failed usage, and preparation cost. [[server/node-context.ts]] binds node context policies to accounted providers and model cost projections outside the graph scheduler.
- [server/api.ts](../server/api.ts) owns the local API and direct provider calls.
- [src/lib/context.ts](../src/lib/context.ts) and [server/context.ts](../server/context.ts) own node context policies, representations, and selection traces. See [[context]].
- [src/lib/usage.ts](../src/lib/usage.ts) owns provider call records, workflow totals, and pricing calculations; [src/lib/model-pricing.ts](../src/lib/model-pricing.ts) owns dated published prices. [src/lib/node-timer.ts](../src/lib/node-timer.ts) owns in-memory running and settled timer transitions.
- [src/chat/use-route-chat.ts](../src/chat/use-route-chat.ts) owns the live stream lifecycle; [[src/chat/use-saved-conversation.ts]] restores persisted turns and results. [src/App.tsx](../src/App.tsx) composes chat and canvas.
- [vite.config.ts](../vite.config.ts) mounts the API in development and preview. A static-only deployment has no API.

## State and trust boundaries

Browser storage, in-memory chat, and server-only secrets have separate owners.

Convex owns graph configuration, positions, reference documents, messages, run snapshots, usage footers, and full result files. Anonymous Convex Auth gives each browser session a durable owner identity without a login form; owner checks protect every application query, mutation, and action. This is not cross-device account recovery. [[persistence]] defines server-owned initialization, concurrent editing, and run lifecycle.

The browser retains only theme, viewport, chat visibility, and authentication state in local storage. Streaming deltas and monotonic node timers are transient. The server keeps bounded, expiring provider-cache observations in memory; reusable content summaries additionally persist in Convex. API keys remain in the local server's .env.local and never reach browser or database. API request bodies have a shared two-MiB limit enforced by the Vite adapter and API handler.

The browser sends the graph with each turn, and the server validates Start fields, any supplied values, and node bindings before provider calls. The browser's configured defaults support local testing; trusted production values must be mapped by the server or an API caller. Intermediate model outputs are bounded data for downstream stages. Chat has no separate workflow-run action.

## Validation

bun run check runs Lat, Konsistent, and read-only Biome checks. bun run typecheck, bun run test, and bun run build cover TypeScript, behavior, and the production bundle.
