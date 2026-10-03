# Repository Guidelines

## Knowledge Graph

`jevgraph` is a single-package Bun project using Vite, React, a local server API, and Convex. `lat.md/` is the canonical knowledge graph for module interfaces, graph execution, provider calls, context optimization, streaming, persistence, and chat behavior. Start with [lat.md/lat.md](lat.md/lat.md), use `lat search` or `lat locate` to find the relevant sections, and read those sections before changing their contracts. Update the graph in the same change whenever a documented contract moves. Run `bun run check:lat` after every graph change.

Every `lat.md/` section must begin with a concise overview paragraph. Use `[[wiki links]]` between architecture sections and supported source files; use ordinary Markdown links for file types Lat cannot parse. `bun run check:lat` validates structure and references; TypeScript, tests, and runtime checks enforce behavior. Keep this file and [README.md](README.md) aligned with the implemented project.

## Project Structure and Ownership

- `src/flow`: React Flow canvas, node editors, connection rules, and run inspection. `graph.ts` owns compilation and configuration projection.
- `src/chat`: composer, streamed replies, saved conversations, history, and usage display.
- `src/components`: shared shadcn/ui primitives, AI components, and provider icons.
- `src/lib`: source-owned graph, request, stream, context, model, and pricing contracts shared with the server.
- `src/storage`: anonymous workspace initialization and revision-checked realtime graph saves.
- `server`: local API, graph scheduling, direct provider calls, context preparation, cost planning, and Convex persistence client.
- `convex`: authentication, indexed schema, owner checks, workspaces, conversations, runs, checkpoint journals, result files, and reusable summaries. `_generated` contains CLI-generated bindings.
- `tests`: Bun behavior tests, typed provider fixtures, and the Convex test backend.
- `lat.md`: architecture and runtime knowledge graph.
- `public`: app assets and the README preview.

Keep browser code independent of server modules and provider credentials. Shared contracts belong in the module that owns their schema or runtime behavior; the browser and server should consume the same contract.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures, including Jev unavailability, model errors, database failures, conflicting edits, reconnects, and partial streams.

When a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long-term maintainability is a core priority. Before adding functionality, check whether shared logic belongs in a separate module. Duplicate logic across files is a code smell. Change existing code when that is the clean solution; do not layer local shortcuts or compatibility wrappers over an obsolete contract.

There are no existing users who need legacy formats or adapters. Remove superseded paths when changing a contract. Preserve the intentional one-attempt model failover documented in [lat.md/routing.md](lat.md/routing.md).

Keep modules focused on their owned behavior. Avoid speculative abstractions, catch-all option objects, duplicated mutable state, and wrappers that only forward arguments. Use derived values when the source already exists. Bound concurrent work, retained data, and cache lifetime; avoid unbounded queries or per-item provider calls when a batch is available. Clean up subscriptions, timers, pending work, and temporary files on their actual completion or failure paths.

Do not hide failures behind empty results, guessed defaults, or successful completion states. Preserve useful errors and partial output. A conservative full-context result after failed compression and an explicitly configured backup are intentional runtime policies; they are not obsolete compatibility code.

## Architecture Boundaries

The chat composer starts every turn at the single required Start node. Start owns typed input fields and reference documents; API values override configured defaults. Jev and Model nodes receive only explicitly selected Start fields and context sources. New chat turns never inherit execution state. Explicit recovery resumes the same interrupted run from acknowledged stages using its frozen graph and inputs. See [lat.md/routing.md](lat.md/routing.md) and [lat.md/context.md](lat.md/context.md).

Jev evaluates its 1–16 named Choice, Noul, or Score questions together only on a reached path. Each question owns its threshold, independent uncertainty/error policies, and question-scoped output IDs. Valid answers below threshold use only the uncertainty output; failed evaluations and missing/invalid answers use only the error output. Both default to stopping with an error. Resolve the entire batch before releasing selected paths; retain every decision downstream. A repeat Jev node contains exactly one question. Model nodes can continue, run in parallel, join, or use an explicit backup; Jev can repeat a bounded branch. Preserve forward-cycle rejection, joins over reachable work, logical stage identity through backups and repeats, and the single final-answer requirement. An exhausted review loop must not traverse its success exit or appear approved.

