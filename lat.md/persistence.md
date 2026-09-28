# Persistence

Convex stores owner-scoped graph configuration, documents, conversations, run records, and reusable summaries. The local API still executes the graph and streams direct provider responses. See [[architecture]], [[canvas]], [[chat]], and [[optimization]].

## Ownership and setup

Anonymous Convex Auth establishes a persistent browser identity, and application functions verify that identity before reading or writing records.

[[convex/auth.ts]], [[convex/auth.config.ts]], and [[convex/http.ts]] configure the anonymous provider and auth HTTP routes. [[src/main.tsx]] creates the browser client; [[src/storage/workspace-gate.tsx]] signs in once and initializes an empty workspace from the existing local canvas. [[convex/access.ts]] owns typed access checks, and [[convex/schema.ts]] owns indexed tables. Provider credentials remain on the local API server. Development configuration uses CONVEX_DEPLOYMENT, VITE_CONVEX_URL, and VITE_CONVEX_SITE_URL; signing keys live only in Convex environment configuration. Anonymous sessions have no cross-device recovery.

## Graph saves

The browser edits optimistically, then serializes and coalesces saves against its last acknowledged revision.

[[src/lib/graph-snapshot.ts]] validates editable drafts independently of the executable workflow. It permits incomplete settings, enforces one Start and unique valid node/edge identities, and caps configuration at 100 nodes, 400 edges, and 900,000 UTF-8 bytes. [[src/flow/graph.ts]] projects configuration while excluding selections, outputs, usage, timers, and callbacks. [[convex/workspaces.ts]] atomically initializes one workspace per owner and compares the submitted revision before saving.

[[src/storage/graph-save-queue.ts]] preserves write order and ignores its own realtime echoes. Later edits coalesce while a write is pending. An independent committed revision reaches idle editors; a conflicting pending save freezes its queue and surfaces a reload error. A remote revision received during a flush is reconsidered after acknowledgment. [[src/storage/use-saved-graph.ts]] debounces changes for 350 ms, flushes before chat execution, and warns before unloading unsaved changes. Closing a page immediately can still interrupt a pending request; acknowledged changes are durable.

## Conversations and runs

Each run records its unique request ID and user/assistant pair atomically before any paid provider call.

[[convex/conversations.ts]] stores a workspace's current conversation and exposes the latest fifty conversations and latest hundred messages of a selected chat. New conversation retains earlier records. Switching conversations is owner-checked and blocked during an active response. [[src/chat/chat-history-menu.tsx]] renders saved conversations using bordered rows, icons, and a selected checkmark. [[src/chat/use-saved-conversation.ts]] restores messages and usage footers through reactive queries and downloads only the latest full result.

[[convex/runs.ts]] deduplicates request UUIDs and permits one active response per conversation. Runs transition from running to completed, failed, or interrupted. A three-minute scheduled lease marks a run interrupted if the local server stops before settling it; the workflow's deadline is two minutes. Failed streams retain partial answer text. Completed results store text and a validated usage footer atomically with the final status; [[convex/results.ts]] stores the full validated result as a JSON file, up to eight MiB, and removes the file if finalization fails. Run ordering uses creation time, not request UUIDs.

[[server/convex-persistence.ts]] forwards the browser's bearer token to Convex. [[server/api.ts]] registers a run before execution and settles it before emitting done. Duplicate submissions return an error without repeating model calls. [[vite.config.ts]] propagates client disconnects into the provider abort signal. Database failures before execution prevent provider calls; failures after a partial stream are reported and lease expiry releases any unsettled lock. Streaming deltas and live timers stay in the submitting tab; other tabs observe the running lock and settled messages in realtime. Saved results support trace inspection after reload when their workflow matches the current graph.

## Reusable summaries

Persistent summaries retain content identity and expiry without claiming a provider cache hit or extending the history window.

[[convex/summaries.ts]] stores short and detailed summaries by workspace, credential scope, and source fingerprint. Upserts refresh a thirty-day expiry, and each workspace retains at most 256 entries. [[convex/crons.ts]] cleans expired entries hourly in bounded batches. [[server/session-memory.ts]] consumes a typed SummaryStore capability and shares one pending generation within a server session. Separate processes can generate the same summary concurrently; storage still upserts one canonical record. Provider-cache observations remain ephemeral and expire according to [[optimization]].
