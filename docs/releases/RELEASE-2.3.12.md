# ApplyFlow Desktop 2.3.12 — Jobright Autofill-only + employer apply URL

## What changed

**1. Apply with Autofill only**
- On Jobright search results and job detail, ApplyFlow classifies the apply button from accessible labels and DOM text (`Apply with Autofill` vs `Apply Now`, referral, or unknown).
- Only Autofill jobs continue into extract, analysis, and CV generation. Apply Now and unsupported methods are skipped early with status lines such as `SKIPPED — Apply Now (unsupported)` and `ELIGIBLE — Apply with Autofill`.
- The recommend list shows discovered / eligible / skipped counts. Deduping uses stable job ids when available.
- Before Tailor & Apply and before pressing Apply, the method is checked again; if it changed to Apply Now, that job is blocked instead of opening an external login.

**2. Employer apply destination**
- When several URLs are available for a posting, ApplyFlow prefers a known ATS / career-site apply URL over job-board syndication mirrors (LinkedIn, Indeed, and similar), so the Jobs tab does not land on an auth wall when a Greenhouse/Lever/Ashby (or other ATS) form exists.

## Installation

Quit ApplyFlow, then run `ApplyFlow-Setup-2.3.12.exe` (or `ApplyFlow-2.3.12-portable.exe`).
