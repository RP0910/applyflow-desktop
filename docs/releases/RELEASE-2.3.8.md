# ApplyFlow Desktop 2.3.8 — ApplyMind fills exact verified answers

## What changed

**1. Exact verified answers**
- During fill, ApplyMind looks up the question by its normalized text. A verified answer is filled when the context fits and the value maps onto one form control. This does not depend on the Tier A lock or a trained model.
- Screening Q&A remains the place answers are edited. Saving there stores the answer in ApplyMind once.

**2. Filled answers stay unverified**
- An answer the filler wrote is no longer saved as something you typed. A fill you leave unchanged is recorded as accepted. Only an answer you type, approve, or correct becomes verified.

**3. Loose matches**
- A loose word overlap, or the only saved answer in a category, is filled and marked for review.
- Work authorization, sponsorship, legal declarations, identity, date of birth, and certifications are not filled from a loose match. ApplyFlow asks you instead.

**4. Knowledge updates**
- A failed knowledge update is shown in the app. The cold-start gate does not pass when no held-out pair was ranked.

**5. Version**
- Application version **2.3.8** (`package.json` + `src/version.ts`).

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.8.exe` (or `ApplyFlow-2.3.8-portable.exe`).
