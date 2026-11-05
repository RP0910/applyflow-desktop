# ApplyFlow Desktop 2.2.14 — Claude chat reuse & default login

## What changed

**1. Claude.ai Chat sessions**
- One **Research — {Company} — {Role}** chat per Tailor & Apply run; retries continue in that thread.
- One **{Company} — {Role}** chat for CV generation (including refine); separate from research.
- Slots expire after 30 minutes so a later run does not silently reuse an old conversation.
- Reused chats ignore the previous JSON on screen so a retry waits for a new reply.

**2. Default login (Profile)**
- Save a default email and password used on Workday and similar portals.
- ApplyFlow can sign in or create an account when the site offers registration.
- Per-site overrides remain available under Job site logins.
- Email verification screens are reported instead of treating the page as “not a login.”

**3. Version**
- Application version **2.2.14** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.2.14.exe` (or `ApplyFlow-2.2.14-portable.exe`).
