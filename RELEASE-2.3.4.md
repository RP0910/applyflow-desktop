# ApplyFlow Desktop 2.3.4 — Mark a Jobright job as applied

## What changed

**1. Jobright**
- After you apply, ApplyFlow still presses “Yes, I applied!” when that dialog is on the page.
- When the dialog is not showing, it records the application with Jobright’s own apply call, using the signed-in Jobright page. An “already applied” reply counts as done. If you are signed out, ApplyFlow says so.
- If that step does not finish, the submitted screen has **Mark as applied on Jobright**.

**2. Version**
- Application version **2.3.4** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.4.exe` (or `ApplyFlow-2.3.4-portable.exe`).
