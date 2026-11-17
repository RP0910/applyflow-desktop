# ApplyFlow Desktop 2.3.11 — Keep the tailored resume on the correct job

## What changed

**1. Job identity checks**
- Before Tailor & Apply writes documents or opens Apply, ApplyFlow checks that the Jobs tab still shows the same posting as the session (job key / id / URL first; title and company as a backup).
- The page state can include a cheap company signal from JSON-LD or board selectors so soft checks have something to compare.

**2. Safe recovery**
- If the tab drifted to a job list or a different posting, ApplyFlow navigates back to this job (or to the application form it already opened) and checks again.
- If it cannot confirm the match, that job’s pipeline stops instead of clicking Apply or filling the wrong form.

**3. Session attach**
- An employer application page no longer picks up the latest session blindly. The candidate session must fit that form’s apply URL / host (and soft title/company when needed).
- While a tailored mid-apply run is open, opening another job in the tab does not swap the session away from the resume you already generated.

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.11.exe` (or `ApplyFlow-2.3.11-portable.exe`).
