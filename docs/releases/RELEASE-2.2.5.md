# ApplyFlow Desktop 2.2.5 — Opening veil only when the application opens

This release keeps the ApplyFlow browser loading veil for the employer-application hop, and stops showing it during document prep so you can still read the Jobright job description.

## What changed

**1. Browser opening veil**
- The “Opening your application…” veil now appears only while Step 2 is active (navigating from Jobright to the employer career / application page).
- It no longer covers the job description while Tailor & Apply is writing the tailored resume and cover letter.

**2. Version**
- Application version **2.2.5** (`package.json` + `src/version.ts`).

## Installation

Close ApplyFlow, then run `ApplyFlow-Setup-2.2.5.exe` (or use `ApplyFlow-2.2.5-portable.exe`). Your database, settings, API key, saved answers, saved documents and Jobright/Dice sign-in are kept.

## Trying it

1. Open a Jobright job and press **Tailor & Apply**.
2. While Step 1 runs (“Tailoring your resume and cover letter…”), the Jobright description stays readable — no preparing-documents veil.
3. When ApplyFlow moves to **Open the application**, the loading veil appears for the hop to the employer site.
