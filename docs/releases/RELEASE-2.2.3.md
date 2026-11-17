# ApplyFlow Desktop 2.2.3 — Profile address, job-site logins, Screening Q&A, Analytics

This release redesigns profile management for real application forms (especially Workday), stores job-site logins locally, prefers Autofill with Resume, and adds Screening Q&A plus an Analytics activity dashboard.

## What changed

**1. Profile settings (address + clearer layout)**
- Renamed the rail item to **Profile settings**.
- Removed the unused **Career profile** section.
- Added structured address fields: street, line 2, city, state, ZIP/postal code, country.
- Those fields are filled automatically into matching application form controls.

**2. Job-site logins**
- New `site_credentials` table in the local SQLite database.
- Uses your profile email and a default password until you change it.
- Passwords are encrypted with OS protection (Windows DPAPI) when available.
- Manageable under Profile settings → Job site logins.

**3. Apply workflow (Workday and similar)**
- Prefers **Autofill with Resume** when the Start Your Application dialog offers it.
- Signs in with stored credentials when a login page appears.
- Continues to attach the tailored resume and fill safe profile fields.
- Screening answers are saved and reused more consistently across applications.

**4. Screening Q&A tab**
- New rail item to view, search, edit and add saved screening questions and answers.

**5. Analytics dashboard**
- New **Analytics** tab: applications in range, pipeline, interviews/offers, response rate, weekly activity, top companies, recent activity and Claude usage.
- All figures stay on this computer.

**6. Version**
- Application version **2.2.3** (`package.json` + `src/version.ts`).

## Installation

Close ApplyFlow, then run `ApplyFlow-Setup-2.2.3.exe` (or use `ApplyFlow-2.2.3-portable.exe`). Your database, settings, API key, saved answers, saved documents and Jobright/Dice sign-in are kept.

## Trying it

1. Open **Profile settings** and fill Contact details + Address; confirm your login email.
2. Open **Screening Q&A** and add an answer such as “How did you hear about us?” → “Indeed”.
3. Apply on a Workday job: ApplyFlow should prefer Autofill with Resume and use stored credentials at sign-in.
4. Open **Analytics** to review your local application activity.
