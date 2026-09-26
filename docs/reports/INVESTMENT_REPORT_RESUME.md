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

## §11 One generation, one evidence basis

**What happened.** 60 Lawley Street, Spalding WA — report `5d8bc97e`, started
24 Sep 2026 at 01:46 UTC. From the production logs:

```
01:46:36.98  location intelligence requested            (+9.9 s of the run)
01:46:48.98  aborted at the `vendor` ceiling of 12 s
01:46:51.89  the service logs its answer — three seconds too late
01:46:54.6   acquisition finished at +27.6 s of 125 s   → 33% of data, grade withheld
01:46:55     sections 1-9 written (≈8 s each), hand-off at 111 s
01:50:23     second invocation: location answers in 6.0 s, geography resolves,
             crime, Domain, regional, climate and planning answer
01:50:44     Scoring V2 3.0.0: B+ at 89 — sections 10-16 written on that
```

Nothing compared the second invocation's evidence with the evidence sections
1-9 were written from, so one document carried two: the first nine had no
coordinate, no demographics, no planning and a withheld grade; the last seven
had all of them and a B+. The row made it worse. Early persistence wrote
`investment_score` **only when the row had none**, so the stored grade stayed
`withheld` for the whole run and the final write stamped whatever the last
invocation happened to compute. That is also how a regeneration kept the
PREVIOUS generation's grade until its last section.

**The rule** — `_shared/reports/investment/evidenceBasis.pure.ts`: the sections
on the row and the score on the row describe one basis.

- The invocation that writes the **first** section records its score as the
  basis, marked (`__writtenBasis`) with whether it held a verified location.
- A later invocation rewrites the whole document from section 1 **only when it
  holds strictly more evidence** — a location the written basis lacked, or a
  dimension it could not measure, and nothing it could. The reset of
  `last_completed_section` goes in the **same** update that records the new
  score, so an invocation that dies before its first section cannot leave the
  old sections resumable beside the new basis.
- Anything else **keeps the written score**, for that invocation's prompts and
  for the record: a pass that lost a reading, measured the same things and
  printed a different figure, or whose scoring call failed outright. The last
  of those used to write `investment_score: null` over a finished report's
  grade.
- The marker leaves with the last section; `_generationQuality.evidenceBasis`
  records the final decision and how many times the generation was rewritten.

Four bounds make it safe. **An unmarked stored score is never kept** — a
report in flight across the deploy, or a regeneration whose row still carries
the previous generation's grade, cannot be shown to be the sections' basis, so
only a strictly better fresh basis acts on it. **A marker never outlives its
document**: the final write strips it, but a generation that is stopped or
fails for good leaves it on the row, so a new document's first pass that has
no score of its own to record clears it (`clear_marker`) and keeps the score —
still a measurement, only not the basis of anything now on the row. Left in
place, the next pass would read the stopped generation's grade as the basis of
sections it never described and hold it over its own. **A rewrite needs a
fresh score it can record**, so a pass whose scoring failed cannot rewrite and
then rewrite again on every invocation. And **while the document keeps
growing, the recorded basis only moves up** the lattice (located × five
dimensions), so it rewrites at most six times and cannot oscillate. The one
way back down is a restart whose pass dies before its first section: the next
pass records afresh, as any new document's first pass does, and that costs a
death per restart, bounded by the drivers' own limits rather than by this
rule. All four are asserted over 400 simulated noisy generations in
`evidenceBasis.spec.ts`, which also carries a document identity so it can
assert that a kept score was always recorded in the current document — with
the clear removed, it fails at seed 50. Area reports are scored by another
engine and keep today's behaviour.

**The early write reads its own error.** It discarded the client's
`{ error }`, so a write the database refused was taken as saved: the fallback on
the first section's save — which exists to carry exactly this basis — never
ran, and a rewrite's reset reached the row a section late. A refused write is
now treated as the thrown write always was.

**The browser had to learn it too.** `useChunkedRegeneration` counts sections
itself and advanced only when the server's counter passed the one it asked
for — so a restart, which writes section 1 when section 10 was asked for, read
as "no progress", was retried twice, threw, and the failure path would have
stamped a healthy report `failed`. Responses now carry `sectionsRestarted` and
`sectionWrittenThisRun`, and `nextSectionIndex` (`runProgress.pure.ts`) follows
the row's counter wherever it says a section was written or the document
restarted, with the whole run bounded at three passes' worth of calls. A
response that says neither — an older server — keeps the old behaviour
exactly. The progress widget's pump counts nothing and needs no change; it
will show the counter going back to 1 when a restart happens, which is the
truth.

