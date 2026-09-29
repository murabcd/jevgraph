<a href="#jevgraph">
  <img alt="JevGraph canvas with Jev classification, model routing, and connected backup models." src="./public/jevgraph.png">
  <h1 align="center">JevGraph</h1>
</a>

<p align="center">
  Visual chatflows with Jev, OpenAI, Gemini, and Convex.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a> ·
  <a href="#building-chatflows"><strong>Building chatflows</strong></a> ·
  <a href="#self-hosting"><strong>Self-hosting</strong></a>
</p>
<br/>

## Status

JevGraph is early. Expect bugs.

Each chat message runs the graph from Start. Conversations and completed runs
persist in Convex; workflows that pause and resume across messages are not
implemented yet.

## Features

- Visual chatflow editing with Jev and Model nodes
- Jev Choice, Noul, and Score evaluations for branching decisions
- OpenAI and Gemini generation with prompts, examples, and reasoning controls per node
- Parallel model paths, joined results, bounded review loops, and explicit backup models
- Context selection per node, relevance filtering, and query-aware full-text or summary selection
- Convex hybrid passage retrieval with OpenAI embeddings and Jev reranking
- Conditional instructions from selected Start values and accepted upstream Jev decisions
- Model evaluation with owner reviews, quality/latency gates, and complete-route cost comparisons
- Optional pre-call context preparation payback and observed provider-cache planning
- Live execution paths, node timers, context inspection, token usage, and estimated costs
- Realtime graph saves, chat history, successful and failed run artifacts, and reusable context summaries in Convex

## Built with

