# Repository Guidelines

## Knowledge Graph

Router is a Bun, Vite, and React app with a local server API. `lat.md/` is the canonical knowledge graph for its module interfaces, routing decisions, stream contract, canvas graph, and chat behavior. Start with [lat.md/lat.md](lat.md/lat.md), use `lat search` or `lat locate` to find the relevant sections, and update the graph in the same change whenever a documented contract moves. Run `bun run check:lat` after every graph change.

Every `lat.md/` section must begin with a concise overview paragraph. Use `[[wiki links]]` between architecture sections and supported source files. `bun run check:lat` validates structure and references; tests and runtime checks enforce behavior.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures, including Jev unavailability, model errors, and partial streams.

When a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long-term maintainability is a core priority. Before adding functionality, check whether shared logic belongs in a separate module. Duplicate logic across files is a code smell. Change existing code when that is the clean solution; do not layer local shortcuts or compatibility wrappers over an obsolete contract.

There are no existing users who need legacy formats or adapters. Remove superseded paths when changing a contract. Preserve the intentional one-attempt model failover documented in [lat.md/routing.md](lat.md/routing.md).

## Architecture Boundaries

Input can connect directly to a Model or through Jev. Jev evaluates the configured Choice, Noul, or Score question only on the routed path. The server calls Jev, OpenAI, and Gemini through direct AI SDK provider packages; do not add AI Gateway. The React Flow graph determines the selected model for direct paths and each Jev output. Keep provider calls and API keys on the server. Chat messages live in memory, while graph layout, theme, and chat panel visibility persist in browser local storage.

## Build, Test, and Development Commands

Run `bun install` at the repo root. `bun run dev` starts the Vite UI and local API. `bun run build` typechecks and builds the production bundle; `bun run preview` serves it with the local API. `bun run test` runs the Bun tests, and `bun run typecheck` checks TypeScript. `bun run check` runs Lat, Konsistent, and non-mutating Biome validation. Use `bun run check:lat` and `bun run check:konsistent` for those layers alone. `bun run check:fix`, `bun run lint:fix`, and `bun run format` intentionally rewrite files.

## Coding Style and Naming Conventions

Biome is the formatter and linter (`biome.json`). Use tabs for TypeScript indentation, double quotes in JavaScript and TypeScript, and Biome-organized imports. Treat `lint` and `check` as read-only validation commands. Single-component React modules use kebab-case filenames and matching PascalCase exports; `konsistent.json` enforces the current cohort. Hooks use `use-*.ts` or `use-*.tsx`. Update Konsistent when a repeated structural convention intentionally changes.

Use shadcn/ui components for app UI. Compose the existing primitives before adding new ones, and keep provider icons and canvas behavior in their current modules rather than duplicating them in chat or the API.

## Code Quality

Avoid `any` unless it is necessary and locally justified. Before guessing an external API shape, inspect the installed dependency types and use exported types. Avoid inline runtime imports and `import("pkg").Type` in type positions; use top-level imports and `import type` declarations.

Do not add generic `isRecord` or `asRecord` helpers. Keep trusted values typed from their source. Parse truly unknown external, persisted, or SDK data once at its boundary with a named schema that describes the contract, then pass the concrete domain type downstream.

Prefer source-owned types. Before declaring a duplicate type, reuse an exported type or derive it with `typeof`, `ReturnType`, `Awaited`, `Parameters`, indexed access, `z.infer`, `Pick`, or `Omit`. Export shared semantic contracts from the module that owns their runtime value, schema, or API. Keep private implementation state local.

## Testing Guidelines

Do not write tests for reversible, low-impact changes that merely mirror the implementation. Tests should verify meaningful behavior or a real failure mode. Run the checks appropriate to the change, including `bun run test` for behavior changes and `bun run typecheck` plus `bun run check` for code changes. Verify UI interactions in the running app when the result depends on browser behavior. Once sufficient evidence passes, broaden testing only for a concrete remaining risk.

## Commit and Pull Request Guidelines

Keep commits granular by feature or concern. Use lowercase Conventional Commit subjects such as `feat: ...`, `fix: ...`, `test: ...`, `chore: ...`, or `docs: ...`. Run relevant checks before committing. A PR should summarize the change, verification, and any material risk; include screenshots or recordings for visible UI changes when useful.

## Security and Configuration

Keep `TYPESAFE_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local` on the server. Never commit credentials or local env files. Update `.env.example` when configuration changes, and ensure browser code does not receive secrets.
