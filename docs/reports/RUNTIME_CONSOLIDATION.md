# Runtime consolidation — Supabase + the browser, and no Cloud Run

> **Target architecture, set in stone.** Frontend/browser + Supabase + existing
> external APIs. No Cloud Run, no Cloud Run Jobs, no Cloud Build application
> dependency, no Compute Engine, no GKE, no new Google-hosted application
> service. Google remains an API provider — principally Maps. Supabase is the
> authoritative backend, runtime and storage platform.

This file records what was **measured** before anything was changed, because
the measurement decided the plan. Read §1 before proposing any sequencing: the
number that matters is not how many report formats route through Cloud Run
(eleven) but how many client documents Cloud Run has actually produced.

---

## §1 — What the delivery evidence does and does not say

**The browser renderer is mature and proven in production. It is not the
current delivery path.** Both halves matter, and conflating them would send
RC-3 after the wrong thing.

### What it says: the browser renderer has done the work

`investment_reports.pdf_url` carries the storage path of the delivered
document, and the two engines write different path shapes. That difference is
a fingerprint, and it settles the question by execution rather than by reading
the code's intentions:

| path shape | engine | rows |
| --- | --- | ---: |
| `<reportId>_<suburb>_<state>_<epoch>.pdf` (stored as a public URL in the older era) | `PixelPerfectPDFGenerator` — **browser, pdf-lib** | **263** |
| `generated/<YYYY-MM-DD>/<uuid>-<name>` | `render-investment-report-pdf` — **Cloud Run WeasyPrint** | **12** |
| | **total delivered** | **275** |

So the browser leg is not a prototype. 263 real client documents came out of
it, with its own upload through `secureStorageUpload` and its own `pdf_url`
write. That is what de-risks RC-3: the target machinery has run at volume.

### What it does NOT say: that the cut has already happened

The **current** unified path is `produceInvestmentDocument` in
`src/lib/reports/investment/deliverInvestmentPdf.ts`, and it is Cloud Run
end to end:

```
tryTemplateDocument('investment', …)   → render-template-pdf  → WeasyPrint (Cloud Run)
  └─ null (no active template) ──────→ render-investment-report-pdf → WeasyPrint (Cloud Run)
```

Every surface — the primary download, Send to Client, the premium button, the
flatten copy — was deliberately folded onto that one module, so **both** of its
legs terminate at Cloud Run. The 263 rows are historical: they predate that
consolidation.

**RC-3 therefore has to migrate a live contract, not delete an unused
renderer.** The renderer implementation is what changes; template selection,
Supabase Storage, `pdf_url`, download, Send to Client and portal delivery all
stay exactly where they are, and the browser renderer becomes the standard
path rather than a second "legacy layout" control beside it.

### How much work Cloud Run has actually done

| signal | window | value |
| --- | --- | --- |
| metered WeasyPrint render calls | since metering began 2026-08-07 | **128**, all successful, last **2026-09-08** |
| `template_render_jobs` | since 2026-06-06 | 135 rows — 122 succeeded, 11 failed, 2 stuck `running` |
| the nine per-format flowing-route ledgers | all time | **42 rows in total** |
| `investment_report_renders` | all time | **0** — the route writes no row to it |
| `pdf_import_jobs` (Docling) | since 2026-06-12 | **86** — 53 succeeded, **33 failed (38.4%)**, last **2026-08-11** |

Two Cloud Run services, low hundreds of renders across the product's life, and
the PDF-import service idle for over a month at a 38% failure rate.

**Caveat, stated rather than glossed:** WeasyPrint metering began 2026-08-07,
so the 128 is not a lifetime total — `template_render_jobs` shows renders back
to June. The lifetime figure is bounded below by ~135 and is of that order, not
of the order of the 1,214 reports on file.

---

## §2 — Per-format render-path matrix

Every one of the eleven render routes is **hard-dependent** on WeasyPrint:
`weasyPrintConfig()` returning null is a hard error in all of them, and there
is no second server-side engine. (`render-investment-report-pdf` still mentions
an Api2PDF/headless-Chrome leg; it is disabled and throws rather than falling
back, deliberately, so a client never receives a stale-looking document.)

| format | Cloud Run route | live browser generator | library | already uploads to Storage |
| --- | --- | --- | --- | --- |
| Investment | `render-investment-report-pdf` + `render-template-pdf` | `reports/PixelPerfectPDFGenerator.tsx` | pdf-lib | **yes** — `secureStorageUpload` → `manage-investment-reports` → `pdf_url` |
| Portfolio | `render-portfolio-review-pdf` | `clients/PortfolioAnalysisPDFGenerator.tsx` | pdf-lib | yes |
| Market Intelligence | `render-market-intelligence-pdf` | `marketing/MarketIntelligencePDFGenerator.ts` | jsPDF | via its buttons |
| Borrowing Capacity | `render-borrowing-capacity-pdf` | `borrowing-capacity/BorrowingCapacityPDFReport.tsx` | jsPDF | via `publishReportToPortal` |
| Commercial & Industrial | `render-commercial-capacity-pdf` | `utils/commercial/commercialReportPdf.ts` | jsPDF | via its page |
| Property Comparison | `render-property-comparison-pdf` | `reports/ComparisonPDFGenerator.tsx` → PixelPerfect | pdf-lib | yes |
| Client Details | `render-client-details-pdf` | — (no dedicated generator) | — | — |
| 10 Year Cash Flow | `render-cash-flow-pdf` | inline in `CashFlowAnalysisModal.tsx` | jsPDF | **already wired as `legacyFallback`** |
| Cash Flow Comparison | `render-cash-flow-comparison-pdf` | — | — | — |
| Report Q&A | `render-report-qa-pdf` | `report-qa/{Conversation,Message}ReportEditor.tsx` | jsPDF | via its editors |
| Template Builder | `render-template-pdf` | `lib/reportTemplate/blocks/*` `drawXBlock` | jsPDF | via the route |

All five generators named in the mandate exist and are **mounted** — every one
has live UI call sites. None is dead code.

### The one place the browser path is genuinely thinner

`src/lib/reportTemplate/blocks/index.ts` already carries a complete dual
renderer — `*.html.ts` for WeasyPrint and `*.ts` `drawXBlock` for jsPDF — and
declares per block which engines support it. Measured:

* **62** registered block types
* **28** have a real jsPDF renderer
* **34** render `drawExtrasPlaceholder` — a literal placeholder

The 34 include **every chart type** (`chart-bar`, `chart-line`, `chart-pie`,
`chart-donut`, `chart-area`, `chart-scatter`, `chart-radar`,
`chart-stacked-bar`, `heatmap`, `sparkline`) plus `data-grid`, `pivot-table`,
`kpi-strip` and `auto-toc`.

