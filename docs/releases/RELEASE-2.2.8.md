# ApplyFlow Desktop 2.2.8 — embedded Chrome

The built-in browser is Google Chrome, shown inside the ApplyFlow window. Chrome’s own identity is what lets a site’s security check finish. ApplyFlow does not click or solve that check.

## What changed

**1. Built-in browser**
- Jobright, Dice, and web tabs open in embedded Google Chrome.
- Sign-in is kept in ApplyFlow’s Chrome profile, separate from the Chrome you use day to day.
- If Chrome is not installed, ApplyFlow says so and uses its previous built-in browser for that session.

**2. Installers**
- A new Windows build removes older ApplyFlow installers from the `release` folder.
- Application version **2.2.8** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow (tray icon → Quit ApplyFlow), then run `ApplyFlow-Setup-2.2.8.exe` (or use `ApplyFlow-2.2.8-portable.exe`). Your database, settings, API key, saved answers, and saved documents are kept. Sign in to Jobright and Dice again in the embedded browser; that sign-in is separate from your everyday Chrome.
