# The run that did nothing for 21 minutes, and why nothing said so

**Incident:** 19 Sep 2026, 18 Annabelle Crescent, Kellyville NSW 2155, purchase
input A$1,490,000. The progress widget read
`Section 1 of 15 · 0/15 · 0% · 21m 2s elapsed · 2 auto-retry attempts used`.

Three defects were true at once. Each on its own is sufficient to produce that
screen, and each reported as normal operation — which is the part worth
remembering, because it is the same shape as the AML screening incident and the
`market_sources` seeding gap: **every signal was green and none of them was
measuring the thing that had stopped.**

---

## 1 · Acquisition had no deadline

The acquisition block (`generate-investment-report/index.ts`, the `try` that
opens after the crime-postcode resolution and closes ~1,500 lines later) issued
**eight service calls**. Seven were a plain `fetch` with no `AbortSignal` at
all. The eighth used the file's own `fetchWithTimeout` at its **90-second
default**.

The run they sit inside is bounded:

| constant | value | what it bounds |
| --- | --- | --- |
| `SECTION_CALL_HARD_STOP_MS` | 125 s | last moment a model call may be in flight, from the run's start |
| `SECTION_MIN_CALL_WINDOW_MS` | 20 s | below this a section is not attempted at all |
| platform kill | ~150 s | the edge runtime's own ceiling |

`runStartedAt` is taken **before** acquisition, so acquisition spends the same
clock the sections need. Past roughly 105 s elapsed there is no window for even
one section, and the loop returns `SECTION_BUDGET_DEFERRED` — correctly
reported as a hand-off rather than a failure, because no call was made.

So one slow provider consumed the invocation, every time, and the document
never started.

**The fix is not a shorter constant.** Every acquisition call now answers to the
run's own clock through `acquisitionFetch`, which delegates to the existing
`fetchWithTimeout` so the circuit breaker still applies — one fetch wrapper, not
two. The window is whatever remains after reserving enough for one model call
*and* enough to persist what research did land. Ceilings are per dependency
class (`local` 8 s, `vendor` 12 s, `register` 20 s, `archive` 25 s) and are
ceilings only: the run's clock always wins, so a generous ceiling cannot
overrun the invocation.

### The rule that matters most here

**A timeout is not evidence of absence.**

A register that did not answer in time has told us nothing about the property. A
register that answered and held nothing has told us something real and worth
printing. `AcquisitionOutcome` keeps `answered` / `timeout` / `http_error` /
`transport_error` / `not_attempted` apart by construction, and `describesSubject`
is true for exactly one of them.

When no window remains the call is **not made** and returns a synthetic `598`,
so every call site's existing `!response.ok` branch records a **failure** rather
than an empty answer. That is the conservative side: we did not ask, so the
dependency stays outstanding for the next invocation instead of being written
into the record as an absence. Getting this backwards is how
"no flood overlay was returned in 4 s" becomes "this property has no flood
overlay" in a client's document — the same class as
[`ABSENCE_IS_NEVER_RATED`](./PLANNING_CONTROLS_IN_THE_REPORT.md) §9 and the
Places `count: 0` defect in [`RF72B1B1`](./RF72B1B1_ENRICHMENT_AND_POSTCODE.md) §13.

---

## 1a · The first fix bound a third of the calls

Worth recording, because the shape of the mistake is the point: **the fix was
written from the calls I had found, not from the calls that exist.** Reading the
*deployed* bundle back afterwards is what showed the rest.

Measured on the deployed revision (`generate-investment-report` v417):

| | calls | timeout allowance |
| --- | --- | --- |
| bound to the run clock | 7 | the run's own |
| **not** bound | **14** | **290 s** |

Of the fourteen, nine sat after phase 1 and were awaited **one after another** —
45 s planning + 40 s climate + 30 s regional + 30 s Domain + 25 s risk + three
crime asks at 20 s — summing to 260 s of ceiling. The phase-1 wave adds up to
30 s more. The invocation's whole hard stop is **125 s**.

So the incident was never closed by the first release: one slow register could
still spend the run on its own, and the document would still never start. Every
call in the acquisition region now goes through `acquisitionFetch`, and the site
keeps **its own declared ceiling** rather than being clamped to a class default
— a planning register that needs 45 s still asks for 45 s, and the run's clock
takes the smaller of the two. Buying speed by shortening a register's patience
would be buying it with evidence.

The guard is derived rather than listed. The first version of the spec named six
services by hand and passed with those fourteen calls in place, which is exactly
the failure mode: **a hand-list cannot see the call it does not mention.** The
spec now reads every `functions/v1/…` call out of the generator's source and
requires each one to be on the bounded wrapper, and it is mutation-tested.

