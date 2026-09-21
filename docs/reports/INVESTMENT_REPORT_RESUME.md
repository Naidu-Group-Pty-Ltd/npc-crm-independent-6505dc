# Investment report generation — why it resumes, and who drives it

> **Section counts below are v2.0's (17).** The current list is eleven
> sections plus back matter — see
> [`INVESTMENT_STRUCTURE.md`](./INVESTMENT_STRUCTURE.md) — so a report now
> converges in about two budgeted rounds rather than four. The mechanism is
> unchanged. One rule was added: a report whose stored `total_sections`
> disagrees with the current registry is **regenerated rather than resumed**,
> because `last_completed_section` is an index into whichever list is
> current and splicing two lists produces a chimera no row records.

Investment reports are the one format whose *generation* does not fit inside a
single request. This document records why, and what now carries a report to
completion. It is about the generation pipeline, not the PDF — for the render
side see [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).

---

## 1. The arithmetic that breaks the request model

A Compass report is 17 sections. Each is a separate Perplexity `sonar-pro` call,
and in production those calls take **9–37 seconds** — call it ~25s average, plus
a 500–1000ms anti-thundering-herd sleep between them.

    17 sections × ~25s ≈ 425 seconds

A Supabase edge invocation is terminated at roughly **150 seconds**. No amount of
tuning closes a gap of that shape: the report needs about three invocations'
worth of wall clock, minimum.

For a long time the section loop simply ran until the platform killed it. The
evidence was unambiguous once anyone looked at `report_generation_chunks`:

| § | label | finished | cumulative |
|---|-------|----------|------------|
| 0 | Cover Page | 11:35:39 | 9s |
| 1 | Client Reading Guide | 11:36:00 | 30s |
| 2 | Executive Verdict | 11:36:22 | 52s |
| 3 | Property & Locality Snapshot | 11:37:00 | 90s |
| 4 | Why This Location Matters | 11:37:38 | 128s |
| 5 | Population & Housing Demand | 11:38:09 | **159s** |

Then nothing. The run row stayed `running` with a null `finished_at` and an empty
`error`, because there was no failure to record — the process was killed between
statements. Across the whole table, stalled reports averaged **6.3 sections**: the
cliff was not intermittent, it was arithmetic.

Because `status: 'completed'` is only written at the very end of post-processing,
a killed run could never reach a terminal state. Ten reports sat at `processing`
for as long as four months.

## 2. Stopping on purpose

`generate-investment-report` now keeps a wall-clock budget
(`SECTION_LOOP_BUDGET_MS`) and a rolling average of observed section latency.
Between sections — never inside one — it asks whether the next section plus, if
it is the last, a post-processing reserve still fits. If not it stops and returns
**200** with:

```jsonc
{ "success": true, "isComplete": false, "resumeRequired": true,
  "sectionCompleted": 6, "totalSections": 17 }
```

Nothing is lost by stopping: the progressive save already writes
`report_content` and `last_completed_section` after every section, and a caller
passing `continueFrom: true` skips everything banked and picks up where the last
run stopped.

The distinction that matters is between *being killed* and *reporting*. A killed
run teaches the caller nothing; `resumeRequired` says "this is fine, call me
back," which is what makes every mechanism below possible.

Two related ceilings were lowered at the same time. The per-section Perplexity
timeout was 150s and the truncation-continuation timeout 120s — both longer than
the entire invocation they lived in, so neither could ever fire. They were cut
to 60s and 45s on the reading that observed section latency was 9-37s — true
of the 2,500-token sections and false of the closing one.

