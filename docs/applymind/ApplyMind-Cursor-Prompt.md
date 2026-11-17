# ApplyMind — Adaptive Job Application Intelligence: Build Brief

## 0. How to read this brief

You are working inside my existing job-application automation tool. This brief defines one feature, **ApplyMind**, to be added to that tool.

- "Must" and "never" mark hard requirements. "Default" marks a starting value that you validate and may propose changing; do not change a default without telling me.
- Work in the phases in section 13. Phase 0 is read-only and ends with a report. **Do not modify code until I approve that report.**
- If this brief conflicts with what you find in the codebase, or two requirements here conflict with each other, stop and tell me. Do not silently choose.
- Do not assume the stack, the database, or the platform integrations. Find out.

## 1. Goal

Today the tool detects screening questions on job platforms (Upwork and other job sites), saves each question and my answer directly in a database, and reuses them. Confirm in Phase 0 exactly how this works. I consider the current approach weak in three ways:

1. **Security.** My answers and personal facts are stored without adequate protection.
2. **Intelligence.** It does not reliably recognise a reworded question, and it cannot tell when the same wording needs a different answer for a different job.
3. **Portability.** What it has learned stays on one device, and I use several.

ApplyMind replaces "store and replay" with a system that understands a screening question, finds the right verified answer for this job's context, measures how sure it is, fills the form when it is sure enough, asks me when it is not, and improves from my approvals and corrections.

**Priority order when goals conflict:** (1) truthful and correct answers, (2) security of my data, (3) not breaking existing functionality, (4) minimum manual typing and clicking. Automation is the purpose of the feature, but it never outranks the first three.

## 2. Definitions

Use these terms with exactly these meanings in code, UI text, and documentation.

| Term | Meaning |
|---|---|
| **Screening question** | A question an employer or platform asks during an application, together with its input control and any answer options. |
| **Verified answer** | An answer I explicitly typed, explicitly approved, or explicitly corrected. This is the only ground truth. |
| **Accepted answer** | An answer ApplyMind filled that I left unchanged when the application was submitted, without explicitly approving it. Weaker than verified. |
| **Prediction** | Any answer ApplyMind retrieved, composed, or generated that I have not yet verified. |
| **Profile fact** | A structured, typed fact about me (for example: work authorization per country, start date of experience with a skill, notice period, location). Stored separately from question records and treated as sensitive. |
| **Knowledge record** | One screening question plus its context plus its verified answer and history. |
| **Context** | Everything that can change the right answer: source platform, job title, required skills and technologies, job location or remote status, seniority, employment type, and the question's own type and options. |
| **Question pattern** | A group of differently worded questions that mean the same thing. |
| **Sensitive question** | A question about legal declarations, work authorization, eligibility, personal identity, certifications, or any other material qualification. |
| **Confidence** | A calibrated estimate, from 0 to 1, of the probability that I would accept the proposed answer unchanged for this question in this context. It is not a raw similarity score. |
| **Learning** | A measurable change in ApplyMind's behaviour caused by verified data: new knowledge records, new paraphrases joined to a pattern, or retrained classifier, re-ranker, calibrator, or adapter. Replaying exact question-answer pairs is not learning. |

## 3. Hard rules

These apply to every phase and override any other instruction in this brief.

- **R1. Truthfulness.** Never invent experience, credentials, employment history, or technical qualifications. Every answer placed on a form must trace back to a verified answer or a profile fact, and the record of that link must be stored.
- **R2. No self-training.** Predictions are never ground truth. Accepted answers may be used as evidence when calibrating confidence, but they never create or change a verified answer.
- **R3. Sensitive questions.** Answer these only from a profile fact, or from a verified answer to the same question pattern in a compatible context. Never from semantic similarity alone and never from generated text. If the needed information is missing, ask me.
- **R4. Confidence does not override facts.** If required applicant information is missing, or two verified sources contradict each other, ask me, whatever the confidence score is.
- **R5. No silent overwrite.** A verified answer is never replaced without my action, whether locally, during import, or during merge.
- **R6. Filling is not submitting.** Form filling and final submission are separate operations with separate authorization (section 11).
- **R7. My input wins.** Never overwrite a value I entered in a form.
- **R8. Preserve what works.** Do not rewrite the existing system or remove working code unless it is necessary, and say why when it is.
- **R9. Real functionality only.** No placeholder functions, fake training logic, mock data, or hardcoded demonstration answers in production code paths.
- **R10. Honest description.** ApplyMind must not be a third-party AI service under a new name. Its essential learning and autofill functions must work with no ChatGPT, Claude, or other hosted AI API, and offline. Do not describe a component as learning unless it meets the definition in section 2.
- **R11. Secrets and logs.** Passwords, authentication tokens, and encryption keys never appear in training data, exports, or logs. Sensitive applicant data never appears in logs.
- **R12. Dependencies.** Before adding any model or large dependency, check its size, license, compatibility with the stack, and CPU-only performance, and report these to me first.