The local server calls Jev, OpenAI, and Gemini through direct AI SDK provider packages; do not add AI Gateway. Jev evaluates decisions rather than generating prose. Generation currently supports GPT-6 Luna and Gemini 3.8 Flash. A catalog change must update supported reasoning options, request validation, provider execution, editor behavior, pricing, relevant tests, and Lat together. Provider icons remain in their shared module.

Keep execution bounded and cancellation propagated through generation, decisions, relevance, and summary preparation. The scheduler currently allows four independent nodes at once and enforces a two-minute active-attempt deadline plus run-wide node, provider-attempt, and repeat budgets retained across recovery. Do not add implicit SDK retries: a configured backup runs once only if the primary failed before producing text, and never after cancellation or a partial answer.

The API emits validated newline-delimited JSON events. Keep the server producer, shared event schemas, stream decoder, chat consumer, and canvas projection aligned. Running node timers use a monotonic browser clock; final durations come from the server. Temporary execution state must stay out of saved graph configuration.

### Context, Cost, and Cache

Current query, selected Start values, System instructions, and configured examples are mandatory. Optional history, documents, and reached upstream results follow each node's bindings and budget. Automation never reads an unselected document or executes an unreached source. Failed or uncertain relevance and adequacy assessments retain the full selected source, subject to the final optional-context budget.

Automatic context chooses omission, a short summary, a detailed summary, or full text. Reusable summaries depend on source content, version, workspace ownership, and credential scope. Summary reuse does not provide semantic retrieval, extend the recent history window, or establish persistent interview state. Explicit node retrieval separately uses Convex vector/text indexes over selected documents and opt-in saved history, followed by batched Jev reranking. Conditional instructions use selected typed Start values or accepted reached upstream decisions. Query-aware summary identity includes the query and effective task. See [lat.md/optimization.md](lat.md/optimization.md).

Automatic model/reasoning routing assesses the current task with a batched Jev call over explicitly configured, supported pairs and task criteria. Missing or invalid assessments stop selection; manual configuration remains available. Evidence and cache identity distinguish each pair. Automatic routing requires owner-reviewed quality and full-turn latency evidence before comparing complete-route projected cost per passing answer. Evaluation mode runs the configured approved candidate; distinct comparable cases, strategy/source identity, expiry, credential scope, failures and unknown costs must remain explicit. Context preparation payback uses a labelled cold forecast and retains full context when savings do not cover cost, unless preparation is needed for the final budget. Separate forecasts from API-reported usage and actual selected models. Account for every attempted provider call, including preparation, relevance, repeats, backups, and failures with reported usage. Missing usage stays unknown, totals become incomplete, and reasoning tokens are not added to output twice. Published rates need sources and verification dates; unknown models have no guessed price.

Provider-cache evidence is temporary, bounded, scoped, and invalidated when its prefix or settings change. Database persistence and summary reuse do not prove a provider-cache hit. Preserve conservative handling of cold prefixes and failed assessments rather than promising savings that have not been measured.

## Convex and Persistence

Convex owns owner-scoped graph configuration, documents, conversations, messages, run records, result files, and reusable summaries. The browser consumes realtime queries; graph writes use revision checks and a serialized, coalescing save queue. Conflicting pending edits must surface an error rather than silently overwrite another tab. Flush graph saves before starting a chat turn. See [lat.md/persistence.md](lat.md/persistence.md).

Anonymous Convex Auth supplies the browser identity. Authenticate application queries, mutations, and actions and verify ownership of every referenced workspace, conversation, run, or file through the shared access layer. A valid ID is not authorization. Anonymous sessions have no cross-device account recovery.

