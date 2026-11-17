# ApplyFlow Desktop 2.2.1 — Jobright fixes

This release fixes the Jobright problems from your screenshots. The run stopped at step 2, **Open the application**, and kept retrying.

## What was wrong, and what changed

**1. "Customize Your Resume in 10 seconds"**
- **Before:** after pressing **APPLY WITH AUTOFILL**, Jobright shows this dialog. ApplyFlow didn't recognise it. It kept pressing Apply behind the dialog.
- **Now:** ApplyFlow presses **Apply Without Customizing**. Your resume is already tailored by ApplyFlow, so Jobright's version isn't needed.
- It never presses **Fix My Resume Now**.
- It never ticks **Do not remind me again**.

**2. The employer's site opens in a new tab**
- **Before:** Jobright opens the employer's application in a new tab. It opens a blank tab first and sends it to the employer a moment later. The built-in browser blocked that blank tab, so nothing opened.
- **Now:** ApplyFlow lets the blank tab open, out of sight. As soon as Jobright sends it to the employer's address, that address opens in the built-in browser, and the hidden tab is closed. ApplyFlow then carries on with the employer's form.
- Sign-in windows (Google and others) still open as their own small window.

**3. Retrying forever**
- **Before:** if pressing Apply led nowhere, ApplyFlow pressed it up to five times.
- **Now:** it stops after the second try and tells you what to do: press Apply on the Jobright page, choose "Apply Without Customizing", then press **Continue** in the panel once the employer's page is open.

**4. "Untitled job" and wrong titles**
- Jobright's titles read like "Experienced Data Science AI Engineer Job Details | Gainwell Technologies LLC". ApplyFlow now takes the clean title ("Experienced Data Science AI Engineer") and the company name ("Gainwell Technologies").
- Inside Jobright's signed-in app, opening a job from a list doesn't load a new page. The page can still carry the data of the first page you opened. ApplyFlow now uses that data only when it belongs to the job on screen.
- Otherwise it reads the job's own page in the background and takes the details from there. This is what caused "Untitled job".

**5. Signed out of Jobright**
- Jobright's **Sign Up to Apply** dialog is now recognised: "Sign up with Google", an Email box, "Already a member? Sign in now".
- ApplyFlow stops with **Sign in to Jobright** instead of retrying. Sign in on the page, then press **Continue**.

## Installation

Close ApplyFlow, then run `ApplyFlow-Setup-2.2.1.exe` (or use `ApplyFlow-2.2.1-portable.exe`). It installs over your current version. Your database, settings, API key, saved answers, saved documents and Jobright sign-in are kept.

## Validation

- TypeScript: passed. Tests: 297 passed, 5 skipped, 0 failed.
- The test copy of Jobright's job page now behaves like the live site:
  - the real title format;
  - **APPLY WITH AUTOFILL**;
  - the Customize dialog, with "Apply Without Customizing" as plain text, not a button;
  - the blank-tab-then-address new tab;
  - no employer address in the page data;
  - the Sign Up to Apply dialog.
- New tests check each of the fixes above:
  - the dialog choice;
  - "Fix My Resume Now" and the checkbox left alone;
  - the new tab;
  - the sign-up dialog;
  - stopping after two tries;
  - title cleaning;
  - another job's page data being ignored.
- End-to-end in the built app (`scripts/e2e-jobright.mjs`): all checks passed. Four applications went Jobright → Customize dialog → hidden new tab → employer form (Lever, Greenhouse in a careers-page frame, Ashby, redesigned Greenhouse) → Submit → confirmation → Back to search results. That run used the real Electron new-tab handling. It also stopped correctly at a Workday sign-in and at a closed job.
- The Dice resume-replacement and back-to-search checks still pass.
- **Not done:** a signed-in run on jobright.ai itself, and a real application. See below.

## Trying it on your account

Use your own Jobright sign-in in ApplyFlow's built-in browser (press **Jobright** in the toolbar and sign in there once). Your password stays with you and Jobright.

1. Open a job whose Apply goes to Greenhouse, Lever or Ashby.
2. Press **Tailor & Apply**.
3. Check the employer's form and the panel's summary.
4. Press **Submit application** yourself.

If something stops, press **Copy page details** in the panel and send me the text. It contains no personal data.
