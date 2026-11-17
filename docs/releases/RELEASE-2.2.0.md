# ApplyFlow Desktop 2.2.0 — Jobright.ai

ApplyFlow now applies to jobs you find on **Jobright.ai**, with resumes and cover letters written for each job.

Jobright doesn't host applications itself. Its **Apply** button sends you to the employer's own hiring site. ApplyFlow follows it there and fills the application:

| Employer site | What ApplyFlow does |
|---|---|
| **Greenhouse** (classic, redesigned, and the form company careers pages show in a frame) | Full support: fills, attaches, asks you what it mustn't guess, and submits after you confirm |
| **Lever** | Full support |
| **Ashby** | Full support |
| Workday, iCIMS, SmartRecruiters, Workable, company sites… | Best effort: fills contact details and attaches your documents. It can move through "Next / Save and continue" steps, but **you press Submit** |
| LinkedIn, Indeed, Glassdoor, ZipRecruiter | Not filled. Your tailored documents are saved for you to attach there |

This release also includes 2.1.1 (Dice resume replacement), 2.1.2 (Education) and 2.1.3 (getting back to your search, Education moved to **Profile & answers**).

## Installation

Close ApplyFlow, then run `ApplyFlow-Setup-2.2.0.exe` (or use `ApplyFlow-2.2.0-portable.exe`). It installs over your current version; your database, settings, API key and saved documents are kept.

## How to use it

1. In the built-in browser, press **Jobright** in the toolbar (or type a jobright.ai address) and sign in to Jobright once. Your sign-in is remembered.
2. Open a job. The panel reads it (it says **Jobright job**) and scores your match, as with Dice.
3. Press **Tailor & Apply**. ApplyFlow:
   - writes the resume and cover letter;
   - presses Jobright's **Apply**;
   - goes to the employer's application form;
   - attaches your tailored resume and cover letter;
   - fills your contact details, location and links;
   - applies answers you saved earlier.

   It stops for questions only you can answer: one tap each, with **Remember answers**.
