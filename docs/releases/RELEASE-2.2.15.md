# ApplyFlow Desktop 2.2.15 — Reused Claude.ai chat replies

When ApplyFlow retries company research or CV generation in the **same** Claude.ai chat, the old JSON can still be on screen. Claude sometimes sends the **same** JSON again for the follow-up prompt.

## What changed

**1. Page snapshot (`fresh`)**
- Assistant text and code blocks are read only **after** the latest user message in the thread.
- `fresh` is true once that turn has an assistant reply, even if the JSON matches the previous answer.

**2. Reply waiter**
- Reused chats accept matching JSON when `fresh` is set, instead of treating it as stale and timing out.

**3. Version**
- Application version **2.2.15** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.2.15.exe` (or `ApplyFlow-2.2.15-portable.exe`).
