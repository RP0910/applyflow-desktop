# ApplyFlow Desktop 2.3.6 — Claude.ai uses the model from Settings

## What changed

**1. Claude.ai Chat**
- Each new Claude.ai chat starts on the model and Speed chosen in Settings. Speed is Claude.ai’s effort (Low, Medium, or High). “Model default” leaves the effort as Claude.ai set it.
- A chat already in progress keeps the model it started with. Changing the model or Speed starts a new chat for that step.
- If Claude.ai cannot switch to that model (the menu is missing, or the plan requires an upgrade), ApplyFlow does not send the prompt and tells you to choose another model.

**2. Version**
- Application version **2.3.6** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.6.exe` (or `ApplyFlow-2.3.6-portable.exe`).
