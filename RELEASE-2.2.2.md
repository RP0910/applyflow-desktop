# ApplyFlow Desktop 2.2.2 — Screening reuse, Jobvite upload, loading overlay, split Claude research

This release fixes the Jobvite resume **SELECT** upload from your screenshots, reuses saved screening answers more reliably, adds a loading overlay while application pages open, and splits company research from resume generation into two Claude API requests.

## What changed

**1. Screening questions saved and reused**
- Answers you approve (panel “Remember answers” or Profile → Saved answers) stay in the local SQLite profile database.
- Matching is stronger: similar wording, Jaccard similarity, and a single saved answer per category (Gender, Race, Veteran, etc.) can auto-fill when options match.
- Auto-filled answers still appear in the review so you can edit them before submit.

**2. Loading overlay when opening application pages**
- The built-in browser shows a blurred dark overlay with a spinner while a job/application page is loading.
- It clears automatically when the page finishes loading.

**3. Resume upload (Jobvite and similar DOM)**
- New **Jobvite** adapter (`jobs.jobvite.com`).
- Document sections found by “Add Resume” / SELECT even when the file input is hidden.
- Upload retries and SELECT / Choose File triggers before giving up.
- Greenhouse, Lever, Ashby and generic ATS locators also treat label-only upload cards as attachable.

**4. Two separate Claude requests**
- **Pass 1 — company research only:** employment periods + tech keywords → short JSON. No resume writing.
- **Pass 2 — CV Generate:** existing `cv-generate.txt` engine with research JSON inserted as context only.
- Placeholder employer names (e.g. `Company 1`, `Acme`) may be replaced from research; real Profile employers are never overwritten.
- Research is never treated as proof you worked at those companies.

**5. Token usage**
- Research prompt is compact (periods + tech list).
- Job description capped at 12k characters for CV generation.
- Refine loop limited to one extra pass with a smaller revision payload.
- CV `max_tokens` floor trimmed slightly.

**6. Version**
- Application version **2.2.2** (`package.json` + `src/version.ts`).

## Installation

Close ApplyFlow, then run `ApplyFlow-Setup-2.2.2.exe` (or use `ApplyFlow-2.2.2-portable.exe`). Your database, settings, API key, saved answers, saved documents and Jobright/Dice sign-in are kept.

## Trying it

1. Save Gender / Race / Veteran (or other) answers once under Profile or with Remember answers.
2. Open a Jobvite application and press Tailor & Apply — watch the loading overlay, then Replace resume should drive SELECT.
3. Confirm Settings → Claude engine + API key; Tailor & Apply should log both `company_research` and `cv_generate` usage.