This is the honest cost of the template leg and it is why §11 of the mandate —
*"if a browser renderer produces inferior output, fix the browser renderer
using existing design primitives"* — is load-bearing rather than a formality.
It is bounded by the fact that the design system renders **0.14%** of this
product's documents and **zero** investment reports, so no client document
depends on those 34 blocks today.

---

## §3 — What "change only the transport boundary" can and cannot mean

The mandate's §5 asks that only the final transport/render boundary change.
For an HTML-composing route that boundary is HTML → PDF, and the constraint
that decides the design is this:

**There is no production-grade browser HTML → PDF converter that both
preserves vector text and yields a `Blob` that can be stored.** The three
candidates fail for different reasons — `html2canvas` + jsPDF rasterises (the
inferior artefact this programme has already rejected once); the browser's own
print engine produces excellent output but cannot hand back bytes, which §6
requires; and no pure-JS vector HTML renderer exists at this quality.

So the resolution follows the mandate's **§4**, which is the more specific
instruction and names the files: the browser path consumes the same **data**,
through the same projections, calculations, branding and disclaimer logic, and
draws it with pdf-lib/jsPDF. Everything upstream of the draw is preserved
unchanged. What differs is the typesetting, and that is measured against §11's
checklist rather than assumed.

**This is not a new reporting engine.** It is the engine that already produced
263 of 275 delivered documents.

---

## §4 — Rules this consolidation answers to

* **Cost safety must never create false data.** A daily ceiling reached makes
  the provider unavailable, the measured field `null`, and the claim absent
  from the report. It never produces a substituted or estimated figure —
  `rentalEvidence`'s rule, applied at the producer.
* **One quota vocabulary.** The ceilings reconcile against the existing
  `GOOGLE_*_DAILY_LIMIT` counters and their existing units before anything is
  hard-coded. A second metering system is not built.
* **Generating a file locally is not sufficient.** Every production PDF path
  keeps download, Supabase Storage persistence, a stable PDF reference, Send to
  Client, portal access, email dispatch where supported, report history and
  access control — through the existing `secureStorageUpload` and delivery
  abstractions.
* **Nothing is deleted before cutover validation.** The order is: browser path
  live → parity passes → smoke passes → production dependency removed → deploy
  workflows deactivated → services decommissioned. No workflow is left able to
  recreate Cloud Run afterwards.
* **Asserted by effect, never by configuration.** A route is proven cut when a
  document is produced, stored, downloaded and sent without a `*.run.app` call
  — not when a setting says so.

---

## §5 — Maps cost control

The first pass of this section claimed `location-intelligence-service` was the
only uncapped paid Google call site. **That was wrong, twice over**, and
nothing in the repository could have caught it because nothing checked. A
targeted scan for outbound Google Maps Platform requests found seven callers
and two with no ceiling at all.

### The production caller matrix

Scanned for actual outbound requests to `maps.googleapis.com/maps/api/*`, not
for mentions of the key:

| caller | billable SKU(s) | before | now |
| --- | --- | --- | --- |
| `location-intelligence-service` | Geocoding, Places Nearby, Distance Matrix | **none** | per-SKU |
| `parse-property-pdf` | Geocoding | **none** | `geocoding` |
| `school-data-service` | Places Nearby | **none** | `placesNearby` |
| `resolve-listing-coordinates` | Geocoding | own bucket | `geocoding` (product-wide) |
| `google-places-autocomplete` | Places Autocomplete | shared `google_places` | `placesAutocomplete` |
| `street-view` | Street View metadata + imagery | one scope, one unit each | `streetView` |
| `_shared/builderStock/images.ts` | Geocoding, SV metadata, SV imagery, Static Maps | **all four billed to the Street View bucket** | routed per SKU |

Two corrections to earlier readings, recorded because the method matters more
than the conclusion:

* `builderStock/images.ts` was described as spending "one unit for up to four
  requests". **That was wrong and no such defect ever existed.** It has a
  `spend()` helper called immediately before each of its four billable
  requests, so the per-request accounting was always correct. The real defect
  was **routing**: all four counted against `google_street_view`, so its
  geocode never touched the geocoding budget and a static map was billed to
  Street View.
* The earlier count came from grepping how many times `enforceGlobalDailyQuota`
  appears in a file, which counts the import and the helper definition rather
  than the call sites. `googleMapsDailyCaps.spec.ts` now asserts the matrix by
  execution instead.

### What the existing counter actually does

Read off the deployed `security_consume_rate_limit`, not inferred:

| property | measured behaviour |
| --- | --- |
| increment | `count = count + 1` — **one unit per call**, consumed once immediately before each outbound request |
| allow test | `count <= p_max` — a ceiling of 250 admits the 250th and refuses the 251st |
| window | **fixed, not calendar**: `window_start` is stamped on first use and reset only once it is older than the window |
| key | `public:global:<scope>:daily`, regex-checked `^[a-z0-9:_./-]{1,200}$` — an invalid scope RAISES, turning a ceiling into a 500 |
| unavailable RPC | falls back to a **per-isolate** counter and flags `degraded` |

### Fail closed — this is a spending boundary, not abuse control

That last row is the one that decides the design. A per-isolate counter is not
a product-wide ceiling under horizontal Edge scaling: every isolate gets its
own first N, so under the exact fault the ceiling exists for, spend is
unbounded while the limiter still answers `ok: true`.

`publicAbuseControls` is right to fail open — for abuse control, disabling a
working feature is the more expensive failure, and its header records what
treating an unreadable store as "denied" once cost. **The Maps wrapper fails
closed instead**, and the general abuse-control behaviour for the rest of
Aurixa is untouched. `degraded` is checked *before* `ok`, because reading `ok`
first would let a degraded limiter permit spend while looking healthy.

### Scopes follow Google's billing SKUs

One scope per billable SKU, because Google prices them separately and a shared
bucket makes each configured number meaningless on its own:

| SKU | scope | env | default |
| --- | --- | --- | ---: |
| Geocoding | `google_geocoding` | `GOOGLE_GEOCODING_DAILY_LIMIT` | 250 |
| Places Nearby | `google_places_nearby` | `GOOGLE_PLACES_NEARBY_DAILY_LIMIT` | 150 |
| Places Autocomplete | `google_places_autocomplete` | `GOOGLE_PLACES_AUTOCOMPLETE_DAILY_LIMIT` (legacy `GOOGLE_PLACES_DAILY_LIMIT` still read) | 250 |
| Distance Matrix | `google_distance_matrix` | `GOOGLE_DISTANCE_MATRIX_DAILY_LIMIT` | 250 |
| Street View | `google_street_view` | `GOOGLE_STREET_VIEW_DAILY_LIMIT` | 250 |
| Static Maps | `google_static_maps` | `GOOGLE_STATIC_MAPS_DAILY_LIMIT` | 250 |

Nearby and Autocomplete are split because they were sharing one bucket, which
meant a busy address field could spend the allowance a client's report needed.

