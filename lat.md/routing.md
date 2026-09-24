# Routing

The server follows a direct model path or asks Jev to choose a connected model, then streams the response. The browser sends graph configuration but never calls providers. See [[canvas]] and [[chat]].

## Decision and model call

[server/api.ts](../server/api.ts) uses the TypeSafe AI SDK provider for Jev and direct Google or OpenAI providers for the response. [src/lib/routing.ts](../src/lib/routing.ts) validates the request and selects a branch.

The direct path calls only its connected model. Jev paths use `experimental_evaluate`; both paths use `streamText` for the response. [src/lib/jev-question.ts](../src/lib/jev-question.ts) defines the Choice, Noul, and Score question contracts, defaults, validation, and output labels. Choice criteria are editable named answers, initially Fast and Deep. Noul maps Jev's yes probability to Yes or No. Score compares Jev's expected score with the editable threshold to choose Low or High. Low confidence or Jev failure chooses the first output connected to the configured default provider. The 70% confidence threshold is a policy setting, not an accuracy claim.

## Failures and wire format

If a Jev-selected model fails before output, the server tries one other connected model once. Direct paths have one selected model and return its error without a fallback.

The API streams newline-delimited JSON events parsed by [src/lib/route-stream.ts](../src/lib/route-stream.ts).

Events cover route, text delta, completion, and error. Failover is an intentional runtime behavior, not preservation of an old API or graph format.
