# ApplyFlow Desktop 2.2.11 — Claude.ai research → resume handoff

Fixes Tailor & Apply stopping after company research when Claude.ai had already returned JSON.

## What changed

**1. Reading Claude.ai replies**
- ApplyFlow extracts complete research or resume JSON even when Claude adds trailing UI text.
- A finished reply is accepted while the Stop control is still visible, so research no longer false-times out.
- Chat rename no longer blocks starting the resume pass.

**2. Two-step workflow**
- **Research** — job-only prompt in a `Research — Company — Role` chat.
- **Save** — companies stored in SQLite for the job.
- **Resume** — CV Generate prompt with researched employer names in `CANDIDATE.jobs` plus the job description, in a separate chat.

**3. Errors**
- Research failure no longer blames resume generation. If research is saved but CV generation fails, the message says so.

**4. Version**
- Application version **2.2.11** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.2.11.exe` (or `ApplyFlow-2.2.11-portable.exe`). Your database, settings, and saved research are kept.

## Trying it

1. Settings → **Claude.ai Chat**, sign in from the sidebar.
2. Tailor & Apply on a job — watch **Researching companies**, then **Generating resume** without a timeout after research finishes in Claude.