**Geocoding is the opposite case and the rule is the same: one SKU, one
budget.** All four geocoding callers consumed `google_geocoding`, so
`GOOGLE_GEOCODING_DAILY_LIMIT` has one honest meaning across Aurixa. The
earlier "configure N/2 because two buckets exist" workaround is gone — the
architecture was fixed rather than documented around. Since 16 Sep 2026 the
four callers ask one geocoding chain (`_shared/geocode/geocoder.ts`, read
[`GEOCODING_WITHOUT_GOOGLE.md`](../integrations/GEOCODING_WITHOUT_GOOGLE.md))
whose Google provider is off by default; where an operator lists it, that one
provider is the one consumer of the scope.

Circuit-breaker scopes are a **different axis** and survive untouched:
`resolve-listing-coordinates` keeps `listing_geocoding` for its breaker (it
was `google_listing_geocoding` until the chain stopped naming Google), because
a breaker is about one caller's error rate while a budget is about the
account's spend.

Street View metadata is free and is counted with the imagery — a deliberate
over-count, because a second counter for a SKU that costs nothing buys nothing
and over-counting spend is the safe direction.

Defaults are set to keep ordinary **pay-as-you-go** usage under Google's free
monthly thresholds with room for month-boundary timing. Nothing here subscribes
to a paid Maps plan. Places Nearby is the tightest because it is what limits
report throughput: one enrichment is 1 geocode + 6 Nearby + 1 Distance Matrix,
so 150 admits ~25 enrichments a day against a corpus that created 32 reports in
thirty.

### Configuration is visible, not hidden

Every ceiling the runtime reads is declared on the **existing** Google Maps
Platform card in `src/lib/integrations/registry.ts` and flows through the
generated `integrationSecrets.ts` allow-list. No second integration card, no
second secret system. A spending limit that exists only in code is
configuration an operator cannot see, and a test asserts the declaration.

### Three refusals, kept distinct — and none of them reaches a client

`kill_switch`, `daily_cap` and `limiter_unavailable` are different operational
facts sending an operator to three different places, so they stay separate
internally and appear in logs verbatim.

**None of them may be paraphrased into client-facing prose.** The geocode
refusal is returned in the response body, so it names no environment variable,
no limit, no vendor and no piece of infrastructure — it says location details
are unavailable, that the address was never rejected, and that nothing has been
estimated in its place. A test scans every client-reachable refusal string for
`GOOGLE_*`, for any SCREAMING_SNAKE identifier, and for infrastructure
vocabulary.

### A ceiling produces absence, never a value

This needed no new machinery — each caller already had the right absence
semantics and a refusal takes them:

| refused call | returns | what a reader gets |
| --- | --- | --- |
| Places category | `{ ok: false, count: 0 }` | `measuredCount` answers **null**; the line is omitted, not printed as `0` |
| Geocode (location intelligence) | `{ ok: false, capped: true }` | `geocoder_daily_cap_reached` — its own reason, because `geocoder_unavailable` sends an operator to hunt broken map access |
| Geocode (`parse-property-pdf`) | the payload untouched | the address keeps what the extraction genuinely read; nothing is filled in |
| Places Nearby (`school-data-service`) | `[]` | the caller answers `null` — "nothing honest to return" — rather than a location with no schools |
| Distance Matrix | `COMMUTE_CAP_REACHED` | distinct from `no_route_returned`, which is a **measurement** a reader may act on |

A reached-and-empty lookup keeps its real zero: a rural address with no
hospital within five kilometres is a fact worth printing. Collapsing that with
a failure is the defect this guards.

### Release-gate proofs

`googleMapsDailyCaps.spec.ts` — 22 assertions, each a state the boundary must
hold:

| state | asserted outcome |
| --- | --- |
| limiter healthy | permitted, exactly one unit consumed, against the right scope |
| daily allowance exhausted | refused, `daily_cap` |
| **global limiter degraded** | **refused**, `limiter_unavailable`, and never reported as `daily_cap` |
| kill switch active | refused, `kill_switch`, and never reported as `daily_cap` |
| provider failure | unavailable, not zero |
| successful measurement | real value retained |
| genuine successful zero | zero retained |
| every known caller | consumes the shared allowance |
| every caller | no longer spends a paid request on the raw abuse-control quota |
| every geocoding caller | consumes the one product-wide budget |
| every ceiling | declared in the registry and the generated allow-list |
| every client-reachable refusal | no env name, no infrastructure wording, no digit |

---

## §6 — A refusal is reported for what it actually was

Three internal reasons, and only one of them is "you have used today's
allowance". The first pass let all three reach a caller as
`daily_quota_exceeded` — `google-places-autocomplete` and `street-view`
answered it on every refusal, and `builderStock/images.ts` **persisted** "The
daily limit for location imagery has been reached" onto the row, where it
outlives the incident and is read by people who were not there.

That is not a wording nit. "Daily quota exceeded" tells an operator to wait
until tomorrow, and waiting clears neither of the other two: a provider
somebody switched off stays off, and a shared counter that cannot be read stays
unreadable.

| internal reason | client / persisted status | HTTP |
| --- | --- | ---: |
| `daily_cap` | `daily_quota_exceeded` | 429 |
| `kill_switch` | `temporarily_unavailable` | 503 |
| `limiter_unavailable` | `temporarily_unavailable` | 503 |
| unknown / absent | `temporarily_unavailable` | 503 |

Both codes already existed at these call sites; nothing new is introduced.
`clientStatusFor`, `clientHttpStatusFor` and `clientMessageFor` are the one
mapping, so four callers cannot drift — and no call site spells either literal,
which is what a test can then assert.

The exact reason still reaches the log at every caller, and
`location-intelligence-service` carries it on the outcome as `capReason`.

**The geocoder's own state was renamed for the same reason.**
`geocoder_daily_cap_reached` is returned in the response body and was true of
one refusal in three. It is `geocoder_not_attempted` now — named for what
happened rather than for one of its causes — and it stays distinct from
`geocoder_unavailable`, which means map service access is broken and is a
genuinely different afternoon's work.

Four tests pin it: the mapping itself; that the two neutral reasons never
produce allowance wording; that no client-reachable string carries a
configuration name, infrastructure vocabulary or a digit; and that no caller
spells the exhausted-quota claim itself. The last is judged on **code with
comments stripped** — a comment may quote the false claim in order to forbid
it, which is `rf72b1b0GeocodeRefusal`'s own rule.

---

## §7 — RS-2 (14 Sep 2026): the Investment FINAL document returns to the existing WeasyPrint container

This section supersedes §1–§3 for **one path**: the Investment report's final
client document when a template is selected. Everything else in this document
stands.