**Every call now answers to the run's own clock (15 Sep 2026).** Measured on
the generation trace, "Risks & Recommendations" (three headings, 4,000
tokens, a 68 KB prompt) took 40-110s whenever it completed, so the
full-prompt attempt timed out at 60s on every run, the compact retry ran in
whatever was left, and 43 invocations for two reports were killed by the
platform with no status written — the widget read "Section 12 of 12 · 10h 45m
elapsed" while the watchdog re-ran the same losing minute. The rule that
replaces the constant: a call is given the window the run can spare —
`SECTION_CALL_HARD_STOP_MS` (125s, inside the watchdog's 130s inner timeout
and the platform's ~150s kill) less the post-processing reserve on the
closing section, less a reserve for the compact retry while a full-prompt
attempt is still worth making (`SECTION_REQUEST_TIMEOUT_MS` is 90s as a
ceiling, never a grant). A full-prompt attempt that cannot get its measured
60s floor is skipped for the compact prompt rather than spent on a timeout
foretold; a continuation never starts into a window it cannot finish in; and
a section with no window left is **deferred** — the single-section answer is
the same `resumeRequired` hand-off as the between-sections guard's, with
`deferred: true`, no error written over the row and no attempt spent —
because writing "failed after 2 attempts" there is what turned one lost
window into ten hours of them. `sectionCallBudget.spec.ts` pins the rule.

What stays measured rather than assumed: whether the closing section's FULL
prompt ever completes inside a 90s window is not known — no full-prompt
attempt for it has completed in the trace — so it may be the compact prompt
that keeps writing that section, as it has been. Right-sizing that section's
prompt is a content decision for the owner, named in the tracker.

## 3. Who calls it back

Three drivers, in ascending order of reliability.

**The browser pump** (`ReportGenerationProgress.tsx`) polls every 3s and drives
single-section calls. It is the fastest path and gives the user live progress —
but it only runs while the tab is visible, gives up after a few attempts, and
dies with the tab. For a long time it was the *only* driver, which is why closing
the tab abandoned a report.

**The bulk worker** (`_shared/bulkReportWorker.ts`) loops `continueFrom` until
the generator reports completion. When its own budget runs out it returns the
item to `pending` rather than marking it `completed` — the previous behaviour
shipped reports truncated at ~6 of 17 sections while the job read as finished.

**The cron watchdog** (`resume-investment-reports`, every 2 minutes) is the
guarantee. It claims stalled reports and drives each one forward by a budgeted
invocation. A 17-section report converges in roughly four ticks with no browser
involved at all.

## 4. Why the watchdog cannot collide with the others

Two drivers calling the generator for the same report would both write
`report_content` and clobber each other. Three rules keep ownership exclusive:

- **Staleness is progress-based.** `claim_stalled_investment_reports` only adopts
  rows whose `updated_at` is older than 2 minutes. The generator refreshes
  `updated_at` on every section, so anything actively being driven — by a live
  invocation or by the browser pump — never looks stale.
- **Claims are leased.** `FOR UPDATE SKIP LOCKED` plus `resume_claimed_at` means
  two concurrent ticks cannot take the same row, and a worker that dies without
  releasing its lease loses it after 5 minutes.
- **Bulk keeps its own.** Reports whose `bulk_generation_items` row is still
  `pending` or `processing` are excluded; the bulk pipeline owns them.

`resume_attempts` counts only rounds that made *no* progress
(`release_investment_report_resume(..., p_made_progress)` resets it otherwise), so
a long report steadily working through 17 sections never exhausts its budget —
only one that is genuinely going nowhere does.

## 5. Retiring what cannot be saved

Anything the claim function refuses — past 8 fruitless attempts, or older than 30
days — would otherwise sit at `processing` forever while the UI kept promising a
report that was never coming. `fail_abandoned_investment_reports()` gives those
rows a terminal status and an error message that says what happened and what is
still recoverable.

**One exception is load-bearing.** A report whose sections are *all* generated is
not abandoned — it is one post-processing pass from done, and finalising it makes
no model calls whatsoever because the generator skips every completed section. So
the age cut-off is waived for `last_completed_section >= total_sections`, in both
directions: the claim function adopts such a report regardless of age, and the
retirement sweep explicitly refuses to fail it.

This is not hypothetical. When the watchdog was written, one row had all 17
sections and 126k characters of finished content and had died during
post-processing 40 days earlier. A naive 30-day sweep would have marked a
complete report `failed` and thrown the whole thing away.

---

## §8 A complete run that reported itself failed

Reported 20 Sep 2026: the 97 Poole Road regeneration "went through the entire
process, however at the end it indicated it failed". Two screenshots carried
the whole diagnosis between them.

**One screen, two answers.** Mid-run the report card read `12/15` while the
progress widget beside it read `Section 12 of 14`. At the end the widget read
`14/14 sections · 100%` and the run was recorded **Failed**.

### One off-by-one

`sectionCountForTier` returned `COMPASS_40_SECTIONS.length` — the **raw**
array — while the generator loops `compassSections()`, the same array
**filtered** on `includeInCompass`. The two agreed until `compass.cover` was
excluded in 2026-09 (a model-written cover was printing as a *second* cover
inside the body, masthead and "Prepared for:" and all). From that day the
client's fallback said 15 where the server wrote 14.

```
COMPASS_40_SECTIONS.length      = 15   <- what the fallback returned
compassSections().length        = 14   <- what the generator loops
FINANCIAL_ANALYSIS_SECTIONS.len = 11
financialSections().length      = 11   <- financial agrees, which is why nobody saw it
```

Three symptoms, one cause:

* **the card said 15** — `useChunkedRegeneration` resolves its total **once**
  at kickoff and falls back to the registry, because the row has no
  `total_sections` until the generator's first progressive save. The widget
  re-reads the row every poll and picked up the server's 14 as soon as it
  existed;
* **the loop ran a fifteenth iteration** against a server that has fourteen;
* **the verdict inverted** — `last_completed_section >= totalSections` was
  `14 >= 15`, so a run that had written every section it was asked for threw
  `Report regeneration incomplete`, and the catch stamped the row `failed`.

**The document was complete throughout.** Only the verdict was wrong. That is
worth stating plainly, because the operator's reasonable reading — "it failed,
so the output is suspect" — was the opposite of the truth.

### What changed

**The count is derived, never restated.** `sectionCountForTier` now measures
`compassSections()` / `financialSections()` — the lists that are actually
generated. `theCountThatDecidesCompletion.spec.ts` pins the equality per tier,
so excluding another section can never again make the client and the server
disagree.

**Completion is the server's arithmetic.** Even with the count corrected, a
client holding a stale total could still condemn a good run, so the final check
reads the row's own `total_sections` and prefers it — the same ordering
`progress/selectors.pure.ts` already applied for display. The client's number
is for drawing a progress bar; it is not a verdict. The thrown message also
names both figures now, because "incomplete" with no numbers is what made this
take a screenshot to diagnose.

**15 was never the right number to show.** The Compass generates 14 sections
and should say 14. The user's "it used to be fifteen" is the old count that
included the duplicate cover — the drop is the 2026-09 improvement landing in
the counter at last, not a regression.

### §8a The clock was timing the wrong thing

The same run displayed `3h 30m elapsed` a few minutes in.

`timeSinceCreation = now - report.createdAt`, where `createdAt` is
`investment_reports.created_at`. **A regeneration reuses the row**, so that is
the report's birthday, not the run's start. On a first generation the two
coincide, which is why it survived; on every regeneration after it the number
is meaningless and grows without bound.

Nothing was frozen — the widget takes `now` from a 1s tick and has since that
was deliberately fixed. The origin was simply the wrong event.

**The instant travels with the start signal.**
`REPORT_GENERATION_STARTED_EVENT` already existed and already woke the widget;
it now carries `{ reportId, startedAt }`, and the widget keeps a per-report map.
No column, no migration, no per-poll join — `report_generation_runs.started_at`
records this server-side, and the run the widget is watching is usually the run
this tab just started.

And where it was not: **a run this tab did not start has no knowable origin**
(a cron resume, a bulk job, a reload mid-flight), so the row prints **no
elapsed at all** rather than the report's age. The completed line degrades the
same way — "Finished" rather than "Finished in 3h 30m". The rule this codebase
has already paid for twice: *absent is never a wrong number.*

## §9 Two pumps drove one report

The section-count fix in §8 was correct and it was not the whole fault. The
next regeneration of 97 Poole Road read `14/14 sections · 100%` and **still
reported Failed** — the same symptom, a different cause, and this one had been
there all along.

**Two browser-side pumps can drive one generation, and nothing serialised
them.**

| pump | where | when it starts |
| --- | --- | --- |
| `useChunkedRegeneration` | the Regenerate button | the operator clicks |
| `ReportGenerationProgress.handleContinueGeneration` | the floating progress panel | `isResumable(report, now)` — no write for `STALLED_AFTER_MS` (90s), **or the row reads `failed`** — with auto-continue on by default and `delaySeconds: 15` |

The panel is not a one-shot nudge. Its own comment says so: *"Drive sections in
a continuous loop instead of one-shot … keep firing until complete"*, bounded
at `MAX_SECTION_CALLS = 60`. It is a complete second generator.

### The measurement

From `function_logs`, project `dduzbchuswwbefdunfct`, 20 Sep 2026:

```
03:39:42  section  7/14    77,840 chars
03:39:49  section 14/14   134,392 chars   "All sections complete"
03:40:06  section  8/14    84,316 chars
03:41:28  section 11/14    99,443 chars
03:43:00  section 14/14   120,145 chars   "All sections complete"
```

`last_completed_section` cannot go 14 → 8 in one linear run, and the finished
document **shrank by 14,247 characters**. Two pumps were writing the same row,
each rewinding the other. Whichever read the row after the other had rewound it
threw "incomplete" and stamped `failed` over a document that was complete.

Three things this rules out, so the next reader does not re-open them:

* **The cron watchdog was not a party to it.** `resume-investment-reports`
  ticked at 04:30:01, 04:32:01 and 04:34:00 and returned in 314 ms, 286 ms and
  336 ms — the shape of "claimed 0" — while a browser pump was mid-run. Its
  `claim_stalled_investment_reports` lease works. §4 stands.
* **The document was never damaged in the way the status implied.** The clean
  run that followed (04:29:25 → 04:38:25, a single linear 1 → 14) finished at
  128,126 characters with header de-duplication and post-processing
  sanitisation complete.
* **"Unable to calculate" on the report card is not a scoring failure.**
  `InvestmentGradeSummary.tsx:26` maps it from `status === 'failed'`. It is a
  symptom of the stamp, not a second defect.

### The fix

**One driver per report** — `src/lib/reports/generationDriver.ts`. Both pumps
take a claim before they write anything and release it when they stop; the
panel's `scheduleAutoRetry` stands down from any report somebody already
holds.

Four rules carry it.

**Exclusion is per driver INSTANCE, never per driver kind.** The first cut of
the module keyed the claim on `'regenerate' | 'auto-continue'`, and two TABS
both claiming as `'regenerate'` would both have succeeded — the exact case the
module exists for, admitted by its own key. The kind is carried only so a
refusal can say where the work already is.

**The claim lives in `localStorage`**, because a second tab is one of the pumps
this has to separate and a module variable cannot see one. A successful read
that says "absent" is the answer: an earlier draft consulted an in-memory
mirror there, and a released claim came back from the dead. The mirror is a
fallback for storage that cannot be READ, never a second opinion about storage
that can.

**It is a lease, never a lock.** A tab closed mid-run leaves its claim behind.
`GENERATION_DRIVER_LEASE_MS` (150s) exceeds `STALLED_AFTER_MS` (90s) and the
longest section this pipeline has been measured at (the closing section,
40–110s), so a live driver is never displaced part-way through a section it is
going to finish — and `oneDriverPerReport.spec.ts` pins that ordering rather
than trusting it. The heartbeat is written once per section rather than on a
timer, so it measures real progress: a pump wedged inside one call lets its
lease lapse and the report becomes recoverable.

**And a failure is a statement about the ROW, not about this caller's run.**
`shouldMarkRunFailed` is asked before the stamp: a report the server calls
`completed`, or one whose banked sections meet the total the server itself
stated, is not failed however badly this particular client ended. It fails
VISIBLE, not closed — a row that could not be read at all still records the
failure, because a run that threw with its state unknown must not be left
looking healthy.

That last rule is the guarantee and the claim is the cause removed. Both were
needed: the claim stops the race, and the guard means that if anything else
ever reaches this line on a complete document, it cannot present it as a
failure. **A complete run had now reported itself failed twice in two days for
two unrelated reasons; the third time it will not be able to.**

### The rule the whole episode turns on

**Read the production logs before modelling the production behaviour** — §7's
lesson, paid again. Thirty seconds of `function_logs` showed the 14 → 8 rewind
and the shrinking character count. No amount of reading the client could have
proved two pumps were running, because each one is correct on its own.

## §10 The watchdog was not broken, and the measurement that says so

On 20 Sep 2026 this document's own rule — *read the production logs before
modelling the production behaviour* — was paid for a third time, and the
mistake was mine in the other direction: I reported the watchdog as dead.

**What was observed.** `resume-investment-reports` answered
`internal_timestamp_skew` on one scheduled invocation at 16:03:45, during a
regeneration of report `5f7fb137` (9 Hollow Street) whose four hand-offs I had
each continued by hand. From one refusal and four unresumed hand-offs I
concluded the watchdog was refusing every tick and that a Compass only
finished with a browser tab open.

**What the invocation record actually says.** The function runs every two
minutes and answered **200 on 24 of 25 ticks** — exactly one 401. It was
working. The reason it resumed none of my hand-offs is that
`claim_stalled_investment_reports` requires `updated_at < now() - interval '2
minutes'`, and I fired each continuation inside that window. **I was the thing
preventing it**, not the skew.

**Verified by effect.** A regeneration was started and then deliberately left
alone:

```
16:27:57  handed off after 7/14 sections — nothing else touched the report
16:29:57  the report becomes claimable (updated_at two minutes stale)
16:30:01  [resume-investment-reports] claimed 1 stalled report(s) as cron-mua1853n
16:30:05  sections 1-7 skipped as complete, section 8 generated
16:32:06  [resume-investment-reports] 9 Hollow Street: 7 -> 10
```

It claimed on the **first tick after the report became eligible**, four seconds
past the threshold. The watchdog carries a report unaided.

**What the skew refusal is worth, stated correctly.** It is real and
intermittent — 19 refusals in 24 hours across `resume-investment-reports`,
`migration-dispatcher` and `conversation-sync-cron`, arriving in batch-flush
clusters (four inside 27 ms, three inside 47 ms). Each costs its job one tick.
For this watchdog that is a two-minute delay, **not a stuck report**, because
the next tick claims what the last one missed. The fix in `auth_v2.ts` stands
on its own reasoning rather than on that symptom: the signature is stamped at
ENQUEUE by `cron_signed_internal_headers` and checked after an unbounded
`pg_net` queue wait, so a symmetric ±90 s window is the wrong shape whatever it
happens to be costing today.

Two rules from it. **A single refusal is not a rate** — one 401 was read as a
dead worker, and the invocation record was one query away. And **a refusal that
carries no measurement cannot be sized**: the log said
`internal_timestamp_skew` and nothing else, so queue latency, a drifting clock
and a wrong unit were the same word, and the severity had to be guessed. It
logs the delta, the direction, the caller and both bounds now, which is what
turns the next occurrence into a reading instead of an inference.
