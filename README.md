# Route Studio

A local, visual chatflow for Jev-centered AI work. Every message in the ongoing chat runs the graph. Jev evaluates Choice, Noul, or Score; a connected output routes onward, while an unconnected output returns its label. Model nodes generate prose. The canvas shows what happened on each turn.

## Start

~~~bash
bun install
cp .env.example .env.local
bunx convex dev --configure existing --once
bun run dev:convex # keep in a separate terminal while editing backend functions
bun run dev
~~~

Fill in .env.local with the provider keys you use:

~~~dotenv
TYPESAFE_API_KEY=your_jev_key
OPENAI_API_KEY=your_openai_key
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key
~~~

Keep actual keys only in .env.local. A turn needs keys for the providers it reaches; the chat warns about missing keys for providers configured anywhere in the connected graph. The local API runs with Vite in development and preview. A static-only deployment does not provide the API.

Convex Auth uses the anonymous provider to scope records to this browser session. Configure `JWT_PRIVATE_KEY` and `JWKS` in the **development Convex deployment**, following the [manual auth setup](https://labs.convex.dev/auth/setup/manual), plus `SITE_URL=http://localhost:5173`. Do not put signing keys in browser-prefixed variables or commit them. `bunx convex dev` writes the public deployment URLs into `.env.local`. An anonymous identity survives reloads, but clearing browser authentication storage loses access to that identity; there is no account recovery or cross-device login yet.

Reusable context summaries persist for up to thirty days. Provider-cache hits still depend on provider-reported usage and expiring server observations. Database persistence does not add search across documents or long-term semantic conversation memory. See [persistence](lat.md/persistence.md).

## Build a chatflow

1. Start is the required entry. Add custom text, number, or boolean fields there. The latest chat message is the built-in query. Defaults let you test fields locally; an API caller may supply declared values under `metadata`.
2. Connect Jev and Model nodes. In each node's settings, select only the Start fields it needs. Jev outputs can connect onward or end the path with the selected label; a Model's Continue output can feed another Jev or Model. Several paths can run in parallel but must join before one final answer.
3. Edit Model prompts for each model's specific task. A terminal Model generates the chat answer.
4. To repeat work, connect one Jev output back to an earlier Model. Set the Jev repeat limit in its settings panel. Another output must exit the loop. If Jev still selects the repeat branch when its limit is reached, the turn stops with “Review incomplete” rather than taking the other branch.

Start can also declare reference documents with full text and optional supplied summaries. Each Jev or Model chooses its own previous messages, earlier node results, and document representations, with a character budget for optional context. Optional Jev relevance filtering screens these chunks in one additional call; uncertain evaluations or provider failures retain the context. See [context](lat.md/context.md) for selection rules and bounds.

The node inspector shows selected context, structured Jev decisions, and each provider attempt. Chat totals include intermediate models, decisions, relevance calls, repeats, and backups. Missing provider usage is marked incomplete. USD cost is estimated automatically from published GPT-6 Luna, Gemini 3.8 Flash, and Jev prices; each node can override its rates, including separate relevance rates when enabled; these estimates are not provider bills.

Send a chat message to run the graph; there is no separate Run button. The canvas highlights reached nodes and edges, displays each node's elapsed time, and offers a last-turn output inspector. Convex saves the graph, documents, conversations, and completed run traces. Reload restores the current chat. New conversation retains earlier chats, and History reopens them. Revision checks prevent concurrent tabs from silently overwriting graph changes. Viewport, theme, and chat visibility remain local to the browser.

The server uses direct AI SDK provider packages for Jev, OpenAI, and Gemini. The installed Jev provider evaluates Choice, Noul, and Score questions; it does not generate prose. Each Jev node configures a minimum provider confidence for Choice and Score or a minimum selected-answer probability for Noul, plus an output for evaluations below that threshold or provider errors. A Model node configures its model, instructions, maximum output tokens, and supported reasoning effort. An explicit backup Model gets one attempt only if the primary fails before producing text. See [routing](lat.md/routing.md) for bounds, failure policy, and stream events.

New Jev nodes start as neutral drafts: Choice 1/Choice 2, Yes/No, or numbered Score levels with blank instructions and criteria. Complete the question in the node editor before sending a chat message. The initial canvas contains only Start and an unconfigured Jev node; model paths are added in the UI.

## Commands

~~~bash
bun run dev:convex # development backend synchronization
bun run dev        # Vite UI and local API
bun run build      # TypeScript and production bundle
bun run preview    # built UI with local API
bun run check      # Lat, Konsistent, and read-only Biome
bun run typecheck
bun run test
~~~

The `toml` override pins the patched parser used by the Lat CLI's XDG dependency; runtime providers are unaffected.

The [knowledge graph](lat.md/lat.md) records the app's architecture and runtime contracts. [AGENTS.md](AGENTS.md) has repository working rules.

## References

- [TypeSafe API reference](https://docs.typesafe.ai/api)
- [AI SDK TypeSafe provider](https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai)
- [AI SDK generating text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
- [Anthropic, Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
