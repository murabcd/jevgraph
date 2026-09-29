# JevGraph Knowledge Graph

This graph describes the app's runtime boundaries and the contracts shared by routing, the canvas, and chat. Update the relevant section when a contract changes, then run `bun run check:lat`.

- [[architecture]] — module ownership, persistence, and quality checks
- [[routing]] — Jev decisions, AI SDK calls, streaming, and provider failures
- [[canvas]] — graph connections, model selection, and saved layout
- [[chat]] — conversation state, stream consumption, and composer behavior
- [[context]] — node-specific context selection, passage retrieval, query-aware representations, conditional instructions, and relevance
- [[optimization]] — automatic model choice, provider cache projections, and temporary session storage

- [[persistence]] — owner-scoped Convex storage, realtime saves, durable chats, and summary reuse
