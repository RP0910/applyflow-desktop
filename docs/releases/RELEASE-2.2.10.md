# ApplyFlow Desktop 2.2.10 — Saved company research

Company research is saved with each job and used to label employers on the draft resume. Claude.ai sign-in now opens inside an ApplyFlow window.

## What changed

**1. Company research**
- Research reads the job title, organization, description, responsibilities, and technology keywords, then returns four real companies that fit the role.
- The result is stored with that job and reused. Deleting the job session deletes the saved research.
- Employer labels on the draft resume come from that saved research. The resume-writing step still copies those names as given; it does not run a second research pass.

**2. Claude.ai Chat**
- Sign-in opens in an ApplyFlow window with Chrome embedded in it. Finish signing in and any security check yourself; ApplyFlow does not complete them.
- The sidebar indicator shows **Writing…** while a resume is being written, then returns to **Connected**.
- A write does not start until Claude.ai is connected. A finished reply is read only after the JSON is complete.

**3. Version**
- Application version **2.2.10** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow (tray icon → Quit ApplyFlow), then run `ApplyFlow-Setup-2.2.10.exe` (or use `ApplyFlow-2.2.10-portable.exe`). Your database, settings, API key, saved answers, and saved documents are kept. Sign in to Claude.ai again if the sidebar indicator says Sign in.
