# ApplyFlow Desktop 2.2.7 — Jobright on startup

The built-in browser opens Jobright recommendations when ApplyFlow starts. Claude.ai Chat is unchanged in what it sends and how resumes are checked; the session now identifies itself the way Chrome does so Claude.ai's security check can finish.

## What changed

**1. Startup page**
- ApplyFlow opens `https://jobright.ai/jobs/recommend` instead of Dice.
- The Dice button in the browser bar still opens Dice. Signing out of Dice still returns to Dice.

**2. Claude.ai Chat**
- The Claude.ai session uses Chrome's reduced user agent and the matching client-hint headers.
- Page helpers run where Claude.ai's own scripts cannot see them.
- ApplyFlow does not click or solve Cloudflare's "Just a moment…" check. If it does not clear on its own, the sidebar indicator asks you to finish it in the sign-in window.

**3. Version**
- Application version **2.2.7** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow (tray icon → Quit ApplyFlow), then run `ApplyFlow-Setup-2.2.7.exe` (or use `ApplyFlow-2.2.7-portable.exe`). Your database, settings, API key, saved answers, saved documents, and Jobright/Dice sign-in are kept.