RV-1 compared the two renderers on one frozen payload and measured what §3
could only argue: the browser renderer embeds no fonts (every face becomes
Helvetica), draws no block the registry marks partial, and cannot draw text on
a filled panel legibly — the executive dashboard's headline figures were
illegible in every browser render and legible in every WeasyPrint render. The
owner's decision (RS mandate, 14 Sep 2026) is the hybrid: **browser for
preview, WeasyPrint for the final document**, on the existing Cloud Run
`weasyprint-service` (`--min-instances 0`, roughly 34 renders a month), invoked
only by a deliberate final action. No new renderer, no migration, no second
hosted runtime; RC-6's decommissioning of `weasyprint-service` is withdrawn,
and the Docling sidecar is a separate question this does not touch.

What changed, and only this:

* `routeReportThroughTemplate` takes `renderer: 'browser' | 'weasyprint'`. The
  Investment finalisation (`produceInvestmentDocument`) passes `weasyprint`;
  every other caller keeps the browser default until its own format is moved
  deliberately (RS-5). Under `weasyprint` the route compiles the template with
  `compileTemplateHtmlForPdf` — the same compiler every design-system render
  uses, fonts sourced from the container, assets resolved to what the engine may
  fetch — and hands the HTML to `render-template-pdf` in `final` mode, naming
  the report. The engine draws the completed report; it calculates, regenerates,
  queries and decides nothing.
* `render-template-pdf` answers the storage `path` beside the signed URL and
  stamps `template_render_jobs.metadata.report_id`, so one finalisation is
  findable by report and its bytes are stored once.
* `publishInvestmentPdf` points the portal at that path instead of uploading a
  copy; concurrent asks share one production and a completed finalisation is
  remembered per tab. `docs/reports/BROWSER_PRESENTATION.md` §"One finalisation
  → one PDF" carries the rules and the measurements.
* The boundary is pinned by `investmentFinalRender.spec.ts` over the module
  graph — one client, one importer, one `final` call site, no preview surface,
  no Cloud Run host addressed from the browser — replacing the two specs that
  pinned the absence.

**Asserted by effect.** `npm run verify:journey -- --report <id>` drives the real
page in Chromium against an intercepting double and fulfils `render-template-pdf`
with the pinned engine locally: on reports A, B and C (14 Sep 2026) each
finalisation made exactly one render call in `final` mode naming the report,
Send made none, the portal row's `storage_path` equalled the render's path, and
the edit written in the same journey appeared in the final PDF.

## §8 — RS-5a (14 Sep 2026): a placeholder never reaches a client document

The owner's rule, verbatim: *"N/A or unavailable — this never should be
included in reports."* Measured on production the same day, before any change:

| stored reports | rows | carrying a table row whose first value cell is a placeholder | carrying "N/A", "not available" or "unavailable" anywhere |
| --- | ---: | ---: | ---: |
| Executive Briefing | 23 | **21** | 22 |
| Snapshot | 26 | 3 | 3 |
| Compass | 1,122 | **268** | 876 |
| Financial / Due Diligence | 11 / 11 | 2 / 2 | 1 / 1 |

Every Briefing produced in the preceding 120 days (seven rows) carries 36 to 97
"N/A" cells; the newest Snapshot (4 Sep 2026, row `8c6edc56`) carries 19,
including `Grade: N/A` and `Score: N/A/100` on a record whose own row holds
score 62 and grade B. All of them predate the write-path scrub
(`stripPlaceholderRows`, 4 Sep 2026 07:39Z; the newest Briefing was written at
03:59Z the same morning), and **the write path is the only place that scrub
ran** — so every reader printed the stored cells verbatim. Two further sources
were our own: the projection published the ungraded verdict as the headline
*"Not available — insufficient verified evidence"* (RS-3), and the governed
narrative authority both instructed the model to *write "Not available"* and,
on recovery, inserted *"…was not available for this analysis"* into the prose —
on the four newest production reports (12 Sep 2026) that sentence and the
model's echoes of it were the commonest "not available" a client saw. No
`report_engine_config` override exists for any prompt, so the code defaults are
what production runs.

Six rules close it, each pinned by `neverAPlaceholder.spec.ts` or the spec
beside the module:

* **The placeholder scrub is applied where stored content is READ**, by one
  implementation every reader imports — `presentStoredMarkdown`
  (`derivedHygiene.pure.ts`) at the browser projection both presentations draw
  from (`projectRowForPdf`), the template adapter, the legacy server renderer
  and the on-screen document view. It is the write-path rule, not a second
  one; a clean document is returned byte-identical, so a report that never
  carried a placeholder packs, charges and renders exactly as before. This is
  `healFinanceIdentity`'s asymmetry for the same reason: a repair that only
  helps future documents leaves the ones already stored, and no stored byte
  changes. Prose is untouched — the scrub's own contract — because a sentence
  that mentions an absence is the author's, and rewriting prose by pattern is
  how a true statement is deleted from a client's document.
* **An ungraded record publishes no verdict.** Headline, action and the verdict
  sentence are absent, the verdict block draws nothing (`textBlock.html.ts`),
  the cover's Verdict cell is dropped, and the narrative's own recommendation
  prose is what the reader gets. The operator's on-screen viewer still says the
  grade was withheld and why; that surface is not the document.
* **An unscored dimension draws no row.** It used to read "Not assessed" beside
  a dash on every master. Its entry keeps its position (the risk register binds
  `assessment.4.details` by index) and publishes nothing bindable; the verdict
  sentence already names only the dimensions the score carries. The standard
  presentation's score chart refuses the engine's placeholder 50 the same way
  the templated scorecard always did.
