# Routing

One workflow graph runs for each chat turn. The server calls models, evaluates Jev questions, joins parallel results, repeats a bounded branch, and returns the final Model result. See [[canvas]] and [[chat]].

## Execution contract

The workflow schema describes connected forward stages and bounded Jev feedback edges.

[src/lib/routing.ts](../src/lib/routing.ts) validates the single workflow route shape. The graph has an implicit chat input, an optional Prompt node for system instructions, Jev nodes, and Model nodes. Forward edges form an acyclic graph; a Jev output may have one explicit repeat edge to an upstream Model. A Model can have several Continue edges for parallel work and one explicit backup Model. Every connected Jev output has one target.

[server/workflow.ts](../server/workflow.ts) evaluates only reached nodes. It runs up to four independent nodes concurrently, waits for reachable upstream work to finish before running a join, and carries the newest output of each upstream node forward. This wait also covers a branch that repeats before joining. Model results can feed later Jev evaluations or Model prompts. Intermediate model text is buffered; a terminal Model streams directly to chat. Multiple unjoined final results are an error.

A Jev repeat edge reruns its upstream Model and following stages. The Jev node's repeat limit is configurable from one to five, with three as the default. At the limit, execution takes its non-repeat output. A turn also has a 20-pass, 100-node-operation, and two-minute budget.

## Jev and provider calls

Jev evaluates decisions; OpenAI and Gemini generate prose through direct providers.

[server/api.ts](../server/api.ts) calls Jev through the TypeSafe AI SDK provider and experimental_evaluate, and calls OpenAI or Gemini through their direct AI SDK packages. Jev supports Choice, Noul, and Score evaluations; the installed Jev provider does not generate prose. [src/lib/jev-question.ts](../src/lib/jev-question.ts) owns question validation, answer resolution, and stable output IDs. Choice has editable named answers, Noul has Yes and No, and Score has one output per configured level.

Each reached Jev node sees recent conversation messages, optional System instructions, validated API metadata, and upstream results. When Jev fails, returns an invalid answer, or misses the 70% confidence threshold, that node takes its first non-repeat output; request cancellation stops the turn instead. The threshold is a policy setting, not an accuracy claim. Every reached Model receives conversation history, optional System instructions, its own optional prompt, and upstream results as data. Model output is capped at 1,400 tokens.

## Provider failures

Model failover is one explicit backup attempt.

[server/model-failover.ts](../server/model-failover.ts) tries a connected backup Model once when the primary fails before producing text. It never retries after a partial stream or after request cancellation. This is an intentional runtime failure policy, not a compatibility path.

## Stream and observation

The API streams progress, text, timings, and the final route to chat and canvas.

The API streams newline-delimited JSON parsed by [src/lib/route-stream.ts](../src/lib/route-stream.ts). Events report progress, route selection, per-node timing, text deltas, completion, and error. Progress includes reached nodes, traversed edges, Jev decisions, and bounded output previews. The optional Prompt node reports zero milliseconds because it makes no provider call; unreached nodes have no timing. Request cancellation and a two-minute server deadline abort provider work.
