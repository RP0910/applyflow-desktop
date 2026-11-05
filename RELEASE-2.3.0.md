# ApplyFlow Desktop 2.3.0 — Claude.ai finishes writing before the next chat

## What changed

**1. Claude.ai Chat**
- A short JSON reply (job titles) can be complete while Claude.ai is still writing. ApplyFlow waits up to 45 seconds for writing to stop, then presses Stop, so leaving that chat does not trip Claude.ai’s “leave site?” prompt and the next step can open.
- The same wait runs after a failed reply, except when you cancel or a security check is showing.
- Research, job titles, and CV generation each keep their own chat per job; a retry continues in that chat.

**2. Version**
- Application version **2.3.0** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.0.exe` (or `ApplyFlow-2.3.0-portable.exe`).
