# ApplyFlow Desktop 2.2.13 — Curly-quote JSON from Claude.ai

Claude.ai sometimes returns JSON with typographic (“curly”) quotes, which standard parsers reject. ApplyFlow now handles that so company research and CV generation can continue.

## What changed

**1. JSON parsing**
- `straightenJsonQuotes` converts curly quotes next to JSON syntax to straight `"` before parsing.
- Chat prompts remind Claude to use plain ASCII double quotes in JSON.

**2. UI**
- Long Continue / primary button labels truncate with an ellipsis (footer status unchanged from 2.2.12).

**3. Version**
- Application version **2.2.13** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.2.13.exe` (or `ApplyFlow-2.2.13-portable.exe`).
