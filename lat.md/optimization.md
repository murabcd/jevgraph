# Context and cost optimization

Model routing compares approved models by projected cost and observed cache evidence. [[context]] prepares sources, [[routing]] executes, and [[chat]] scopes session reuse.

Convex stores reusable summaries through [[persistence]]. Provider calls use direct AI SDK packages.

## Model planning

Planning contracts validate model choices and separate forecasts from actual usage.

[[src/lib/model-routing.ts]] owns allowed model IDs, expected output tokens, expected requests with the same prefix, cache modes, and validated planning traces. [[server/model-planner.ts]] estimates input tokens as UTF-8 bytes divided by four; this is a labelled estimate, not a tokenizer or API token count. Expected output must fit the node's maximum output limit. The planner compares total projected cost for one to twenty expected requests across GPT-6 Luna and Gemini 3.8 Flash. Allowed models express the user's acceptable quality; the planner does not infer task capability. Reasoning must be supported by every allowed model.

Unavailable server keys and unknown prices exclude a candidate. Custom rates apply only to the configured model that owns them; other candidates use the dated published catalog in [[src/lib/model-pricing.ts]]. No viable candidate produces an error eligible for the node's one explicit backup attempt. No implicit retry or alternate candidate call is made. The stream, output, usage ledger, and canvas footer report the actual selected provider/model. A separate planning record reports estimates and context-preparation cost so far; actual charges remain API-token-based ledger estimates.

The planner owns both context-price comparison and final candidate selection. It estimates the shared rendered input once per quote batch and returns the chosen target, its exact quote, and the planning trace together. Execution never searches the trace to recover a selected candidate or applies the previous model's rate overrides to a different provider. [[server/provider-ledger.ts]] owns preparation-cost totals; [[server/node-context.ts]] applies the same model-price policy while choosing representations.

## Provider cache

Cache planning uses content identity and reported usage, without claiming guaranteed provider hits.

The reusable prefix contains System instructions, configured examples, and selected documents. Provider model and reasoning participate in its hash; current query, selected Start values, history, and stage results remain outside this planned prefix. Changed prefix content or reasoning invalidates its evidence. API-reported cached reads (and OpenAI cache writes) establish evidence for a matching prefix. A reported miss clears it. Prefix observations expire after 30 minutes for OpenAI and five minutes for Gemini, and are capped at 128 per session.

For OpenAI, automatic routing explicitly controls prompt cache behavior using the installed direct SDK's Responses options and text breakpoints in [[server/model-prompt.ts]] and [[server/api.ts]]. Prefixes below the estimated 1,024-token threshold are not credited. A cold prefix is written only when its write premium plus projected later reads costs less than uncached requests. A single request remains uncached; a matching observed prefix can be reused. Projection assumes later reuse and is not a promise. Manual model mode retains ordinary provider defaults.

Gemini uses its implicit cache; no explicit cache object or paid storage is created. A cold prefix receives no assumed discount. A prefix above the estimated 4,096-token threshold can receive a projected discount only after reported cache reads for the same model/settings/content. Five-minute evidence is a conservative local heuristic, not a provider TTL guarantee. Actual provider hits or misses are always recorded independently of the forecast. See the official [OpenAI cache guide](https://developers.openai.com/api/docs/guides/prompt-caching) and [Gemini cache guide](https://ai.google.dev/gemini-api/docs/generate-content/caching).

## Optimization storage

The server retains bounded optimization records per conversation and account; Convex additionally stores reusable summaries.

[[server/session-memory.ts]] owns the bounded in-process pool, scoped by the persisted conversation ID plus a SHA-256 hash of server credentials. Each of sixteen sessions retains at most 256 summaries and 500,000 summary characters, sixteen pending generations, and 128 prefix observations, with a 30-minute inactivity TTL. Standalone engine tests can omit persistence and use an isolated request/session ID; the configured application API requires an authenticated Convex conversation.

An optional typed SummaryStore capability retrieves or stores completed summaries in [[convex/summaries.ts]] through [[server/convex-persistence.ts]]. Workspace ownership, credential hash, and content/version identity prevent cross-owner or stale reuse. Persistent summaries expire after 30 days and are capped at 256 per workspace; hourly cleanup drains expired entries in batches. Failed retrieval/generation/persistence retains full source rather than using an unconfirmed summary. Simultaneous calls within one server session share a pending promise; separate server processes can independently generate the same summary.

Reload and server restart retain durable summary reuse, but provider-cache evidence remains bounded server memory. Realtime database synchronization never establishes provider-cache validity. Persistent summaries are compression artifacts, not semantic retrieval or long-term customer memory.

## Settings and observation

Node settings opt into automation; inspection explains the chosen provider and context.

[[src/flow/model-routing-fields.tsx]] exposes the cost-routing toggle, bordered checked allowed-model rows, expected output, and expected reuse count. [[src/flow/context-policy-fields.tsx]] exposes automatic context and adequacy probability; automatic document bindings use the same checked rows as Start variables. [[src/flow/model-plan-details.tsx]] shows candidate exclusions, estimated costs, cache mode, and preparation costs in run inspection. Settings save or cancel together with the node and persist with graph configuration; plans and measurements are retained with completed turns.