**What it costs.** A rewrite re-buys the sections already written — on 60
Lawley Street, nine sections at about eight seconds each. That is the price of
a document that says one thing; the first half of this fix (§8 of
`GENERATION_STALL_AND_ACQUISITION_BUDGET.md`) is what makes it rare, by not
missing the location in the first place.

**What is not done.** A restart is visible only as the counter going back; the
widget does not say why. Evidence other than the grade's inputs — a crime
reading, a school list — can still differ between passes where it is
re-fetched and not reused; the rule protects the basis the grade and the
geography-keyed registers rest on, and the location and geography halves (§8)
are what keep those from regressing. And a REGENERATION whose first pass
cannot score writes its first sections with no grade while the row still
carries the previous generation's score, unmarked: a later pass rewrites only
if it beats that score, and otherwise writes on its own evidence as it always
did. Closing that means recording "written with no score" on the row, which
would take the previous grade off a report mid-regeneration; that is a
product decision, not one to take inside this fix. The progressive save after
each section also still discards its own `{ error }` (the early write no
longer does); a refused save there is re-written by the next pass rather than
lost, and fixing it is a separate change.

## §12 A read that failed is not a failed report

§8 and §9 were two reasons a complete run reported itself failed, and §9 closed
with *the third time it will not be able to*. It was able to, on 24 Sep 2026,
for a third reason — and it was the rule written in §9 to be the guarantee
that did it.

### The measurement

`function_edge_logs` and `function_logs`, project `dduzbchuswwbefdunfct`,
60 Lawley Street, Spalding (report `5d8bc97e-…`), regenerated beside
9 Hollow Street:

```
05:30:59.8  generator   section 16/16 saved, last_completed_section=16
05:31:01.6  generator   final write — status 'completed' — "Report successfully updated"
05:31:05.1  generator   POST returns 200 (55.9 s) with isComplete
05:31:05.2  OPTIONS condense-investment-report   503  SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED  11 ms
05:31:07.1  POST    get-investment-reports       503  SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED   6 ms
05:31:08.2  manage-investment-reports  action: update  → status 'failed'
05:31:27.0  "token release for failed report" — jobsReleased 16, tokensReleased 316
```

Four requests across the whole project met the 503 between 05:31:04.5 and
05:31:07.1, in 6–81 ms and with no `function_id` — the platform refused them
before any worker ran. Two were this browser's. Hollow's run finalised at
05:32:03, after the window, and completed normally; that is the only reason one
of the two reports failed and the other did not.

### Why every guard passed

The hook's final status check destructured `{ data }` and dropped the error.
With the read failed, `data.report` was undefined and the check compared
`Number(undefined) >= 16` — `NaN`, false — and threw *"the record holds 0 of
16 sections"* about a record it had never seen. The catch asked the row again,
could not read it either, and `shouldMarkRunFailed(null)` answered as §9
designed: *a row that could not be read at all still records the failure*. The
condense step's `try`/`catch` was dead code for the same reason —
`invokeSecureFunction` returns its failures rather than throwing them — so the
preflight 503 was never tried again.

Nothing about the document was uncertain. The generator's own answer to this
very run had said `isComplete`, and the row said `completed`. What followed:
the widget read `Failed · 16/16 sections · 100%` for good (`isResumable`
excludes a report whose sections are all banked, so nothing resumes it), the
card reads "Unable to calculate" once the list refreshes
(`InvestmentGradeSummary` maps that from `status === 'failed'`, §9), and the
finished report was refunded as a failed one.

### The fix

**The server decides from the row it can read.** `manage-investment-reports`
reads `status, last_completed_section, total_sections` before any
`status: 'failed'` write and refuses — HTTP 409 `report_complete`, with the
reason in words, nothing written and nothing released — when the row holds a
finished document. A row it cannot read is not stamped either (503
`row_unreadable`, retryable): an unread row is not evidence of a failure, and
the stamp cannot be taken back. This is the half that protects every browser,
including one running a build from before this section, and it ships with the
edge functions on merge rather than waiting for a frontend publish. The rule is
`rowHoldsCompleteDocument` in `_shared/reports/investment/failureStamp.pure.ts`,
read by the browser through a bridge — one rule, because the server now
enforces what the browser asks.

