# ApplyFlow Desktop 2.2.16 — Conversation API reply read

When Claude.ai shows a complete answer on screen but ApplyFlow could not parse JSON from the rendered page (disclaimers, layout changes, or reused-chat confusion), Tailor & Apply could time out even though research or CV JSON was already there.

## What changed

**1. `readReply` (in-page, same session)**
- Loads the open chat via Claude.ai’s `chat_conversations` API.
- Returns the leaf assistant message as plain text (no curly-quote rendering) and the human prompt it answers.

**2. Reply waiter**
- Every few polls, prefers conversation JSON when it matches the prompt ApplyFlow just sent (including reused chats).
- If Claude finishes with prose instead of JSON, fails with a short excerpt instead of a long timeout.
- Logs a `reply-unread` diagnostic when both paths miss JSON.

**3. Version**
- Application version **2.2.16** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.2.16.exe` (or `ApplyFlow-2.2.16-portable.exe`).