## 4. Architecture

Choose the final design after Phase 0. The expected shape is below; deviate if the codebase gives a reason, and explain the reason.

**A hybrid of four layers, cheapest and most reliable first:**

1. **Deterministic layer.** Question normalization, detection of the answer type from the input control, direct profile-fact lookup, and exact pattern match. Handles everything that needs no model.
2. **Semantic retrieval layer.** A compact, open-source sentence-embedding model running locally on CPU, plus similarity search over verified knowledge records. At this data scale (thousands to tens of thousands of records) exact in-process cosine search is sufficient; do not add a separate vector database service unless you can show it is needed.
3. **Learned layer.** Small models trained on-device from my verified data only: a question classifier (category and type), a context-aware re-ranker that picks between candidate answers, and a confidence calibrator. This is the part that makes ApplyMind self-learning.
4. **Answer rendering layer.** Converts the chosen verified answer or profile fact into the exact format the control needs: a number, one of the offered options, a short phrase, or a paragraph. Long-form answers are assembled from verified passages. A small local generative model may be offered as an optional drafting aid; anything it writes is a prediction and is handled as section 7 specifies.

**Optional fifth step:** fine-tune the embedding model or a lightweight adapter once there is enough verified data. Adopt the fine-tuned version only if it beats the base model on held-out verified questions; otherwise keep the base model.

**Do not** train a large language model from scratch. Prefer the smallest architecture that meets the requirements.

**One fact, many formats.** These three questions share a subject but need different outputs, all derived from the same verified information:

- "How many years of Python experience do you have?" (numeric control) → `<N>`
- "How long have you worked professionally with Python?" (short text) → `<N> years`
- "Describe your Python development experience." (long-form) → a verified paragraph

Store durations as a start date or equivalent fact and compute the number at fill time, so answers do not go stale.

**Same wording, different answer.** Questions with near-identical wording may need different answers depending on job, location, experience requirements, and my profile. Retrieval must therefore rank on context compatibility as well as wording similarity, and a knowledge record must state which contexts it applies to.

**Module boundaries.** Keep each of these as a separate component with a clear interface, fitted into the existing project structure: question extraction; question normalization; semantic embeddings; knowledge storage; context-aware answer retrieval; answer generation and rendering; confidence evaluation; feedback processing; training and model updates; import/export; data merging; synchronization; autofill execution.

**Responsiveness.** Training, indexing, import, and merge run in the background and never block the UI or prediction. Each long operation supports progress reporting, cancellation, error handling, and recovery after interruption. Everything must run acceptably on a machine with no dedicated GPU.

## 5. Data model

**Each knowledge record stores:**

- Stable unique ID and the ID of the device that created it
- Original question text
- Normalized question text
- Question pattern ID
- Question category
- Question type (see list below)
- Available answer options, if any
- Verified answer, and its status: verified, accepted, or prediction
- Provenance: which profile fact or verified answer it derives from
- Context: job title, technical context, and the other context fields from section 2
- Source platform
- Date answered, and date last confirmed
- Model version that produced or ranked it
- Confidence score at the time of filling
- Full revision history, including every correction and piece of feedback

**Supported question types:** short text; long-form; yes/no; multiple choice; dropdown selection; numeric; experience-related; technical screening; availability and work authorization; salary and compensation.

**Two separate stores.** Profile facts live in a sensitive store. Question patterns and general answer templates live in an ordinary store that references profile facts by key rather than copying their values.

**Answer freshness.** Answers in categories that change over time (availability, notice period, salary) carry a "last confirmed" date and are sent back for my review after a configurable period (default: propose one in Phase 0).

