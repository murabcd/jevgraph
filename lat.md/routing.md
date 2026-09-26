# Routing

One workflow graph runs for each chat turn. The server calls models, evaluates Jev questions, joins parallel results, repeats a bounded branch, and returns one final answer from a Model or Jev. See [[canvas]] and [[chat]].

## Execution contract

The workflow schema describes connected forward stages and bounded Jev feedback edges.

[src/lib/routing.ts](../src/lib/routing.ts) validates the single workflow route shape and Start input schema. The graph has one explicit Start, followed by Jev and Model nodes. Start holds typed fields; request metadata must match declared field names and types, while defaults fill omitted values. Each Jev or Model selects which fields it receives. Forward edges form an acyclic graph; a Jev output may have one explicit repeat edge to an upstream Model. A Model can have several Continue edges for parallel work and one explicit backup Model. A Jev output has at most one target; an unconnected output ends the path with its selected label.

[server/workflow.ts](../server/workflow.ts) evaluates only reached nodes. It runs up to four independent nodes concurrently, waits for reachable upstream work to finish before running a join, and carries the newest output of each upstream node forward. This wait also covers a branch that repeats before joining. Model results can feed later Jev evaluations or Model prompts. Intermediate model text is buffered; a terminal Model streams directly to chat. When Jev selects an unconnected output above the configured threshold, its label goes to chat without a Model call. A configured fallback output can also return its label directly. Multiple unjoined final results are an error.

A Jev repeat edge reruns its upstream Model and following stages. The Jev node's repeat limit is configurable from one to five, with three as the default. At the limit, execution takes its non-repeat output. A turn also has a 20-pass, 100-node-operation, and two-minute budget.

## Jev and provider calls

Jev evaluates decisions; OpenAI and Gemini generate prose through direct providers.

[server/api.ts](../server/api.ts) calls Jev through the TypeSafe AI SDK provider and experimental_evaluate, and calls OpenAI or Gemini through their direct AI SDK packages. Jev supports Choice, Noul, and Score evaluations; the installed Jev provider does not generate prose. [src/lib/jev-question.ts](../src/lib/jev-question.ts) owns question validation, answer resolution, and stable output IDs. Choice has editable named answers, Noul has Yes and No, and Score has one output per configured level. Blank question drafts can be saved locally but are rejected by the workflow schema until instructions and all answer criteria are filled in; the server never evaluates a placeholder question.

Each reached Jev node sees recent conversation messages, only its selected Start variables, and upstream results. For Choice and Score, its editor sets minimum provider confidence; for Noul, it sets the minimum probability of the chosen Yes or No answer, calculated as max(P(Yes), P(No)). Both use 70% by default. The editor also selects the output to take when the value is below the threshold or the provider fails. Without an explicit fallback output, an unreliable or failed evaluation reports an error. Request cancellation stops the turn. These thresholds are application policy, not accuracy claims. Every reached Model receives conversation history, its own optional System instructions, ordered User and Assistant example messages, selected Start variables, and upstream results. [server/model-prompt.ts](../server/model-prompt.ts) sends System instructions through the AI SDK `instructions` option, places example messages before conversation history, and includes Start values and upstream results as data with the latest live User message. [server/upstream-context.ts](../server/upstream-context.ts) formats prior node outputs for both Model and Jev calls. The editor sets maximum output tokens (1,400 by default) and model-specific thinking controls. [src/lib/models.ts](../src/lib/models.ts) owns the available settings: GPT-5 starts at Medium effort, Gemini 3.5 Flash Lite at Minimal, and Gemini 3.1 Pro and 3 Flash at High. The server passes those efforts through the AI SDK `reasoning` option. Gemini 2.5 instead uses a numeric thinking budget through `providerOptions.google.thinkingConfig`; Pro and Flash default to dynamic (-1), while Flash Lite defaults to off (0). A positive budget must be within the model's range and below the configured maximum output tokens, which include thinking tokens. The server does not add an implicit assistant prompt.

## Provider failures

Model failover is one explicit backup attempt.

[server/model-failover.ts](../server/model-failover.ts) tries a connected backup Model once when the primary fails before producing text. The backup connection alone enables this behavior. It never retries after a partial stream or after request cancellation. This is an intentional runtime failure policy, not a compatibility path.

## Stream and observation

The API streams progress, text, timings, and the final route to chat and canvas.

The API streams newline-delimited JSON parsed by [src/lib/route-stream.ts](../src/lib/route-stream.ts). Events report progress, route selection, per-node timing, text deltas, completion, and error. Progress includes reached nodes, traversed edges, Jev decisions, and bounded output previews. Start reports zero milliseconds because it makes no provider call; unreached nodes have no timing. Request cancellation and a two-minute server deadline abort provider work.
