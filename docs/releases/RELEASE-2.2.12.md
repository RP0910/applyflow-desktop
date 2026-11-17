# ApplyFlow Desktop 2.2.12 — Claude.ai research handoff and live status

Fixes false timeouts after company research when Claude.ai already returned JSON, and shows each Tailor & Apply step in the footer.

## What changed

**1. Reading Claude.ai replies**
- JSON is read from code blocks and from the assistant message that contains `"companies"` or `"company_name"`, not only the last bubble on the page.
- Reduces false “Claude took too long” errors when research finished in the worker tab.

**2. Live footer status**
- One line above Continue shows the current step (preparing job description, sending research, saving companies, updating CV prompt, generating resume, etc.).
- Long text truncates with an ellipsis. On failure, the footer keeps the last step; details stay in the warning banner.

**3. Workflow**
- Unchanged two-step flow: company research → save to database → CV Generate with updated employer names and job description.

**4. Version**
- Application version **2.2.12** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.2.12.exe` (or `ApplyFlow-2.2.12-portable.exe`).
