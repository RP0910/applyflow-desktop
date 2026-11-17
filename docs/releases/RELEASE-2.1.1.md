# ApplyFlow Desktop 2.1.1

Fixes the most common failure in 2.1.0: **"Replacing your resume with the tailored one…" opened Dice's "…" menu and then stopped, leaving the profile resume on the application.**

## Installation

Close ApplyFlow, then run `ApplyFlow-Setup-2.1.1.exe` (or use `ApplyFlow-2.1.1-portable.exe`). It installs over 2.1.0; your database, settings, API key and saved documents are kept.

## What was wrong

On Dice's "Resume & Cover Letter" step, the resume card has a "…" (**File options**) menu with **Replace** and **Delete**. In 2.1.0 ApplyFlow:

1. clicked "…" with a *scripted* click. Menus that open on pointer events, or only on a real click, stayed closed or opened without ApplyFlow noticing;
2. looked for the "Replace" item by exact text. Icons inside the item (an SVG with a `<title>`, or an icon-font word like "sync") changed that text, so "Replace" wasn't recognised;
3. only looked at the first 400 links and buttons on the page. Dice renders the menu at the very end of the page, after its header menus and footer, so on longer pages the menu was out of reach;
4. relied on intercepting Dice's own `input.click()` from page script. Without a real click, the browser refuses to open a file chooser at all, so any other way Dice opens it (a `<label>`, an action after re-rendering) went nowhere.

Any one of these left the menu open with nothing replaced, which matches the screenshot.

## What changed

- **Real input in the built-in browser** (`electron/diceInput.ts`). ApplyFlow clicks "…" and "Replace" the way your mouse does. When Dice opens its file chooser, the browser answers it with the tailored PDF instead of showing the Windows "Open" dialog. Dice gets the file through its own input, with genuine events, exactly as if you had picked it. The page's own code is left untouched. This only happens on dice.com, during an upload ApplyFlow started, and is switched off right after.
- **Reliable "Replace" detection.** It now reads the item's rendered text, its text pieces, aria-label and title, and ignores icon words and SVG titles. It searches the whole page, including the end-of-page menu. It never clicks the menu as a whole, nor anything that says Delete, Remove or Download.
- **Fallbacks.** If a point-click is blocked (for example something covers the item), the click is sent as a user gesture. If real input isn't available at all, the earlier scripted method is used. The cover letter is put on its input the same real way.
- **One retry on the same page.** Dice removes the old file as soon as Replace is pressed and re-renders the card. ApplyFlow then looks again and uses the new upload area if the first attempt didn't land.
- Waits up to 30 s for Dice to show the new file name after uploading (was 15 s).

## Validation

- TypeScript: passed. Unit/integration tests: 253 passed, 5 skipped (local-only fixtures), 0 failed. This includes 12 new tests in `tests/unit/replace.test.ts`.
- New real-Chromium end-to-end check (`scripts/e2e-replace.mjs`, in the Electron app against `tests/fixtures/dice/wizard-realistic.html`). It covers 12 shapes of Dice's resume card: pointer-only menu, SVG-title icons, `<label>` Replace, re-render-then-open, very long page, `aria-hidden` page, a menu that ignores scripted clicks, slow upload, a freshly created input, and combinations. On 2.1.0, 6 of the 12 resume checks failed. On 2.1.1 all 15 checks pass (the 12 shapes, the original 2.1.0 mock wizard and 2 cover-letter checks), most in about 0.6 s. Replace is clicked exactly once and Delete never. They also pass with the Dice view hidden. With real input switched off, everything passes except a page that ignores scripted input entirely, which is what real input is for.
- Not tested: a live, signed-in Dice application (none was available). If Dice still won't take the resume, use **Copy page details** in the panel and send the outline.

## Build from source

Node.js 22.12+. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run dist:win`. To run the replace check: `npm run build && xvfb-run -a node scripts/e2e-replace.mjs` (Linux) or `node scripts/e2e-replace.mjs` (Windows). Playwright must be installed.
