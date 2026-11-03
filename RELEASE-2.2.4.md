# ApplyFlow Desktop 2.2.4 — Smarter Screening Q&A, Jobright applied confirm, opening veil

This release improves how saved screening answers match live ATS questions, marks Jobright jobs applied only after a verified employer confirmation, and shows a clear loading veil while documents are prepared and the application opens.

## What changed

**1. Screening Q&A catalog & matching**
- Built-in catalog of common ATS screening questions (eligibility, logistics, compensation, EEO, and more).
- Answers store control type, option labels, aliases, and optional catalog ids.
- Conventional (non-AI) matching with synonym groups so reworded questions reuse the right saved answer.
- Screening Q&A UI redesigned around the catalog and richer answer metadata.

**2. Jobright “Did you apply?”**
- While opening an employer application, ApplyFlow dismisses an early “Did you apply?” prompt with No so the flow can continue.
- After a verified employer confirmation (or an explicit “Record it as applied”), ApplyFlow returns to the Jobright job and presses “Yes, I applied!”.
- Applications are no longer recorded as Applied from a submit click alone when the site has not confirmed.

**3. Browser opening veil**
- While preparing documents or opening the employer application, the built-in browser shows an ApplyFlow loading veil (and hides the native page underneath so the overlay is visible).

**4. Version**
- Application version **2.2.4** (`package.json` + `src/version.ts`).

## Installation

Close ApplyFlow, then run `ApplyFlow-Setup-2.2.4.exe` (or use `ApplyFlow-2.2.4-portable.exe`). Your database, settings, API key, saved answers, saved documents and Jobright/Dice sign-in are kept.

## Trying it

1. Open **Screening Q&A**, pick a catalog question (e.g. work authorization), save your answer, then apply on a Greenhouse/Lever/Ashby/Workday form with a similar wording — the field should autofill.
2. Apply from Jobright through to employer confirmation: Jobright should then show the job marked applied (“Yes, I applied!”).
3. Start Tailor & Apply and watch the browser veil during document prep and “Opening your application…”.
