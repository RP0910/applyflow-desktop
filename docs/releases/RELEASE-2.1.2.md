# ApplyFlow Desktop 2.1.2

Includes everything in 2.1.1 (the Dice resume-replacement fix), plus:

## Added: Settings → Education

The first section on the Settings page is now **Education**. For each university or school, enter:

- University / school
- Degree (for example "Bachelor of Science")
- Field of study
- City (optional)
- Start month (optional)
- End / graduation month
- Details (optional, one per line, such as GPA or honors)

Use **Add education** for a second school and **Remove** to delete one, then **Save education**.

- Education was already part of your candidate data, but no screen let you edit it after 2.1.0 removed the master-resume upload. It is saved with your employer setup in the same local database. Saving changes only education; employers and dates are untouched.
- Claude never writes or changes education. It is placed on every tailored resume (PDF/DOCX) exactly as entered and is also used for the "Degree requirement shown" ATS check.
- If you haven't saved employers yet (Profile & answers → Resume generation setup), the section asks you to do that first and links there.
- Documents already generated for a job keep the education they were made with. New Tailor & Apply runs use the new entries.
- Education details (GPA, honors) from an earlier imported resume are now kept when the setup is edited and saved. Previously they were dropped.

## Validation

TypeScript passed. Tests: 259 passed, 5 skipped, 0 failed, including 6 new ones in `tests/unit/educationSettings.test.tsx`. The real-Chromium Dice replace check (`scripts/e2e-replace.mjs`) still passes. I also drove the built app: from a fresh profile, set up an employer, edited and saved education in Settings, reloaded, and confirmed it was stored.
