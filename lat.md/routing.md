# Routing

The server asks Jev to choose a `fast` or `deep` branch, resolves its connected model, and streams the response. The browser sends graph configuration but never calls providers. See [[canvas]] and [[chat]].

## Decision and model call

[server/api.ts](../server/api.ts) uses the TypeSafe AI SDK provider for Jev and direct Google or OpenAI providers for the response. [src/lib/routing.ts](../src/lib/routing.ts) validates the request and selects a branch.

Jev uses `experimental_evaluate`; the model response uses `streamText`. Low confidence or Jev failure chooses `deep`. The 70% threshold is a policy setting, not an accuracy claim.

## Failures and wire format

If the selected model fails before output, the server tries the other connected branch once. The API streams newline-delimited JSON events parsed by [src/lib/route-stream.ts](../src/lib/route-stream.ts).

Events cover route, text delta, completion, and error. Failover is an intentional runtime behavior, not preservation of an old API or graph format.