4. Check the page and the panel's summary, then press **Submit application**. ApplyFlow presses the employer's Submit once and records the application when the site confirms it.
5. Press **Back to search results** (or the toolbar's **Search results**) to return to your Jobright list for the next job.

## Situations handled

**On Jobright**
- **Not signed in to Jobright:** stops with "Sign in to Jobright", then continues when you press Continue.
- **Apply opens a new tab:** Jobright's Apply normally opens a new tab. In ApplyFlow it opens in the built-in browser, so ApplyFlow can follow it. Sign-in pop-ups (Google and others) still open as small windows.
- **Apply does nothing:** if pressing Apply doesn't lead anywhere, ApplyFlow goes straight to the employer's posting address from Jobright's page data.
- **Referral roles ("Send My Profile"):** there is no employer application to fill, so your documents are saved and ApplyFlow says so.
- **Closed jobs:** Jobright's "no longer available" message stops the run with the reason.

**Getting to the form**
- **Form in a frame:** company careers pages that show a Greenhouse, Lever or Ashby form in a frame are followed to the form itself.
- **Lever:** the job page is followed to the form at …/apply.
- **Ashby:** the Overview tab is followed to the Application tab.
- **Greenhouse:** the form is on the job page.
- **Closed jobs:** Greenhouse's "no longer open", Lever's "couldn't find anything here" and Ashby's "job not found" stop the run with the reason.
- **Already applied:** "You've already applied" stops the run.

**Filling the form**
- **Resume reading (Lever and others):** these sites read your resume and fill fields themselves, sometimes wrongly. ApplyFlow attaches first, waits for the site to finish, then corrects name, email and phone from your profile. Fields it has no profile value for, such as current company, are left as the site filled them.
- **Ashby's "Autofill from resume" box:** never used for your resume. The resume goes in the Resume field.
- **Dropdowns that are really text boxes** (Greenhouse's redesigned form, Ashby):
  - ApplyFlow opens them to read their choices, so you can answer with one tap.
  - It picks country from your profile location.
  - It searches the location and picks the matching suggestion.
- **Lever's location field:** ApplyFlow types your city and picks Lever's own suggestion.
- **Yes/No questions shown as two buttons** (Ashby) appear as one-tap questions.
- **Cover letter:** attached as a file where the form takes one. On Lever, it goes in **Additional information**.
- **Required markers:** "✱" (Lever) counts as required, like "*".

**Things ApplyFlow never does**
- **Never guesses:**
  - work authorization;
  - sponsorship;
  - salary;
  - demographic, veteran and disability questions;
  - criminal background.
  You answer these, and can save the answer for next time. Voluntary self-identification is left blank unless you answer it.
- **Never ticks acknowledgement boxes for you:** privacy notices and attestations are questions you confirm.

**CAPTCHAs and submitting**
- **Invisible CAPTCHAs:** Greenhouse, Lever and Ashby forms carry invisible ones and reCAPTCHA's corner badge. These no longer count as "Complete the CAPTCHA". Only a challenge that is actually on screen stops the run.
- **CAPTCHA after Submit:** Lever sometimes shows a challenge only after Submit. ApplyFlow asks you to complete it and records the application only when the site confirms.
- **Form refuses to submit:** if the form shows errors after Submit, they are shown in the panel and nothing is recorded.

**Sites ApplyFlow doesn't fully support**
- **Workday and other account-based portals:** ApplyFlow presses Apply, then picks "Apply Manually" when asked. It stops at the sign-in page; sign in, then press Continue.
- **Best-effort sites:** ApplyFlow never presses Submit. You submit, and the application is recorded when the site's confirmation appears.

**Moving between jobs**
- **Opening another job after a stop** (a sign-in you don't want, a closed job) switches the panel to the new job.
- **Back:** from an employer's form, Back skips the application pages.
- **Search results:** returns to your Jobright list, the same as for Dice.

## Safety rules

An independent review of this feature found ten ways things could go wrong. All ten are fixed and covered by tests.

**One application per run**
- A run is tied to the employer form it opened. If you end up on another job's form, ApplyFlow stops with "Different application" and fills nothing there.
- Submit is refused if the page no longer shows the application you reviewed.

**Pressing Submit**
- ApplyFlow never presses a form's own submit button while opening an application, even one labelled "Apply".
- If a page shows several different Apply buttons (a careers list), it asks you instead of guessing.

**Recording "applied"**
- An application counts as confirmed only when the form is gone and the site shows its confirmation. A job description that says "thank you for applying" doesn't count.
- If there's no confirmation after Submit, the application isn't recorded. The panel asks you to check the page, and records it when the confirmation appears or when you press "Record it as applied".
- A confirmation page only counts when the employer's own form led to it.

**Your details**
- Your contact details only go into contact fields: never into "Referrer email", "Name of the employee who referred you", or look-alike words such as "excellence".
- Corrections after a site reads your resume happen once, right after attaching. Later passes never undo your own edits.

**Dropdowns**
- Location suggestions must match your city, and the best match on state and country wins.
- When answering a question, a dropdown never falls back to its first option.

**Dialogs and file choosers**
- After an upload, ApplyFlow only confirms a dialog that is about the file, never cookie or consent banners.
- Answering the site's file chooser with your tailored file is switched off when the page navigates, and after 90 seconds at most.

## Validation

- TypeScript: passed. Tests: 289 passed, 5 skipped, 0 failed.
- New `tests/integration/jobright.test.ts` (16 tests, including the safety rules above) and `tests/unit/jobrightUnits.test.ts` (9 tests) runs the real page helper and apply runner against test copies of Jobright, Greenhouse (classic in a careers-page frame, and redesigned), Lever, Ashby, Workday and LinkedIn pages. These copies are in `tests/fixtures/jobright`.
- End-to-end in the built app (`scripts/e2e-jobright.mjs`), with Claude's replies stubbed. It runs these steps:
  1. Set up the candidate.
  2. Open Jobright's list with the toolbar button.
  3. Apply to four jobs: Lever, Greenhouse in a frame, Ashby, and redesigned Greenhouse. Each one runs Tailor & Apply → questions → **Submit application** → confirmation → **Back to search results**. On the second and later jobs the answers saved on the first were reused.
  4. Stop correctly at a Workday sign-in and at a closed job.
  5. Show all four in Applications.

  Every check passed.
- The Dice resume-replacement and back-to-search end-to-end checks still pass.
- **Not tested on the live sites:** no Jobright account, employer sites or Claude key were available. The test copies follow these sites' published structure; real sites change. If a site doesn't fill as expected, use **Copy page details** in the panel and send the outline (it contains no personal data).

## Build from source

Node.js 22.12+. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run dist:win`. End-to-end checks (Linux: prefix with `xvfb-run -a`):

- `npm run build && node scripts/e2e-jobright.mjs`
- `node scripts/e2e-replace.mjs`