**The browser tells a failed read from an answer.** `runRowRead.pure.ts`:
`readRunRow` repeats a transient failure (network, 5xx, 408, 429) at 1 s,
2.5 s and 5 s — more than twice the measured window — and says which of three
things happened: `row`, `absent` or `unreadable`, never "a row of zero".
`settleRunOutcome` reads the row whenever it can, and the row wins, including
against the generator (§9: a second pump can rewind a counter the generator
reported complete). Where the row cannot be read, the generator's `isComplete`
stands and the run is reported finished with the status "not re-read yet"; with
no such answer the outcome is `unknown`, said as unknown.

**`shouldMarkRunFailed` learns what the run already knows.** An unreadable row
no longer overrules `serverReportedComplete` (the generator said `isComplete`,
or the kickoff read found every section banked), and a run that failed before
it wrote anything — the kickoff read — stamps nothing, because the row is
exactly as it found it and may be mid-run under another driver. A run that
threw with its state genuinely unknown still fails VISIBLE, and now the server
decides whether that stamp lands.

**The condense step is repeated through a blip**, bounded, and never after a
timeout — a condense that ran for 180 s is not a blip.

What is unchanged, on purpose: a row short of its sections is still stamped (a
section that failed twice, a Stop mid-run); the Stop re-assert is untouched; a
Stop pressed on a report that has already finished is now refused with the
reason instead of destroying it — the hook's own comment already said *marking
a completed report failed destroys it*.

`failedReadIsNotAFailedReport.spec.ts` drives the real hook with the transport
scripted to answer as production did. Three of its replays fail on the hook as
it was — the incident itself, a blip shorter than the retries, and a kickoff
read that cannot be made — and pass now.

### Recovering a report stamped before this

A finished report already stamped failed is recovered by **Regenerate**. With
every section banked, the hook takes its post-processing path: it writes
`processing` without resetting the counter, calls **no** generator (no section
is rewritten, no model is paid for), runs the condense step — which writes
`completed` — and confirms. The replay spec pins that path and it passes on
the hook both before and after this change, so it works on the build that is
live today.

### What is not done

* **The 316-token refund for 60 Lawley Street's finished run is not reversed.**
  It is a Mission Control ledger entry; nothing here touches billing records.

Three things this section first named as not done were then fixed in the same
change, each measured from the same logs:

* **`report-schema-validator` is no longer called.** It answered 401 to every
  generator call — five of five between 23 Sep 13:30 and 24 Sep 05:32 — because
  the generator invoked it through an ANON client and it requires a user
  session. Two more reasons, each sufficient: its answer sits under `data` while
  the reader took `.issues` from the top level, so a 200 would still have
  produced nothing; and its nine required sections are the legacy layout, none
  of them a Compass section name. It had never contributed a flag to any report,
  so removing the call changes no document. A Compass's structure is judged by
  `runQAValidation`, against the registry it was generated from.
* **Compass QA requires only the Protected sections the generator writes.**
  `missing-protected-section compass.cover` fired on every Compass (five of
  five): the cover is Protected and `includeInCompass: false`, drawn by the
  template and never written. `REQUIRED_PROTECTED_SECTION_IDS` is derived from
  `compassSections()`, never restated.
* **QA no longer calls the price and the rent financial modelling.**
  `/weekly rent/` and `/purchase price/` predated TIER_FRAMEWORK Decision E and
  filed two `financial-exclusion` errors on 9 Hollow Street for stating facts
  the tier keeps. Yield, LVR, the loan and the cash flow are still refused.

And a fourth, found while fixing the missing risk register, which is larger than
any of them: every Compass section's own instructions and the document's rules
were cut from its prompt on every call. That is recorded in
[`INVESTMENT_STRUCTURE.md`](./INVESTMENT_STRUCTURE.md) under *What a section is
told*. 

## §13 The first invocation's facts reach the last section (24 Sep 2026)

Measured on the regeneration test the same afternoon, from production logs.

