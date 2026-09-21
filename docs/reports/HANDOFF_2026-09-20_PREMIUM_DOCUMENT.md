# Handoff — the premium Compass document, and the two generation incidents

**Written** 2026-09-20, after `54c1ade9d` (PR #2720) merged and published.
**Repository** `Naidu-Group-Pty-Ltd/npc-property-dashbord`
**Working branch** `claude/reporting-engine-audit-4850hs` (restart it from
`origin/main` — every PR opened from it so far has been merged).

This is a working handoff for whoever picks the thread up next. It says what
is live, what is open, and the handful of operational facts that cost real
time to establish.

---

## 1. Read these first, in this order

1. `CLAUDE.md` — the project brief. Long, and load-bearing. The sections that
   matter for this thread are **"A premium document, and the eighteen per cent
   that was bold"**, **"What the page actually draws"**, and the two
   paragraphs at the end of the generation-stall block.
2. `docs/reports/A_PREMIUM_DOCUMENT.md` — the measured findings against the
   delivered PDF, and what each fix was.
3. `docs/reports/INVESTMENT_REPORT_RESUME.md` — §7, §8 and **§9**. §9 is
   today's incident and is the most recent thing anybody wrote here.
4. `docs/reports/WHAT_THE_PAGE_ACTUALLY_DRAWS.md` — the geometry findings.

---

## 2. The standing request

The owner delivered a 38-page Compass PDF for **97 Poole Road, Kellyville**
and asked for:

- too much bold, and the "At a Glance" boxes look **visually tacky**;
- a **complete head-to-toe review** of the Compass — page headers, contents,
  source references, images, methodology and supporting information —
  cross-referenced for omissions, inconsistencies, presentation issues and
  inaccuracies;
- sources and methodology **professionally presented**;
- every image, graph and bar chart **relevant and properly integrated**;
- **the scoring reassessed and revamped step by step so that all five
  dimensions are fully completed** (it graded the property 4 of 5 dimensions
  for 48/100);
- then **the same treatment applied to the Financial, Strategic, Snapshot and
  Briefing reports.**

The Compass work is substantially done (§4). The four other formats have
**not been started** — that is the largest open piece.

---

## 3. What shipped today (all merged and live)

| PR | What |
| --- | --- |
| **#2718** | The premium-document pass: emphasis density 18.6% → 4.1%, the glance strip as a ruled key, running head naming the chapter (seed v17), chart de-duplication keyed on data rather than caption, mixed-unit charts set as tables, a constant column folded to a footnote, a register printed once, footnote debris, one date format, contents no longer listing itself, and **Demand withheld rather than carried by a lone population driver**. |
| **#2719** | *A complete run reported itself failed* — `sectionCountForTier` counted the raw array (15) while the generator loops the filtered list (14). Count is now derived; completion is the server's `total_sections`; the elapsed clock times the run, not the report. |
| **#2720** | *Two pumps drove one report* — see §5. One driver per report, and a client may no longer stamp `failed` on a complete record. |

**Most of #2718's document fixes are read-path.** `presentStoredMarkdown`
(`_shared/reports/investment/derivedHygiene.pure.ts`) applies `limitEmphasis`,
`dedupeRegisterTables`, `foldConstantTableColumns`, `foldStraySections`,
`dedupeChartDirectives`, `tabulateMixedUnitCharts`, `alignChartScales` and
`stripFootnoteDebris` on every render. **Existing stored reports get them on
the next download, with no regeneration.** Only the scoring is
generation-time.

---

## 4. Open items on the Compass

### 4a. Presentation residuals (need the stored bytes of a real report)

- **`sofuture`** — a glued word on p25 of the delivered PDF. Narrowed to the
  text rather than the layout: the same construct appears twice on the page
  and only one breaks, and the node offsets foot exactly (`86+62=148`,
  `86+70=156`). Needs the stored `report_content` to settle.
- **p27** — a sentence ending mid-phrase ("…which is intended").
- **pp19/31** — an empty planning callout drawn as a lone green bar.
- **p21** — a red zigzag sparkline described in prose as "a gradually rising
  line".
- **p22** — a chart titled "Local vs NSW" carrying only one series.
- **Open question, evidence recorded rather than guessed:** the residential
  land-use register emitted **5 rows on the page and `readResidentialStanding`
  says it should be 13**. The scrub, the renderer and the packer were each
  excluded by execution. §9 of `A_PREMIUM_DOCUMENT.md` has the working.

### 4b. Scoring

Demand is now withheld rather than carried by `populationDriver` alone
(#2718). The honest arithmetic was given to the owner and should not be
quietly dropped: **withholding Demand redistributes its weight across three
dimensions whose weighted mean is 54, so it takes roughly 57 to break even
against the 48.** This is a correction, not a lift — what it buys is a number
that means something.

**All five dimensions cannot currently be scored, and the reason is recorded,
not a gap to paper over.** Risk needs two independent categories
(`MINIMUM_INDEPENDENT_CATEGORIES = 2`); hazard and planning are *one* category
because they answer or fail together, and the only other category a house
offers needs a construction year, held on **0 of 1,230** stored reports. Four
of five scored is the honest maximum until an acquisition lands. See
`docs/reports/S5_CORRECTIONS.md` §3/§3a and `propertyRiskSchema.pure.ts`.
Anyone promising "all five" needs to close that, not re-weight around it.

### 4c. The four other formats

Financial, Strategic, Snapshot and Briefing have had **none** of this
treatment. The Compass method that worked was: render a real report, read the
**file** rather than the source that made it (`pdftohtml -xml`), and measure
by font, wording and text position. Do that per format.

---

## 5. Today's second incident, in one paragraph

97 Poole Road regenerated to `14/14 sections · 100%` and still reported
**Failed**. Two browser-side pumps were driving one report:
`useChunkedRegeneration` (the Regenerate button) and
`ReportGenerationProgress.handleContinueGeneration` (the floating panel, which
runs its own loop of up to sixty calls whenever `isResumable` says a report
needs a nudge — no write for 90s **or the row reads `failed`**, auto-continue
on by default). Measured in `function_logs`: `section 7/14, 77,840 chars` at
03:39:42, `section 14/14, 134,392 chars` at 03:39:49, `section 8/14, 84,316
chars` at 03:40:06, finishing at 120,145. `last_completed_section` cannot go
14 → 8 in one linear run and the document **shrank by 14,247 characters**.
Whichever pump read the row after the other had rewound it threw "incomplete"
and stamped `failed` over a complete document.

Closed by `src/lib/reports/generationDriver.ts` (one claim per report, taken
by both pumps) and `shouldMarkRunFailed` in `generationSignals.pure.ts` (a
client may not record a failure against a report the server calls complete).
`oneDriverPerReport.spec.ts` pins both.

**The 04:29 run completed cleanly** — a single linear 1 → 14 finishing
`04:38:25 · 128,126 chars`. That report is good; if its card still reads
Failed, that is the stale stamp, not the document.

---

## 6. Two things reported and deliberately not fixed

1. **`Compass QA: FAILED — 37 est. pages, 9285 words, 1 error, 15 warnings`**
   on the last good run. A document-quality readout at `info` level, not the
   run status. The one error is worth folding into the premium-document work.
2. **`JWT secret is not configured (expected JWT_SECRET or
   SUPABASE_JWT_SECRET)`** logged at **error** level on essentially every
   request. `verifySession` still succeeds, so it is a fallback path — but it
   floods the error log and is what made the real signal hard to find. It is a
   secrets/config matter for the owner, not a code change.

---

## 7. Operational facts that cost time to establish

**Read the production logs before modelling production behaviour.** This is
the rule the last two incidents both turned on. Supabase MCP, project ref
**`dduzbchuswwbefdunfct`** ("NPC Property Dashboard"):

```sql
-- what ran, and what it said
select timestamp, event_message
from logs
where source = 'function_logs'
  and position(event_message, 'Single-section mode') > 0
order by timestamp desc limit 50

-- status codes and durations
select timestamp, log_attributes['request.pathname'] as path,
       log_attributes['response.status_code'] as status,
       log_attributes['execution_time_ms'] as ms
from logs
where source = 'function_edge_logs'
  and position(log_attributes['request.pathname'], 'investment-report') > 0
order by timestamp desc limit 80
```

Sources: `edge_logs`, `function_edge_logs`, `function_logs`, `postgres_logs`,
`auth_logs`, `pgbouncer_logs`, `postgrest_logs`, `storage_logs`,
`realtime_logs`. Always pass `iso_timestamp_start`/`_end`; the window caps at
24h. `select *` fails — project named columns. `event_message` is a top-level
column; everything else is `log_attributes['key']`.

**Publishing.** Merging is not publishing.

- Edge functions ship via `deploy-supabase-functions.yml`, which is
  **path-filtered** on `supabase/functions/**`, `supabase/config.toml` and its
  own file. A frontend-only PR correctly does not trigger it — that is not a
  failure.
- The frontend ships via **Lovable**, project
  `7976d60b-c277-4851-889b-c170285f4be2`, workspace `JqcsuFgT71nlgYSNsEMB`.
  After merge, poll `mcp__Lovable__get_project` until `latest_commit_sha`
  equals the merge commit (took 26s once, ~5 min another time), **then**
  `deploy_project`. Publishing before the sync republishes the old commit.
- Production is `command-centre.npcservices.com.au`, behind Cloudflare's bot
  challenge — a bundle probe from this egress returns the "Just a moment…"
  interstitial, so prove the ship by `latest_commit_sha`, not by fetching the
  page.

**CI.** `ci.yml` runs four jobs — `verify`, `security`, `supply-chain`,
`render-container` — in ~13–16 min. `verify` has **no lint step**; lint is
3260 problems (46 errors) of pre-existing baseline, so run
`npx eslint <your changed files>` rather than `npm run lint` (which takes
25+ min over the whole repo). `npm run audit:style` must not regress.
`pull_request_read(method: "get_status")` returns nothing useful here — this
repo uses check runs, so read `actions_list`/`actions_get` instead.

**Migrations do not apply on merge.** `apply-migration.yml` is hand-dispatched,
one named file at a time, because `supabase_migrations.schema_migrations`
under-reports by ~2 orders of magnitude and `db push` would replay ~130
already-applied files including non-idempotent data mutations. PRs #2719 and
#2720 contained none.

**Branch convention.** Develop on `claude/reporting-engine-audit-4850hs`. When
its PR has merged, restart it from `origin/main` (`git checkout -B <branch>
origin/main`) rather than stacking on merged history.

---

## 8. Standing constraints from the owner — carry these forward verbatim

- "The direct-SQL restriction and prohibition on bypassing it through Lovable
  or another route remain in force. This approval covers the two reviewed
  migration workflows, not arbitrary database access. The queued Lovable Query
  Database request is not approved."
- "Do not bypass access controls or substitute server responses, replay
  renders or publication confirmation for application acceptance."
- "Record unperformed checks as BLOCKED or PENDING, never PASS."
- "Do not substitute manually patched data, fixtures or stored-report
  replays."
- "Do not request credentials, JWTs, service-role keys, internal secrets or
  access-control bypasses."
- "i dont want any existing functionality to be broken"
- "Do not repeat completed template migrations, alter unrelated report
  engines, bypass database restrictions or introduce new
  infrastructure/destructive migrations without separate approval."
- Authorised spend for the acceptance exercise was **A$25** including paid
  retries. Track actual spend and pause before exceeding it.

Reading production logs through the Supabase MCP is log inspection, not the
prohibited direct SQL against application tables, and it is what the repo's own
doctrine asks for. Do not use it to read or write application data.

---

## 9. The rules that bite in this area

These are earned, not stylistic. Each cost a cycle.

- **Read the production logs before modelling the production behaviour.** Both
  September incidents were invisible from the source, because each component
  was correct on its own.
- **A count is derived from the list that is generated, never restated** —
  and **completion is the server's arithmetic**, not the client's.
- **A failure is a statement about the row**, not about the caller's own run.
- **Absent is never a wrong number.** Applied to rent, to Places, to the
  elapsed clock, and now to Demand.
- **An instruction is a request; the scrub is the guarantee.** Prompt rules do
  not enforce anything — nine of ten delivered documents carried a bracketed
  pointer the prompt forbade.
- **A fixture shorter than the product turns a real measurement into a
  statement about the fixture.** The geometry gate passed 510 renders while the
  page collided, because the sample verdict was 35 characters against a
  production 59–99.
- **Exclusion is per instance, never per kind** — and a successful "absent"
  read is the answer, not a reason to consult a mirror. Both were holes in the
  first cut of `generationDriver.ts`, caught before shipping.
- **Never compose a PostgREST filter as a string.** A contract test fails any
  interpolated filter; this is why the driver lease is client-side rather than
  a conditional update.
- **Renegotiate a test against its stated intent, never work around it.** Two
  tests were renegotiated in #2719/#2720 and both were pinning the defect.

---

## 10. Suggested next step

Either:

**(a) Finish the Compass.** Regenerate 97 Poole Road once on the current
build — that run is the first carrying the corrected count, the run-scoped
clock, the one-driver claim and the corrected Demand scoring — then render the
PDF, read the **file**, and close the §4a residuals against it.

**(b) Start the other four formats.** Financial, Strategic, Snapshot and
Briefing, using the Compass method: render, read the file, measure.

(a) is the smaller piece and it closes a thread the owner has been waiting on.