The local API requires an authenticated Convex connection, a conversation ID, and a unique request UUID. Register the user/assistant pair and active-run lock before any paid provider call. Preserve request deduplication, one active response per conversation, lease-based interruption recovery, partial failure text, and settlement before the final stream completion event. Checkpoint each provider reservation before paid work and each completed stage before downstream execution. Recovery rotates the execution token and checks journal revisions, ownership, credential scope, frozen versions, and latest/current conversation identity. Lost provider attempts retain unknown duration and usage. Stop is final; no paid work resumes automatically. Delete superseded journal and interrupted artifact files on their actual finalization paths. Database failure must not silently switch execution to an in-memory mode.

Streaming deltas, live timers, and provider-cache observations remain temporary. Convex stores settled messages and traces; browser storage retains viewport, theme, chat visibility, and authentication state. Do not reintroduce local-storage graph drafts, legacy session-ID requests, or a database-optional API.

Before changing Convex behavior, read its Lat contract and the relevant installed Convex skill. Use argument and return validators, generated API references, `Doc`/`Id` types, and indexed, bounded queries. Keep database updates atomic in mutations; actions coordinate external work through typed queries and mutations. Validate stored JSON with the source-owned schema at its boundary. Preserve result-file cleanup when finalization fails and bounded summary expiry cleanup.

Regenerate `convex/_generated` with the Convex CLI; never hand-edit generated bindings. `convex.json` intentionally disables generated AI files. Inspect existing development configuration before provisioning another deployment. Local tests and builds do not deploy functions; verify the intended Convex target before synchronization or deployment, and do not change production merely to validate local work.

## Build, Test, and Development Commands

Run commands from the repository root.

| Command | Purpose |
| --- | --- |
| `bun install` | Install dependencies using Bun and `bun.lock`. |
| `bun run dev:convex` | Synchronize the configured development Convex backend; keep it running in a separate terminal. |
| `bun run dev` | Start the Vite UI and local API; the documented local URL is `http://localhost:5173`. |
| `bun run typecheck` | Check app/server TypeScript and the separate Convex TypeScript project. |
| `bun run test` | Run Bun tests, including Convex tests. |
| `bun test tests/workflow.test.ts` | Run a focused test file; select the file relevant to the change. |
| `bun run build` | Typecheck and build the production UI bundle. |
| `bun run preview` | Serve the built bundle with the local API. |
| `bun run check` | Run Lat, Konsistent, and read-only Biome checks. |
| `bun run check:lat` | Validate knowledge-graph structure and references. |
| `bun run check:konsistent` | Validate cross-file structural conventions. |
| `bun run lint` | Run read-only Biome linting. |
| `bun run check:fix` / `bun run lint:fix` / `bun run format` | Intentionally rewrite files with Biome. |

Follow [README.md](README.md) and [`.env.example`](.env.example) for initial Convex and auth setup. A static-only deployment has no local API; both development and preview mount it through `vite.config.ts`. Adding a deployment path requires an explicit server runtime rather than assuming the UI bundle can execute provider calls.

## Coding Style and Naming Conventions

Biome is the formatter and linter (`biome.json`). Use tabs for TypeScript indentation, double quotes in JavaScript and TypeScript, and Biome-organized imports. Treat `lint` and `check` as read-only validation commands. Single-component React modules use kebab-case filenames and matching PascalCase exports; `konsistent.json` enforces the current cohort. Hooks use `use-*.ts` or `use-*.tsx`; Convex function modules use descriptive names consistent with existing modules. Update Konsistent when a repeated structural convention intentionally changes, rather than weakening it to bypass a violation.

Use shadcn/ui components for app UI, composed from the existing Base UI primitives. Reuse existing controls before adding another component or dependency. Keep graph behavior, provider presentation, and form logic in their owned modules rather than duplicating them in chat or the API.

Preserve consistency with existing form layouts, selection controls, spacing, typography, and interaction patterns. Use shared components for recurring patterns instead of styling each feature independently. Maintain keyboard navigation, focus states, and accessible labels. Verify layout and interaction changes in the running app.

## Code Quality

Avoid `any` unless it is necessary and locally justified. Before guessing an external API shape, inspect the installed dependency types and use exported types. Avoid inline runtime imports and `import("pkg").Type` in type positions; use top-level imports and `import type` declarations. Do not use casts or suppressed diagnostics to conceal a broken contract.

