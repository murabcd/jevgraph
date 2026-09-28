# Context

Each reached Jev or Model builds its own context from identifiable conversation messages, reached stage outputs, and declared reference documents. The latest query, selected Start variables, and configured instructions remain mandatory. See [[routing]], [[canvas]], and [[chat]].

## Selection and representations

Explicit bindings select optional context before any provider call.

[src/flow/context-documents-editor.tsx](../src/flow/context-documents-editor.tsx) edits declared documents in the Start sheet using flat fields and InputGroup text controls. Each document's options menu owns removal; inputs have no adjacent removal button or explanatory descriptions. [src/flow/context-policy-fields.tsx](../src/flow/context-policy-fields.tsx) composes the node settings. [src/flow/context-document-binding-fields.tsx](../src/flow/context-document-binding-fields.tsx) owns representation selection, and [src/flow/context-relevance-fields.tsx](../src/flow/context-relevance-fields.tsx) owns optional relevance and its rates. Each control updates only its owned policy field. Binding lookup uses indexed source IDs for both editing and server selection.

[src/lib/context.ts](../src/lib/context.ts) owns documents, node context policies, selection traces, and document override validation. Start declares reference documents with stable IDs, names, full text, and optional supplied summaries. API clients may replace a declared document by ID; replacement never inherits an old summary. Documents are limited to 20 and 240,000 combined characters. A node selects each document as full text or a supplied summary; omission is the default. Missing selected summaries reject the request. Automatic summarization is not implicit; a Model branch can produce a summary and another node can bind its result.

[server/context.ts](../server/context.ts) applies the shared policy for both providers and Jev. The default is six previous messages, all reached upstream stage results, no documents, and a 24,000-character optional-context budget. Nodes can choose zero to 29 previous messages, all/selected/no upstream stages, and a 1,000–120,000-character budget. The budget counts chunk content, excluding prompt framing, the current query, selected Start values, system instructions, and example messages; it is not a token or monetary budget. Whole upstream results and documents take priority, followed by newest history. Oversized chunks are omitted rather than cut in half. Retained history keeps its chronological order.

Output chunks identify the producing node, logical source stage, and revision. A backup produces a result for the original stage, so selected stage bindings still work after failover. Joins and repeats use the latest revision for each logical stage. A chunk can only use an output already available on the reached path; bindings do not execute an unreached source. [server/upstream-context.ts](../server/upstream-context.ts) serializes retained outputs, including structured Jev decisions, without another truncation layer. [server/model-prompt.ts](../server/model-prompt.ts) adds retained document representations as data to the current user message.

## Relevance and observation

Optional Jev relevance filtering makes an additional batched evaluation of selected chunks.

[server/api.ts](../server/api.ts) sends the current query, node task, and bounded candidate chunks to one TypeSafe call with one Noul question per chunk. The node supplies relevance instructions and a minimum omission probability, defaulting to 90%. Only confidently irrelevant chunks are omitted. Uncertain, missing, malformed, or failed results retain the selected context and record the reason. Cancellation stops execution. Relevance screening is not an authorization policy, and its selected chunk bodies are sent to Jev even when the downstream model ultimately omits them.

Every generation or decision attempt records a context trace linked to its call ID. It reports source IDs, representations, character counts, inclusion reasons, and any relevance probabilities. Included excerpts are limited to 600 characters per chunk and 4,000 characters per attempt; omitted bodies are not copied into the trace. The node inspector exposes these traces and clearly marks shortened excerpts. Traces remain in memory, while context settings and documents persist with the graph.
