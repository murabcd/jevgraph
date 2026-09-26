# Route Studio

A local, visual chatflow for Jev-centered AI work. Every message in the ongoing chat runs the graph. Jev evaluates Choice, Noul, or Score; a connected output routes onward, while an unconnected output returns its label. Model nodes generate prose. The canvas shows what happened on each turn.

## Start

~~~bash
bun install
cp .env.example .env.local
bun run dev
~~~

Fill in .env.local with the provider keys you use:

~~~dotenv
TYPESAFE_API_KEY=your_jev_key
OPENAI_API_KEY=your_openai_key
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key
~~~

Keep actual keys only in .env.local. A turn needs keys for the providers it reaches; the chat warns about missing keys for providers configured anywhere in the connected graph. The local API runs with Vite in development and preview. A static-only deployment does not provide the API.

## Build a chatflow

1. Start is the required entry. Add custom text, number, or boolean fields there. The latest chat message is the built-in query. Defaults let you test fields locally; an API caller may supply declared values under `metadata`.
2. Connect Jev and Model nodes. In each node's settings, select only the Start fields it needs. Jev outputs can connect onward or end the path with the selected label; a Model's Continue output can feed another Jev or Model. Several paths can run in parallel but must join before one final answer.
3. Edit Model prompts for each model's specific task. A terminal Model generates the chat answer.
4. To repeat work, connect one Jev output back to an earlier Model. Set the Jev repeat limit in its settings panel. Another output must exit the loop.

Send a chat message to run the graph; there is no separate Run button. The canvas highlights reached nodes and edges, displays each node's elapsed time, and offers a last-turn output inspector. Chat history stays in memory. The graph, layout, viewport, theme, and chat visibility persist in browser local storage.

The server uses direct AI SDK provider packages for Jev, OpenAI, and Gemini. The installed Jev provider evaluates Choice, Noul, and Score questions; it does not generate prose. An explicit backup Model gets one attempt only if the primary fails before producing text. Jev failures or low confidence take the first connected non-repeat output, or report an error if none is available. See [routing](lat.md/routing.md) for bounds, failure policy, and stream events.

## Commands

~~~bash
bun run dev        # Vite UI and local API
bun run build      # TypeScript and production bundle
bun run preview    # built UI with local API
bun run check      # Lat, Konsistent, and read-only Biome
bun run typecheck
bun run test
~~~

The [knowledge graph](lat.md/lat.md) records the app's architecture and runtime contracts. [AGENTS.md](AGENTS.md) has repository working rules.

## References

- [TypeSafe API reference](https://docs.typesafe.ai/api)
- [AI SDK TypeSafe provider](https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai)
- [AI SDK generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
- [Anthropic, Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