### And a non-answer was being recorded as an absence

Converting phase 1 exposed a second fault in the same class, older than this
work. Those wrappers read `if (response.ok) { … } return null`, and a null there
reaches `fetchServiceWithFallback` as the string `"No data returned"`, which
`acquisitionLedger.fromServiceResult` maps to `unavailable_in_coverage` —
*"the provider answered and holds nothing for this subject"*. So an HTTP 500
from the ABS service was already being written into the record as a statement
about the property. `assertAcquisitionAnswered` throws instead, which lands in
the same wrapper's catch and records `requested_failed`. `return null` still
means what it always meant: the service answered 200 and said it holds nothing,
which is real and worth printing.

---

## 1b · One wave, not four queues

Planning, climate, regional trends and Domain depend on the geography that has
just resolved and on **nothing else**. They were awaited in series, so the
invocation paid 45 + 40 + 30 + 30 seconds of ceiling one at a time. Started
together they cost the slowest of them instead of the sum.

Only the **request** moves. Every answer is still read, recorded and bound
exactly where it was and in the same order, by the same code, so the acquisition
ledger and `enhancedData` are written in one sequence whatever order the network
answers in — a wave is not a second way to assemble the record.

Three rules hold it.

**A dependency is not made concurrent by wishing.** The QLD crime re-key is
keyed on `planningData.parcel.lga`, the cadastre's own answer, so it stays
behind planning and a test asserts there is no `crimeRekeyRequest`.

**A started request is marked handled.** A promise that rejects before anything
awaits it is an unhandled rejection, which Deno treats as fatal. The no-op
`catch` in `startAcquisition` swallows nothing — the call site awaits the
original promise, so the same error still surfaces inside the same `try` it
always did.

**The condition that starts a call is the condition that reads it.** Each block
now guards on the request handle rather than re-testing the coordinate, so the
two can never drift apart and leave a started request unread or an unstarted one
awaited.

---

## 2 · A no-progress hand-off wrote the row, and that blinded the watchdog

This is the one that hid the other two for 21 minutes.

`investment_reports` carries a `BEFORE UPDATE` trigger,
`update_investment_reports_updated_at` → `update_updated_at_column()`. It stamps
`updated_at` on **every** write, whether or not the payload names the column.

Two stall detectors read that column:

* the server watchdog — `claim_stalled_investment_reports` claims where
  `updated_at < now() - interval '2 minutes'` **and** `status = 'processing'`
  **and** `resume_attempts < 8`;
* the progress widget — `NO_PROGRESS_STALLED_AFTER_MS` is 180 s when no section
  has landed.

The budget hand-off wrote `status: 'processing'` **even at zero sections**,
under a comment saying the stamp was written "so the watchdog's staleness window
runs from real progress". At zero sections there was no real progress. Every
attempt refreshed the clock, the watchdog never claimed the run, and the widget
kept re-arming its own retry until it hit its ceiling of three.

**Omitting `updated_at` from the payload would have changed nothing** — the
trigger does not read the payload. **Not writing at all** is the only way to let
the clock age. That is why `runProgress.pure.ts` returns a decision about
*whether to write* rather than a payload field, and why progress has to be
classified before the write is issued rather than inferred from it afterwards.

Nothing here disables a safeguard. It restores two: once a no-progress
invocation stops refreshing the clock, `updated_at` ages, the watchdog claims
the run, and `resume_attempts < 8` bounds the retries that were previously
unreachable.

### Activity is not progress

| what happened | durable? |
| --- | --- |
| sections written to `report_content` | yes |
| acquisition results newly persisted | **yes** — research a later invocation will not have to buy again |
| `total_sections` learned for the first time | yes — the widget cannot draw "of 15" without it |
| the same research re-run | no |
| the same status re-written | no |

The second row is the important one: **real progress can precede any prose.** A
long research phase and a hang are otherwise indistinguishable from outside.

---

## 2a · And the widget had been drawing that line since the first second

Two things were wrong with `Section 1 of 15 · 0/15 · 0% · 21m 2s elapsed`, and
only one of them was the run.

`toReportProgress` falls back to the tier registry when the row states no
`total_sections`. The fallback is right for the arithmetic — the bar needs a
denominator and cannot divide by zero — and wrong for the words, because it
meant the widget printed a section count the record had never stated. A healthy
forty-second research phase and a twenty-one minute hang produced **the same
line**, so no reader could tell them apart by looking, and the operator who
reported this had no way to know which they were watching.