**Migration of existing data.** Back up the current database before any change. Determine where each existing stored answer came from. Answers I entered myself migrate as verified; answers produced by any existing AI integration migrate as predictions. The migration must be repeatable, reversible from the backup, and reported with counts.

## 6. Processing workflow

For every screening question, in this order:

1. **Detect** the question and its input control on a supported site.
2. **Analyze** it: normalize, classify category and type, read the options, and build the context.
3. **Retrieve** matching profile facts, verified answers for the same pattern, and verified answers for semantically similar patterns.
4. **Predict** the answer from the most reliable source available, in this order of preference: profile fact; verified answer for the same pattern in a compatible context; verified answer for a similar pattern; composed or drafted text.
5. **Score** confidence from verified evidence, semantic relevance, context compatibility, and the history of corrections for this pattern.
6. **Act** according to the policy in section 7.
7. **Ask** me whenever the policy says to, rather than guessing.
8. **Learn** from my approval or correction: store it as a verified answer with history, update the pattern and index, and queue retraining of the learned layer.

## 7. Confidence and automation policy

**Tiers.** Let `c` be the confidence. Thresholds are defaults and must be configurable.

| Tier | Condition | Behaviour |
|---|---|---|
| A | `c ≥ 0.95` **and** the answer comes directly from a profile fact or a verified answer | Fill automatically, no review flag |
| B | `0.80 ≤ c < 0.95`, or `c ≥ 0.95` without direct verified backing | Fill, and flag for review |
| C | `0.60 ≤ c < 0.80` | Show the suggestion; do not fill |
| D | `c < 0.60` | Request a manual answer |

**Gates.** Any one of these overrides the tier:

- Required information is missing, or verified sources contradict each other → manual answer (R4).
- The question is sensitive and no profile fact or same-pattern verified answer exists → manual answer (R3).
- The answer cannot be mapped unambiguously onto the offered options or the required format → manual answer. Never pick the "closest" option for a sensitive question.
- The answer text was composed or drafted by a model → Tier B at most.
- The pattern has an unresolved merge conflict, or the answer is past its freshness period → Tier B at most.

**Operating modes**, selectable in settings:

- **Suggestion-only:** nothing is written to the form; Tier A to C answers are shown as suggestions.
- **Assisted autofill:** Tier A and B answers are filled, and all of them are flagged for review.
- **Automatic verified-answer filling:** the table above applies as written.

**Confidence must be measured, not assigned.** Calibrate it on held-out verified questions and report the calibration results. No hardcoded or arbitrary scores.

**Cold start.** Until the calibrator has been validated on enough held-out verified examples (propose the minimum in Phase 0, based on how much data exists), only direct profile-fact lookups and exact pattern matches in a compatible context may reach Tier A. Everything else is capped at Tier B.

**Threshold validation.** Report the measured rate of wrong answers at each tier, especially wrong Tier A fills, and recommend threshold changes if the defaults do not hold up.

## 8. Learning from feedback

- An explicit approval or a correction creates or updates a verified answer and is appended to the record's history. A correction also counts as negative evidence against the answer it replaced.
- New wordings of a known question are attached to the existing pattern instead of creating a duplicate record.
- The learned layer (classifier, re-ranker, calibrator, optional adapter) is retrained in the background from verified data when enough new feedback has accumulated. A retrained model replaces the current one only if it performs at least as well on the held-out set; otherwise the current model stays. Every trained artifact has a version.
- Repeated corrections on a pattern lower its confidence until the corrected answer has itself been confirmed.
- The system must get measurably better with use, and the evaluation in section 14 must be able to show it.

## 9. Multi-device knowledge transfer

This is one of the most important requirements. I use the tool on several computers and need the learned knowledge on all of them.

### 9.1 Export

A single archive file in a versioned, documented format, containing:

- Verified question-answer knowledge
- Profile facts (selectable at export time; default included)
- Training examples
- Feedback, corrections, and learning history
- Model configuration, and versions of every model and adapter
- The embedding model's identifier, version, and dimension, so the index can be reproduced
- A manifest with format version, schema version, app version, source device ID, creation time, record counts, and a checksum for every part

The verified text is the source of truth. Embedding vectors and indexes may be included as a cache, tagged with the model that produced them.

