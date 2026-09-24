# Route Studio

A local Vite playground for dynamic AI model routing. Jev classifies each new chat message as a fast or deep task, then sends it to the model node connected to that branch. The [AI SDK](https://ai-sdk.dev/docs) calls Jev, Gemini, and OpenAI through their direct provider packages. The full-height canvas uses React Flow, with a collapsible shadcn/ui chat panel.

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

Then run `bun run dev` and open the Vite URL. Put actual values only in `.env.local`; `.env.example` is a template and Vite does not load it. `.env.local` is gitignored. The chat shows an alert if a required key is missing; key status refreshes when the window gains focus or a route runs.

## What the route does

1. The server uses `@ai-sdk/typesafe-ai` and `experimental_evaluate` to ask Jev's `jev-latest` Choice model to select `fast` or `deep`.
2. A confident `fast` or `deep` decision chooses the model node connected to that Jev output. Model nodes can use either OpenAI or Gemini.
3. When Jev is unavailable or confidence falls below 70%, the deep branch handles the request.
4. If the selected model fails, the server tries the model on the other branch once.

The default models are `gemini-3.5-flash-lite` and `gpt-5-mini`. Select a model node to reveal its toolbar, then use the model button to open the searchable picker grouped by provider. The toolbar also has Focus, Duplicate, and Remove actions. The 70% threshold is a policy setting, not a measured accuracy guarantee. Each chat turn routes independently, while the selected model receives recent conversation history for follow-up questions.

The playground caps model output at 1,400 tokens. GPT-5 mini uses minimal reasoning effort in this preview. This affects response latency and length, not Jev's classification.

Drag a connection from a Jev output to empty canvas to create and connect a model node. Drag a connection to an existing model node to reroute that branch. Each Jev output has one active model connection; replacing it removes an unused old model node. The connected nodes and their selected models determine execution. Canvas layout and the light/dark theme persist in browser local storage. Chat messages remain in memory until the page reloads or the conversation is cleared. The chat panel can be collapsed and reopened without losing the current conversation.

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

The `/api/route` and `/api/status` endpoints run in Vite's dev and preview servers. A static-only deployment will not provide these endpoints; deploy them with a server runtime before using the app remotely. Keep all three keys on that server.

The [knowledge graph](lat.md/lat.md) records the app's architecture and runtime contracts. [AGENTS.md](AGENTS.md) has repository working rules; [konsistent.json](konsistent.json) enforces the repeated component export convention.

## References

- [TypeSafe API reference](https://docs.typesafe.ai/api)
- [TypeSafe intent routing](https://docs.typesafe.ai/patterns/intent-routing)
- [AI SDK generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
- [AI SDK TypeSafe provider](https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai)