`total_sections` is written by the first progressive save, which is also the
first moment any prose exists. Its absence is therefore a real, readable signal
rather than a second guess at one, and `generationPhase` reads it: *Researching
the property* while the record states no count, *Section N of M* once it does,
*Assembling the document* when every section is written. The counts line says
"No sections written yet" rather than `0/15 sections`.

Three rules.

**A count the server has not stated is not printed as though it had.** The
arithmetic keeps its fallback denominator; only the reading changes.

**A phase is not a fifth activity state.** Stall detection, the header counts
and the resume decision all key on `ActivityState`, and adding a member would
change what those mean. A phase says what is happening; a state says whether
anything is wrong — so a run that has been *researching* for four minutes is
still `stalled`, and a test asserts exactly that.

**An absent flag reads as settled.** A row mid-flight when this shipped, or any
caller not yet updated, renders exactly as it did before.

---

## 3 · The continuation loop advanced on `success: true`

A budget hand-off returns HTTP 200 `success: true` — that is how it says "resume
me", not "the section is done". `useChunkedRegeneration` treated it as done and
incremented its section index, which would have **stepped over a section that was
never written** and shipped the report with it silently missing.

The authority is the server's own counter. `sectionWasWritten` requires
`sectionCompleted` to have moved past the index requested, and a healthy hand-off
that banked nothing now retries the **same** section.

## 4 · A stopped run could be revived

A run already in flight when the operator presses Stop finishes its section and
lands its write afterwards. The hand-off wrote `status: 'processing'`
unconditionally, so the row went back to looking live — and the watchdog claims
exactly `status = 'processing'`. The write now matches only
`['pending', 'processing']`, which makes it an atomic no-op against a cancelled,
failed or completed row with no read to race against.

---

## 5 · The one phase that could consume the run was the one phase nothing timed

`traceStartRun` is called **after** the acquisition block, so
`report_generation_runs` has never once included acquisition in its own clock.
That is why "21 minutes at 0 of 15" could not be attributed to anything from
the record alone — the phase under suspicion was invisible to the only
telemetry the pipeline has.

It is measured now, at the close of the block and from the run's own clock, and
the figure travels two ways: a structured line in the edge logs, and
`acquisitionMs` plus `sectionMsThisRun` on the hand-off response, so a speed
measurement can be taken from the browser's network tab without edge-log
access.

Deliberately a log and a response field rather than a column. The run trace's
schema is a contract with its own readers, and a number nobody has asked to
store does not earn a migration.

---

## What was NOT the cause

**The fifteen sections.** v4.0 of the Compass splits Planning, Transport and
Environment back out, so 15 is the registry's number and expected. Fifteen
sections against eleven cannot produce zero in 21 minutes.

**The two retries.** They are the widget's own no-progress auto-continues
(`maxRetries: 3`, reset whenever `sectionsCompleted` increases). That they had
*not* reset is the useful signal: it proves no section ever landed. They are not
the total underlying attempts — the initiating call and each continuation are
separate invocations.

---

## 6 · Research is bought once

`acquisitionReuse.pure.ts` is wired. It was written and left unwired because it
seemed to need somewhere to persist a provenance stamp, and that seemed to need
a column. It did not.

**`report_generation_runs.data_packet` has been storing the whole acquired
`enhancedData` object on every run since the trace was built** — written by
`traceStartRun`, which is called *after* the acquisition block, so the research
a run buys is already durable. The table holds 1,733 rows against 1,232
reports. What was missing was never the storage; it was a statement of **what
the object describes**, and that rides inside the object the generator composes
itself, under `__acquisition`.

### Why it matters more than the budget did

The bound and the wave stop acquisition consuming an invocation. They do not
stop it being **bought again on the next one** — and because sections are what
is left after acquisition, re-buying it is what decides how many sections fit.

Modelled on `SECTION_LOOP_BUDGET_MS` (110 s), a ~25 s mean section and the
widget's 15 s continuation delay:

| acquisition per invocation | sections per invocation | invocations for 15 | end to end |
| --- | --- | --- | --- |
| ~40 s | 2 | 8 | ~16 min |
| ~5 s | 4 | 4 | ~8 min |

Modelled, not measured. `acquisitionMs` and `sectionMsThisRun` (§5) are what
replace both columns with real figures.

### The rules

**Refusal is the default and every refusal is named.** `planReuse` returns a
decision per dependency — `no_stamp`, `no_stored_value`, `subject_changed`,
`inputs_changed`, `schema_changed`, `expired`, `previous_attempt_failed` — and
adopts a value only on `valid`. Every packet recorded before this is unstamped,
so **every existing report acquires exactly as it did**.

