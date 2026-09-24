# Repository Guidelines

## Knowledge graph

Start with [lat.md/lat.md](lat.md/lat.md) for the architecture map. Use `lat search` or `lat locate` to find a relevant section. Update the graph in the same change when a documented contract moves, and run `bun run check:lat`. Begin each graph section with a short overview paragraph and link related sections with `[[wiki links]]`.

## Architecture boundaries

This is a Vite React app with a local server API. Jev chooses the route; the AI SDK calls Jev, OpenAI, and Gemini through direct provider packages. Keep credentials server-only in `.env.local`. The React Flow graph determines the connected model for each branch. Model failure can trigger one attempt on the other branch. Chat history is in memory; graph layout and theme persist in browser local storage.

There are no existing users to support with compatibility layers. Replace obsolete contracts cleanly and remove leftover adapters and fallbacks when changing them. Preserve the intentional runtime model failover described in [lat.md/routing.md](lat.md/routing.md).

## Commands and quality

Use Bun. `bun run dev` starts Vite and the local API. `bun run check` runs Lat, Konsistent, and read-only Biome checks; `bun run check:lat` and `bun run check:konsistent` run those layers separately. `bun run typecheck`, `bun run test`, and `bun run build` verify types, behavior, and the production bundle. `check:fix`, `lint:fix`, and `format` intentionally rewrite files.

Use shadcn/ui components for app UI. The single-component modules covered by [konsistent.json](konsistent.json) use kebab-case files with a matching PascalCase primary export. Keep provider-specific code at the server boundary and parse unknown external data there. Prefer source-owned types and focused tests that cover meaningful behavior. Do not add tests that only mirror a reversible UI edit.

## Changes and commits

Keep commits granular by feature or concern. Use lowercase Conventional Commit subjects such as `feat: ...`, `fix: ...`, `test: ...`, `chore: ...`, or `docs: ...`. Run relevant checks before committing. Do not commit keys or `.env.local`.
