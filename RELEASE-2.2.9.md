# ApplyFlow Desktop 2.2.9 — Claude.ai Chat in Chrome

Claude.ai Chat now uses Google Chrome, so Claude.ai’s security check can finish. ApplyFlow does not click or solve that check.

## What changed

**1. Claude.ai Chat**
- Sign-in and resume writing use Google Chrome with its own profile, separate from everyday Chrome and from the Jobright and Dice browser.
- Sign-in opens as a normal Chrome window. Resume writing stays in a background Chrome window, off the taskbar.
- If Chrome is not installed or does not start, Claude.ai Chat uses ApplyFlow’s previous built-in browser for that session.

**2. Version**
- Application version **2.2.9** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow (tray icon → Quit ApplyFlow), then run `ApplyFlow-Setup-2.2.9.exe` (or use `ApplyFlow-2.2.9-portable.exe`). Your database, settings, API key, saved answers, and saved documents are kept. Sign in to Claude.ai again in the window ApplyFlow opens; that sign-in is separate from your everyday Chrome and from Jobright and Dice.