**Only geography-sensitive registers are reusable.** A flood overlay does not
move because the operator revised the interest rate. Anything derived from the
accepted inputs is deliberately absent: `financials` is a local calculator and
costs nothing, and `investmentScore` must re-run because it grades the evidence
*this* run assembled, reused or not. `locationIntelligence` is absent too — it
already has `assessEnrichmentReuse`, and two modules deciding one question is
how they come to disagree.

**A failure is never frozen as an absence.** A dependency that failed leaves no
value in the packet, because the call sites only assign on success — so absence
re-fetches. A stamp whose `outcome` is `failed` reuses nothing at all.

**The provenance is written last.** `AcquisitionRecorder` is last-write-wins and
a reused dependency still passes its own call site, which records a skip — so
the reuse entries are recorded at the END of the block, after every call site
has had its say. Otherwise the ledger would say a register was skipped when the
report in fact holds its answer.

**And reuse can never fail a report.** The read is wrapped; a failure logs and
costs the calls again. An optimisation that can stop a document being produced
is not an optimisation.

### What this is not

It is **not** "skip acquisition on continuation". That gate would reuse a result
acquired for somewhere else and freeze a four-second silence as a permanent
absence. Eleven dependencies are judged separately, against this subject, under
this run's inputs, inside a shelf life priced by class: cadastral and
statistical answers keep for 30 days, registers for 7, anything with a market
price in it for 1.

---

## One more lesson, from fixing it

The first push failed CI with **TS2305** — the generator imported
`boundedServiceCall` after that module had been rewritten to export only
`runBounded`. That is fatal at load, not type debt.

It survived local checking because Deno is unavailable in the authoring
environment and `esbuild --external:*` resolves nothing, so a stale named import
parses clean. The gap was closed rather than patched:
`generationHandoffSource.spec.ts` reads every named import the generator takes
from `_shared/reports/investment/` and asserts the target module exports it —
and the guard was **mutation-tested**, because a test that invents its own error
agrees with the code while only the server disagrees.

`boundedServiceCall.ts` was **deleted** rather than left exporting an unused
helper, for the same reason `bd-chip` and `DimensionRail` were: a module nothing
imports is not shipped, it is dead.

---

## 7 · The outage all of the above was standing in front of

Everything from §1 to §6 is a budget. On **19 September 2026** none of it
mattered, because the function was not running out of time — it was throwing.

Measured from `function_edge_logs` on the production project, POSTs to
`generate-investment-report`:

| window | POSTs | status | mean duration |
| --- | --- | --- | --- |
| 18 Sep 16:00–18:00 | 7 | **200** | 77–86 s |
| 19 Sep 12:00–16:00 | **23** | **500** | 18–52 s |

Not one 200 all day. And the durations are the tell: a run that had exhausted
its budget would end at ~125 s, not at 30.

`function_logs` for the 15:52:03 invocation carries the whole story in
fourteen hundred milliseconds:

```
15:52:36.368  ⏱️ acquisition finished at +33.4s of the run's 125s budget · continuation
15:52:36.386  Error in generate-investment-report function:
              ReferenceError: propertySpecs is not defined   (index.ts:5565)
15:52:37.617  ReferenceError: requestBody is not defined     (index.ts:8005)
```

Acquisition worked. It finished in 33.4 s — inside budget, with the
instrumentation §1b added reporting it for the first time. Eighteen
milliseconds later the handler threw, and no section was ever attempted.

### Three symptoms, one defect, plus its twin in the error handler

The operator reported three things. They are two faults.

**"It takes forever and never reaches section 2."** It never reached section
*one*. `readStrategyRecord({ propertyAddress, propertySpecs, …, dataSources })`
read two `const`s declared 2,222 lines further down, inside the
`if (reportId && supabaseClient)` block that writes the row. That block is a
**child** of the block doing the reading, so neither name was in scope. The
throw lands immediately after the acquisition block, every time, on every
property.

**"It keeps stalling."** Same thing seen from the client: the run 500s, the
continuation loop retries, the next invocation 500s at the same point.

**"A CORS / network error that comes and goes."** This is the second fault, and
it is the more interesting one. The handler's `catch` **does** build a correct
500 carrying `corsHeaders` — it had simply never reached it. `let requestBody`
was declared inside the `try`, and **a `catch` is a sibling of the block it
guards, not a child of it**, so `if (requestBody?.reportId)` — the first
statement of the error path — threw `ReferenceError: requestBody is not
defined`. The error escaped the handler, the platform served a bare 500 with
none of this function's headers, and a browser sending `credentials: 'include'`
discarded it. `fetch` rejected with *"Failed to fetch"*.

