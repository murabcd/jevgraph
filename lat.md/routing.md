# Routing

The server follows a direct model path or traverses connected Jev nodes before streaming a response. Each Jev node uses its configured Choice, Noul, or Score question. See [[canvas]] and [[chat]].

## Decision and model call

[server/api.ts](../server/api.ts) uses the TypeSafe AI SDK provider for Jev and direct Google or OpenAI providers for the response. [src/lib/routing.ts](../src/lib/routing.ts) validates the request and graph contract. [server/workflow.ts](../server/workflow.ts) traverses connected Jev nodes and selects a model.

The graph determines each next step through its connections. The browser sends the graph configuration but never calls providers.

The direct path calls only its connected model. Jev paths use `experimental_evaluate`; both paths use `streamText` for the response. The optional System node prompt is a separate request field, sent as an empty string when the node is absent or unset: Jev sees it with recent conversation context, and the selected model receives it as reusable instructions for each turn. The workflow contract uses an implicit chat entry when the canvas has no System node. [src/lib/jev-question.ts](../src/lib/jev-question.ts) defines the Choice, Noul, and Score question contracts, defaults, validation, and output labels. Choice criteria are editable named answers, initially Fast and Deep. Noul maps Jev's yes probability to Yes or No. Score has one output per rubric level, with the same Level 0, Level 1, and later labels shown in the editor and node. Jev's expected score selects the nearest level, with half scores rounded upward. In a connected multi-Jev workflow, each Jev runs only if its node is reached; low confidence or Jev failure takes that node's first configured output. A single-Jev path instead uses the configured default provider on low confidence or Jev failure. The 70% confidence threshold is a policy setting, not an accuracy claim.

[server/workflow.ts](../server/workflow.ts) passes optional System instructions, recent conversation messages, and any validated metadata supplied by an API client to each reached Jev node. Its decisions use the questions saved in the graph. The chat UI sends no special test metadata; future clients can supply named values without adding case-specific fields to the server.

## Failures and wire format

Single-Jev routes can retry through another connected output; workflow Model nodes can use an explicit backup. Both retry only before output begins.

The single-Jev path depends on graph shape, not the Router node's ID.

[server/model-failover.ts](../server/model-failover.ts) tries that backup once when the primary fails before any text; it never retries after a partial stream. A direct path without a connected backup returns the model error.

The API streams newline-delimited JSON events parsed by [src/lib/route-stream.ts](../src/lib/route-stream.ts).

Events cover route, per-node timing, text delta, completion, and error. A timing event records elapsed server time for each reached Jev evaluation and each model attempt, including failures and fallback attempts. Model time includes streaming through completion. The optional System node is static configuration and reports 0 ms because it makes no provider call. Unreached nodes have no timing event. Workflow route events include the traversed node path and each Jev decision so [[canvas]] and [[chat]] can show the selected route. Failover is an intentional runtime behavior, not preservation of an old API or graph format.