**A listing's facts reached five sections of sixteen.** A report is written
over many invocations; the first carries what the caller extracted
(`propertyDetails`: a listing scrape, a parsed PDF, the form), every later one
is a continuation that carries a report id and nothing else, and reads the
subject back from the row's `manual_overrides`. The extracted facts were
written to `manual_overrides` only by the FINAL write — which is itself a
continuation, with no `propertyDetails` to write from — so a Compass generated
from a listing never persisted them at all. On `79d677d6` (93 Schofields Farm
Road) the first invocation logged `Beds: 4`, `Baths: 2`, `Land size: 401` and
wrote sections 1-5; the eleven continuations logged `From URL scrape: false`
and no facts, sections 6-16 said the counts were not held, the scoring service
was sent the modelling default of 3 bedrooms, and Compass QA failed the
document twice with `attribute-asserted-and-withheld`. `de783a4b` (a
one-bedroom APARTMENT) lost its property type the same way — the final write's
list never carried `propertyType`.

The facts are now banked by the invocation that has them, in the early
persistence, before the first section is written (`subjectFacts.pure.ts`), under
the precedence the final write always used: what the caller extracted is the
floor, and anything the row or the operator already holds wins. The final write
builds its set from the same definition. The listing's descriptive TEXT still
reaches only the first invocation's sections — there is no column for it and it
is not carried in `manual_overrides`.

**A unit number was the postcode.** The intake parse took the FIRST four-digit
token, so `1408/5 SECOND AVE, Blacktown NSW 2148` became postcode 1408. The ABS
calls were re-keyed once the geography resolved (POA 2148), but the school,
risk, rent, climate and location calls went out on 1408 (`Found 20 schools in
1408`). The postcode is now `parseAddressText`'s — the last four-digit token
that agrees with the state, the rule the geocoder already reads by.

**The state was the first state name anywhere, which reads as a street.** Found
while fixing the postcode, not observed on a report: the intake took the first
of `NSW|VIC|…|Victoria|Queensland|…` in the address, so `5 Victoria Street,
Brisbane QLD 4000` read VIC — its postcode then disagreed with VIC and was
dropped, and the location calls went out for a Brisbane street in Victoria —
and `12 Main St, Victoria Point QLD 4165` lost its suburb to the same word. The
state is now the state word in the LOCALITY position (`localityStateOf`: one
followed by nothing but a postcode and the country), which is where every form
this product composes puts it; a state's name inside a street or suburb is part
of the address.

**The library said what it was told when the page opened.** The owner's
screenshot showed Schofields "processing" and Lawley "failed" after the rows
were `completed` (07:56:07 and 08:00:35); a reload showed the truth. The list
was fetched once. It now re-reads itself quietly every 30 s while any listed
report is `pending` or `processing` (a visible tab only), and when a generation
starts or is stopped (`libraryRefresh.pure.ts`), through a ref so an interval
never applies an earlier render's filters, and without raising an error or a
toast over a good list.

**And the 503 window came back, and did no harm.** At 08:00:15–08:00:31 the
edge runtime refused `get-investment-reports` twice, `financial-validation-service`
and `internal-messaging` (5-13 ms, no function version — nothing reached a
worker), during 60 Lawley Street's last section: the situation that stamped it
failed at 05:31. This time the hook's reads retried through it, the finishing
step ran at 08:00:45, no failure stamp was written, and the card reads
`completed` at A+ 89 — §12's fix, observed under a real outage.

## §14 A continuation carries no document either (26 Sep 2026)

§13's fault had a twin. A report made from an uploaded brochure or a listing
link carries the document's words into its prompt, and they arrive in
`propertyDetails`, which only the first invocation is sent. So the first batch
of sections was written from the brochure and every later section as though
there had been no document: the owner's words, "brochure text reaches only the
first batch of report sections".

The first invocation now keeps the document context it composed, at
`listing-images/report-sources/<reportId>/document.json`, and any invocation
handed no document of its own reads it back (`reportDocumentContext.pure.ts`,
`reportDocumentContextStore.ts`). Two rules:

- **A kept copy stands in only for the same report at the same address**, and
  only a record the module wrote is read.
- **The prompt section is composed from the kept fields alone**, so a
  continuation states the document exactly as the first invocation did. On a
  first invocation the section is byte-identical to what it was.

Keeping and reading are bounded (five seconds) and never fail a report. The full
record is `WHITE_LABEL_DOCUMENTS.md` §10.