* **No prompt asks for a placeholder, an estimate or a confession.** The
  governed authority's directive says leave the figure out together with the
  sentence that would have carried it; its recovery sentences state what the
  analysis RESTS ON ("This analysis does not rely on postcode-level demographic
  statistics; …") rather than what it lacks; the generator's score block hands
  the model only the dimensions that scored and no grade line at all on an
  ungraded record (it used to interpolate `'N/A'` into the prompt, which is how
  "N/A/100" reached prose); "state plainly that transport detail is not
  available" and "use real data or realistic estimates" are gone from every
  system prompt.
* **A chip with nothing to state is not drawn.** `NotAvailable` drew a grey
  "N/A" pill; `UNSTATED_CONFIDENCE` is one predicate for both presentations.
* **The instrument exempts nothing.** `verify:pdf`'s sentinel scan used to admit
  the designed ungraded reading; it now flags the placeholder family in any
  case and spelling, so a document that says "not available" anywhere fails
  the gate rather than passing with a note.

What is deliberately NOT done: no regular expression is run over a client's
prose, on read or on write. A stored Compass report whose model-authored
paragraph says a figure "could not be established" keeps that sentence — 876
of 1,122 carry one somewhere — because a filter blunt enough to remove it
removes true statements too; the editor is where an operator changes prose,
and the generator no longer writes it.

### What the render then showed, and the three rules it added

The first Snapshot rendered clean of placeholders was **seventeen pages** for
a tier whose promise is four to six, and two of its prose headings — "Key
Market Stats", "Score Breakdown" — stood over nothing, because the scrub had
taken their tables. Three rules followed, each measured through the real
journey on Midnight:

* **A heading with nothing under it goes with its table** (`dropEmptySections`,
  in `derivedHygiene.pure.ts`): a section is empty when the next non-blank
  line is a heading of the same or a higher level, or the end of the document;
  a heading over a deeper heading that holds prose is kept; run to a fixed
  point so a parent emptied by its children goes with them. Applied by
  `presentStoredMarkdown` on read and by `condense` and `fork` on write, after
  the placeholder scrub.
* **A derived tier draws only the typed pages the registry gives it**
  (`tierPageSequence.pure.ts`). `sectionRegistry.pure.ts` places each section
  per tier on a surface, and for the four derived tiers only the cover, the
  key-figures strip and — on the Briefing alone — the property identity table
  are `document`; the score breakdown, the financial position, the ten-year
  projection, the risks, the recommendation and the provenance are all
  `markdown`, composed from the same record the typed pages would draw, so on
  those tiers the typed page was a second copy. The rule is read from the
  registry rather than remembered: a typed page is kept where the registry
  places its section on the document surface; the six Compass-depth pages go
  on every derived tier, the property page follows `propertyIdentity`'s
  surface (kept on the Briefing), and the contents page goes on the Snapshot
  alone. Applied in both renderers so the preview and the final agree; the 500
  seeded masters are untouched. Measured: Snapshot 17 → **11** pages, Executive
  Briefing 16 → **11**, Financial Analysis 19, Due Diligence 25; the Compass
  page sequence is not touched by the tier rule.
* **A record that issued no grade draws no page about how the grade was
  reached.** With unscored dimensions drawing no row, the long reference
  report's assessment page — "How the grade was reached — Five dimensions,
  weighted" — was that heading over one dimension's sentence, 70% of the page
  empty under a promise the record cannot keep. `pagesForDocument` drops
  `The assessment` where `recommendation.grade` is absent (the projection
  publishes it only where the policy issued one); a graded record keeps it,
  and data with no Investment tier keeps every page.

And one latent fault the change exposed, in `closeDroppedBlocks`: **one hole
is closed once.** Two dropped blocks with nothing drawn between them are one
hole, from the first's top to the first drawn follower, and the first closes
it; the second had been carried up with the followers to a position ABOVE the
first's top and was then processed as a hole of its own, pulling the followers
up a second time into the block above — the Yield definition landed at 137pt,
inside the section opener at 114pt, instead of at the scorecard's 228pt. A
dropped block whose own top lies inside a hole already closed is skipped, and
`closeDroppedBlocks.spec.ts` pins the assessment page's exact geometry.

What the journeys still flag is stored PROSE: the Executive Briefing's model
note that "market activity metrics … were not provided numerically", the
Due Diligence report's "not provided", the sparse reference report's own
recovery sentence written before this change and the model's echoes of it.
Those are the author's sentences in stored documents, left to the editor and
to regeneration, exactly as the rule above says; the generator no longer
writes them.

**Measured through the real journey on Midnight, 14 Sep 2026** (front end
30/30 on every run, one final render each, `verify:pdf` on the final PDF):

| document | pages | placeholder tokens | remaining sparse pages |
| --- | ---: | ---: | --- |
| A, the long Compass (ungraded) | 39 → **37** | 0 | contents, dashboard |
| B, the medium Compass (graded) | 37 | 0 | contents, risk |
| C, the sparse Compass (ungraded) | 24 | 4, all stored prose | contents |
| Snapshot `8c6edc56` | 17 → **11** | 19 → **0** | none |
| Executive Briefing `89b451f6` | 16 → **11** | 87 → **1**, stored prose | contents |
| Financial Analysis `c21ed1fa` | **19** | 0 | contents |
| Due Diligence `2f1f7f6f` | **25** | 1, stored prose | contents |

The two pages A lost are the assessment page (no grade was issued) and the
last narrative page's fold; the verdict headline "Not available —
insufficient verified evidence" is gone from A's and C's cover and dashboard.

## §9 — RS-5c (14 Sep 2026): the nine other formats onto the fixed pattern

The inventory first (`RS-5b`, measured on the repository and the production
ledgers). Every one of the nine formats — Borrowing Capacity, Portfolio,
Property Comparison, 10 Year Cash Flow, Cash Flow Comparison, Client Details,
Report Q&A, Commercial & Industrial Capacity, Market Intelligence — already
draws its own document with the pinned WeasyPrint engine through its own
`render-<format>-pdf` function (`weasyprintClient.renderPdf`), stores the PDF
in `client-files` (Q&A in `qa_exports`, Market Intelligence in
`marketing-reports`) and writes a `*_renders` ledger row. Four things were not
on the pattern:

1. **A chosen template was drawn by the browser's jsPDF on all nine.**
   `routeReportThroughTemplate` defaults to `renderer: 'browser'` unless the
   caller names the final renderer, and only the Investment delivery did — so
   choosing a template on any other format DOWNGRADED the document (jsPDF
   embeds no fonts and cannot draw text on a filled panel) relative to the
   format's own route.
2. **Every download re-renders.** No format reads its ledger back; Download,
   Send and Publish each mint a new file (`crypto.randomUUID()`, `upsert:
   false`). Market Intelligence is the one exception — a stable path, and the
   scheduled email reuses it.
3. **Cash Flow's "Send to Client" ships the legacy jsPDF** while its "Generate
   PDF" ships the WeasyPrint document: two controls, two documents.
4. **Borrowing Capacity and Portfolio portal publishes upload a second copy**
   to `client-files/portal-reports/…` instead of pointing at the render the
   route stored. Market Intelligence's template selection is unreachable by
   default (`persist` defaults on, and the template path is entered only when
   it is off).

Volume, so the order is honest: in 90 days, 13 Borrowing Capacity renders,
11 Cash Flow, 6 Client Details, 4 Commercial, 3 Cash Flow Comparison, 2
Portfolio, 2 Q&A, 1 Comparison, 0 Market Intelligence — against 62 Investment
finals.

### RS-5c.1 — a chosen template is drawn by the final renderer on every format

Every delivery path now names `renderer: 'weasyprint'` when it asks
`tryTemplateDocument` for a templated document — `deliverSnapshot` (both
paths), `deliverPortfolioReview` (both), `deliverComparisonPdf` (both),
`deliverClientDetailsPdf`, `deliverReportQaPdf`,
`deliverMarketIntelligencePdf`, `useCapacityReport` and the Cash Flow modal's
`exportServerCashFlowPDF` — so the route compiles the template with
`compileTemplateHtmlForPdf` and hands it to `render-template-pdf` in `final`
mode, exactly as the Investment finalisation does; `render-template-pdf` is
format-agnostic (an id that names no investment report is the ordinary case
for the other nine, and is not an error). Every refusal is still a fallback
to the format's own WeasyPrint route. `finalRendererOnEveryFormat.spec.ts`
scans the source: every ask in a delivery module names the final renderer,
and nothing outside a delivery module names it. `snapshotBlob` now returns
the render's `storagePath` beside the bytes, for the portal publish to point
at (RS-5c.3).

### RS-5c.2 — Cash Flow "Send to Client" ships the final document

The Cash Flow analysis had two documents behind two controls. "Generate PDF"
asked the chosen template (final renderer) and then the format's own
WeasyPrint route; "Send to Client" ran the in-browser jsPDF generator with
three chart switches of its own and uploaded THAT to
`investment-reports/cashflow-analysis/…`. So the file a client opened in the
portal was never the document the adviser had generated and reviewed — and it
was a jsPDF (no embedded fonts, no text on filled panels) while the download
was typeset.

One producer now, both exits (`produceFinalCashFlowDocument` in
`CashFlowAnalysisModal`). `describeReviewedProjection` names what the document
is drawn from — the ten years on screen with unsaved overrides, the stored
scenario those years prove, and the template choice read ONCE — and folds them
into a key (`cashFlowFinalKey`, `src/lib/reports/cashFlow/finalDocumentKey.ts`;
a plain module rather than a `.pure.ts`, because the source-of-truth spec
reserves that suffix for bridges onto `_shared`). Generate saves the document
and remembers where the renderer stored it under that key; Send points the
portal at that object while the key still matches, or produces the document
once and points at it. `render-cash-flow-pdf` answers `path` beside the signed
URL now (as do `render-borrowing-capacity-pdf` and
`render-portfolio-review-pdf`, for RS-5c.3), and the client result types carry
it as `storagePath`, null for the legacy generator. The portal resolver already
tries `client-files` and then `investment-reports`, so a route render and a
templated final are both reachable without a copy.

Three rules. **A moved override is a different document** — the key changes on
any cell of any year, on the scenario label and on the template choice, so a
send never ships a document the screen has since left behind
(`finalDocumentKey.spec.ts`). **Nothing is uploaded that the renderer already
stored**: the send's upload survives only for the deployment-gap fallback (the
route absent, jsPDF drawing) and keeps the `resourceId` binding that fixed
audit item 14. **A switch the document cannot honour is removed, never left
dead** — the send dialog's chart toggles reached only jsPDF, so they went
(`CashFlowChartOptions` deleted); the export menu's own chart switches still
govern the legacy download, which stays a named choice. The note "your chosen
template was not used: a template prints the saved projection instead" went
too: it described the world before the payload channel and had become untrue,
and `tryTemplateDocument` already says so itself, naming the gate, whenever a
selection is not honoured. `sendShipsFinalDocument.spec.ts` pins all of it at
the source, because the modal is 6,000 lines of React no unit harness mounts.

