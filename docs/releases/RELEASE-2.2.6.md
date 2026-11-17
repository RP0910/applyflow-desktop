# ApplyFlow Desktop 2.2.6 — Claude.ai Chat resume generation

This release adds Claude.ai Chat as a second way to write resumes. The Claude API method is unchanged, and both methods still use the same JSON checks, PDF Studio renderer, and application flow.

## What changed

**1. Claude.ai Chat**
- Settings → Resume generation method: **Claude API** or **Claude.ai Chat**.
- Sign in once from the Claude.ai indicator at the bottom of the sidebar. The session is kept until it expires.
- The indicator is green when signed in, yellow while checking or connecting, and red when signed out. Click it to sign in or reconnect.
- Each job gets its own Claude.ai conversation titled with the company and the role.
- ApplyFlow does not solve CAPTCHAs or other sign-in checks.

**2. Version**
- Application version **2.2.6** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow (tray icon → Quit ApplyFlow), then run `ApplyFlow-Setup-2.2.6.exe` (or use `ApplyFlow-2.2.6-portable.exe`). Your database, settings, API key, saved answers, saved documents, and Jobright/Dice sign-in are kept.

## Trying it

1. Open **Settings** and select **Claude.ai Chat**.
2. Click the sidebar indicator and sign in to Claude.ai.
3. Press **Tailor & Apply** on a job. The resume JSON is written in Claude.ai, checked, and rendered by PDF Studio as before.
