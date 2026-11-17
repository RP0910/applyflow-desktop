# ApplyFlow Desktop 2.2.18 — Claude.ai continues when the page is already open

## What changed

**1. Claude.ai page load**
- Claude.ai’s load event can arrive minutes late while the page is already usable. ApplyFlow continues when the tab is on the target page and waits for the message box.
- If a new chat never actually opens, the resume prompt is not sent into the previous research conversation.
- Opening a new chat or a saved chat uses a shorter time limit (25s / 30s).

**2. Retry vs security check**
- A Claude.ai error (the page didn’t load or answer) is retried. Only a security check still needs you.

**3. Version**
- Application version **2.2.18** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.2.18.exe` (or `ApplyFlow-2.2.18-portable.exe`).
