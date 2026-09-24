# Chat

Chat keeps the conversation in memory and routes each new turn independently. The chosen model receives recent history for follow-ups. See [[routing]] for server events and [[canvas]] for the graph sent with a turn.

The composer remains editable while a response streams.

[src/chat/use-route-chat.ts](../src/chat/use-route-chat.ts) owns messages, request state, and streamed assistant updates. [src/chat/chat-panel.tsx](../src/chat/chat-panel.tsx) renders the collapsible panel and composer. [src/chat/chat-message-item.tsx](../src/chat/chat-message-item.tsx) renders user and assistant messages. [src/lib/route-stream.ts](../src/lib/route-stream.ts) decodes server events before chat applies them.

Collapsing the panel retains the current in-memory conversation. Clearing chat removes it; a page reload also starts a new conversation.
