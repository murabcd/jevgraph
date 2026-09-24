# Route Studio

A local Vite playground for visual AI model routing. Connect Input directly to a Model, or route each message through Jev's Choice, Noul, or Score question. The [AI SDK](https://ai-sdk.dev/docs) calls Jev, Gemini, and OpenAI through their direct provider packages. The full-height canvas uses React Flow, with a collapsible shadcn/ui chat panel.

## Start

```bash
bun install
cp .env.example .env.local
```

Fill in `.env.local`:

```dotenv
TYPESAFE_API_KEY=your_jev_key
OPENAI_API_KEY=your_openai_key
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key
```

Then run `bun run dev` and open the Vite URL. Put actual values only in `.env.local`; `.env.example` is a template and Vite does not load it. `.env.local` is gitignored. A direct path needs only its model provider's key; a Jev path also needs the TypeSafe key. The chat shows an alert if a required key is missing; key status refreshes when the window gains focus or a route runs.

## What the route does

1. Input can connect straight to a Model. The server sends the conversation to that selected OpenAI or Gemini model without calling Jev.
2. Input can instead connect to Jev. The server uses `@ai-sdk/typesafe-ai` and `experimental_evaluate` to ask `jev-latest` the configured Choice, Noul, or Score question, then calls the Model connected to the chosen output.
3. When Jev is unavailable or confidence falls below 70%, the first output connected to the configured default provider handles the request. If a Jev-selected model fails before producing text, the server tries one other connected model once. Direct paths have no alternate branch.

The default models are `gemini-3.5-flash-lite` and `gpt-5-mini`. Select a Model node to reveal its toolbar, then use the model button to open the searchable picker grouped by provider. The toolbar also has Focus, Duplicate, and Remove actions. The 70% threshold is a policy setting, not a measured accuracy guarantee. The selected model receives recent conversation history for follow-up questions.

The playground caps model output at 1,400 tokens. GPT-5 mini uses minimal reasoning effort in this preview. This affects response latency and length, not Jev's classification.

Drag a connection from Input to empty canvas to choose Router or Model. Dragging from a Jev output offers Model. You can also connect Input or a Jev output to an existing compatible node. Each Jev output has one active model connection. The connected nodes and their selected models determine execution. Canvas layout, the light/dark theme, and whether chat is expanded persist in browser local storage. Chat messages remain in memory until the page reloads or the conversation is cleared. The chat panel can be collapsed and reopened without losing the current conversation.

## Commands

```bash
bun run dev     # Vite UI and local API
bun run build   # typecheck and production build
bun run preview # serve built UI with local API
bun run check   # Lat, Konsistent, and read-only Biome checks
bun run check:lat         # knowledge graph links and structure
bun run check:konsistent  # component export conventions
bun run lint    # read-only Biome lint
bun run format  # write Biome formatting changes
bun run typecheck
bun run test
```

The `/api/route` and `/api/status` endpoints run in Vite's dev and preview servers. A static-only deployment will not provide these endpoints; deploy them with a server runtime before using the app remotely. Keep the provider keys on that server.

The [knowledge graph](lat.md/lat.md) records the app's architecture and runtime contracts. [AGENTS.md](AGENTS.md) has repository working rules; [konsistent.json](konsistent.json) enforces the repeated component export convention.

## References

- [TypeSafe API reference](https://docs.typesafe.ai/api)
- [TypeSafe intent routing](https://docs.typesafe.ai/patterns/intent-routing)
- [AI SDK generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
- [AI SDK TypeSafe provider](https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai)