The archive is encrypted with authenticated encryption, using a key derived from a passphrase I supply through a memory-hard key-derivation function. Tampering or corruption must be detected before any data is read into the application. Use a well-reviewed cryptography library available for the stack; never implement cryptographic primitives yourself.

### 9.2 Import

The import must, in order: validate the file format; authenticate and decrypt; check integrity of every part; check schema and model compatibility; migrate older schema versions forward; detect duplicates; apply the merge rules in 9.3; and report results (added, merged, skipped as duplicate, conflicts, rejected, and why).

- A corrupted, tampered, or invalid file is rejected entirely, with a clear reason.
- An archive from a newer schema than this installation understands is rejected with a message to update, not partly imported.
- Import is atomic. An interrupted import leaves the local data exactly as it was. A local backup is created automatically before every import.
- Existing verified records are preserved (R5).

### 9.3 Merge

Example: device A holds 500 verified questions and device B holds 300. After merging, both hold the same combined set, whose size is 800 minus the duplicates.

Rules:

1. **Same record, same history** → skip.
2. **Same record, one history extends the other** → take the longer history.
3. **Same pattern, compatible context, same answer** → one record, histories combined.
4. **Same pattern, different contexts** → keep both as context-specific answers. This is not a conflict.
5. **Same pattern, compatible context, different verified answers** → conflict. Keep both, queue for the conflict-resolution interface, and cap the pattern at Tier B until I resolve it.
6. **Verified versus accepted or prediction** → verified takes precedence; nothing unverified ever replaces a verified answer.
7. **Deletions** are recorded as markers so a deleted record does not return on the next merge.

Required properties: merging the same archive twice changes nothing; merging A into B and B into A gives the same result; no verified record or history entry is lost. Do not resolve conflicts by timestamp alone, since device clocks differ.

The conflict-resolution interface shows both answers with their context, history, and verification status, and lets me keep one, keep both for different contexts, or write a new answer.

### 9.4 Models across devices

Never average model weights or merge fine-tuned models from different devices. Reconcile the verified knowledge first, then rebuild the index and retrain the learned layer locally from the merged data. If embedding model versions differ between devices, rebuild the index with the local model.

### 9.5 Synchronization

- Offline-first: every device works fully with no connection.
- This implementation must deliver reliable manual export, import, and merge.
- Put the transfer step behind a transport interface so automatic sync can be added without changing merge logic. Manual file transfer is the first transport.
- Implement automatic sync only if Phase 0 finds a suitable secure backend, or I approve one. If implemented, data is encrypted before it leaves the device and the backend stores only ciphertext.
- Receiving updates must never discard a device's local learning history.

## 10. Security and privacy

Improve the existing database storage; do not simply remove it.

- Encrypt sensitive data at rest. Profile facts and answer contents are sensitive.
- Keep encryption keys in the operating system's credential store where one exists; otherwise derive them from a passphrase. Keys never live in source code, configuration files, or the database they protect.
- Validate all data at every boundary: form extraction, import, and sync.
- Protect against unauthorized local access to the stored knowledge.
- Provide encrypted backup and tested restore.
- Keep only the personal information the feature needs. Do not retain full job pages or unrelated form content.
- Keep sensitive profile facts separate from ordinary question templates (section 5).
- R11 applies: no secrets in training data, no sensitive applicant data in logs. Log record IDs, not contents.
- A model-generated answer is never treated as a verified fact unless I explicitly confirm it.

## 11. Autofill integration

Integrate ApplyMind into the existing autofill workflow; reuse the existing detection and filling code where it works.

When I open a supported job application, the tool must:

1. Detect the screening questions present.
2. Identify the correct input control for each.
3. Retrieve or predict answers through the workflow in section 6.
4. Fill according to the policy in section 7.
5. Handle text fields, text areas, radio buttons, checkboxes, dropdowns, and any other control the existing tool supports, in a way the page registers as real input.
6. Leave any value I entered untouched (R7).
7. Select an option only on an unambiguous match.
8. Detect questions that load dynamically after the page opens, and process them.
9. Fill each question once; re-running must not duplicate or re-fill.
10. Mark clearly which questions were filled automatically, which are flagged for review, and which need a manual answer.