Do not add generic `isRecord` or `asRecord` helpers or rename the same generic guard. Keep trusted values typed from their source. If trusted data becomes `unknown`, fix the upstream type flow. Parse truly unknown external, persisted, or SDK data once at its boundary with a named schema that describes the contract, then pass the concrete domain type downstream.

Prefer source-owned types. Before declaring a duplicate type, reuse an exported type or derive it with `typeof`, `ReturnType`, `Awaited`, `Parameters`, indexed access, `FunctionReturnType`, `z.infer`, `Doc`, `Id`, `Pick`, or `Omit` where appropriate. Export shared semantic contracts from the module that owns their runtime value, schema, or API. Keep private implementation state local; do not export details solely to avoid a local type.

Use explicit outcomes and validated state transitions. Keep error handling at the layer that can act on the failure, propagate cancellation, and account for attempted provider work even when it fails. Do not add effects to copy state that can be derived, rerender the whole canvas on timer ticks, or put server behavior in UI callbacks. Resolve high-confidence maintainability findings before declaring the change complete.

## Testing Guidelines

Tests live in `tests/*.test.ts` and use `bun:test`. Convex tests use `convex-test` through `tests/convex-fixture.ts`; API tests use `tests/api-fixture.ts` and the same required persistence lifecycle. Reuse typed fixtures and controlled provider responses instead of calling paid APIs or a production database in the automated suite.

Test behavior and real failure modes rather than private implementation details. Routing changes should cover reached paths, joins, repeats, exhaustion, backup eligibility, and cancellation as relevant. Stream changes should cover decoding, partial responses, error settlement, and interrupted timers. Context and cost changes should cover source isolation, uncertain assessments, cache invalidation, missing usage, and preparation accounting. Persistence changes should cover owner isolation, stale revisions, deduplication, active-run locks, partial failures, file cleanup, and expiry as relevant to the changed contract.

Do not write tests for reversible, low-impact changes that merely mirror the implementation. Run focused tests while developing, then `bun run test` for behavior changes and `bun run typecheck` plus `bun run check` for code changes. Run `bun run build` when bundling, imports, dependencies, configuration, or production output may be affected. For documentation-only work, validate referenced paths and commands and run `bun run check`; a knowledge-graph change also requires `bun run check:lat`.

Verify UI interactions in the running app when the result depends on browser behavior. When an end-to-end provider test is requested, use a coherent conversation in the requested language with natural user messages and inspect the reached paths, answer, usage, and saved state. Clearly distinguish controlled fixtures from real provider calls, local browser checks from production validation, and measured results from estimates. Once sufficient evidence passes, broaden or repeat testing only for a concrete remaining risk.

## Commit and Pull Request Guidelines

Keep commits granular by feature or concern. Use lowercase Conventional Commit subjects such as `feat: ...`, `fix: ...`, `test: ...`, `chore: ...`, or `docs: ...`. Inspect the diff, run relevant checks, and resolve failures before committing. Preserve unrelated work and follow the user's explicit commit, amend, push, and deployment instructions; these are separate actions.

A PR should lead with the concrete problem and resulting behavior, then state verification and material limitations. Include screenshots or recordings for visible UI changes when useful. Call out schema, auth, environment, provider pricing, or deployment changes explicitly. Do not claim that a local test, commit, or build proves a pushed change or live deployment.

## Security and Configuration

Keep `TYPESAFE_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local` on the local server. Never send provider credentials to the browser, store them in Convex records, log them, or commit local env files. Only public Convex endpoints use the `VITE_` prefix. `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, and `VITE_CONVEX_SITE_URL` identify the configured backend; Convex Auth signing keys belong in that deployment's environment, not the client bundle.

Update `.env.example` and setup documentation when configuration changes. Preserve request and stored-data validation, size limits, owner checks, and server-side access to credentials. Context relevance is not authorization: selected source text can reach Jev during assessment even if it is later omitted from generation. Do not add client-side provider calls or use hidden credentials in test fixtures.
