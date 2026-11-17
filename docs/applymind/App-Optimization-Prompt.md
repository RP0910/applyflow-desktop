# Application Optimization: Size, Startup, and Resource Usage

## 0. Rules for this task

- Work in the order of the sections below. Sections 1 to 3 are read-only: measure and analyze, change nothing.
- **Priority when goals conflict:** (1) every existing feature keeps working, (2) stability, (3) startup time and runtime resource use, (4) installer size. If a change trades one of these against another, tell me the trade instead of choosing silently.
- **Evidence levels.** Mark every claim as **Verified** (observed at runtime; say development or packaged build), **Tested** (an automated test covers it and passes; name it), **Implemented** (code exists, not seen running), or **Unverified** (say what would be needed).
- Do not guess at causes. Every finding about size or performance must come from a measurement or a tool's output, and must name the file, package, or setting responsible.
- I have not set a numeric target. After the analysis, tell me what reduction is realistic.

## 1. First: is ApplyMind actually working?

Before any optimization, answer this from your review findings and the current code. For each item, give Yes, No, or Partly, with its evidence level:

1. My manually entered or corrected answers are captured and stored as verified.
2. A newly verified answer is usable for retrieval in the same session, with no retraining.
3. Retraining of `am-lr-1` starts automatically, with no command, restart, or rebuild.
4. Exact matches of my verified answers are filled automatically.
5. Similarly worded questions are recognized and handled according to the confidence policy.
6. An answer ApplyMind filled is never stored as verified unless I approved or edited it.
7. Knowledge, embeddings, and the trained model survive an application restart.
8. All of the above work in the packaged Windows build, not only in development mode.

Do not describe ApplyMind as fully implemented and working unless every item is Yes and Verified in the packaged build.

**If any item is No, Partly, or Unverified, stop here.** List what is outstanding and ask me whether to fix it first. Optimizing on top of a workflow that is not confirmed working would make it impossible to tell what broke it.

## 2. Baseline measurements

Measure the current packaged Windows build before changing anything. Record the method for each number so the same method can be repeated afterwards on the same machine.

**Size**
- Installer size
- Installed size on disk
- A breakdown of the installed size by its largest contributors: the Electron runtime, application code, dependencies, AI model files, the WebAssembly runtime files, assets, and everything else

**Startup**
- Time from launch to the window appearing
- Time from launch to the application being usable
- Take at least five cold starts and report the median

**Resource usage** (total across all of the application's processes)
- Memory and CPU when idle after startup
- Memory and CPU during autofill on a job application
- Memory and CPU during ApplyMind retraining

**ApplyMind**
- Embedding model load time
- Time per question for retrieval and prediction
- The evaluation results on held-out questions
- A fixed set of test questions with the answer and tier ApplyMind gives for each, saved for comparison

**Tests**
- The full list of passing and failing tests, including the four known resume-processing failures

## 3. Analysis and strategy

Find the actual causes, then report them ranked by measured impact.

**Build size. Check each of these:**
- Dependencies that are never used
- Development-only dependencies that end up in the packaged application
- The same package included more than once, or in several versions
- Heavy packages where a small part is used
- Files for other operating systems or processor architectures
- AI model files: which files of `bge-small-en-v1.5` are shipped, whether more than one format or variant is shipped, and whether every shipped file is loaded at runtime
- WebAssembly runtime files: which variants are shipped and which are used
- Source maps, tests, documentation, and example files inside the package
- Images, fonts, and other assets that are unused or uncompressed
- Unused language files of the Electron runtime
- The Electron packaging configuration: what is included and excluded, archive settings, compression level, installer type, and target architectures
- Whether application code is bundled and minified, and whether tree shaking is effective

The Electron runtime sets a minimum size that optimization cannot go below. State what that minimum is.

**Startup and runtime. Check each of these:**
- What is loaded or executed at startup that could wait until first use
- Whether the embedding model loads at startup or on first need
- Whether the model or other large data is loaded more than once across processes
- Whether training, indexing, or embedding runs on a thread that blocks the interface
- Memory that grows over time: listeners, observers, timers, and caches that are never released
- Background work that runs when nothing needs it

**Techniques to evaluate:** tree shaking, code splitting and lazy loading, dependency replacement or removal, asset compression, and more efficient Electron packaging. For each, say whether it applies to this codebase and what it would save. Leave out any that would bring no measurable benefit, and say so.

**Strategy report.** Give me a table:

| # | Change | Cause it addresses | Expected saving (size, startup, memory, or CPU) | Risk to existing features | How it will be verified |
|---|---|---|---|---|---|

Order it from safest and most effective to riskiest. Then **stop and wait for my approval** before implementing.

## 4. Implementation rules

- **One change at a time.** Make each change, or small group of related changes, separately. After each: build the packaged application, run the tests, and run the ApplyMind checks in section 5. If anything breaks, revert that change and report it.
- **Removing a dependency.** Remove one only after proving it is unused: check direct imports, dynamic loading, configuration files, build scripts, and native modules.
- **Removing code.** Remove code only when it is proven unreachable. Do not change behaviour as part of clean-up, and do not mix refactoring with optimization in the same change. The old Screening Q&A feature stays until I have accepted the migration.
- **The embedding model.** Replacing, compressing, or quantizing `bge-small-en-v1.5` changes the embeddings it produces. That invalidates the stored embeddings, the trained `am-lr-1` model, and the confidence calibration. Do not do this as a routine size reduction. If it would save a meaningful amount, present it as a separate decision for me, with the size saved and the evaluation results before and after re-embedding and retraining.
- **Offline operation.** Do not move the model or any required file to download-on-first-run without my approval. ApplyMind must keep working offline.
- **My data.** Do not move, rename, or reformat the knowledge store, stored embeddings, trained model, or encryption key. Data created by the current build must load unchanged in the optimized build.
- **Security.** Do not weaken encryption, input validation, or Electron security settings to gain speed or reduce size.
- **Tests.** Do not delete, skip, or loosen a test to make it pass. The four failing resume-processing tests must not get worse; report them separately and do not fix them as part of this task unless I ask.
- **Lazy loading.** If the embedding model is moved to load on first need, report the delay this adds to the first autofill of a session.

## 5. Verification after optimization

Repeat every measurement from section 2, on the same machine with the same method.

Then verify in the **packaged Windows build**, installed from the new installer:

1. The application installs, launches, and runs without errors.
2. Installing over the previous version keeps all my existing data.
3. Every existing feature works. List the features and the result for each.
4. ApplyMind end to end: a question is detected; an exact match is filled; a new answer I type is captured and stored as verified; it is retrievable in the same session; it is still there after a restart; retraining starts automatically; a reworded question is recognized.
5. The fixed set of test questions from section 2 gives the same answers and tiers as before.
6. The ApplyMind evaluation results are no worse than the baseline.
7. The test suite has the same passing tests as the baseline, or more.

## 6. Final report

1. **Before and after:**

| Measure | Before | After | Change |
|---|---|---|---|
| Installer size | | | |
| Installed size | | | |
| Launch to window | | | |
| Launch to usable | | | |
| Memory, idle | | | |
| Memory, autofill | | | |
| Memory, retraining | | | |
| CPU, idle | | | |
| Model load time | | | |
| Time per question | | | |

2. Each change made and what it saved.
3. Changes that were tried and reverted, and why.
4. Further reductions that are possible but need my decision, with their trade-offs.
5. Anything that remains unverified.

The goal is a lightweight, fast, stable, production-ready desktop application with a smaller installer and a faster startup, with every existing feature intact and ApplyMind still learning and autofilling correctly.