> **An error handler that can throw turns every server error into a CORS
> error.** The operator is then sent to look at CORS and the network, where
> there is nothing wrong, while the real fault is a hundred lines away in the
> code. This is the second time this deployment has learned it — the first was
> `_shared/stepUp.ts` building a 401 from a wildcard `Access-Control-Allow-
> Origin`, which the browser also discarded. Different mechanism, identical
> symptom, identical wasted search.

The catch's bookkeeping is now wrapped in a guard of its own, so the
CORS-bearing 500 is unconditional. `generatorNameScope.spec.ts` asserts it by
walking the AST: everything before that `return` must be logging, a local, or
inside a `try`.

### Why the gate did not catch it

`check-edge-functions.mjs` was promoted to treat "this name does not exist" as
**fatal and never baselineable** — for exactly this reason, after
`defer_pep_determination` called `appendCaseEvent`. It named the two codes
TypeScript emits for a bare identifier: `TS2304` and `TS2552`.

A **shorthand property** is neither. `{ propertySpecs }` where nothing named
`propertySpecs` is in scope is **TS18004** — *"No value exists in scope for the
shorthand property"* — which was not in the fatal list, so it fell through to
the **count** baseline and was banked as ordinary type debt. Shorthand is how
this repository passes almost everything around, so of the two ways to spell
the same runtime fault, the one that was not fatal was the commoner one.

`requestBody` is the other half of the lesson. It *was* TS2304, the gate *did*
see it, and it was **frozen** in `edge-missing-names.txt` — under a header
reading "EVERY LINE BELOW IS A LIVE DEFECT". It was. It was the CORS error.

Both closed:

- `TS18004` joins the fatal set, with `TS2448` / `TS2454` (the temporal-dead-
  zone spellings) beside it. Measured across all 425 entry points when added:
  **two** occurrences, both this outage, both fixed here. Nothing was frozen.
- The identifier extraction reads all four message shapes, because the freeze
  key is the identifier and a message the gate cannot parse yields no key.
- `requestBody` and `queryType` are **removed** from the freeze rather than
  re-frozen. Eighteen live defects remain named there.

`queryType` was the third instance and is fixed in the same change: area
scoring read it where the binding is `reportScope`, so every suburb, postcode
and statewide report threw at the same class of fault. It had never been
exercised because address reports are the volume.

### The rules

**A count baseline can absorb a guaranteed 500.** That was already known — it
is why this class was made fatal. What was missing is that *the class has more
than one spelling*, and enumerating compiler codes from memory is how you get
three of four.

**Deno is not available locally, so the gate is not either.** The CI gate is
the authority, but it runs after a push. `generatorNameScope.spec.ts` checks
the same property from the ordinary suite, using the TypeScript parser already
in `devDependencies` — it walks scopes and asserts every read of the four names
is covered by a declaration that precedes it and encloses it. Seven mutations,
seven failures; the first version of the gate assertion passed against a
**commented-out** fatal code, which is the same mistake in miniature and is why
it now reads live lines only.

**Three weeks of budget work sat in front of a function that was throwing.**
PRs #2710, #2711 and #2712 are all correct and all still needed — but they were
measured against an outage, not against a slow pipeline, and the modelled
"~16 min → ~8 min" in #2712's body was arithmetic over a run that could not
complete. The lesson is the one this repository keeps paying for: **read the
production logs before modelling the production behaviour.** Thirty seconds of
`function_edge_logs` would have shown 23 consecutive 500s.

### What the hoist does and does not change

`propertySpecs` and `dataSources` are now composed immediately above the
strategy record that reads them, and the row write two thousand lines below
uses those same bindings. **One binding, so the stored row and the prose cannot
disagree.**

Nothing stored moves. Every input to `composePropertySpecs` is a `const`
settled by L5397, and `enhancedData`'s last assignment is L4716 — both before
the new position — so the objects built are the objects that block used to
build. The single exception, stated because it is a real difference: the
`sourceStamp` timestamps inside `data_sources` are taken where the object is
now composed rather than at the end of the run, a shift of a minute or two
within the same invocation. No figure a reader sees is derived from them.

One content consequence is worth naming: the three strategy sections that block
composes — **Resale Liquidity & Exit Outlook, SWOT Analysis, Monitoring &
Review Plan** — have never appeared in any report, because the code that
composes them has thrown on every run since it was introduced.