### RS-5c.3 — a portal publish points at the render the route stored

`publishReportToPortal`'s own rule is "a generated report is pointed at,
never copied", and its two on-publish renders — a borrowing capacity
assessment, and a stored portfolio analysis whose file upload failed in the
403 era — broke it from the inside. The render route stored and ledgered the
document and answered a signed URL; the publisher fetched the bytes back,
uploaded them a SECOND time to `client-files/portal-reports/…`, and wrote the
portal row with the copy's path. The ledger named one object and the portal
another, and every publish doubled the bytes. A second defect sat beside it:
no Borrowing Capacity surface names an assessment (`{ clientId, clientName }`
everywhere), and `snapshotBlob` handed that bare request to the template ask —
which answers null with no id — so on every publish the chosen template was
skipped and its own "not used" notice fired, while the download beside it
resolved the most recent assessment and honoured the choice.

Both blob helpers answer where the bytes already are now. `snapshotBlob`
resolves the assessment exactly as `deliverSnapshot` does (one
`resolveAssessmentId`) and returns `storagePath` — the templated final's
object in `investment-reports/template-builder/…` or
`render-borrowing-capacity-pdf`'s in `client-files/borrowing-capacity/…`;
`portfolioReviewBlob` does the same for `render-portfolio-review-pdf`'s
`client-files/portfolio-reports/…/typeset/…`, and answers null for the
`stored` variant, which is a file somebody else placed. `publishReportToPortal`
writes the row with that path and reports `uploaded: false`; the upload to
`portal-reports/…` survives only for a document nothing stored — the
in-browser generator on the deployment-gap fallback — and is reported as
`uploaded: true`. The portal reader (`get-portal-client-data`) is unchanged:
it signs `client-files` first and `investment-reports` second, so a route
render and a templated final are both reachable, and `pdf_file_path` is still
never written. `publishReportToPortal.spec.ts` (new) pins the four on-publish
cases and the already-filed case; `templateRouteWiring.spec.ts` pins the path
travelling through both helpers on both the templated and the flowing path.

Three rules. **Where the bytes already are is part of the answer** — every
helper that produces a client document says it, because a caller that is
not told will copy. **One object per finalisation**: the path the ledger
carries is the path the portal serves, so a `*_renders` row and a
`client_portal_reports` row describe the same file. And **a copy survives
only for what nothing stored**, said in the outcome rather than assumed.

### RS-5c.4 — Market Intelligence honours a chosen template on every call

`deliverMarketIntelligencePdf` entered the template path only for
`persist: false`, to protect `pdf_storage_path` — the column
`dispatch-marketing-reports` attaches to a scheduled email, which the template
route does not write. But `MarketIntelligenceDownloadButton` defaults
`persist` ON. So on the one control that produces this document a chosen
template was never drawn, silently, while the picker inside the same popover
said the choice was kept.

Measured on production before deciding how far to go (14 Sep 2026): 8
market intelligence reports, none with a stored PDF, no
`market_intelligence_renders` row ever, no `marketing_report_schedules` row
ever, no dispatch ever logged; and of 60 succeeded `final` render jobs in
`template_render_jobs`, none yet carries the `report_id` RS-2 started writing.
Nothing downstream is fed by the column today. So the template is drawn for
every call, and the stored copy is SAID rather than substituted: a templated
document is stored by `render-template-pdf` (`templatePath`), the column is
left untouched, `persisted` is false, and when the person had asked for the
stored copy the button says "drawn from your chosen template; not saved for
the scheduled email, which attaches the standard layout". The flowing route
and its `persist` semantics are unchanged for a format with no template
chosen, and the scheduled dispatch is untouched.

