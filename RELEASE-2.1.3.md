# ApplyFlow Desktop 2.1.3

Includes everything in 2.1.1 (Dice resume-replacement fix) and 2.1.2 (Education editing), plus:

## Education moved to Profile & answers

The **Education** section (university / school, degree, field of study, city, dates, details) is now on the **Profile & answers** page, right below **Resume generation setup**, next to the rest of your candidate details. It is no longer on Settings. Nothing else changed: your saved education is kept, and it still goes on every tailored resume exactly as entered.

## Getting back to your job search after applying

After submitting, the built-in browser stayed on Dice's application pages. Back couldn't get out, because Dice's wizard sends you back to itself once you've applied. So it was hard to return to your search and apply to the next job.

- **"Search results" button** in the browser toolbar, next to Home. It takes you to the last Dice search-results page you used: the same query, filters and page number. When that page is still in the browser history it is restored exactly, including the scroll position. Otherwise it is reopened, and it is remembered across restarts. If you haven't searched yet, the button reads "Job search" and opens Dice's job search. It is greyed out while you're on the results page.
- **After applying, the panel's main button is "Back to search results"** (it used to be a greyed-out "Applied"). There is also a "Back to search results" button on the "Applied to …" card. The application is still saved in Applications as before.
- **Back works on application pages.** From the application wizard or its confirmation page, Back skips all of Dice's application steps in one go and returns to the job you applied to. One more Back gets you to your results.
- **Confirmation detection.** ApplyFlow now recognizes Dice's confirmation page ("Fantastic! Your application is on its way.") and waits up to 20 s for it instead of 10 s. Dice's submit often takes more than 5 s, so "Check the Dice page to confirm it went through" should appear less often.

## Validation

- TypeScript: passed.
- Tests: 264 passed, 5 skipped, 0 failed. This includes `tests/unit/diceNavigation.test.ts`, which covers recognizing search and application pages, choosing the Back target, choosing the search to return to, the confirmation text and the panel's after-apply action.
- End-to-end in the built app against mock Dice pages. The sequence was: search typed in the address bar → page 3 of the results → job → application → confirmation. All of these held:
  - Back landed on the job.
  - "Search results" returned to page 3 of the same search.
  - The button was disabled on the results page.
  - With the browser history cleared, it reopened the remembered search.
- The Dice resume-replace check (`scripts/e2e-replace.mjs`) still passes.
- Not tested on live dice.com (no signed-in account available).
