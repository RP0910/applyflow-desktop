# ApplyFlow Desktop 2.2.17 — Faster tailor; optional optimize

## What changed

**1. Tailor & Apply speed**
- Company research + **one** CV generation pass (no automatic second Claude call).
- After the draft is ready, use **Optimize with Claude** on the ATS report when scores are below target. ApplyFlow runs one measured revision and keeps it only if ATS and match scores improve.

**2. Claude.ai reliability**
- Time limits on background tab loads and page scripts; a frozen tab is closed and retried on a fresh tab.
- Conversation API fetches abort after 10 seconds.
- Footer shows retry progress (`Claude.ai try 1 of 3…`); failures log a `chat-failed` diagnostic with the last step.
- Notices include Claude.ai timing (research · resume · optimization).

**3. Version**
- Application version **2.2.17** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.2.17.exe` (or `ApplyFlow-2.2.17-portable.exe`).
