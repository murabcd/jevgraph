# Architecture

Router is a local Vite and React app. Its server API classifies each message and streams a reply through the selected model. The canvas edits the graph sent with each turn. See [[routing]], [[canvas]], and [[chat]].

## Module ownership

These files own the principal runtime and UI contracts.

- [server/api.ts](../server/api.ts) owns `/api/route` and `/api/status`, direct provider calls, and the server-only API keys.
- [src/lib/routing.ts](../src/lib/routing.ts) owns routing request schemas and branch selection.
- [src/flow/graph.ts](../src/flow/graph.ts) owns graph shape, connection rules, and graph persistence.
- [src/chat/use-route-chat.ts](../src/chat/use-route-chat.ts) owns the in-memory conversation and request lifecycle.
- [src/App.tsx](../src/App.tsx) composes the canvas, chat panel, theme, and key status.
- [vite.config.ts](../vite.config.ts) mounts the API in both dev and preview modes. A static-only deployment has no API.

## State boundaries

The canvas graph and theme live in browser local storage. Chat state lives only in memory.

The graph includes model connections, node positions, and the Input node's reusable prompt. Canvas pan and zoom persist separately. Chat state includes messages and the current draft. API keys belong in `.env.local` on the server and never enter the browser bundle.

## Validation

`bun run check` runs Lat, Konsistent, and Biome. Typecheck, test, and build cover TypeScript, behavior, and production output.

Konsistent enforces the filename-derived primary export for 20 component modules across `src/components/ui`, `src/components`, `src/chat`, and `src/flow`. The icon family and app entrypoints have separate roles.