The step deliberately not taken: making the dispatch attach the newest
templated final for the report (read from `template_render_jobs` by
`report_id`, compared by time against the flowing route's ledger row) would
close the remaining gap — the emailed document and the downloaded one being
the same — but it adds a second ledger read to a cron path that has never
run, that the journey harness cannot drive, and that nobody has scheduled.
It is the change to make the day a schedule exists, and it is a small one.

Two rules. **A choice gated on a default is not a choice** — a knob whose
default disables the person's selection has to be measured against how the
control is actually pressed, not against what it protects. And **an
untouched column is said, never implied**: `persisted` stays the column's
fact, `persistRequested` carries what was asked, and the difference reaches
the person at the moment it happens.

### RS-5c.5 — the other formats driven through a real browser, one at a time

The Investment journey (`run.mjs`) drove one format. The other nine had
never been through a browser, so the same harness now takes a format:
`scripts/verify/report-journey/run-format.mjs --format <cashflow|market_intelligence>
--record <id> [--template <id|name>]`, on the same `supabaseDouble.mjs`. The
double grew what those pages read — `tables/<table>.json` fixture rows,
PostgREST reads (`eq`/`in`/`order`/`limit`, the single-object 406 that
`maybeSingle` reads as "no row"), `get-client-data` in list mode,
`manage-ci-assessments`, the `authenticated-data/<table>` gateway, and
`global_report_settings` from the fixtures — and each format declares
`answers` for the vendor and model calls its page fires on mount (Meta
insights, the agent model list, automation settings), so the page mounts with
no network and no credential. What it does not recognise still fails the run.

Results, 14 Sep 2026, against the pinned WeasyPrint 69.0, on non-client rows:

| format | record | template | front end | render | document |
| --- | --- | --- | --- | --- | --- |
| Cash Flow | `09f8569e` | Private Banking — Chancery `4af70118` | 22/22 | 1 final, of the chosen template; Send re-used it (0 more); portal row = the render's path | 10 pages, 0 hard findings |
| Cash Flow | `09f8569e` | Corporate Advisory — Board Pack Brief `ebb636c9` | 22/22 | as above | 10 pages, 0 hard findings |
| Market Intelligence | `c4d22645` | Private Banking — Chancery `70d29782` | 18/18 | 1 final, of the chosen template, with `persist` at its default (on); the toast said the scheduled email's copy was untouched | 41 pages, 0 hard findings |

The Cash Flow Chancery master sets one topic to a page, so six of its ten
pages read SPARSE to the instrument; that is the catalogue's decision and is
recorded, not changed.

**What the Market Intelligence document found**, each fixed at the cause:

1. **The contents ran under the running foot.** 41 entries in one column.
   `blocks/tocFit.ts` fits a contents list to the room it has — one column,
   then two, then the type shrunk to a floor of 0.8, then cut with a closing
   "… and N more sections" — and `toc.html.ts`, `toc.ts` (the preview) and
   `autoToc.html.ts` all read it, so the three cannot disagree about what fits.
2. **A delimiter row of 123,913 dashes spent the whole budget.** `layer5_outlook`
   is 124,671 characters in ten lines; the renderer's delimiter test is
   length-agnostic, so the table was well-formed, the 65,536-character cap fell
   inside that row, every body row after it was cut, and the header plus the
   truncated separator printed raw. `markdown.pure.ts` now rewrites any
   delimiter row longer than 96 characters to its canonical cells BEFORE the
   cap (`notices.delimiterRowsNormalised`); the long row and the short one
   render byte-identical, because alignment is the only thing a delimiter row
   carries.
3. **The sources table wrapped past its page.** Twelve rows were budgeted at
   one line each and source names run long. `fitCitationRows` fits by LINES
   (84 characters to a line on this measure) — the fixture shows six and says
   "54 further sources" rather than overflowing.
4. **A table the model started and never filled printed as pipes.** Header,
   delimiter, end of text — the scanner fell through to the paragraph path and
   `| Factor | Risk Level | … | :--- |` reached the page. An empty structure is
   nothing to show: the two lines are consumed and counted in
   `tablesRejected`, and the heading left standing over nothing goes with it
   under the module's own empty-heading rule. `reportQa/__tests__/markdown.spec.ts`
   was renegotiated on exactly that line — a malformed table WITH body rows
   still keeps its words as a paragraph, because those words are the model's;
   an empty one prints nothing.
5. **Two icon-only controls had no accessible name** — the Report History button
   on the Market Intelligence export and the typeset button at icon size. The
   journey finds controls by role and name, as a screen reader does, and could
   not find either; both carry an `aria-label` now.

**What it found and did not fix here** (RS-5c.6): Market Intelligence has no
narrative profile — `resolveNarrativeProfile` answers null for it — so its
thirteen markdown runs pack with the legacy line estimate at
`linesPerPage: 34` against a box that holds about 46 lines, and the estimate
over-charges on top. Measured on the render: continuation pages 20–40% full
(pages 23 and 24) while the layers under them are clipped by 6, 9, 14 and 9
pages; page 24 ends on the heading "Subdivision Potential:" over nothing; and
4 of 41 pages (10, 17, 21, 25) carry nothing but the "This section continues"
callout, which the composer gives a page of its own. Ordered lists whose
items carry nested bullets (`1.  **…**` over four-space `*` children, the
source of layer 8) restart at "1." on every item. All of it is the
renderer's to fix without touching a stored row or re-seeding a master, and
it is the next step.

Two things about the surfaces are recorded rather than changed. The Market
Intelligence export door is gated on Meta insights — `MarketCorrelationPanel`
mounts only when ads data exists — so a deployment with no Meta connection has
no typeset export for this format. And four formats were not driven at all:
borrowing capacity, portfolio, client details and commercial capacity have no
non-client row in production (every row names a client; the demo clients hold
none), and the harness renders no client's record locally. They stay verified
by RS-5c.1 and RS-5c.3's specs and are the first to drive the day a non-client
record exists. Comparison and Report Q&A follow in RS-5c.5b.

Four rules. **A budget is spent on information**: a delimiter row carries
alignment and nothing else, so its length is normalised away before anything
is counted against a cap. **An empty structure is consumed, never printed as
its own markup.** **A list of unknown length fits its box or says what it left
out** — the contents and the sources now answer to the rule the layers already
did. And **a control with no accessible name is a control a journey cannot
find**, which is the same thing as a control a screen reader cannot find.

### RS-5c.5b — the Comparison and Report Q&A journeys

The runner grew two formats (`--format comparison`, `--format report_qa
[--subject transcript|structured]`) and the double the reads their pages make:
one comparison by id through `get-investment-reports`, the library's
comparison list through `manage-templates`, the Q&A page's `get-conversations`
/ `load-conversation`, the author-name lookup, a HEAD count with
`Prefer: count=exact` answered in `Content-Range` (the Q&A adapter's
`hasAnswer`), and module grants for the pages these controls sit behind.
Fixtures are non-client rows: comparison `23cc7e34` (three NSW properties, no
client) and conversation `a2400de4` (a strata by-law question, `client_id`
null, four exchanges, the largest answer 94,256 characters).

Results, 14 Sep 2026, WeasyPrint 69.0:

| format | template | front end | render | document |
| --- | --- | --- | --- | --- |
| Comparison | Private Banking — Chancery `23b7e18b` | 17/17 | 1 final, of the chosen template, from the library card's menu | 14 pages, 0 hard findings, 0 placeholders |
| Report Q&A — transcript | Private Banking — Chancery `ae7734d5` | 17/17 | 1 final, of the chosen template | 13 pages, 0 hard findings, 0 placeholders |
| Report Q&A — structured | `ae7734d5` chosen | 14/14 | **0 template renders, 1 call to `render-report-qa-pdf`** | the route's own document |

**The structured write-up was a finished-looking shell.** Before this step the
templated path routed the structured subject whenever a write-up was stored
and produced, for a conversation holding a 5,460-character `structured_report`,
a cover, "The question" with the note *"This document carries 0 of 4
exchanges; 4 are not shown"*, the sources page and the back cover — the
write-up nowhere in it. The cause is two decisions that are each right on
their own: the projection deliberately never publishes `structured_report`
(two answers to one question on a page), and every content page of the Q&A
masters binds `qa.answer`, the FIRST turn's reply. Neither side had a page for
the write-up, so the document was real and empty. `qaAdapter.resolveRoutingContext`
now declines the structured subject and the delivery falls through to the
route that draws it; the button's note says the write-up comes out in the
standard layout; `qaStructuredNotTemplated.spec.ts` pins the refusal AND
watches the composer, so the day a master binds the write-up the test fails on
purpose and the refusal is the line to remove. The runner learnt the shape
too: a subject a format produces through its own route is checked for exactly
that — no template render, one route call — and the route's document is not
the double's to measure.

**What the transcript document shows, carried to RS-5c.6.** The Q&A masters
draw one answer over eight pages and a table of the further questions; the
payload's transcript budget (`MAX_TRANSCRIPT_LINES` 950 in the legacy line
estimate, `MAX_TRANSCRIPT_CHARS` 50,000) cut this conversation to ONE
exchange, so the "rest of the conversation" table — the only place the other
three questions appear — did not draw at all, and the first answer, estimated
at 26 pages, was cut at 8 while every one of those pages was 47–57% empty and
the "Not the whole answer" notice took a page of its own (page 11, 78% empty).
It is the same fault as Market Intelligence's: the format has no narrative
profile, so the block packs at 34 estimated lines against a box holding about
46, and the budgets are stated in those same estimated lines. One fix serves
both formats and is the next step.