- [Bun](https://bun.sh/), [Vite](https://vite.dev/), and [React](https://react.dev/) for the app and local API
- [React Flow](https://reactflow.dev/) for the graph canvas
- [Convex](https://www.convex.dev/) for realtime data and backend functions
- [Convex Auth](https://labs.convex.dev/auth) for anonymous browser sessions
- [AI SDK](https://ai-sdk.dev/) with direct [TypeSafe](https://docs.typesafe.ai/), [OpenAI](https://openai.com/), and [Google](https://ai.google.dev/) providers
- [shadcn/ui](https://ui.shadcn.com/), [Base UI](https://base-ui.com/), and [Tailwind CSS](https://tailwindcss.com/) for UI
- [Biome](https://biomejs.dev/), Konsistent, and Lat for code and architecture checks

## Running locally

Install dependencies and create your local environment file:

```bash
bun install
cp .env.example .env.local
```

Add the keys for the providers you use to `.env.local`. Retrieval needs an OpenAI key for embeddings and a TypeSafe key for Jev reranking, even when Gemini generates the answer:

```dotenv
TYPESAFE_API_KEY=your_jev_key
OPENAI_API_KEY=your_openai_key
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key
```

Connect a development Convex deployment:

```bash
bunx convex dev --configure --once
```

The Convex CLI writes the deployment configuration and public URLs into
`.env.local`. Configure `JWT_PRIVATE_KEY`, `JWKS`, and
`SITE_URL=http://localhost:5173` in that Convex deployment, following the
[manual Convex Auth setup](https://labs.convex.dev/auth/setup/manual).
Provider keys stay on the local server; signing keys stay in Convex.

Keep backend synchronization running in one terminal:

```bash
bun run dev:convex
```

Start the app in another:

```bash
bun run dev
```

The app runs at [localhost:5173](http://localhost:5173/).

## Building chatflows

1. Define custom text, number, or boolean fields in Start. The latest chat message is the built-in query. API callers can supply declared field values through `metadata`.
2. Connect Jev and Model nodes. Select the Start fields and context each node needs. Jev evaluates its configured question; Model nodes generate text.
3. Configure Jev output criteria and Model prompts. Connected outputs continue through the graph; unconnected Jev outputs return their labels in chat. Parallel paths must join before producing one final answer.
4. Connect a Model's On error output to an explicit backup for one attempt if the primary fails before producing text. Connect a Jev output back to an earlier Model for a bounded review loop with a separate exit.
5. Send a chat message to run the graph. Inspect the reached path, decisions, context, timings, and provider usage on the canvas.

The initial canvas contains Start and an unconfigured Jev node. Complete the
Jev question and criteria before sending a message. Reference documents belong
to Start; each downstream node selects its own documents, history, and earlier
results. Enable **Retrieve relevant passages** in a node's Context settings to
search its selected documents. **Search previous messages** separately enables
retrieval from up to 200 saved messages in the current conversation. Candidate
and passage limits bound search and Jev reranking. Indexes build on the first
reached call and are reused when content and credential scope match.

**Automatic context** prepares summaries for the current query and effective
node instructions. **Conditional instructions** activate from selected Start
values or accepted reached Jev outputs; their status appears in run inspection.
Model settings also offer Evaluate selected model and Route using reviewed results. Define answer criteria, run distinct cases with each candidate, and mark answers Pass/Fail in last-turn inspection. Automatic routing requires reviewed quality, acceptable full-turn p95 latency, and complete costs; qualifying candidates must share the same test cases. Context settings can retain full sources when cold preparation cost exceeds optimistic savings.

Use the [shop-support evaluation cases](evals/shop-support.md) for the initial demo comparison. These features use the existing node settings. See [context](lat.md/context.md) and [routing](lat.md/routing.md).

## Self-hosting

Self-hosting requires your own Convex deployment, auth signing keys, and provider
keys. See [`.env.example`](.env.example).

The local API is mounted by Vite in development and preview. A deployment must
also run the server API; serving the static bundle alone does not provide it.

Anonymous authentication retains access across reloads in the same browser.
Clearing its authentication storage loses access to that identity. Account
recovery and cross-device login are not implemented yet.

## Build and preview

```bash
bun run build
bun run preview
```

The build typechecks the app and Convex functions, then creates the production
UI bundle. Preview serves that bundle with the local API.

## Project structure

- `src/flow`: graph canvas, node editors, and execution inspection
- `src/chat`: composer, streamed replies, saved conversations, and history
- `src/components`: shared UI primitives and AI components
- `src/lib`: graph, context, model, pricing, and stream contracts
- `src/storage`: Convex workspace initialization and realtime graph saves
- `server`: graph execution, direct provider calls, context preparation, and cost planning
- `convex`: authentication, schema, workspaces, conversations, runs, and reusable summaries
- `tests`: routing, providers, context, persistence, and failure behavior
- `lat.md`: architecture and runtime knowledge graph
- `public`: app assets and the README preview

## Model providers

Jev evaluates Choice, Noul, and Score questions. GPT-6 Luna and Gemini 3.8 Flash
generate replies through their direct AI SDK providers. API keys remain on the
server.

Cost totals include generation, decisions, embeddings, reranking, context preparation, repeats, and
backup attempts. Published rates provide estimates; node settings can override
them. Missing usage is marked incomplete, and estimates are not provider bills.

Automatic context selection can reuse summaries stored in Convex. Provider-cache
hits depend on reported usage and expiring observations. Summary reuse does not extend the history window. Passage retrieval supplies
semantic and keyword search over explicitly selected sources; it does not
establish persistent interview state or guarantee exhaustive recall. A workspace
retains at most 512 indexed passages for thirty days, with bounded cleanup.
Failed indexing/search is reported; uncertain Jev reranking retains search order. See
[optimization](lat.md/optimization.md) and [persistence](lat.md/persistence.md).

## Contributing

Read [AGENTS.md](AGENTS.md) and the [knowledge graph](lat.md/lat.md) before making
changes. Run the relevant checks:

```bash
bun run check
bun run typecheck
bun run test
bun run build
```

## References

- [TypeSafe API reference](https://docs.typesafe.ai/api)
- [AI SDK TypeSafe provider](https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai)
- [AI SDK generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
- [Anthropic, Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
