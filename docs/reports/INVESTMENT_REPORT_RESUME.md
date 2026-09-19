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