**What the comparison document shows, recorded for the catalogue.** 0 hard
findings and no placeholder, and 10 of 14 pages SPARSE: the Chancery
comparison master gives each analysis axis a page — return, catchment,
amenity, exposure, reward — and this comparison holds one or two rows on each,
so five consecutive pages carry a heading and a sentence or two (page 7 is 74%
empty). Two of them share the heading "Who wins on location, and why". Nothing
here is the renderer's; a master that let short axes share a page is a
composer change for future seeds, noted rather than made.

Rules. **A route that cannot draw the subject must decline it, not draw a
shell** — an empty document that looks finished is the worst of the three
outcomes, behind both the standard layout and an error. **A refusal is pinned
to its cause**: the test that holds the refusal also watches the thing whose
absence justifies it. And **a budget is stated in the units the page is
measured in**, which is the rule RS-5c.6 has to make true.

### RS-5c.6 — Market Intelligence and Report Q&A packed by the template's own geometry

The fix the two previous steps measured their way to. Neither format had a
narrative profile, so every one of their markdown runs packed with the
legacy line estimate at 34 lines against a ~46-line box, and the estimate
over-charges: MI continuation pages 20–40% full while the layers were
clipped by 6/9/14/9 pages and 4 of 41 pages carried only the "continues"
callout; Q&A answer pages 47–57% full, the answer cut at 8 of an estimated
26 with the cut notice on its own page, and the transcript budget cutting a
four-exchange conversation to one so the further-questions table never
drew. `docs/reports/NARRATIVE_PACKING.md` §7 carries the design; this
records the effect.

| document | before | after |
| --- | --- | --- |
| Market Intelligence, Chancery `70d29782` | 41 pages; notes "6 / 9 / 14 / 9 further pages"; 4 stub pages (10, 17, 21, 25); every numbered step "1."; 30 SPARSE | **36 pages**; notes "2 / 4 / 6 / 3 further pages", each at the foot of its section's last page; 0 stub pages; steps numbered 2…9; 12 SPARSE (section openers and content-limited pages) |
| Report Q&A transcript, Chancery `ae7734d5` | 13 pages; answer pages 47–57% full; cut note on its own page ("runs to 26 pages"); "carries 1 of 4 exchanges"; further-questions table absent | **13 pages**; answer pages full; cut note at the foot of answer page 8 ("runs to 17 pages"); "The first exchange is set in full; 3 further questions are listed without their answers"; the table lists them |
| Cash Flow `09f8569e` ×2, Investment A Chancery | 22/22, 22/22, 30/30 | unchanged — 22/22, 22/22, 30/30 |

All at the renderer. No stored `report_templates` row changed, no master
re-seeded, no projection estimate altered: `geometryAwareFormat` names the two
formats; `planNarrative` reads each run's pages path off its continuation
conditional (`marketIntel.layers[0].pages > n`, `qa.answerPages > n`), writes
the true count there with arrays kept as arrays, recognises the master's own
note page, clears its key and folds the note — counts rewritten to the
truth — onto the last allowed page through a `PageReserve` the packer holds
back; ordered lists keep their bulleted sub-points nested and their number
(nesting by rank of indentation; the resumed ordinal written as
`counter-reset: list-item`, which WeasyPrint 69.0 reads where it ignores
`<ol start>`; `styleTags` merging a tag's own style); and the templated Q&A
transcript keeps every turn (`keepAllTurns`) with the note saying what the
document sets.

Two harness findings on the way. The Investment runner's send step looked
for a button named "Send" after RS-5c.2 renamed it "Prepare & Send" — the
journey aborted at the click, 22/22 before it; the locator accepts both. And
the double's gateway read answered an unknown table with nothing, where the
generic answer it replaced had said "no rows": a table with no fixture rows
IS a table with no rows, and the Investment page's `report_structure_templates`
read is not a page nothing answered. Both are `scripts/verify/report-journey`
changes, not product changes.

What stays open, recorded: the remaining SPARSE pages on MI (a section opener
with one paragraph, two-page event calendars, the sources page) and on the
comparison master (one axis to a page) are the composers' decisions and
content-limited pages; a heading the pre-pass folds a note under could
theoretically leave its own page short by the note's height, which
`balanceTail` already smooths. The next step on this branch is the RS-5
closing report.
