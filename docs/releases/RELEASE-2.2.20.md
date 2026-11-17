# ApplyFlow Desktop 2.2.20 — Claude.ai title chats and a clickable sign-in window

## What changed

**1. Claude.ai Chat**
- Job titles use their own conversation, separate from company research and CV generation. The footer says which step is running.
- If a page never opens in time, that background tab is closed and the next try opens a fresh one. Opening the tab is attempted twice.
- A Cloudflare check is reported as a security check, not a time limit.
- A reply is accepted only when the JSON parses. Streaming JSON is read once it is stable or Claude has stopped. An incomplete resume says so, instead of looking like a finished draft.

**2. Sign-in window**
- The Claude.ai page is embedded after the header is ready and kept above ApplyFlow’s own window, so clicks reach Claude.ai.

**3. Version**
- Application version **2.2.20** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.2.20.exe` (or `ApplyFlow-2.2.20-portable.exe`).
