# Chat

Chat keeps the conversation in memory and follows the current graph for each turn. See [[routing]] for server events and [[canvas]] for graph behavior.

The chosen model receives recent history and the Input node's reusable instructions. The chat composer contains only the current message and does not edit the node prompt.

A direct path keeps the selected model; a Jev path evaluates each turn independently.

The composer starts compact, grows as text is entered, and scrolls internally after reaching its maximum height. It remains editable while a response streams.

[src/chat/use-route-chat.ts](../src/chat/use-route-chat.ts) owns messages, request state, and streamed assistant updates. [src/chat/chat-panel.tsx](../src/chat/chat-panel.tsx) renders the floating chat and composer above the canvas. [src/chat/chat-message-item.tsx](../src/chat/chat-message-item.tsx) renders user and assistant messages. [src/lib/route-stream.ts](../src/lib/route-stream.ts) decodes server events before chat applies them.

The chat opens from a persistent bottom-right canvas button, starts closed without a saved preference, and never resizes the canvas. Its open state persists in browser local storage and restores on refresh. Closing retains the current in-memory conversation. Clearing chat removes it; a page reload starts a new conversation.
