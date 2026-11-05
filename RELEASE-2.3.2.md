# ApplyFlow Desktop 2.3.2 — Typing works in the Claude.ai sign-in window

## What changed

**1. Claude.ai sign-in**
- Windows does not move keyboard focus into an embedded page from another process when you click it, so keys were going to the header.
- While the sign-in window is in front, ApplyFlow gives focus to the Claude.ai page. Clicking the window or bringing it forward does the same.

**2. Version**
- Application version **2.3.2** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.2.exe` (or `ApplyFlow-2.3.2-portable.exe`).
