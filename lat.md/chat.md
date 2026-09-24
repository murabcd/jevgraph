# Chat

Chat keeps the conversation in memory and follows the current graph for each turn. The chosen model receives recent history. See [[routing]] for server events and [[canvas]] for graph behavior.

A direct path keeps the selected model; a Jev path evaluates each turn independently.

The composer remains editable while a response streams.

[src/chat/use-route-chat.ts](../src/chat/use-route-chat.ts) owns messages, request state, and streamed assistant updates. [src/chat/chat-panel.tsx](../src/chat/chat-panel.tsx) renders the collapsible panel and composer. [src/chat/chat-message-item.tsx](../src/chat/chat-message-item.tsx) renders user and assistant messages. [src/lib/route-stream.ts](../src/lib/route-stream.ts) decodes server events before chat applies them.

The panel's expanded or collapsed state persists in browser local storage and restores on refresh. Collapsing retains the current in-memory conversation. Clearing chat removes it; a page reload starts a new conversation.
