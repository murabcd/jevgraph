# Chat

Chat keeps the conversation in memory and follows the current graph for each turn. See [[routing]] for server events and [[canvas]] for graph behavior.

The chat composer supplies the message on every turn. The chosen model receives recent history and, when a System node exists, its reusable instructions. Removing System leaves chat available through a connected Jev or Model entry. The composer does not edit the node prompt.

A direct path keeps the selected model; a Jev path evaluates each reached Jev node for every turn. A model-only workflow with a backup displays as a direct conversation in chat. The chat composer sends the conversation without example-specific test fields.

The composer starts compact, grows as text is entered, and scrolls internally after reaching its maximum height. It remains editable while a response streams.

[src/chat/use-route-chat.ts](../src/chat/use-route-chat.ts) owns messages, request state, and streamed assistant updates. [src/chat/chat-panel.tsx](../src/chat/chat-panel.tsx) renders the floating chat and composer above the canvas. [src/chat/chat-message-item.tsx](../src/chat/chat-message-item.tsx) renders user and assistant messages. [src/lib/route-stream.ts](../src/lib/route-stream.ts) decodes server events before chat applies them.

The chat opens from a persistent bottom-right canvas button, starts closed without a saved preference, and never resizes the canvas. Its open state persists in browser local storage and restores on refresh. Closing retains the current in-memory conversation. Clearing chat removes it; a page reload starts a new conversation.

The latest request's node timings stay in memory alongside the route result. Sending another message clears the previous timings, and editing the route hides timings from the old graph. The [[canvas]] displays each timing beside its node.