**Submission is separate.** Submit an application only when all three hold: I have explicitly enabled automated submission for that workflow; every answer has passed validation and none is waiting for review or manual input; and the target platform permits the automated action. Otherwise stop at the filled form.

## 12. User interface

Add one **ApplyMind** section that matches the existing application's visual style and reuses its components. Compact, practical for daily use, few clicks, no unnecessary screens or configuration panels, no generic-looking stock UI.

It contains:

- **Model status:** ready, learning, updating, or error, with the error shown.
- **Knowledge statistics:** verified questions, unique question patterns, answer categories, corrections, and successful predictions. All numbers come from real data.
- **Learning activity:** recent verified learning events and whether each has been indexed.
- **Model management:** configuration, version information, and the supported learning operations (re-index, retrain, cancel).
- **Import / Export / Merge:** export knowledge, import knowledge, merge knowledge, resolve conflicts, create a backup, restore a backup.
- **Autofill settings:** the confidence thresholds, and the choice between suggestion-only, assisted autofill, and automatic verified-answer filling.

## 13. Phases

**Phase 0 — Discovery (read-only).** Examine the whole project and report:

- Languages, frameworks, dependencies, database technology
- Project structure, and where question detection, answer storage, and autofill live
- How the tool communicates with each supported platform
- Current data format, how many answers are stored, and where they came from
- Any existing AI integrations
- Hardware and runtime constraints that affect model choice
- Proposed architecture: chosen models with size, license, and CPU performance; integration points; migration plan; risks
- Open questions for me

Then stop and wait for my approval.

**Phase 1** — Data model, secure storage, migration of existing data.
**Phase 2** — Question normalization, classification, embeddings, retrieval, answer rendering.
**Phase 3** — Confidence evaluation, feedback learning, evaluation harness.
**Phase 4** — Export, import, merge, backup and restore, sync transport interface.
**Phase 5** — Integration with the existing autofill workflow.
**Phase 6** — ApplyMind UI section.
**Phase 7** — Full test run, regression check of all existing functionality, documentation, final report.

After each phase, run the relevant tests, fix failures, and give me a short status. Continue to the next phase unless something contradicts the approved plan.

## 14. Testing and evaluation

The feature is not complete because the code compiles. Write automated tests for:

question normalization; semantic similarity; correct answer retrieval; different answers for context-dependent questions; question classification; confidence evaluation; user corrections; duplicate detection; import/export integrity; cross-device merging; conflict resolution; differing model versions; interrupted imports; corrupted and tampered archives; offline operation; dynamically loaded forms; autofill accuracy across control types; sensitive-information handling, including log contents; persistence across application restart.

**Two-device scenario.** Simulate two devices with independent verified datasets that overlap partly and contain at least one true conflict. Export both, merge in both directions, resolve the conflicts, and confirm both devices end with identical combined knowledge and intact histories.

**Evaluation on held-out verified questions.** Split by question pattern, so rewordings of the same question never appear on both sides. Report:

- Answer retrieval accuracy
- Coverage: the share of questions handled at each tier
- Wrong-fill rate at Tier A and Tier B
- Latency per question on a CPU-only machine (default target: propose one in Phase 0)
- Calibration: predicted confidence against observed acceptance

If my real data is too small for a meaningful result, say so and report what the data supports. Test fixtures are synthetic and never ship in production paths (R9).

## 15. Final report

When finished, give me:

1. What was implemented, by component.
2. What was tested, with results and the evaluation numbers from section 14.
3. What is incomplete, limited, or needs further work.
4. Which components learn, which perform semantic retrieval, and which rely on stored verified information.
5. Confirmation that existing functionality still works, and how you checked.
6. Documentation: setup instructions, model dependencies and their sizes, data migration procedure, and the export archive format.

## 16. Definition of done

ApplyMind is fully integrated and working, not a mockup or a partly connected prototype, and it:

- Understands screening questions from the supported platforms
- Reuses verified answers, including for reworded questions, with the right answer for the context
- Fills answers with minimal manual interaction, under the policy in section 7
- Learns from my approvals and corrections, measurably
- Keeps my applicant information truthful and consistent
- Persists across application restarts
- Exports, imports, and merges knowledge between devices without loss
- Works offline for all essential functions
- Protects sensitive data at rest, in archives, and in logs
- Shows clear confidence and review indicators
