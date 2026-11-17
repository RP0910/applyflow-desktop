# ApplyFlow Desktop 2.3.7 — Switch Claude.ai accounts after sign-out

## What changed

**1. Claude.ai sign-out**
- Signing out leaves the hidden Claude tab on a blank page. Loading the login page there was opening account windows that ApplyFlow closed immediately, so the sign-in window flashed and another account could not sign in.
- After sign-out, the sign-in window stays open until a different account finishes signing in. If the previous account is still on the page, ApplyFlow asks you to log out of it in that window, then sign in with the other account.
- Sign-out clears the Claude.ai session cookies for that browser profile, including the Google sign-in cookies.
- Closing the sign-in window while it is still opening does not bring the window back.

**2. Version**
- Application version **2.3.7** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.7.exe` (or `ApplyFlow-2.3.7-portable.exe`).
