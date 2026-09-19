# Reporting Engine audit — September 2026

A full end-to-end audit of the reporting engine, conducted stage by stage with the
product owner: architecture → data injection → generation pathways → template
selection and white-label → practical rendering. This file is the durable record
of what was measured and found. **No behavioural change ships with this
document** — every fix is listed for the consolidation programme, and anything
that hides or retires a legacy pathway explicitly awaits the owner's
authorisation.

Method: the docs in `docs/reports/` were read first and then re-verified against
the code and against the **live production database** (read-only). Rendering
claims were verified by rendering: the pinned engine (WeasyPrint 69.0) with the
container's own typefaces, the repo's measurement tooling, real production rows
through the real projections and templates, and a page-by-page review of the
result. Every load-bearing number below is a fresh measurement dated
2026-09-02, not a quotation of an earlier doc.

**Picking this up cold?** Read
[`REPORTING_ENGINE_HANDOVER.md`](./REPORTING_ENGINE_HANDOVER.md) first. This
file records what was measured; that one records where the work stands, what
is blocked, and which facts must not be re-derived.

---

## 1 · Architecture census

Two layers, separate in code and time:

**Generation** (content): `generate-investment-report` writes model-authored
Markdown into `investment_reports.report_content` under a wall-clock budget with
three resume drivers (browser pump, bulk worker, 2-minute cron watchdog). Other
formats are deterministic calculators plus bounded model prose. Sub-reports
derive from a Compass parent: **fork** (`fork-investment-report` — deterministic
section split via `_shared/reportSplitRegistry.ts`, no model calls, idempotent,
inherits the parent's data wholesale) and **condense**
(`condense-investment-report` — model-condensed briefing/snapshot, regenerates
in place).

**Rendering** (documents): five engines exist in live code.

| # | Engine | Carries |
| --- | --- | --- |
| 1 | WeasyPrint via nine per-format design-system routes (`render-*-pdf`) | the migrated formats' standard documents |
| 2 | WeasyPrint via `render-template-pdf` (browser compiles HTML through `compileTemplateHtmlForPdf`) | chosen-template documents |
| 3 | WeasyPrint via `render-investment-report-pdf` — 5.7k-line monolith, own inline THEME, own private client, Api2PDF fallback | nearly all Investment volume |
| 4 | pdf-lib in Deno ×2 (`quantitative-report-pipeline`, legacy export inside `report-qa`) | quantitative reports; legacy Q&A export |
| 5 | ~17 live browser generators (jsPDF / html2canvas / pdf-lib) | the legacy side of most formats; record nothing |

Storage: `investment-reports` (two producers), `client-files` (six routes),
`marketing-reports`, `qa_exports`, `quantitative-reports`, `converted-templates`;
all report PDFs served by signed URL (TTLs vary: 7d legacy / 24h routes / 15-min
`secure-storage` ceiling). Ledgers: nine `*_renders` tables +
`template_render_jobs` + `template_events`.

Two unrelated systems share the word "template": `report_templates`
(presentation / white-label) and `report_structure_templates` (generation-time
structure guides). They never touch.

## 2 · Live measurements (2026-09-02)

- Coverage (per `COVERAGE.md`'s own query): investment **1,174 / 0** via design
  system; report_qa 255/2; portfolio 26/2; market_intelligence 7/0.
  **The coverage query cannot see the templated path** — it counts `*_renders`
  ledgers, while template renders land in `template_render_jobs` (127 rows, 114
  succeeded, successes for `investment_compass` and `commercial_capacity` on the
  audit date). `investment_report_renders` has **no writer anywhere in the
  codebase**, so that cell can never move.
- Templates: 10 active global WeasyPrint masters (one per format spelling,
  "Private Banking — Chancery") + 4 active user-scoped adoptions; 96 legacy
  jspdf rows deactivated. 4 stored selections, all valid.
- Downloads, last 45 days: `premium_weasyprint` 24 (legacy investment route),
  `cash_flow_server` 11, `cash_flow_template` 7, `report_viewer` 6 (browser),
  `pixel_perfect_generator` 1.
- `investment_reports`: 1,174 completed / 18 failed / 1 stale pending (the
  resume watchdog works). 17 new reports in 30 days.
- Sub-reports in production: snapshot 25, briefing 22, financial 10,
  strategic 10 — all four active on the audit date.

## 3 · Findings register

Class key: **D** data/content · **P** pathway/delivery · **T** template/white-label · **R** rendering.

| # | Class | Finding | Evidence / location |
| --- | --- | --- | --- |
| F1 | D | `financial_calculations` injection unreliable: 190/1,174 rows overall; 71% of Compass rows since June; no record of why any row lacks it | live DB; `generate-investment-report` phase 2 |
| F2 | D | Stored record contradicts itself: `keyMetrics.annualNet/weeklyNet` vs `projections.moderate[0].cashFlow` agree on **0 of 162** rows, median gap **$24,793**; legacy renderer prints the keyMetrics side, templates print the series | `cashFlowProjection.pure.ts` header; `render-investment-report-pdf` exec summary |
| F3 | D | Overrides go stale: saving `manual_overrides` does not recalculate; legacy renderer references the column **zero** times; only `{{overrides.*}}` carries corrections and no master binds it. 435 rows (37%) carry overrides | `ManualDataOverrideModal.tsx:1174`; grep of legacy renderer |
| F4 | D/T | Brand baked into content: generator writes `# BRAND / YOUR DEDICATED PROPERTY PARTNER / Investment Report: …` into `report_content`; `narrative.source` republishes it verbatim, so templated documents print a second, generation-time cover inside the body (verified on a real render — including the literal heading "Cover Page") | `generate-investment-report:5311`; `compassSectionRegistry.ts` cover section `includeInCompass: true` |
| F5 | D | Missing source data is silent: Phase-1 service failures only log to console; nothing on the row records completeness | `generate-investment-report:2541-2575` |
| F6 | P | The two investment pathways differ in **content**: legacy adds a self-authored executive summary, an "Editor's Note", and hero photography; the templated path has none of these | `render-investment-report-pdf:3025-3055`, hero reads at `:2702-2730` |
| F7 | R | Charts drawn by two implementations (legacy's 11 private SVG renderers vs shared `vizFigures`) | both files |
| F8 | D | Reports unlinked from clients: `client_property_id` on 2/1,174; no client name on the row | live DB |
| F9 | P | Two engines answer to "Financial": `TierSwitcher` generates it via condense (model) while `ReportVariantControls` forks it (deterministic); both address the same child row and regenerate in place | `TierSwitcher.tsx:99`; `ReportVariantControls.tsx:30`; `condense-investment-report:404` |
| F10 | P | Sub-reports go stale silently: children refresh only on click; nothing compares child freshness to the parent's `updated_at` | `fork-investment-report`, `condense-investment-report` |
| F11 | P | The report page's primary "Download" produces a **.txt dump**; the PDF exits live lower in the export panel | `InvestmentReportView.tsx:136-151` |
| F12 | P/T | **Send to Client / client portal never receive the templated document**: they ship stored `pdf_url` (written by legacy route *or* browser generator, whichever last) or a fresh browser PDF | `SendToClientModal.tsx:159-199`; `InvestmentReportView.tsx:282`; `PortalReports.tsx:82-114` |
| F13 | T | The template invariant is process-enforced only: binding expressions permit arithmetic (`{{=financials.x * 1.1}}` passes `SAFE_EXPR_RE`), so nothing mechanical stops an approved template computing a figure | `bindingResolver.ts:193` |
| F14 | T | `client_branding_profiles` (the Templates → Branding tab) is a decoy: nothing in the reporting engine reads it | `BrandingManager.tsx`; grep of `applyOrganisationAndBrand` chain |
| F15 | T | `whitelabel_settings.company_name` stored with trailing space (no visual effect — the projection trims; data hygiene only) | live DB |
| F16 | P | Market Intelligence scheduled email has nothing to attach: `pdf_storage_path` is 0/7 (only the unused server persist path writes it); the labelled "Generate Report" button is the browser jsPDF path, which persists nothing | live DB; `MarketIntelligencePDFGenerator.ts` |
| F17 | D | Model prose contradicts structured facts: a real report states "3 bedrooms" (×3, including the closing summary) for a 4-bedroom subject; nothing reconciles prose against `property_specs` on any pathway | real render, pages 27/28/32 |
| F18 | R | Truncation leaves skeletons: `truncateNarrativeToCap` keeps headings while deleting their prose and appends a literal "…" — nine content-less headings and eight severed sentences on one real document | `compassPostProcessor.ts:190-210` |
| F19 | R | Markdown paging under-fills by ~2×: fixed `DEFAULT_LINES_PER_PAGE = 34` undershoots the rendered frame; 26 consecutive pages at 30–60% full; lead-in lines stranded above white | `reports/markdownPaging.pure.ts:16` |
| F20 | R | Loose ordered lists render as separate `<ol>`s — a 15-item checklist numbered "1., 1., 1., …" | `reports/markdown.pure.ts:985-1012`, `listHtml` ~`:1245` |
| F21 | R | A table row can be clipped with its continuation drawn above the running head and lost — observed mid-word on a real risk register | real render, pages 29→30 |
| F22 | D | The money page doesn't foot: upfront total $500 short of its own column; net position $2,176 off the visible rows (stored totals vs stored lines) | real render, page 6; `financial-calculator-service` outputs |
| F23 | R | The company/back page renders in a different palette and typeface from the template family around it | real render, page 36 |
| F24 | R | Footnote syntax (`[^abs]`) prints as body copy — no footnote handling in the Markdown renderer | `reports/markdown.pure.ts` |
| F25 | R | Part numbering counts pages, not sections: running heads reach "Part 49" on an 11-section document; two pages share "07" | `reports/investment/render.pure.ts:380` |

Minor (unnumbered): display heading overrun on one risk page; duplicated
headings 16 pages apart; pseudo-tables flattened to bullets; raw scoring-band
strings ("Good walkability (50-69)") and enum values reaching client prose;
mixed minus glyphs; "andother" missing space; contents labels disagreeing with
page headings.

## 4 · What verified sound

- **The template invariant holds on real data**: one live Compass row rendered
  through two families produced 81 currency/percent figures each, identical
  except each family's KPI strip curating a different *published* figure.
  Switching templates changes presentation only.
- **The selection chain**: 159 repo tests pass (route enforcement, resolver
  parity ×3, selection rules, seeded master through the real render boundary,
  font policy, brand-mark rules, adoption idempotency). Selections are re-read
  and re-validated server-side; stale choices fall back with a notice.
- **White-label sources are live and correctly keyed**: `report`/`reportMono`
  logo slots uploaded and matching the resolver's spelling; ABN, address,
  phone, disclaimer present in `global_report_settings`.
- **Typed design-system pages are professional**: fixture harness renders all
  formats with zero high-severity findings; real cash-flow tables are
  immaculate (banded, aligned, unwrapped numerals, semantic negatives).
- **The sub-report mechanism**: fork inheritance, idempotency, and one
  selection driving the whole family (compass + tiers fold to one key, active
  masters exist under both raw spellings).
- **Pipeline health**: watchdog keeps `investment_reports` at 1 stale row;
  production template renders succeeded on the audit date.

## 5 · Pathway / duplication register

**Same report, competing engines (user-visible):** investment's six exits
(.txt, template route, legacy server route, browser pdf-lib, Send-to-Client,
listings-modal jsPDF); Q&A's two exporters; Comparison's model-rewrite-per-
download beside the deterministic route; Market Intelligence's labelled jsPDF
button vs typeset popover; Cash Flow's four PDF exits; Client Details' Formara
twin; `FlattenPdfIconButton` on 18 surfaces. Commercial Capacity is the
consolidated model: one road.

**Same logic, multiple copies:** cash-flow cascade ×3 (the F2 divergence);
template resolver ×3; report-type normaliser ×2; chart primitives ×2;
browser/server calculator mirrors (`lenderLvrCaps.ts` and
`capitalAllocationLedger.ts` measurably drifted); orphaned
`buildTemplateBindingContext.ts` (three documented defects, zero callers);
drifted `compassSectionRegistry` mirror (672 vs 174 lines).

**Same name, different product:** "Financial" (F9); two unrelated "10 Year
Cash Flow" reports (investment modal vs commercial calculator print view).

**Dead but shipped:** `EnhancedInvestmentReportModal`, `QAPDFGenerator`,
`HybridPDFTemplate`, `StrictPDFTemplate`, `ClientPDFTemplate`,
`reportTemplate/pdfRenderer.ts`.

## 6 · Consolidation programme (draft — sequencing for owner sign-off)

Priorities agreed during the audit: accuracy · consistency · reliability ·
template compatibility · rendering quality · user experience. Legacy pathways
stay reachable throughout; **hiding them is a later, separately authorised
step**.

**A — Narrative channel (fixes most of what a client sees; small, local):**
exclude the Cover Page section from Compass assembly (the contents section
precedent is recorded in the registry's own header); truncation drops a heading
with its prose and never emits "…"; calibrate/measure markdown paging against
the rendered frame + keep-with-next for lead-ins; merge loose ordered lists and
carry `start`; strip or render footnote syntax; number parts by section, not
page; keep table rows whole across breaks; theme the company page from the
template family.

**B — Data-layer reconciliation (accuracy):** reconcile model prose against
`property_specs` at the enrichment boundary and fail loudly (F17); make
`financial_calculations` internally consistent or publish one side only (F2,
F22); record per-source fetch outcomes on the row (F5); regenerate-on-override
or stamp staleness (F3); investigate and alarm on missing fincalc (F1).

**C — Delivery unification (reach):** route Send-to-Client / portal / scheduled
sends through the same template-first delivery the downloads use (F12, F16);
make the report page's primary Download produce the document, not a .txt
(F11); single writer for `pdf_url`.

**D — Sub-report cascade:** one engine per variant name (fork for
financial/strategic, condense for briefing/snapshot — remove `financial` from
condense's accepted tiers or repoint `TierSwitcher`) (F9); staleness marker
against the parent (F10); regenerate children on parent regeneration or offer
one-click "refresh family".

**E — Invariant hardening:** refuse arithmetic over financial namespaces in the
production template guard (F13); retire or wire `client_branding_profiles`
(F14); write a `report_render_events` row from legacy paths and include
`template_render_jobs` in the coverage measure so the number tells the truth.

**F — Later, upon authorisation:** hide (not delete) the legacy generators
behind the unified delivery; retire dead components; fold the duplicated logic
copies onto their canonical modules.

## 7 · Reproduction

- Fixture harness: `npx tsx scripts/reports/renderAll.mts` (WeasyPrint 69 +
  `weasyprint-service/fonts/` installed locally; poppler-utils for
  `pdftoppm`/`pdftotext`).
- Real-row template render: build the projection data exactly as
  `scripts/template-library/productionFit.ts` does (`investmentData`), render
  with `renderTemplateToHtml(schema, { data, fontSource: 'container' })`, and
  measure with `scripts/reports/measure_pages.py`.
- Live counts: the SQL in `COVERAGE.md`, plus `template_render_jobs`,
  `report_template_selections`, `report_templates` grouped by
  engine/scope/active.

## 8 · Phase 0 + Phase 1A — implemented (2026-09-02)

The first two phases of §6's programme shipped together, and every number
below was re-measured on the same two production rows §5 measured, so the
before and after are the same instrument.

### Phase 0 — the measure

`public.report_render_coverage` (migration `20260915100000`) unions the nine
`*_renders` ledgers, `template_render_jobs`, and engine-tagged
`activity_logs` events into one engine × format × week matrix. The write side
is two pieces: `src/lib/secureInvoke.ts` auto-tags every successful
`render-*-pdf` / `render-template-pdf` invocation (the meteredFetch pattern —
coverage a new call site cannot forget), and `src/lib/reports/renderEvent.ts`
is the explicit helper for the ledgerless pathways, wired into the stored-PDF
chokepoint (`clientPdfDownload`), Formara, the Market Intelligence jsPDF
buttons and the portfolio pdf-lib generator. Remaining minor surfaces (print
views, flatten buttons, the QA editors, the commercial/industrial utils, the
listings modal) are listed for the same one-line treatment in the follow-up.

### Phase 1A — the narrative channel, calibrated and cleaned

`scripts/reports/markdownCalibration.mts` is the new measuring instrument: it
rendered probes through the real seeded Chancery master twice — pager in
charge, then bucket cap lifted — and found the pager sending every narrative
page at **40–47% of its measured capacity** (~54.5 rendered line-units per
continuation page, ~42.5 on the first; prose wraps at ~98 chars, the charge
model said 65). That under-fill was every "large sectional gap".

What changed (all charge-model changes are opt-in per format via
`resolveNarrativeProfile`; every uncalibrated caller is byte-identical):

- **Measured charges + calibrated budgets** for the investment narrative
  (`markdownPaging.pure.ts`, `markdown.pure.ts:charging`), resolved
  identically by the markdown block and the projection so the conditional
  page count and the drawn buckets cannot disagree. The deployed schemas'
  baked `linesPerPage: 34` is read as the legacy sentinel.
- **Keep-with-next**: a page never ends on a heading or a lead-in line
  ending in a colon.
- **Tables split by rows with the head repeated** when taller than a page
  (`splitTableBlock`), charged by real cell wrap — the clipped risk-register
  row (F21) is structurally impossible now.
- **Loose lists merge** (fifteen "1." items are one list again) and ordered
  runs keep their opening number (F20).
- **Footnotes render**: `[^id]` becomes a superscript with a Notes list;
  a citation-shaped ref with no definition strips instead of printing (F24).
  `sup.fn-ref`/`ol.fn-notes` joined the print stylesheet's vocabulary.
- **Skeleton headings drop** (`dropEmptyHeadings`, default on) and the
  word-cap truncation now cuts cleanly: no heading survives its deleted
  prose, no literal "…", while figures and tables still always survive
  (F18, and the standing figures-and-tables rule).
- **The baked cover is gone twice over**: `compass.cover` is excluded from
  generation (the contents-section precedent), and
  `reports/investment/narrativeClean.pure.ts` strips the masthead and
  "Cover Page" section out of the 1,100+ stored narratives at read time, on
  both sides of the contract (F4).
- **Scorecard band jargon is cleaned at the projection** — "Good walkability
  (50-69)" publishes as "Good walkability" (the F-series readability item).

Measured on the same rows as §5: 48 Budgeree via the user's selected
Dictionary master went **36pp → 22pp, median body ink 0.055 → 0.111**, with
every narrative page inside the native 0.10–0.13 band, zero cover/masthead
artefacts, zero footnote syntax; the 6 Acer Court financial fork via Chancery
went **21pp → 15pp, median 0.097**, risk register split with repeated heads
and no severed row. The remaining sparse pages are the typed fixed-geometry
pages (contents, dashboard, property, sources) — Phase 1B's schema-side
economy work, alongside the part-numbering and back-page theming that also
live in the seeded schemas.

### Phase 1B — the schema-side pass (2026-09-02, same day)

- **One part number for the whole report body.** Every narrative continuation
  page minted its own — running heads marched "Part 08 · Report" through
  "Part 33", and Sources introduced itself as Part 49 with a two-inch numeral.
  The opener mints the label once and every continuation (and the cut page)
  carries it verbatim; a Compass now runs Part 01–09. The labels are baked
  into schema furniture, so the fix ships as the v9 catalogue seed
  (`20260916100000`) plus a reactivation migration (`20260916110000`) that
  refreshes every active row from its published entry — the same mechanism,
  guards and colourway-exclusion as `20260816150000`, with a probe that no
  active investment schema still carries "Part 15 · Report".
- **The closing page dresses in the family's tokens.** `disclaimer.html.ts`
  hardcoded a foreign ground (#141414), one of the audit's eight stray golds
  (#BF9B50) and a Helvetica fallback — the critic's "back cover from a
  different design system". It now reads the colourway (`bg`,
  `accentOnField`, `text`, `mutedOnField`, the heading face), with the old
  literals as fallbacks so token-less templates render unchanged. The
  split wordmark (every word large, the last small beneath — "SERVICES" as a
  subtitle) is one name at one size in the family's heading face.
- **Deliberately not done here, and why:** the typed front-matter pages
  (contents, dashboard) measure sparse and are left so — front matter in a
  premium document is airy by intent, and densifying it is a family-design
  decision for the Claude Design catalogue, not a defect fix. The data-sparse
  typed pages on financially-empty rows are queued with Phase 2's
  completeness work, where the row-level `when:` guards already carry most of
  it.

## 9 · Phase 2 — accuracy gates (2026-09-02)

Phase 2 set out to make the Investment report's figures one truth end to end.
Reconnaissance for it found something larger than the divergence the audit
had measured: **every stored 10-year projection series was charging the
property's operating costs roughly three times over.**

### F26 — the projection fold triple-charged operating costs

`generateProjections` (financial-calculator-service) folded
`Object.values(annualCosts)` into its cost base, and that object carries its
own totals (`totalAnnual`, `totalAnnualExcludingLandTax`) and a percentage
beside the line items — so the opex base was
`2·totalAnnual + totalAnnualExcludingLandTax + percent`. Proven to the
dollar on the captured production row ($1.19M NSW house, rent $739/wk):

|                                   | stored | honest |
|-----------------------------------|--------|--------|
| Year-1 operating costs charged    | **$59,931** | $22,232 (totalAnnual × 1.038 CPI) |
| Year-1 cash flow (moderate)       | **−$92,557** | −$54,858 |
| Year-1 ROI                        | **−18.89%** | −3.05% |
| 10-year cumulative position       | overstated by ~**$370k** | — |

The buggy base reconstructs exactly: 2×21,418 + 14,893 + 7 = $57,736, and
×1.038 (that day's cached year-1 CPI) = $59,930 ≈ the stored charge. The
headline `keyMetrics` used a third base (un-escalated, land tax out), so one
page contradicted itself by $43,885/yr — and the generator's prompt injected
the poisoned series verbatim as the cash-flow table the model transcribes,
directly under a stated formula ("rent − operating costs − repayments")
whose quoted operating costs were the sane ones. The sensitivity analysis
carried the same fold twice more. Nobody could reconcile these numbers
because they were not reconcilable.

### F27 — adjacent accuracy defects, same commit series

- `totalUpfront` = deposit + duty + hardcoded $2,000 — ignoring the row's
  own `legalFees`/`inspectionFees` lines (historic rows off by $500+); the
  cash-on-cash denominator was a second hardcoded derivation.
- The prompt forced **accounting-negative notation onto positive cash
  flows** (`($X)` via `Math.abs`), taught that P&I repayments decline ~5% by
  year 10 (they are constant; the split changes), bound `p.lvr` — a field
  the series never had — printing the literal "XX%", and asserted "all
  scenarios produce negative cumulative cashflow" unconditionally.
- Manual overrides reached `financial_calculations` by three writers, all
  splatting values over computed leaves: the captured row carries overridden
  line items summing $13,578 beside `totalAnnual` $21,418, with projections
  and metrics describing neither (C5's defect, proven on the same row).

### What shipped

- **C1 — one engine, one cost base**
  (`_shared/reports/investment/financialEngine.pure.ts`). All calculator
  arithmetic extracted pure and pinned by `financialEngine.spec.ts` against
  the captured row; the service keeps orchestration only. Projections,
  sensitivity and headline cash flow share `operatingExpensesFrom` (the
  footed total, never a fold); the year-0→year-1 gap is exactly the declared
  escalation. The one deliberate asymmetry: net rental **yield** keeps the
  land-tax-excluded base (land tax follows the owner's aggregated holdings,
  not the property) and the report states the exclusion. Cash-on-cash
  divides by the same `totalUpfront` the report prints. The prompt's
  narrative figures are now derived FROM the series (`impliedOpexFromSeries`,
  `fmtCashFlow`, `seriesLvrPercent`, `cumulativeCashFlow`), so prose and
  table cannot disagree; the sign convention keeps the sign, and the
  cumulative-cashflow teaching is conditional on the data.
- **C2 — historic rows healed at every read boundary**
  (`reconcileStoredFinancials`). ~1,170 stored rows carry the fold; nothing
  rewrites them until regeneration, so readers heal them exactly: the fold
  base reconstructs from the row's own aggregates (original even where line
  items were overridden — nothing ever rewrote the aggregates), each year's
  CPI factor recovers as impliedOpex ÷ base, and cash flow, cumulative and
  ROI follow. Detection cannot misfire (buggy year-1 charge ≥ 2× totalAnnual;
  healthy ≤ ~1.1×). Totals are derived from the row's own lines; headline
  metrics recompute from components. Wired at the template binding
  projection, the legacy `render-investment-report-pdf` route (its 10-year
  and cash-flow charts drew the inflated series on every historic re-render),
  and the design-composer normaliser. Idempotent, never mutates the stored
  row, no-op on post-fix rows. Historic **prose** is beyond render-time
  repair — regeneration is the remedy, and regeneration now writes correct
  figures.
- **C5 — overrides go INTO the engine, on every writer**
  (`overrides.pure.ts`). An override that changes a modelled input (price,
  rent, rate, reviewed costs, duty, conveyancing) becomes calculator INPUT —
  `calculateAnnualCosts` takes the reviewed figures, an explicit $0 replaces
  the estimate, letting fees join the totals, and the totals foot against
  the final lines whoever supplied them. Only non-modelled fields (tax
  treatment, occupancy display, build splits, loan labels) merge afterwards,
  through one shared `applyDisplayOverrides`. `manage-investment-reports`
  recomputes server-side before the write (never blocking the save; the
  response and the modal's toast say which happened), and the generator's
  30-line splat loop is gone.
- **C3 — fact reconciliation** (`factReconciliation.pure.ts`). The prose is
  compared with the record at completion — bedrooms, bathrooms, car spaces,
  purchase price, weekly rent, land size. Report-level rule (recorded value
  never appears + a different value repeats) so comparative prose cannot
  trip it; money facts are context-anchored. Findings disclose as
  `validation_flags` `type:'fact'` entries in lay wording and never gate
  completion. Feeding findings into regeneration retries is deliberately
  deferred until the detector has production mileage.
- **C4 — completeness recorded and disclosed, no schema change.**
  `data_sources` now records all eleven attempted sources (was four) —
  present with provenance, or null as a recorded fact. The viewer's new
  `InvestmentReportCoverageNote` renders ONLY when a source is missing or a
  fact check flagged ("9 of 11 sources", the gaps named, each contradiction
  in a sentence); a complete, clean report shows nothing, because a badge
  must mean something is unmet. Carried on the detail projection of
  `get-investment-reports`.

### Verification

63 new spec assertions across `financialEngine.spec.ts`,
`investmentOverrides.spec.ts`, `factReconciliation.spec.ts` — the engine
pinned against the captured production row (its reconstruction reproduces
the stored totals and monthly payment exactly, and the heal reproduces the
stored corruption before repairing it). Full affected surface green: 2,330
tests, tsc, eslint, `audit:style` under baseline, production build.

### Deferred, with reasons

- Regeneration-retry wiring for fact findings (detector mileage first).
- Browser viewer chart components reading `financial_calculations` directly
  (the two live PDF routes and the composer are healed; the viewer's own
  charts join in the delivery-unification phase).
- Historic prose corrections (regeneration is the remedy; C1 makes every
  regeneration correct).

## 10 · Phase 3 — delivery unification (2026-09-02)

Programme item C: every pathway that puts an Investment document in front of
a person produces THE document — template-first, one implementation — and
the scheduled Market Intelligence email can finally attach one.

### What shipped

- **`deliverInvestmentPdf.ts` — investment's own `deliver*` module.** The
  correct chain (the person's chosen template → the legacy WeasyPrint
  route) existed once, inside `PremiumPdfButton`. It is the module now, in
  the same shape every other migrated format has, and every surface asks
  it. `templateRouteEnforcement`'s investment pins moved onto the module,
  which makes them stronger: they now guard the path every surface uses
  rather than one button.
- **F11 — the primary Download produces the document.** The page's main
  action (header, mobile bar) had saved the markdown as a `.txt` for the
  life of the page while the real PDF sat lower in a collapsible panel. It
  now delivers template-first with a busy state, and says "Download PDF".
  The raw-text export survives everywhere its label already said "raw
  text": the panel button, the header menu item, the document card.
- **F12 — Send to Client publishes what the operator reviewed.** The send
  produced nothing before: it shipped whatever `pdf_url` held (legacy
  route or browser raster, whichever wrote last) or minted a fresh raster.
  It now produces fresh through the same chain, uploads template renders,
  reuses the path the legacy route just persisted rather than re-uploading
  the same bytes, and falls back to the raster only when both engines fail
  — reachability kept, primacy corrected. The portal needed no change: it
  serves the snapshot it was sent, and the snapshot is now the document.
- **`pdf_url` has one meaning**: the storage path of the most recent
  standard-delivery document, recorded through the one
  `manage-investment-reports` broker (the module and the browser
  generator's bookkeeping both go through it; the legacy route's internal
  write is the same delivery's server half).
- **F16 — the scheduled Market Intelligence email renders its own
  attachment.** The dispatcher's generate step writes content, never a
  PDF, so every dispatch that had to generate failed before sending
  (`pdf_storage_path` 0/7 in production). It now reuses a recent report
  even when that report carries no PDF yet, renders through the same
  design-composer route the download button uses (`persist` on), and
  attaches the path handed back. The route still refuses anonymous
  service_role exactly as pinned; the dispatch acts FOR the schedule's
  creator, whose `marketing_analytics` permission the route checks under a
  delegated authMethod that cannot hit the permission short-circuit.

### Verification

18 behavioural assertions on the delivery module (chain order, option
forwarding, publish reuse-vs-upload, bookkeeping-never-fails-a-document)
plus the `investmentDeliveryUnified` source pins (F11/F12/F16 wiring by
name). Full affected surface green: 6,243 tests, `tsc`, eslint,
`audit:style` under baseline, production build; MI's `legacyPathStays`
route pins all hold; security inventory regenerated with the new
dispatcher→render edge.

### Deliberately not done here

- The orphaned investment design-composer (`buildInvestmentReport` /
  `render.pure.ts`) stays orphaned: it is the legacy monolith's eventual
  replacement and belongs to the separately-authorised legacy phase (F),
  not to delivery unification.
- `ClientPDFGenerator`'s client-side override splat (a fourth copy) is
  harmless now that stored financials are override-coherent (Phase 2 C5)
  and folds with the duplicate-copy work.

## 11 · Phase 4 — sub-report cascade (2026-09-02)

Programme item D: the Compass family behaves as one family — one engine per
variant name, one linkage, and staleness that shows itself.

### What the phase found live (beyond the register)

- **F9 was structural, not just a mis-routed button.** The two engines used
  DIFFERENT linkage columns (fork → `derived_from_report_id`, condense →
  `parent_report_id`) with different idempotency keys, so neither could see
  the other's child: one Compass could hold two contradictory "Financial"
  documents, one deterministic and one model-written.
- **F28 — the tier switcher read `investment_reports` from the browser.**
  The table's policies are service-role-only, so the sibling lookup always
  answered `[]` with HTTP 200: switching to an existing child was
  impossible and every click regenerated one (model spend included). The
  fourth surface to hit the read-through-the-server trap.
- **A regenerated condense child kept its first-creation data copies.**
  Regeneration rewrote the prose and left `financial_calculations`,
  demographics, specs et al. as copied on day one — fresh words over stale
  figures.
- **Every fork was scored against $0.** The fork's score inputs read
  `financial_calculations.purchasePrice` / `.weeklyRent` — paths the record
  never had (the figures live at `initialCosts.propertyValue` and
  `income.weeklyRent`).

### What shipped

- **`subReportFamily.pure.ts`** — one mapping (`engineForVariant`:
  financial/strategic → fork, briefing/snapshot → condense), family
  resolution across BOTH historical linkage columns, and derived staleness
  (`variant_generated_at` vs the parent's `updated_at`; missing stamps never
  cry wolf). Bridged to src; both switchers route through the shared
  `generateSubReport`, and `condense-investment-report` refuses
  `financial` at the server, naming the right engine.
- **`familyOf` on `get-investment-reports`** — the family read, server-side,
  under the reports module gate: two indexed lookups (never a composed
  `.or()` string), per-child staleness in the answer. `TierSwitcher` uses it
  (its direct browser query is gone), lists all five variants including
  Strategic, and shows "parent has changed since" on stale rows.
- **Staleness stamps and honest refreshes.** Condense stamps
  `variant_generated_at` on completion and refreshes the structured copies
  from the parent on regeneration; both engines write both linkage columns
  on new rows.
- **`InvestmentReportFamilyNotice`** on the report page: renders nothing
  when the family is clean; on a stale child, one "Refresh from latest
  data"; on a parent, which sub-reports lag and one click that refreshes
  exactly the children that already exist — a refresh never mints documents
  nobody asked for. Fork refreshes are free (deterministic); condense
  refreshes cost a generation and the button counts what it touches.
- **Fork scores read the record** (override → initialCosts/income), not
  absent top-level paths.

### Verification

31 assertions across the pure-module spec (engine mapping, dual-column
family resolution from any anchor, the staleness truth table, orphan and
incomplete-child handling) and the source pins (server refusal, no inline
engine choice on any surface, no browser table read, stamps and structured
refresh present, page wiring). Full affected surface green: 2,356 report
tests, `tsc`, eslint, `audit:style` under baseline, production build, edge
column gate; security inventory unchanged (no new call edges).

### Deliberately not done here

- Auto-regenerating children when a parent regenerates: a condense refresh
  spends a model generation, so the family refresh stays an explicit,
  counted click on the page rather than a silent side effect of every
  parent save.
- Backfilling the two linkage columns into one: readers resolve the union
  either way; a data migration is pure tidiness and can ride with any later
  schema work.

## 12 · Phase 5 — invariant hardening (2026-09-02)

Programme item E: the rules the engine lived by become rules the machine
enforces.

### F13 — the template invariant is mechanical now

A template FORMATS data; it never COMPUTES it. `{{= financials.x * 1.1 }}`
used to pass the expression evaluator's character whitelist, so an approved
template could print a figure no engine produced. One implementation
(`templateLibraryCore.pure.ts`), two layers:

- **`expressionComputesOverData`** refuses arithmetic over ANY data
  reference — not only the financial namespaces, because a computed figure
  under `property.*` fabricates as readily as one under `financials.*`.
  Selection stays legal (ternaries, comparisons, `&&` presence logic choose
  between engine-supplied values); pure-literal arithmetic touches no data.
  Deliberately strict: `financials.x > -1` is refused (write `>= 0`) — a
  stricter refusal beats a parser.
- **The publish gate** (`validateForPublish`, code
  `library_template_computes`) refuses a computing schema with the
  offending expressions named, so no library entry can ship one.
- **The binding resolver** refuses at evaluation — the always-on stop for
  schemas that never meet the gate (activated copies, user drafts,
  imports). A computing expression resolves to nothing, like every refused
  expression; never to an invented figure.

Measured first, pinned after: zero of the 543 seeded templates use
expression arithmetic at all — `templateComputePolicy.spec.ts` asserts it
per template across all twelve collections, so the measured fact stays a
fact. 24 assertions on the rule, the walker, the gate and the runtime stop.

### F14 — the Branding decoy is retired

Templates → Branding collected per-client logos and colours into
`client_branding_profiles`, and no document generator ever read a row —
an operator configuring it was being promised branding the reports never
applied. The tab and `BrandingManager.tsx` are deleted rather than left
dormant (the platform's own rule: a dormant component is one import away
from returning). Untouched: the table, its rows, the `manage-templates`
allow-list, and the `ai-dashboard-agent` listing tool that reads the table
as data. The real brand source remains `whitelabel_settings` through the
brand resolvers; per-client REPORT branding, if ever wanted, is a
design-system feature on that chain and goes through Claude Design.

### E's third bullet — verified already delivered

"Write render events from legacy paths; include `template_render_jobs` in
the coverage measure" shipped in Phase 0: the `report_render_coverage`
view unions the nine `*_renders` ledgers, `template_render_jobs`, and
engine-tagged activity events, and the legacy investment route is
auto-tagged `legacy_server` by `secureInvoke`. Nothing further owed.

### Deliberately not folded

`compassSectionRegistry` / `compassPostProcessor` keep their src/edge
mirror pairs: the duplication is deliberate (edge functions cannot import
`src/`), drift-guarded by `compassRegistryParity.spec.ts`, and the src
copies carry src-only content below the shared block — a fold is churn,
not hardening. `ClientPDFGenerator`'s client-side override merge likewise
stays: it is the browser generator's compatibility shim for historic rows
whose stored financials predate the Phase 2 recalculation.

### Verification

6,709 template-suite tests green (the golden-render byte-stability guard
included — the refusal branch changes no rendered byte of a
non-computing template), `tsc`, eslint (0 errors), `audit:style` under
baseline, production build, edge column gate; security inventory
unchanged.

## 13 · Phase F — legacy incorporation and hiding (2026-09-02, upon authorisation)

The owner's standing instruction was that the legacy system be "incorporated
and hidden at a later stage once authorization is provided"; the
authorisation arrived after Phase 5 merged, and this phase is that step. The
model for what "incorporated and hidden" means was already in the tree: the
Borrowing Capacity Snapshot's one control offering the server render as the
primary act and the in-browser generator as an explicitly named
"legacy layout" choice — a decision its own spec records was taken so the
generator's retirement from reachability would never happen by accident.
Phase F generalises that arrangement to every format that still had
competing exits, deletes what nothing could reach, and folds the duplicate
logic copies the earlier phases had deferred here.

### Dead code deleted, not left dormant

Seven files with zero reachable callers went: `EnhancedInvestmentReportModal`,
`QAPDFGenerator` (whose unreachability the Q&A contract had recorded for two
migrations — the spec now pins the *deletion* so nobody restores it from
history), `HybridPDFTemplate`, `StrictPDFTemplate`, `ClientPDFTemplate`,
`reportTemplate/pdfRenderer.ts`, and the orphaned
`_shared/buildTemplateBindingContext.ts` (three documented defects, zero
callers). The style ratchet was re-measured downward in the same edit —
hexLiterals 636→611, fontHardcoded 53→51 — because the deleted print
components carried much of the recorded backlog. The orphaned investment
design-composer (`buildInvestmentReport`) turned out NOT to be dead — its
modules feed `reportBindingProjection` and `compassSectionRegistry`, i.e.
the template path itself — so it stays, and the §10 note that called it
orphaned is superseded by that measurement.

### The folds

**The read-boundary heal now covers the browser.** `get-investment-reports`
reconciles `financial_calculations` through `reconcileStoredFinancials`
before any row leaves the service — the same heal the two PDF routes and
the binding projection have applied since Phase 2 — so browser charts, the
library summaries and the legacy browser generator read one set of figures.
This closes the Phase 2 deferral ("the viewer's own charts join in the
delivery-unification phase") at a single server-side point instead of
per-component.

**The fourth override-splat copy is folded and named.**
`ClientPDFGenerator`'s hand-written flat-key→path merge is now
`overlayOverridesForHistoricRow` in `overrides.pure.ts` — the modelled
overlay a pre-recompute-era row needs, then the ordinary display paths —
documented as a display compromise for historic rows, never a recompute,
and a no-op on current rows. `applyDisplayOverrides` shares the same splat
mechanics (`splatByPaths`), so the path-walking exists once. The modal's
`OVERRIDE_FIELD_PATHS` deliberately stays: it is the override editor's own
field metadata (broader vocabulary, read-back concern), not a competing
money path.

**The browser/server mirror pairs were measured and left.**
`lenderLvrCaps`, `capitalAllocationLedger` and `scenarioDeltaEngine` are
deliberate structural twins with parity tests
(`scenario_parity_test.ts`, `lender_shading_parity_test.ts`, in place since
2026-08-30): the lenderLvrCaps constants are byte-identical, the ledger's
numeric content identical modulo comment counting, and the size difference
is inlined types on the Deno side. The §5 "measurably drifted" note is
superseded by that measurement; folding them would repeat the
`compassSectionRegistry` churn §12 already declined.

### One road per format, with the legacy named behind it

- **Investment** — all six exits now converge. The listings modal's
  "Download PDF" delivers through `deliverInvestmentPdf` (template-first,
  legacy server route behind it); its raw-text jsPDF dump survives only for
  an unsaved generation, where no row exists to deliver. The three
  `ClientPDFGenerator` mounts (export panel, Generated Reports viewer, the
  client tab's download sheet) sit after the unified control as
  "Download (legacy layout)" — the browser pdf-lib generator keeps its ref
  because the send fallback still reaches it. The client tab's sheet gains
  the unified download it never had.
- **Market Intelligence** — generating no longer draws and auto-saves the
  legacy jsPDF (the browser engine was the default road nobody picked). The
  typeset control leads the success strip and the History modal rows; the
  legacy layout is drawn only when chosen, and the choice is labelled. The
  spec's "never a silent substitute" reasoning survives: nothing falls back
  across engines.
- **Client Details** — the typeset control is the toolbar's one primary
  document control; the two Formara raster buttons moved to the end of the
  toolbar, demoted and named ("Send to Finance (legacy layout)",
  "Download (legacy layout)"). They stay because the raster document
  carries capabilities the typeset one does not (owner-occupied toggle,
  borrowing-capacity appendix) and a broker's workflow may depend on the
  exact document.
- **Property Comparison** — `ComparisonPDFGenerator` used to spend a
  metered model call (`format-comparison-report`) on every viewer MOUNT,
  download or not. It now formats only when "Download (legacy layout)" is
  actually chosen — once per stored row, and the click that paid for the
  formatting gets its download (the generator handle gained a programmatic
  `download()` for exactly this). The deterministic typeset control was
  already first at both mounts.
- **Cash Flow / Cash Flow Comparison** — the 10 Year menu already carried
  the converged shape ("Generate PDF" server-first, legacy named beneath);
  the comparison modal's two jsPDF exports are now demoted ghosts labelled
  "(legacy layout)" beside the typeset controls that already led.
- **Report Q&A** — the toolbar's ambiguous "Export PDF" is now
  "Transcript (legacy layout)": it posts a pdf-lib *transcript* into the
  chat, a different document from the typeset structured report, which is
  why it remains a choice rather than being folded. The editors' own jsPDF
  exports stay untouched — they export user-EDITED content the server
  routes cannot see.
- **Borrowing Capacity, Portfolio, Commercial Capacity** — already
  conformant; nothing changed.

Out of scope, recorded: the quantitative-analysis viewer
(`pages/ReportViewer`), `PropertyReportGenerator`, `OverviewSnapshotPDF`,
the Strategy Rationale Brief, call-log and lender-packet exports are
standalone documents with no typeset twin — there is no unified delivery to
hide them behind, and inventing one is new-format work, not consolidation.

### Contracts renegotiated, not broken

Each affected `legacyPathStays` spec records the new decision in place of
the old one: Q&A pins the deletion; Market Intelligence pins "named choice,
drawn only when picked, never a side effect of generating"; Client Details
pins the order (unified first) and the naming. The specs that pinned
handlers, field names, destinations and server contracts pass unchanged —
demotion touched chrome, not machinery.

### Verification

2,360 report-suite tests green across 108 files (every legacyPathStays
contract included), `tsc` clean, eslint at exact error parity with `main`
(zero introduced), `audit:style` ratcheted down and holding, production
build, edge column-name gate, the security gate chain (registry, static,
authz, CORS, mass-assignment, public-validation et al.), and esbuild parse
checks for the touched Deno modules; security inventory unchanged (no new
internal call edge).

## 14 · Closing pass — every open finding and deferred item, measured and closed (2026-09-02)

The owner asked for whatever remained — "remaining phases and stray
patterns" — to be executed and the loops closed once and for all. The named
phases were complete, so this pass took the register's open findings and
every "deferred, with reasons" note in §9–§13, measured each against the
live system, and acted where the measurement supported action. What follows
is the whole list, including the items closed by *decision* rather than by
code, because a loop closed by "we looked, here is why not" is closed.

### Closed by code

**F17 at its source — the generator fabricated a bedroom count.**
`effectiveBeds` was `mergedOverrides.bedrooms || propertyDetails?.beds || 3`
(bathrooms `|| 2`), and the prompt's specification table read it, so a
property whose count was never captured was asserted to the model as "3
bedrooms" — which is exactly how a real report said "3 bedrooms" three
times about a four-bedroom subject. Measured the same day: **0 of the last
43 reports carry a bedroom count in `property_specs`** while 651 older ones
do, because the callers spell the facts four ways (`beds`/`bedrooms`,
`landSizeSqm`/`landSize`/`land_size_sqm`, `carSpaces`/`parking`) and every
site read exactly one; the specs write read `.landSize`, `.buildingSize`
and `.parking` while every caller sent `landSizeSqm`, `buildSizeSqm` and
`carSpaces`, so three of nine specs were null on every row whatever the
caller knew. Now: one normalisation, once, before anything reads a fact;
the FACT is null when unknown and the prose says "Not specified"; the
MODELLING DEFAULT (`modelledBeds`) exists separately and feeds only the
scorer and the rent lookup, which need a number to model with and never
reach a page. Pinned by `closingPass.spec.ts`.

**F17's detector, measured on production prose.** The regeneration-retry
deferral said "detector mileage first"; the detector had had none (0 rows
touched since Phase 2 merged), so it was run offline over 18 production
reports — 10 recent, 8 with bedroom counts. Result: **one true positive**
(a lot priced at $693,100 whose entire money section anchored on the suburb
median, $625,000, six times — the class disclosure exists for) and **one
false positive**: a spec list, "Bedrooms: 3 - Bathrooms: 2", whose " - "
separator the `[\s-]*` bridge read as the hyphen of "3-bathroom", while
the true label-first "Bathrooms: 2" never counted as the recorded value
appearing. Counted mentions now allow one separator character, label-first
forms are collected, and both production cases are pinned as tests.
**The retry itself is deliberately not wired**: one positive in eighteen is
not the volume that validates a section-scoped correction loop inside the
highest-volume generator's resume bookkeeping, and the fabrication fix
above removes the mechanism that produced the reported contradiction.
Disclosure stays the remedy; this measurement is recorded so the next
decision starts from evidence.

**F26's remaining readers.** `reconcileStoredFinancials` now runs where
the two comparison producers read rows (`compare-investment-reports`,
`compare-cash-flow-reports` — both were handing a model triple-charged
figures for historic rows) and inside `projectCashFlow` itself, so the 10
Year Cash Flow heals whatever path a row arrives by (browser adapters,
sample data, the live-projection carrier). The cash-flow render routes
turned out not to read the column at all — they render the snapshot the
adviser reviewed — so nothing was owed there.

**F28's class, five more instances.** `investment_reports`' SELECT policy
is `generated_by = auth.uid()` (plus the client-owner branch) — measured
from `pg_policies` — so a browser read answers with the current user's own
reports and calls it the whole: the Overview's "reports this month" was one
person's count, the Q&A library picker offered a user only their own
reports, a client's portfolio actions listed nothing for a colleague, the
auto-generated badge marked only your own rows, and the error-log retry's
status reset matched zero rows for anyone else's report and said nothing.
All five read through `get-investment-reports` (whose `listOptions`
already carried every filter needed) or write through
`manage-investment-reports`; the picker now fetches a body per pick rather
than 200 documents to draw a list. `closingPass.spec.ts` pins all six
files (the Phase 4 one included) against a table read.

**A sixth instance, found by the gate rather than by the sweep.** Removing
the browser client from the Q&A picker left one call behind, and CI's
undefined-identifier gate caught it — `check-src-missing-names.mjs`, the
one gate this repo keeps precisely because the app is never fully
type-checked (`tsconfig.json` declares `"files": []` and delegates to
project references, so a bare `tsc --noEmit` verifies **nothing**; that is
why a local run said clean). Looking at the line it named turned up a
defect older than this pass: the call read `client_properties`, whose only
SELECT policies are **service-role**, so it answered `[]` with HTTP 200 for
every user — and an empty property list short-circuits the picker to "no
reports" whenever it is opened for a client. It now reads through
`get-client-data`, which brokers that table behind the
`client_management` permission and a client filter. The lesson is the
gate's, not the sweep's: an import removed is an audit of every use of it.

**F15.** `manage-branding` trims string columns at the write boundary, and
the migration brings the stored `company_name` — trailing space, measured
— to what every reader was already trimming it to.

**Linkage columns.** 48 rows carried only `parent_report_id`, 20 only
`derived_from_report_id`, 0 disagreed where both were set; the migration
backfills each from the other, idempotently. Readers already resolved the
union, so no reading changes — the record is coherent now. All three
statements were planned against the live schema with `EXPLAIN` before being
committed (45, 17 and 4 estimated rows, matching the counts above); nothing
was executed against production.

**A test that failed for its own weight, not for a defect.**
`printFontPolicy.spec.ts` reads and regex-scans every
`seed_template_library` migration — **199 MB across nine files**, the
catalogue written out as SQL — under vitest's default **5-second**
allowance. Alone it takes about a second; in a loaded parallel run it took
**7.3 s** and failed the file, which is what "flaky" looked like from the
outside. The assertion is untouched and the scan is unchanged; only the
clock now reflects the work, so the gate fails when a face is missing
rather than when the machine is busy.

**A silent skip made visible.** The Q&A library picker now reads a body per
pick, and a completed report carrying no body cannot be asked questions
about. It names the ones it could not read rather than dropping them from
the selection without a word — a pick that vanishes with no reason reads as
a broken button.

### Closed by decision, with the measurement

- **F6 (content parity: hero photography, exec summary, editor's note).**
  The binding projection publishes no hero image and no master binds one;
  adding a cover photograph is a change to all fifty generated investment
  masters, which by the catalogue's own rule goes to Claude Design and
  comes back through the generator — recorded as the design-catalogue
  decision it is. The legacy route's render-time executive summary and
  editor's note were model calls made at RENDER; the templated document is
  the stored report, and a renderer that invents content is the invariant
  this programme exists to enforce. Not ported, deliberately.
- **F7 (legacy renderer's eleven private chart drawers vs `vizFigures`).**
  The legacy route is now the hidden fallback behind every unified
  delivery; rewriting its charts onto the shared primitives would be
  effort spent on a road nobody is offered. Left, named.
- **F8 (reports unlinked from clients).** 2 of 1,193 carry
  `client_property_id`; both came from the client tab, which links
  correctly. The other 1,191 were generated from listings or the report
  form, where no client exists to link — a post-hoc "link to client"
  affordance is a product feature, not a stray pattern.
- **Template resolver ×3.** The browser resolver calls the authoritative
  `resolve_report_template` SQL function first and falls back to a JS
  ranking parity-locked to the edge copy — one authority, two guarded
  mirrors. Report-type normaliser ×2: the browser re-exports the shared
  pure module. Both already folded; the register's note is superseded.
- **Minor unnumbered items.** Table rows keep together
  (`table.data tr { page-break-inside: avoid }`); contents labels derive
  from the spine; the scoring band strings are the engine's own one-line
  reasons carried for the wheel. "andother" and the mixed minus glyphs
  were prose defects in one generation, remedied by regeneration.

### Verification

Full vitest suite green end to end in one run — **1,071 files, 20,503
tests, 0 failures** (the two that failed the first pass were the font-policy
timeout above and one load-sensitive market-updates fixture, both green
now); `tsc` clean; eslint **0 errors** on every changed file; style ratchet
holding; production build; all seven touched Deno modules parsed with
esbuild and the edge type-check ratchet run locally with Deno installed —
**no file this changeset touches sits above its baseline**; the security
gate chain (registry, static, authz, CORS, mass-assignment,
error-disclosure, public-validation, migrations, portal boundaries);
security inventory regenerated and unchanged. Production measurements were
taken read-only through the project's SQL interface and are quoted above;
the migration was validated with `EXPLAIN` and never executed.

---

## 15 · The generation engine — a control that could never take effect (2026-09-04)

The owner sent a screenshot of the Investment Analysis page's **GENERATION
ENGINE** drop-down and asked a fair question: how is an operator meant to
know whether "the trimmed version" is the one to pick — and if it is now the
primary engine, name it Primary.

The answer is worse than the question assumed. **There was nothing to pick.**

### What the drop-down did

Nothing. `InvestmentReportGenerator.tsx` sends no `reportTier`, so the
generator's `rawTier` falls to its default:

```ts
const rawTier = propertyDetails?.reportTier || 'compass';
const isCompassTier = rawTier === 'compass' || rawTier === 'compass-40';
const generationEngine = isCompassTier || requestedEngine === 'compass-40'
  ? 'compass-40' : 'legacy';
```

`isCompassTier` is therefore **always true from that page**, and the engine
resolves to Compass whatever the operator selected. That is not a bug in the
resolution — the tier is the data-minimisation boundary, and an engine
preference must never be able to pull financial content into a non-financial
report — but it makes the control inert.

The drop-down opened on the option that never ran, and described it as the
safe one: *"Legacy Compass — Stable · Full DB template, ~12 chunks,
battle-tested."* Every quality gate this programme built runs under the
other one — the canonical section registry, `postProcessReportMarkdown`,
`runQAValidation` — all inside `if (compass40OverlayActive)`. So the default
was labelled *stable* and was in fact the ungated path, and it made no
difference either way.

**A dead control is worse than no control**, the rule this repository
already applies to the AUSTRAC path card. This one was worse than dead.

### What the column recorded

`generation_engine` was written **only by the browser**, at request time.
So the row recorded the *selection*, not the run. Measured on 2026-09-04:

| `report_tier` | `generation_engine` | rows |
| --- | --- | --- |
| compass | legacy | **1,124** |
| snapshot | legacy | 25 |
| briefing | legacy | 21 |
| strategic | legacy | 10 |
| financial | legacy | 10 |
| compass | compass-40 | 2 |
| briefing | compass-40 | 1 |

Every one of those 1,124 rows says "legacy" about a document the Compass
engine produced. **A record of what was requested is not a record of what
happened.** `generate-investment-report` now writes the column on the
completion update, from `compass40OverlayActive` — the flag that actually
governed the run.

The historic rows are **deliberately not backfilled**. The rows predating
the tier promotion genuinely did run on the legacy engine, and the honest
discriminator is `total_sections` (the Compass registry persists 17, the
legacy section list 12) rather than a date nobody can pin to a deployment.
Replacing one guess with another is not a repair; a regeneration now stamps
the truth on the rows it touches.

### What changed on screen

The page **states** the engine instead of offering it: *Compass — Primary*,
with what it produces and what it deliberately omits (purchase price, yield,
LVR, loan and ten-year cash flow belong to the Financial Analysis Report).
The name lives in `ENGINE_LABEL` in one module, because two literals is how
two screens come to disagree.

The Regenerate dialog carried the same two options, and there the choice was
not merely dead but **harmful**: on a Compass report the server overrides it,
and on a Financial Analysis report picking Compass would strip the financials
the report exists for. It is a statement now too, resolved from the report's
own record.

### The rule, in one place

`src/lib/reports/generationEngine.pure.ts` mirrors the server's expression —
tier first, caller preference only where the tier leaves the question open.
It is deliberately neither trimmed nor lower-cased, because the server
compares with `===`: a module whose whole job is to say what will happen
must not be kinder than the rule it reports. `generationEngineTruth.spec.ts`
reads the edge function's own source and fails when the two drift, the guard
`llmUsageBinding.pure.ts` already carries against the router.

### One defect found on the way

`useChunkedRegeneration` sent `reportTier: normaliseReportTier(...)`, and
that helper collapses **everything except `financial*` into `compass-40`**.
It is right for counting chunks and wrong for the tier, which is the
boundary the server resolves the engine from — so regenerating any of the
**56 production `snapshot` / `briefing` / `strategic` reports** would have
sent `compass-40`, and returned a Compass document in place of the report
that was there. It now sends the report's own stored tier and resolves the
engine through the shared rule.

Two smaller things fixed in passing: the dialog read the `detail` projection
(~95KB of report prose plus every JSON blob on the row) to read one string,
and passed `listOptions.select`, which that function documents as
"deprecated and deliberately ignored" — it takes `generationProgress` now.

### Verification

Full vitest suite green in one run — **1,075 files, 20,556 tests, 0
failures**; `check-src-missing-names` clean; the edge column-name gate and
the style-token ratchet both holding; eslint **0 errors on every changed
file** and the repo total down one (44, from 45 — a
pre-existing `prefer-as-const` in a file this touches); production build;
the edited edge function parsed with esbuild; the edge type-check ratchet run
under the Deno version CI resolves (`v2.x` → 2.9.6) with **no file above its
baseline**. A local Deno 2.1.4 reports four unrelated `builderStock` /
`immutableDocuments` files as regressed: they use `Uint8Array<ArrayBuffer>`,
which needs TypeScript 5.7, and they are clean under the CI toolchain — the
gate is only meaningful on the version CI pins. Production counts were taken
read-only through the project's SQL interface and are quoted above; nothing
was written to the database.

---

## 16 · The template picker becomes a gallery (2026-09-04)

The owner's ask, verbatim in intent: choosing a template from names alone is
not choosing — show the actual template styles, lead with **different design
families** rather than one family's variants stacked above the next family's
first appearance, and let it cascade to every report being generated.

### What was there

`ReportTemplatePicker` listed the catalogue as radio rows of text. For the
Investment format that is **sixty rows** — ten families × five layouts plus
the ten individual designs — in which "Sovereign Folio" and "Signal Dark"
are names nobody can rank without seeing them, and the five Private Banking
variants sat above Dark Executive's first appearance. Meanwhile the Template
Library's browse page already rendered every design's real first page
(`TemplateDocumentPreview` — the same `renderTemplateToHtml` the customer's
PDF goes through, with sample data), so the pictures existed one page away
from the decision they were for.

### What it is now

- **Families first.** One tile per design family — ten visually different
  documents — each tile the family's reference layout rendered for real, on
  the light-table sheet treatment the Library established. Opening a family
  reveals a tray with its five layouts and its ten curated colourway swatches,
  and choosing a colourway repaints every sheet in the tray, so "Oxblood or
  Platinum?" is answered by watching. The tray scrolls itself into reach when
  opened, because a family in the gallery's second row would otherwise reveal
  it below the fold — a click that appears to do nothing.
- **Individual designs** (the voice templates, no `designMeta`) sit beside
  the families as their own tiles, each with its own face.
- **Active rows with no library lineage** get a face too. Their rows carry no
  `preview_schema`, and the picker's projection deliberately never fetches
  `config`/`schema` whole — so page one and the token palette alone are
  fetched, lazily, only when the dialog is open with such a row to draw
  (`fetchActiveTemplatePreviewPages`; PostgREST `schema->pages->0`, measured
  at ~50KB across every active row in production, largest page 3.9KB). A row
  whose schema has no pages, or a failed fetch, degrades that tile to an
  empty sheet — a missing picture never takes the chooser down.
- **A stored selection is followed visually**: its family opens pre-expanded
  with the design checked and badged Current, its colourway pre-selected.

**Nothing behavioural changed.** The save flow (adopt-then-select,
idempotent on entry + version + colourway), the fold of active rows into the
designs they descend from, "Choose automatically", the unavailable-choice
alert, the non-WeasyPrint disclosure and the ownership model are all exactly
as `TEMPLATE_SELECTION.md` records them — the same tests assert them against
the new surface. And because every surface mounts this ONE dialog
(`ReportTemplateSelector`, `useReportTemplateMenu`, the Templates page's
bindings list — the map `templateRouteEnforcement.spec.ts` holds complete
against the adapter registry), the gallery reaches all nine production
formats' download controls without touching any of them.

### Measured in a real engine

jsdom has neither layout nor iframes, so a DOM test passes while every tile
paints blank. `tests-e2e/report-template-picker/` mounts the real dialog in
Chromium over **sixteen real catalogue rows** (the ten family references,
all five Private Banking layouts, two standalone designs — their production
`preview_schema`, fetched read-only) and asserts on painted iframes and
bounding boxes: families visible and painted before any variant, the tray's
five layouts painted after one click, swatch repaint, one checked radio on
the followed selection, no sideways scroll at 1440×900 or 390×844
(`npm run test:e2e:report-template-picker`).

One environmental fact worth recording: a preview document's Google-Fonts
`@import` blocks a srcdoc iframe's **first paint** while the stylesheet is
pending, so an environment that black-holes `fonts.googleapis.com` shows
blank sheets until the connection dies — which is how this harness's first
screenshots came out, and why its fixtures strip `tokens.fontFaces` (the
fallback stacks are what a browser with no reach to the CDN uses anyway).
Production serves those fonts and the Library page demonstrably paints the
same previews.

### Verification

Picker unit suites rewritten and green (8 gallery tests, 14 selector tests —
one renegotiated wording pin); `templateRouteEnforcement.spec.ts` and the
adjacent template suites green; all five Chromium layout tests green; eslint
0 errors on every changed file (repo total holding at 44); style-token
ratchet holding; `check-src-missing-names` clean; production build; full
vitest suite green in one run — **1,077 files, 20,575 tests, 0 failures**. Production reads for fixtures and measurements were
read-only.

---

## 17 · Five client PDFs, six defects, one render (2026-09-04)

The owner attached five PDFs downloaded that morning — three reports of
1/27D Mitchell Street, Muswellbrook (a Compass, a Financial Analysis and a
derived Snapshot), rendered through Chancery and through the Luxury
Editorial "Frontispiece" chosen in the new picker — and named four
complaints: N/A everywhere, no table of contents anywhere, every report
titled Investment Compass whatever was chosen, and content cut off. All
four reproduced from the files, and the investigation found two more
underneath them that none of the four names: the silently dropped figures
(§1), and — visible only once those figures drew — the chart primitives
clipping their own labels (§6).

### 1 · Every figure the model composed was silently dropped

The stored Compass body carries **43 chart directives** — 13 glance strips,
6 bars, 6 donuts, 6 gauges, 4 timelines, a wheel, tiles, a heatmap, a
pictograph — and the rendered PDF contains **none of them**.
`markdownBlock.html.ts` called `renderMarkdown` without `renderDirective`,
and a shortcode is an instruction to the renderer either way, so every
directive was removed and drawn as nothing. The Disclaimer, whose whole
content is one glance strip, printed as a heading over nothing.

The block passes `vizDirectiveRenderer` now, in a `ChartContext` built from
the template's own tokens (keyword fallbacks, per the planning-context
convention), and `projectReportNarrative` charges the SAME directives
through `planningChartContext()` — `figureLines` reads the SVG's geometry
alone, so the page count and the buckets stay one arithmetic. The Compass
document grows from 13 truncated body pages to 23 complete ones.

### 2 · The tail printed over the running foot, silently

Page 19 of the Compass render ends mid-bullet — "Commercial Property Data
Providers (CoreLogic, Domain, realestate.com.au)" with its description
gone — and the footer beneath it is garbled where overflow text struck
through it. Measured: the final bucket packed **47 charged units under the
50 budget** and still overflowed the physical box, because the measured
charge model undercounts a bold-lead bullet list (a top-level item was
charged at the full measure, ignoring its own hanging indent) and page
margins. The estimator's error exceeded the 8% held back.

Two changes: measured list charging now subtracts the marker indent at
depth 0, and `CALIBRATED_CONT_LINES`/`CALIBRATED_FIRST_LINES` sit at
**46/36** (~16% under the bench capacity) — because a sparse page costs
white space and an overfull one costs a client the end of the document.
Re-packed against the real content: the failing bucket splits, the
Disclaimer and Notes get their own page, nothing touches the foot.

### 3 · N/A nineteen times, about figures the row held

The Snapshot's "The report" pages tabulate Median Price N/A, Grade N/A,
Score N/A/100, five component scores N/A, six financial rows N/A — while
the SAME ROW carries score 62, grade B and a complete
`financial_calculations` block. `condense-investment-report` hands the
model only the parent's PROSE — and a Compass parent deliberately states
no financials — then demands tables. The model, forced to fill a table
from a document that never says the numbers, wrote N/A.

`condenseFacts.pure.ts` renders the row through `projectInvestmentReport`
(the same reconciled projection every templated document binds) into an
authoritative RECORDED FIGURES block in the prompt, and the rule travels
with it: a metric absent from the record and the prose loses its ROW —
never gains a placeholder. The snapshot/financial guides' fixed metric
menus became choose-from lists under the same rule.

### 4 · Four document kinds, one name

Cover eyebrow, wordmark, running head and running foot were the literal
words "Investment Compass" in the Investment composer — and those masters
serve the compass, financial, snapshot, briefing AND strategic tiers. So a
Financial Analysis was titled Investment Compass on all 15 of its pages.
The composer binds `{{report.documentTitle}}` / `{{report.standfirst}}`
now, and `DOCUMENT_IDENTITY` in the projection is the one place a tier is
translated into words (Financial Analysis; Snapshot Report; Executive
Briefing; Strategic Overview; compass keeps its name and standfirst — and
an unrecognised tier reads as compass, the ranking's default document).

### 5 · Two whole families had no contents page

37 of the 50 Investment masters carry a Contents page; **Luxury Editorial
and Private Banking declare `toc_style: none` family-wide** — the house
default and the design the owner chose, which is why all five PDFs lack
one. `hasContents` returns true for every style now: navigability is a
property of the document, not of a family's styling, and `toc_style` keeps
deciding how the list is drawn, not whether the reader gets one.

### 6 · The chart primitives clipped their own labels

Fixing §1 made the figures visible, and the first honest render showed the
primitives cutting text: the score wheel printed "FUTURE RESILIENCE" as
"RE RESILIENCE" and lost GROWTH ALIGNMENT's tail; the bars' label column
clipped "Property-specific verification need" at the left edge; and the
risk matrix drew "5=High)" as an orphan row label floating under a one-row
grid.

The wheel taught the real lesson. `text()` converts points to viewBox
units through `w / widthMm`, so **widening the box also enlarges every
label in units** — a first fix added the label's estimated width to the
padding and the clip only moved ("TURE RESILIENCE"). Measured in Chromium
(`getComputedTextLength` over the failing labels): a 17-character tracked
uppercase micro label needs 140u of the 78u available at w=460, 161u of
114u at w=532, and would need w≈813 — wider than the wide box — on one
line. The fix is structural: long labels **wrap at the word break that
best balances two lines** (never truncated — a shortened dimension name is
a different dimension), the width is the closed-form solution of
`w/2 − labelR ≥ label(w) + edge` (solvable because label(w) is linear in
w), and the label/value blocks stack radially outward with leads computed
from the type's own unit size, growing the box height from the actual
extents. The advance is measured, not guessed: 0.71em per uppercase
character, 0.55em mixed-case, carried with margin.

The same honesty went to the other two. The bars and matrix label columns
size from `ptToUnits(micro) × 0.58` instead of a 5.4-unit guess (three
characters short on the real 26-character row label); the matrix solves
its width as a converged fixed point, refuses — the module's own rule —
when labels at micro size are physically wider than the measure and no
box width can fit them, and scales its header band and cell height with
the type. And the orphan label was the directive parser: `csv()` split
`rows=Risk level (1=Low, 5=High)` on the comma inside the parenthesis,
declaring a second row the grid never had — it now splits only on commas
outside parentheses (the quote-aware splitter's rule, extended), and
`renderHeatmap` refuses to draw a label for a row or column the grid does
not hold, because a labelled row is a promise that figures follow.

### Shipping the fix to documents people already generate

Master schemas are COPIES — seeded and adopted rows never updated — so the
v10 seed alone would fix only future adoptions. Two migrations ship
together: `20260917100000` reseeds the library (543 templates revalidated),
and `20260917110000` refreshes every ACTIVE `report_templates` row that
descends from a listed design: the entry's new schema with THE ROW'S OWN
token colours carried forward (a colourway bake is exactly that merge, so
no palette is invented), and the lineage's entryVersion advanced so the
picker's fold keeps recognising the copy. Rows with no lineage are
untouched.

### Verified against the failing documents themselves

Both real reports were re-rendered through the updated Luxury Editorial
master with the real projection in Chromium: the Financial Analysis covers
itself as FINANCIAL ANALYSIS with its own standfirst; both carry Contents
as page 2; the wheel, donuts, glance strips and gauges draw in the family
palette; and both tails — the exact sentences missing from the shipped
PDFs — sit whole on their pages. Every chart-bearing page was then
screenshot and read: all five wheel labels whole (wrapped, values clear of
the disc), the three DD-focus bar labels whole, and the risk matrix one
labelled row with six labelled columns. `reportRenderDefects.spec.ts` pins
all six fixes; `narrativeCalibration.spec.ts`, `vizDirectives.spec.ts` and
`vizFigures.spec.ts` hold.

## 18 · Coverage of the choice, and the cascade into every format (2026-09-04)

The owner attached a real 15-page Property Comparison and asked two things:
that the visual template choice reach **every** area that produces a report
or downloadable document, and that §17's rectifications (Contents pages and
the rest) demonstrably cascade beyond the Investment format. Both were
measured before anything was changed.

### The choice — 40 exits swept, three gaps, one lawful absence

Every document exit in `src/` was inventoried: forty inside the report-format
system and twenty-three deliberately outside it (AML records, agreement
templates, portal file downloads — each governed by its own rules, none a
candidate for a template choice). Coverage was already strong: the primary
exits of nine formats carry `useReportTemplateMenu` or an inline
`ReportTemplateSelector`, and `templateDocument.ts` honours the stored
selection at delivery with the `unavailable` guard. Three Investment exits
did not — the Generated Reports **viewer**, the listings **modal** and the
client-property **download sheet** all delivered through the unified
template-first road while offering no way to see or change which template
the document comes out in. Each now mounts the selector where the export
panel precedent puts it: before the buttons that use it. The Cash Flow
Comparison's absence is correct, not a gap — the format is preview-only
because nothing about a comparison is persisted anywhere a template can
read, and the menu hook already returns nothing for a format a choice
cannot change. Legacy jsPDF paths are outside selection by definition: they
ARE the named legacy layout.

### The cascade — one real comparison, eight defects, three of them global

The attached PDF (three properties, NSW) reproduced a defect family §17's
fixes had not reached, because every §17 measurement was taken on the
Investment format:

1. **Parts jumped 12 → 19.** Part numbers were baked at compose time
   (`partNo += 1`), so every page a `conditional` dropped left a hole in the
   numbering of the document that shipped. Part numbers now resolve at
   render time: the renderer counts `{{partNumber}}`-binding pages over the
   pages that actually draw (the binding is also the opt-in, so the cover
   stays outside the count), `pad2` keeps the "Part 07" style, and the same
   per-page value serves the running head and the section numeral so the two
   cannot disagree. All six composers that number parts converted
   (`renderTimePart` in `blocks.ts`); the count is folded into the page
   cache signature because a page's number depends on which preceding pages
   opted in.
2. **Empty ruled stripes under labels.** The scorecard drew two blank zebra
   rows for axes the record does not hold, and three of six "Basis of the
   analysis" rows printed as label-over-nothing. `data-table` rows already
   had the answer — an explicit per-row `when`, added for exactly this rule —
   so `definition-list` items gained the same (`renderDefinitionListHtml`
   filters, a list whose every item is absent draws nothing), and the
   comparison composer declares the conditions on every fixed slot.
3. **Whole pages of furniture over nothing.** The "Money · cash flow" page
   rendered a heading and zero rows; "Who each property is for" rendered a
   heading and nothing at all (its continuation page was conditional, the
   first page was not). The axis-reason pages are now conditional on holding
   at least one slot, and the first investor-fit page on `matches[0]`.
4. **A callout that asked its own question and left it blank.** "Why there
   is no recommendation here" bound `comparison.truncationNote`, which was
   composed only for salvaged rows — the attached row is structured and
   complete, merely without a structured `bestOverall`, so the heading drew
   over an empty body. The projection now composes the note whenever the
   pick is absent, whatever the cause, in the format's own sentences.
5. **"Eleven axes, side by side"** was a hardcoded count over a
   data-dependent table showing eight. The heading is count-free; with row
   suppression the table describes itself.

The Contents-page cascade needed no new work — every format's composer gates
its Contents on the same `hasContents` §17 made unconditionally true — but
it was verified rather than trusted: the fixture comparison renders 14 pages
with Contents as Part 01 and parts 01–12 consecutive, the empty pages gone,
the basis list three honest rows, and the verdict callout answered. A
converted Borrowing Capacity master renders gap-free under sample data with
no unresolved `{{partNumber}}`.

Shipping is the §17 pattern: the v11 seed (543 templates revalidated) plus
`20260918100000_refresh_active_masters_from_library_v11.sql`, which
re-copies every active library-descended row with its own baked colourway
carried forward. `reportCoverageCascade.spec.ts` pins the renderer count,
the filter, the item `when`, the projection note, the composer conditionals,
the three selector mounts and the migration pair; the four catalogue specs
that assert "bind nothing the projection cannot publish" now name
`partNumber` as renderer-ambient, beside `pageNumber`.

## 19 · Phase 1 of the tier framework — derived reports read the record (2026-09-05)

The signed-off framework (`docs/reports/TIER_FRAMEWORK.md`, and the audit that
preceded it) reduced every derived-tier defect to one cause: prose was the only
carrier of substance, and the Compass — the only parent — stopped carrying
financial prose in v3.0. Phase 1 makes the record the carrier. All figures
below were measured on the 4 September production family of 1/27D Mitchell
Street (parent `0478c410`, children `c21ed1fa`/`2f1f7f6f`/`89b451f6`/
`8c6edc56`) before and after, re-composed through the same modules the
functions now run.

**The Financial fork composes its chapters from `financial_calculations`.**
The "Client Investment Feasibility & Financial Performance Report" was a
substring routing of a parent with no financial sections to route: 7 headings,
ONE dollar sign, while its own row held seven key metrics, eleven annual-cost
lines, ten loan details, three projection scenarios and a sensitivity grid.
`reports/investment/financialChapters.pure.ts` writes the missing chapters —
purchase & holding costs, rental & yield, loan structure, sensitivity, the
ten-year table (with equity and LVR, which the stored series already carried),
the scorecard and the SWOT — from `reconcileStoredFinancials(...)`'s healed
record, the same heal the KPI tiles bind, so a chapter and a tile cannot
disagree. Composed chapters REPLACE routed prose claiming the same FIN ordinal
or heading (the record wins over a legacy parent's stale tables), and the
response names what was replaced. After: **14 headings, 109 dollar signs,
0 N/A**, and the document reads as the declared FIN structure.

**The Briefing's guide is cut to the parent that exists.** It still described
the 17-section legacy Compass — eight financial tables and a market-performance
grid demanded from a parent forbidden to carry them, which the model filled
with N/A: 33.2 per briefing before August, 87 on the newest. The guide now asks
the model only for the condensed location case; the financial tables, score
breakdown and SWOT are composed server-side after the call (`composed_sections`
in the response), and the SWOT is typed from the score record's own four lists
rather than improvised.

**A labelled row is a promise — enforced on stored markdown.**
`derivedHygiene.pure.ts#stripPlaceholderRows` drops a table row whose first
value cell is a placeholder, blanks trailing placeholder cells, drops tables
left with no body, and drops placeholder-confession lines ("- Source
attribution: N/A (…)"). Run over the worst production briefing it removed 39
rows, 11 tables, 5 lines and blanked 15 cells — **87 → 0**. It runs on every
fork and condense output, alongside `stripEditorialLabelsFromMarkdown` (the
label strip alone, exported from the post-processor — the full pass's word
caps are the Compass's and must not touch other tiers' sections).

**The Snapshot is one document again.** The newest snapshot carried its 8
declared sections and then the parent's 9 echoed back — 17 headings, 2.5× the
format's length, and nothing post-processed it (hygiene ran on the briefing
alone, which was exactly backwards). `trimToDeclaredSections` keeps what the
tier declares and names what it dropped; the guide now says so to the model
too. Measured: 17 → 9 headings, 12,325 → ~3,000 chars, 17 → 11 rendered pages.

**The Due Diligence scorer can score, and the verdict sentence can no longer
print holes.** `scorePropertyFundamentals` counted `dDemand` twice (as demand
AND "tenant fit") against a three-of-five floor, so a row without both real
dimensions never scored — `investment_score` was null on 11 of 11 strategic
rows and the verdict page printed "Graded  at  out of 100" with the holes
left in. Four honest dimensions now, floor stated in place (≥2 available, at
least one of location/demand), weights rebalanced 40/35/15/10. The fork falls
back to the parent's composite score when the variant scorer cannot compute
(a refresh never overwrites a good score with null) and carries the parent's
strengths/weaknesses/opportunities/risks onto variant scores, whose engine
leaves them empty. And the sentence itself is COMPOSED: the projection
publishes `recommendation.gradedLine`/`gradedDetailLine` only when grade and
score exist, with a weighting clause naming the dimensions THIS score carries
(`scoreSections.pure.ts`); the two verdict bodies bind it (template library
v12 + active-master refresh). Measured: the strategic child renders "Graded
C+ at 53 out of 100, weighted across location and planning risk." where it
rendered holes.

**Lineage is stamped.** `fork-investment-report` never wrote
`generation_engine`, so every child took the column default `legacy` —
including the four forked from a compass-40 parent — and never carried
`report_scope` at all. Both engines now stamp the parent's engine; the fork
carries scope.

Pinned by `tierFrameworkPhase1.spec.ts` (19 tests: composition, hygiene,
scorer, sentence, source-scans of both functions, the v12 migration pair).
Bridges keep the new pure modules inside the investment format's closed
import set; `condenseFacts` now shares `figures.pure.ts` with the composer so
one thousands-separator serves both.

---

## §20 — Phase 2: one registry, and what it found

Law 3 of the tier framework: *one registry is the constitution — structure is
selected by section id, never by matching heading strings, and a declared
section with no producer fails CI.* Shipped as
`_shared/reports/investment/sectionRegistry.pure.ts` plus
`sectionRegistry.spec.ts`, measured against the 1,199-row corpus on 6 September
2026.

### There were six competing structure definitions, not four

| # | Where | Shape | Read by |
|---|---|---|---|
| 1 | `generate-investment-report` `DEFAULT_REPORT_SECTIONS` (+3 scope variants) | 12 groups naming 26 H2s | the generator's prompt |
| 2 | `compassSectionRegistry.ts` | 12 `compass.*` + 11 `financial.*` ids | post-processor, QA validator, generator |
| 3 | `reportSplitRegistry.ts` | FIN 16 / PLDD 17, routed by heading substring | `fork-investment-report` |
| 4 | `condense-investment-report` `TIER_CONFIG[*].sections` | briefing 9, snapshot 6, financial 11 | **nothing** |
| 5 | the `structureGuide` prose in the same object | the headings a model is asked for | the model |
| 6 | an inline array at the snapshot's trim call site | 9 headings | `trimToDeclaredSections` |

Two more key on structure without declaring it: `PROSE_GROUPS`
(`sections.pure.ts`) groups by section **number**, and `TITLED_SECTION_CHARTS`
(`normalise.pure.ts`) attaches charts by title regex.

### What the corpus said about the declarations

**#4 was read by nothing, and the snapshot's copy was wrong.** Only `.name`,
`.targetPages` and `.structureGuide` are ever read. The dead snapshot list named
`Top Opportunities & Risks` and `Recommendation`; the guide beside it in the same
object literal asks for `Top 3 Opportunities`, `Top 3 Risks` and `Quick
Recommendation`, and for two more headings the dead list omits entirely. Six
declared entries against nine real ones. `contentRatio` was likewise never read.

**FIN declares 16 sections and two have never been produced.** Across all 11
financial forks ever made: `10-Year Cashflow, Equity & Growth Projection` **0**,
`Financial Investment Scorecard` **0**; ordinals 6, 10 and 13 appear on one
report each; 4, 5, 8 and 14 on two. Meanwhile `Disclaimer` — which FIN does not
declare — is on 11 of 11, because `renderVariantMarkdown` appends it
unconditionally.

**PLDD declares 17 and six consecutive ones appear on 1 of 11.** Ordinals 11–16
— tenant demand, resale appeal, **planning/zoning/title**, infrastructure,
environmental risk (2), supply pipeline — on the tier whose entire promise is due
diligence. Nothing measured this, because a list of strings cannot be asked
whether anything makes them.

**The compass-40 engine produced three different structures in five runs.** Two
rows carry exactly the 11 declared `includeInCompass` sections; two carry a v2.0
set of 17–18; one carries a hybrid with the **unmerged** v2.0 sections
(`Population & Housing Demand`, `Tenant & Buyer Profile`, `Employment & Economic
Linkages`, `Education & Family Amenity`, `Retail, Healthcare & Lifestyle
Amenity`, `Transport & Connectivity`) plus `Cover Page` and `Client Reading
Guide`, both of which the registry marks `includeInCompass: false`. The v3.0
merges existed only as a code comment.

**`PROSE_GROUPS` keys on numbers no recent report has.** Compass primary reports
in the last 90 days: 29, **0 numbered**. Older: 1,098, of which 144 (13.1%) are.

### The registry

38 sections, each carrying its provenance class, the headings production has
actually carried for it, and a placement per tier: depth, order, label, surface
and producer. It is the **union** of what every tier draws, because the tiers
disagree about granularity — Due Diligence splits demand across four headings and
risk across two where the Compass draws one of each — and a registry with only
the coarse ids cannot emit PLDD's list while one with only the fine ids cannot
emit the Compass's. `depth: 'merged'` with `mergedInto` carries the difference.

`sectionRegistry.spec.ts` (136 tests) resolves every producer by running it: a
composed ordinal must actually come out of `composeFinancialChapters` on a full
record, an authored section must be named in the prompt that asks for it, a
routed one must exist at that ordinal in the split registry, and a projection
namespace must be one `applyInvestmentProjection` really merges. It then asserts
FIN, PLDD and the Compass registry are each expressible as registry placements at
the same headings, so the three can drift only by failing CI.

That test earned its place immediately: the first draft of the registry named two
projection namespaces — `keyFigures.*` and `sources.*` — that do not exist.

### Two findings the producibility check surfaced, and the fixes

**The Briefing had no trim, and 21 of 21 carry the parent's structure.** Phase 1
re-cut the guide and shipped no enforcement; the snapshot got both halves and the
briefing got one. Of its nine declared headings, `Top 3 Opportunities` and `Top 3
Risks` appear on 16 reports, `Executive Summary` on **1**, and `Location &
Demand`, `Amenity & Access`, `Market Position`, `Property Fit`, `Risk Overview`
and `Recommendation` on **none** — while `Location Overview` is on 20 and
`Historical Price Growth Table` on 19. Both condensed tiers are now trimmed to
`markdownHeadingsForTier(tier)`, which returns the authored and composed headings
together — the reason the list has to come from the registry rather than from
either call site. Run against production row `89b451f6`, the trim keeps 5 of 29
headings and drops 24.

**`provenance` is spine and the Briefing had no producer for it.** The re-cut
guide never asks for a sources section, so a client's briefing would carry no
statement of what it rests on. `## Market Data Sources` is now in the guide,
worded so the section is never omitted and never filled with a placeholder.

**The trim will not empty a document.** If no *authored* heading survives, the
untrimmed text is kept and `sections_trim_skipped` recorded. The guard asks about
authored headings specifically because the composed chapters are appended by us
and always match — "something survived" would be satisfied by our own output and
say nothing about whether the model followed the guide.

### What Phase 2 deliberately did not do

Nothing routes on the registry yet. `reportSplitRegistry` still owns the fork's
substring routing and `compassSectionRegistry` still owns the generator's prompt;
both are now pinned to the registry rather than replaced by it. **A producer that
resolves is not a section that appears** — the Due Diligence tier's routed
producers are all correct and still put planning on 1 of 11 documents, because
routing depends on the parent carrying a matchable heading and the Compass parent
carries its planning content merged inside Risk Dashboard. That is law 4's
problem, and Phase 3 fixes it by assembling from stored sections rather than
re-reading a sibling document.

Pinned by `sectionRegistry.spec.ts` (136) and `tierRegistryAdoption.spec.ts` (11).

---

## §21 — Phase 3, part 1: can the registry recognise what production wrote?

Phase 3 assembles documents from the registry instead of by matching heading
strings. Before any of that could be designed, one number had to be measured:
**how much of the corpus does the registry actually recognise?** If assembly by
id cannot name a heading, that heading's content is lost.

### The measurement

Every `##` heading in the 1,199 stored reports: **966 distinct headings, 10,752
instances** — for a product with 38 sections.

| resolver | headings | instances |
|---|---|---|
| as Phase 2 shipped it | 278/966 (28.8%) | 6,529/10,752 (60.7%) |
| + multi-level ordinal fix | 295 (30.5%) | 6,898 (64.2%) |
| + qualified variants | 400 (41.4%) | 7,330 (68.2%) |
| + six section aliases (final) | — | **73.3%** on the committed fixture |

### The 966:38 ratio is the finding

The residue is not a set of sections the registry forgot. It is:

- **sub-headings the legacy generator promotes to H2** — `Strengths`,
  `Weaknesses`, `Opportunities`, `Threats` under SWOT; `Market Commentary:`,
  `Yield Commentary:`, `Loan Assumptions:` under their sections; the whole
  `11.1 …` / `15.1 …` / `4.2 …` family;
- **furniture that is not a section at all** — `📞 CONTACT US`, on 761 reports.

That decides the design. A partition that dropped what it could not name would
discard nearly a third of every legacy document; one that treated each
unrecognised heading as a section would fragment one SWOT into four. So:

> **An unrecognised heading is content belonging to the section above it. Never
> a section, never a deletion.**

`partitionByRegistry` implements it, and reports what it absorbed so a genuinely
new heading is visible rather than silently swallowed.

### Three rules that fell out of the measurement

**A sub-heading must not be an alias.** Adding `Strengths` to the alias table
would make it *open* a section, splitting SWOT into four. The absorb rule puts
it exactly where it belongs and costs nothing — so an alias is only ever a
heading a document uses as a section.

**Numbering outranks text.** `11.1 Public Transport Network` reduces to `public
transport network`, a genuine alias of `transport` — and opening a section there
cuts section 11 in half at its own sub-heading. The legacy generator numbers
top-level sections `1.` … `13.` and sub-sections `11.1`, `15.1`, `4.2`, so
`isSubHeadingByNumbering` treats two or more levels as a sub-heading whatever
the words say.

**A section id may repeat, and repeats are kept in order.** Production briefing
`89b451f6` carries 29 headings resolving to 21 sections, with `marketPosition`
four times and `tenYear` three. Collapsing them in the reader would merge bodies
written apart and reorder a client's document; how to fold them belongs to the
storage step, not to the text splitter.

### Two defects fixed

`normaliseHeading` required trailing punctuation after an ordinal
(`\d+(\.\d+)*[.)]`), so `9. Financial Analysis` normalised and `11.1 Public
Transport Network` did not — worth **3.5 points** of instance coverage. The
obvious fix, making the punctuation optional, overshoots: it would strip the
leading number of a real name, turning `2026 Market Review` into `market
review`. The rule shipped instead is that an ordinal is EITHER multi-level
(`11.1 `) OR punctuated (`9. `), never a bare number and a space. No corpus
heading has that shape today, which is the moment to close it rather than after
one arrives.

Qualified variants did not resolve at all — `Property Value Projections (AUD)`,
`Cashflow Analysis - Interest-Only Scenario (Year 1)`, `Education Facilities
(Extended List)`. Worth **4.0 points**. The separator must be a bracket, dash or
colon and never a bare space, or `Market Position` would swallow `Market
Positioning`.

### Verified against real documents

Four production documents spanning both engines and three tiers — 39.6k, 48.4k,
14.4k and 51.6k characters — partition with their non-whitespace content
**conserved exactly**. The compass-40 document resolves to precisely its 11
declared sections; the legacy Compass to 11 plus one absorbed heading (its own
title, correctly left in the preamble).

`fixtures/corpusHeadings.json` is the committed heading inventory: every heading
carried by two or more reports, scrubbed of the twelve singletons that named a
property address. It makes coverage a CI number rather than a one-off
measurement — a regression shows up as a failing floor instead of a quietly
thinner report.

Pinned by `corpusPartition.spec.ts` (21).

---

## §22 — What the record does not hold

Phase 3's next step was per-section storage. Measuring what could actually be
stored found something that changes the programme's priorities, so it is
recorded before any of that is built.

### The Due Diligence tier's defining section cannot be produced at all

`Planning, Zoning and Title Due Diligence` appears on **1 of the 11** Due
Diligence reports ever produced. Neither available producer can fix it:

- **Routing cannot.** The Compass parent folds planning into Risk Dashboard —
  the registry states this — so there is no section in the parent to route.
- **Composition cannot.** The record holds no planning data. Across all 1,199
  stored reports, `property_specs` carries a `zoning` key on 1,071 and a zoning
  **value on zero**; `location_intelligence`, present on 1,112, holds only
  `amenities`, `commute`, `coordinates`, `healthcare`, `lifestyle`, `schools`,
  `transport` and `walkScore` — no planning, zoning, overlay, title or
  environmental key at all.

Nor is it a wiring fault: no table in the schema carries residential zoning,
land size or council area. `zoning` exists only on `commercial_properties` and
`industrial_properties`, a different product. **The platform does not acquire
this data**, so the fix is upstream of the reporting engine.

It is now a declared gap (`PRODUCER_GAPS = ['strategic:planning']`) rather than
a placement claiming a producer that cannot produce. The tier keeps its promise
and the registry stops asserting something it cannot honour.

### Six of nine property attributes have never held a value

`property_specs`, measured over all 1,199 reports:

| attribute | reports with a value | | attribute | reports with a value |
|---|---|---|---|---|
| `property_type` | 1,071 | | `parking` | **0** |
| `bedrooms` | 651 | | `year_built` | **0** |
| `bathrooms` | 633 | | `building_size_sqm` | **0** |
| | | | `land_size_sqm` | **0** |
| | | | `council_area` | **0** |
| | | | `zoning` | **0** |

`reportBindingProjection` publishes all nine. So `property.landArea`,
`property.buildingArea`, `property.yearBuilt`, `property.zoning` and
`property.council` resolve to nothing on every document the product has ever
issued, and `configuration` renders without a car count because parking is
always absent.

**`propertyIdentity` is a spine section** — mandatory in every tier — and it is
substantially empty on every report. Law 2 says a labelled row is a promise that
a figure follows it; this is that law failing at the data layer rather than the
rendering one, which is why no amount of template or assembly work reaches it.

### And the financial model is thinner than it looks

`financial_calculations` is present on **202 of 1,199** reports (17%). Every
composed financial chapter — the Phase 1 work — is bounded by that. It is
correct on the rows that have a calculation and silently absent on the rest,
which is the designed behaviour, but it means the Financial tier's substance
exists for fewer than a fifth of the corpus.

### What this means for Phase 3

Per-section storage and assembly by id remain worth building, and they fix the
routing weaknesses. They cannot fix a section whose source data does not exist.
The registry now says which is which, so the next increment can build assembly
for the sections that can be assembled without implying the others are one
refactor away.

---

## §23 — The coordinate every location figure is measured from (2026-09-06)

Phase 3's measurement of what the record holds (§22) asked what is *absent*.
This asks a harder question about what is *present*: is the stored figure the
right one? For the location section the answer is available, because every
property in this corpus is in Australia and a coordinate outside it is not an
unusual property — it is a wrong answer.

### The measurement

Of the 1,112 stored investment reports carrying
`location_intelligence.coordinates`:

| | reports | share |
|---|---:|---:|
| inside the Australian bounding box | 929 | 83.5% |
| **outside Australia** | **183** | **16.5%** |
| **exactly Sydney CBD (−33.8688, 151.2093), to four decimals** | **64** | **5.8%** |

Sydney CBD to four decimals is not a coincidence; it was this service's
hard-coded failure value. Together, **247 of 1,112 reports — 22% — carry a
coordinate that is either not in Australia or is the geocoder's way of saying
it gave up.**

The twelve most-repeated foreign points, with the address that produced each:

| address as stored | resolved to | reports |
|---|---|---:|
| `Keystone Drive` | Blacksburg, Virginia | 8 |
| `124 First Avenue` | Manhattan, New York | 7 |
| `Walbrook Drive` | Knoxville, Tennessee | 7 |
| `Prophets Street` | Bulacan, Philippines | 7 |
| `590 Walker Street` | Manhattan, New York | 7 |
| `40 Avondale Road` | Auckland, New Zealand | 6 |
| `84-85 Pacific Boulevard` | Long Island, New York | 6 |
| `4 Lilac Close` | Bristol, England | 5 |
| `44 Frederick Street` | Edinburgh, Scotland | 5 |
| `63 Lakeview Drive` | North Carolina | 5 |
| `7 Kinghorn Street` | City of London | 4 |
| `25 Acacia Avenue` | Ottawa, Canada | 4 |

### Why this was invisible

Every figure in a report's location section — the amenity counts, the nearest
school and its rating, the walk score, the CBD commute — is measured *from the
coordinate*, by real Google Places and Distance Matrix calls that succeed. A
wrong coordinate does not make them fail. It makes them describe somewhere
else, accurately. A report for a property in Perth carrying Sydney's schools
and Sydney's walk score contains no error a reader can see, no `N/A`, and
nothing the placeholder scrub or the fact-checker can catch: the numbers are
real, they are just about a different place. This is the same failure class as
`cotality-scoping.md`'s note on score clustering, and it is the reason that
note existed.

### Four faults, each sufficient on its own

**1 · The question had no locality.** The service is handed `suburb`,
`postcode` and `state`, and spent them on the CBD lookup and the
public-transport call. The one request that actually needed a locality — the
geocode — was given `input.address` alone. Split by what the address itself
said:

| the address names… | reports | landed outside Australia |
|---|---:|---:|
| a state **and** a postcode | 283 | **1** (0.4%) |
| neither | 768 | **180** (23.4%) |

That is the cause. A bare street name exists in every English-speaking
country, and Google was not malfunctioning — it was asked an ambiguous
question and returned one of its correct answers.

**2 · No country filter.** `components=country:AU` is a filter;
`region=au` is only a bias, and the request carried neither.

**3 · Nothing checked the answer.** `auGeoSanity.pure.ts` — country box, land
mask, state cross-check — already existed and is already applied by
`resolve-listing-coordinates`. This geocoder did not ask it.

**4 · Failure returned Sydney CBD.** Not an error, not a null: a coordinate,
indistinguishable downstream from a real one.

Faults 1 and 2 are not alternatives, which is the trap here. The country
filter *alone* only relocates the error: `Keystone Drive` restricted to
Australia resolves to some Keystone Drive here, in the wrong suburb, inside
the country box, past every gate. Composing the query is what makes the answer
right rather than merely local.

### What changed

- `_shared/auGeocodeQuery.pure.ts` composes the query from the parts the
  service already holds, never repeating one the address already spells.
- The request now sends `components=country:AU` **and** `region=au`.
- The answer goes through `assessAuPoint` — the shared gate, not a second
  bounding box written beside it.
- An unresolved address returns `success: false, resolved: false` with a
  reason, **not** the sample-data branch: sample data is a fact about no
  property, an unresolvable address is a fact about this one, and a caller
  must be able to tell them apart.
- A caller-*supplied* coordinate goes through the same gate, because the
  stored rows are where the 183 live and handing one back is the door a fix on
  the fetch path alone would leave open.

Both report consumers already guard on `success && data`, so a refusal lands
them in the path they take when the service is unreachable:
`enhancedData.locationIntelligence` stays undefined, where the existing
coverage flag records it.

### The trade this makes, stated plainly

A refused geocode means the location section is **absent** rather than wrong.
That is the intended direction — a reader can see an absent section and cannot
see a correct-looking figure measured from the wrong continent — but it is a
real cost and the expected volume is small: the 283 addresses that already
name a state and a postcode geocoded correctly 282 times, and the 768 that
name neither will now be asked *with* their locality rather than without it.
The expected outcome for most of the 183 is a **correct** coordinate, not an
absent one.

### Two things deliberately not done here

**No backfill.** The 247 stored rows are untouched; nothing is re-geocoded and
no vendor call is spent. Fixing forward stops the fault reproducing; repairing
the record is a separate, authorised decision.

**`generateMockLocationData` is untouched and remains a live defect.** It is
reachable on three branches — no API key, a Google API error, and the
top-level catch — and each returns **HTTP 200 with `success: true`** carrying
invented school names (`Primary School A`, `High School B`,
`Private College C`), an invented `Central Station`, a random walk score
(`Math.random()`), a random commute, and Sydney's coordinates. Exactly one
consumer inspects `usingMockData`, and it only `console.warn`s while using the
data anyway; `regenerate-report-qualitative` does not check it at all. That is
a larger behaviour change than the one made here and is recorded rather than
taken unilaterally.

---

## §24 — The invented data behind the reports (2026-09-06)

§23 found one fabricator (`generateMockLocationData`) while fixing the
geocoder. Sweeping for the class found **seven of the nine external-data
services** behind report generation answering "I don't know" by inventing —
and every one of them reported as normal operation, which is why the class
survived the platform's whole life. This section is the record of what was
measured, what was removed, and what now guards the door.

### The measurements, service by service

**`abs-data-service` — the worst of them.** It never called the ABS at all:
its four live-API functions (`fetchPopulationData`, `fetchIncomeData`,
`fetchHousingData`, `fetchEmploymentData`) had **no caller anywhere**. Every
request was answered by one of THREE invented profiles for the whole of
Australia (eleven named postcodes were "high-income metro"; NT/TAS/SA were
"regional"; everywhere else "standard suburban") with `Math.random()` jitter
on population, density, income, age and rent, labelled
`source: 'ABS Census 2021 estimates'` — then **cached for 30 days and served
back as `'ABS Census Cache'`**, the fabrication laundering itself into a
cache hit, while `api_health_log` recorded a successful `abs-census` call
that was never made. In production:

- **849 of 1,199 stored reports, across 500 distinct properties, carry the
  identical profile**: growth 2.5%, unemployment 3.5%, owner-occupiers
  69.8%, participation 68.4% — every suburb in the country, the same suburb.
- `10 Chester Street` holds **20 reports with 20 different populations**
  (16,245 → 38,773), median income $99,003 → $141,343, rent $520 → $689.
  Regenerating a report re-rolled the demographics.

**`public-transport-service`.** Eight per-state "fetchers" that ignored the
coordinate entirely: every NSW property was 450m from Central Station with
lines T1–T8; every VIC property 250m from a Swanston Street tram; every
state a hard-coded landmark list with an invented `qualityScore` — which
drove up to 30 points of every report's walk score through
location-intelligence, overriding Google's real, coordinate-measured transit
results. Its error path invented a *different* answer ("Unknown", 999m,
score 25).

**`abs-employment-service`.** A labour-force size of
`15000 * (0.5 + Math.random() * 0.5)` — a random number of workers —
hard-coded tables for five states (TAS, NT and the ACT silently received
NSW's figures), canned job growth (`+2.8%` annual, everywhere), a fixed
occupation breakdown, and a canned `futureOutlook: 'Positive'` paragraph for
every suburb in the country, all under `dataSource: 'Australian Bureau of
Statistics (ABS)'`, `dataset: '6202.0 - Labour Force, Australia'`.

**`crime-statistics-service`.** Postcode bands invented **counts of
offences** ("Break and Enter: N"), a safety score, and "22% higher than
state average" — a comparison against a statistic nobody computed. Its
per-state fetchers did call the open-data catalogues, then discarded the
response at a `// TODO` and fell through to the invention. An invented crime
figure defames a suburb or falsely reassures a buyer; either way it is
libel-shaped.

**`climate-data-service`.** One climate per state — every property in NSW
shared one annual rainfall (1,150mm) from Bourke to Bondi — cached **365
days**. Its own comment conceded there was no source ("BoM's open data
delivery is currently suspended … We'll use climate zone patterns").

**`abs-seifa-service`.** Real attempts against the ABS API and data.gov.au,
then a fallback that assigned socio-economic deciles from postcode folklore
("Eastern suburbs decile 10, Western Sydney decile 4") with scores derived
as `900 + decile × 10` and the sibling indexes as ±constants.

**`school-data-service`.** Real directory + real Google Places, then a final
fallback that invented **named institutions** — `"${suburb} Public School"`,
ICSEA guessed from a postcode list, 450 students — schools that do not
exist, in a client's report.

**`rba-data-service`.** A real live path (domain-filtered search over
rba.gov.au/abs.gov.au, temperature 0, range-validated, cited). But all four
failure exits returned a cash rate **hard-coded at 4.10%** and stamped with
**today's date** — over a year stale at removal, presented as current, with
an `isFallback: true` flag that nothing anywhere read.

**`risk-assessment-service`.** The most real of the nine — AFRIP flood
queries and actual state bushfire-mapping services. But its fallbacks
invented: any suburb whose *name* contained "hills", "ranges" or "forest"
was rated **Extreme** bushfire risk (Baulkham Hills and Surry Hills alike);
fifteen suburb-name fragments decided flood risk by substring (anything
containing "kew" inherited Maribyrnong's flood history); and an outage was
cached for 180 days.

**The caches, in total:** `abs_census_cache` 123 rows, `climate_data_cache`
1,237, `crime_statistics_cache` 140, `transport_data_cache` 639 — **2,139
rows, 100% `data_quality = 'estimated'`, zero live**. No real fetch ever
completed in any of the four. (`risk_assessment_cache`: 169 rows, 100%
live — AFRIP is real.)

**The clean counter-example:** `domain-data-service`. Real API; on failure,
`success: false` with a status-only `fallbackData` carrying no figures. The
pattern existed in-repo the whole time.

### The rule, and what changed

**A source that cannot answer says so.** A missing section is a visible
absence a reader can weigh; an invented one is a defect nobody can detect,
because every downstream figure is computed from it correctly. This is the
same asymmetry the AML programme records as "refusal is visible, a confident
clear against nothing is not".

- **`_shared/sourceUnavailable.pure.ts`** is the one honest answer:
  `{ success: false, data: null, unavailable: true, service, reason,
  message }` at HTTP 200, with four reasons that each name a different
  remedy (`not_configured`, `provider_error`, `source_not_integrated`,
  `no_data_for_location`). No field on it can carry a figure.
- Every generator is **deleted, not bypassed** — a dormant generator is one
  code path away from coming back (the agreements programme's rule). The
  real paths (AFRIP, state bushfire mapping, schools directory, Google
  Places, Domain, the RBA live retrieval, the two SEIFA attempts) are
  untouched.
- Both report pipelines already attach data only on `success && data`
  (verified at every call site; no `fetchServiceWithFallback` caller passes
  a fallback value), so a refusal lands in the exact path taken when a
  service is unreachable, and the existing coverage flags record it.
- Public-transport's consumer needed one guard: that service historically
  returned a **bare** payload, so the envelope would have read as data —
  `isSourceUnavailable()` in location-intelligence keeps the refusal from
  outranking Google's real transit results.
- Risk-assessment keeps its composite shape (a real flood reading can stand
  beside an unavailable bushfire one): its fallbacks now return `level:
  'Unknown'` with the reason and the official source, and **an outage is
  never cached**.
- Migration `20261112020000` purges the 2,139 fabricated cache rows —
  filtered on `data_quality = 'estimated'` so anything a real integration
  writes survives — and `abs-data-service` reads its cache `live`-only, so a
  straggler row from a not-yet-redeployed old revision cannot be served
  either.
- `api_health_log` is no longer told a story: nothing logs a successful
  call that was never made.

### What guards the door

`scripts/security/check-fabricated-data.mjs`, wired into `ci.yml` and
`security:test` (gate 56; the gates-wired check counts it):

1. A **`Math.random()` ratchet** over `supabase/functions/` — every
   occurrence must be named in
   `supabase/functions-registry/math-random-allowlist.json` with a reviewed
   purpose (jitter, ids, SVG handles); counts may only fall. Comments are
   stripped first, because the removal deliberately left the history in
   comments.
2. The ten de-fabricated services must keep their honest-absence contract
   and must not reintroduce any generator by name.

The negative-test harness proves the gate bites: a mutation reintroducing
`getMockABSData(` fails it (38 controls removed → 38 gates failed).
`src/lib/reports/__tests__/fabricatedDataRemoval.spec.ts` pins the same
contracts in the verify job, plus the consumer guards and the purge
migration's shape.

### What this costs, and what fills the hole

New reports will carry **absent** demographics, employment, climate, crime,
SEIFA and transport-detail sections until real integrations exist, and
that is the point: the sections were never real. The acquisition paths are
recorded at the head of each service — ABS Census 2021 GCP DataPacks by POA
(CC BY 4.0; G01/G02 carry exactly the promised fields) loaded on the
sanctions-register pattern; ABS 6202.0 for employment; BoM climate averages
by station; BOCSAR/CSA/QPS et al. for crime; GTFS feeds for transport. The
live ABS SDMX API could not be verified from this environment (egress
blocked), and an unverified parser of a statistical agency's API is how the
last version of `abs-data-service` started.

**Stored reports are untouched.** The 1,085 rows carrying fabricated
demographics are delivered records; repairing history is a separate,
explicit decision, exactly as with §23's coordinates.

### Also noted

`admin-user-management` generates a temporary password with
`Math.random()` — not report data, but not a CSPRNG either. Flagged in the
allowlist as a hardening follow-up (`crypto.getRandomValues()`), with its
entry pinned so it cannot grow.

---

## §25 — The real data arrives: ABS Census by postal area (2026-09-06)

§24 removed the invented demographics; this section records their
replacement with the Australian Bureau of Statistics' own figures — loaded,
verified, and serving. The sections that used to be fabricated
(demographics, employment, SEIFA) are now **real, postcode-level, and
labelled with their true reference period**.

### What was loaded, and how it was verified

Two published ABS sources (both CC BY 4.0):

- **2021 Census GCP DataPack, POA level, Australia** — tables G01 (persons),
  G02 (medians and averages), G37 (tenure), G46 (labour force status), G54
  (industry of employment), G60 (occupation). Every column name was
  transcribed from the pack's own metadata workbook, never guessed, and a
  wrong name throws at parse — the Airtable lesson, enforced.
- **SEIFA 2021, Postal Area indexes** — all four indexes with scores and
  deciles. The workbook's column order is **IRSD first, then IRSAD** — read
  from the header and verified at parse time, because the platform's old
  fabricated shape listed IRSAD first, and assuming that order would have
  swapped *advantage* for *disadvantage* on every report.

Verification is refusal-shaped and ran before any write: a zero-row parse
refuses; a POA count outside Australia's range refuses; a national
population sum away from the Census's 25.42M refuses; a failed SEIFA join
refuses. The load that passed:

| | |
|---|---|
| census rows | **2,643** postal areas |
| national population (sum) | **25,422,756** (the Census counted 25,422,788; POAs exclude the migratory/offshore remainder) |
| SEIFA rows | **2,627**, all matched to census POAs |
| spot checks | POA 2150 medians byte-identical to the raw G02 row; Point Piper (2027) IRSAD decile 10 at $3,027/wk household income; Sydney CBD 71% renters with IER decile 1 |

Two independent implementations of the parse (a Node scaffold and the
shipped `_shared/absPoaIngest.pure.ts`) produced identical summaries on the
same files before the scaffold was deleted.

### Where the loader lives, and why

**`abs-poa-ingest` is an edge function** — the loader runs where the
credentials and the egress already live. That is the corrected form of the
sanctions-register lesson: a repository-secret loader "has never had the
secret it needs to write", and this sandbox's proxy cannot even reach
`api.data.abs.gov.au` — but Supabase's own egress fetched the DataPack from
abs.gov.au without complaint. Two invocations
(`{"stage":"seifa"}`, `{"stage":"census"}`) download, parse, verify and
upsert; the split exists because the single-pass version exceeded the edge
worker's memory (WORKER_RESOURCE_LIMIT, first invocation, recorded in the
function header). Refreshing for the 2026 Census (releases mid-2027) is:
update two URLs and the reference period, deploy, invoke.

Auth is the internal edge secret — or, exactly once, an **empty database**:
the bootstrap arm that permitted the first load seals itself the moment
`abs_census_poa` holds a row, and re-opening it would take deleting the
reference data, which already requires the service role. The sources are
public and the write is an idempotent upsert of that public data.

Also learned on the way, at the cost of one refused invocation each:
Supabase's bundler only imports from its CDN allowlist (SheetJS ships from
its own CDN; the last npm-registry release, 0.18.5, was verified to parse
the real workbook identically before being pinned), and PostgREST caps a
read at max-rows — a `.limit(5000)` silently returned 1,000 and the census
stage refused a database that was loaded, so the key read paginates.

### What serves it

`abs_census_poa` and `abs_seifa_poa` (RLS-enabled, service-read), with the
load recorded in `abs_poa_sync`. Three services now read them through one
projection module, `_shared/absCensusProjection.pure.ts`:

- **`abs-data-service`** serves population, medians (age, rent, household /
  personal / family income, mortgage), tenure rates and employment
  structure, labelled `ABS Census 2021 (POA xxxx)`.
- **`abs-employment-service`** serves the local labour force: rates with
  **named denominators** (employment rate = employed ÷ labour force; the
  employment-to-population ratio published under its own name — the
  fabricated predecessor blurred them), industries sorted by measured
  employment, the occupation breakdown, and the personal-income median.
- **`abs-seifa-service`** serves the four indexes from the loaded register.
  Its two never-verified live-API attempts were deleted — one walked the
  whole country's SDMX inside a 5-second timeout by construction.

A postcode the Census does not cover answers `no_data_for_location` through
the §24 envelope — real absence, never a neighbour's figures.

### Accuracy and timeliness, reconciled

Census figures are 2021 **because they are 2021** — the most current
authoritative postcode-level source until the 2026 Census releases — and
every block carries `referencePeriod` so no figure wears a date it does not
have. Current *conditions* stay on the live RBA retrieval beside them. The
annualised incomes are weekly medians × 52 and say so. And where one census
cannot measure change, **no change is asserted**: there is no growth field
anywhere in the projection, and the prompts now say so out loud.

### The prompts stopped lying about their tables

The generator's Demographics section used to hard-code its industry rows —
"Professional Services" was row one and "Construction" row five **for every
suburb in the country**, filled from `industries[0..4]` regardless of what
those indexes held — sourced everything as "ABS (2025)", and fell back to
ratings that asserted ("Moderate Advantage") precisely when there was no
data. `_shared/reports/censusPromptBlocks.pure.ts` composes those tables
from the data now: real industry names sorted by measured share, true
vintage labels, rows only where figures exist (law 2), one honest line when
nothing is available, and an explicit instruction that no growth figure may
be asserted because none is measured. The suburb-scope prompt's placeholder
skeleton and the regeneration function's growth lines got the same
treatment.

### What remains fabrication-free but not yet real

- **Crime** — BOCSAR (NSW) answers this sandbox (200); VIC's CSA 403s
  scripted clients (the DFAT class). Per-state loads with per-state
  reference periods are the next `abs-poa-ingest`-shaped build.
- **Climate** — BoM 403s scripted clients; SILO (Queensland government,
  BoM-derived) is blocked from this sandbox's proxy but untested from
  Supabase egress, which today proved able to reach what the sandbox
  cannot.
- **Transport detail** — the section already carries real coordinate-based
  Google transit results; GTFS adds route/frequency depth later.

Until built, those sections stay honestly absent under §24's envelope. The
`abs-poa-ingest` pattern — fetch where egress lives, parse through a pure
module under test, refuse the implausible, record the sync, label the
vintage — is the template each should follow.

## §26 — The deploy that ships all of this had been red for a day (2026-09-06)

Confirming that §24 and §25 actually reached production found the fleet
deploy failing: **thirteen consecutive `deploy-supabase-functions` runs on
main were red** (runs 487–499, 2026-09-05 06:33 → 2026-09-06 05:17), every
one with the same single line — `failed to deploy: mcp`, HTTP 413 "request
entity too large". The failure was *bounded*: the workflow deploys the fleet
alphabetically and collects failures, so every reporting function shipped
(§24's nine honest services and both generators are live from run 499;
`abs-*` deploy first in the loop). But a red run is indistinguishable from a
failed ship without reading its log, and the one function that failed had
been undeployable for 24 hours with nothing saying so.

The cause is recorded in the broken file's own header. `mcp/index.ts` is
regenerated by @lovable.dev/mcp-js's Vite plugin and hardcodes `npm:`
specifiers; the hand-written `deno.json` beside it remaps them to esm.sh,
which is the only thing that keeps the bundle deployable (measured: 38
modules / 0.69 MB mapped, against 182 dependencies / 87 MB raw — 26 MB
bundled — unmapped). On 2026-09-05 06:20 the plugin regenerated the file
from 0.26.3 to **0.28.0**; the map's keys stayed at 0.26.3; and an
import-map key that does not exactly match is **silently ignored**. The
map's own RULES block predicted precisely this ("you would be back to 25 MB
with nothing saying so") — a warning is not a gate.

Fixed by moving the two keys to 0.28.0 (the zod key still matches) and
verified the way the original map was: `deno info` shows zero npm-resolved
modules, `deno check` is clean, and the server was booted locally —
`initialize` negotiates, `tools/list` emits the zod-derived schema,
`tools/call echo` round-trips, an empty string is refused `too_small`.
`mcpFunctionImportMap.spec.ts` is the gate the warning lacked: every `npm:`
specifier in the generated entrypoint must have an exactly matching map key,
versions must agree between key and URL, every mapping must resolve to
esm.sh, and no `deno.lock` may sit beside the function (the spec caught this
audit's own local runs writing one). The spec fails on the exact broken
state that shipped; regeneration can no longer strand the map silently.

## §27 — Planning, zoning and what is coming through council (2026-09-06)

The user's confirmation of the §25 build queue led with property-level
planning: zoning, and "what developments are to be coming in the local
LGA … from a council application perspective". `planning-data-service`
delivers it from each jurisdiction's OWN planning services, on the
research doc's rules (`ZONING_BY_JURISDICTION.md`, now carrying a second
executed round).

**What a report now receives, per property coordinate:**

- **Zoning** for NSW, VIC, TAS and ACT — verbatim zone code, the
  instrument's own label, the planning instrument, LGA and the layer's own
  currency date, plus a derived national *family* that a test forbids from
  ever being printed as the zone.
- **Parcel** for QLD — surveyed lot area (labelled surveyed), lot/plan,
  tenure, LGA — the state where zoning is per-council and the cadastre is
  the strength.
- **State development instruments** for QLD — PDAs, SDAs, coordinated
  projects, infrastructure designations at the point (executed: Moranbah
  sits inside the Central Queensland Gas Pipeline coordinated project).
- **Development-application intelligence** for NSW — the Online DA API,
  no key required: executed end-to-end for Muswellbrook (183 days): 99
  applications, $66.3M stated cost of development, 83 new dwellings
  proposed, status distribution, top development types, largest projects.
  Costs stay attributed to applicants; a sample says both numbers.
- **A verification instrument sentence** per jurisdiction (s10.7 NSW,
  planning and development certificate QLD, Crown lease purpose clause
  ACT, …): the layer is indicative, the certificate is the instrument.

**The router is the services themselves.** No bounding boxes: the
integrated layers are point-queried in parallel and the polygon containing
the point answers (executed: the NSW layer answers a definite empty for a
VIC coordinate). `assessAuPoint` gates the coordinate first — §23's rule,
one implementation.

**Every absent cell says why**, and the reasons are different sentences:
QLD zoning is `not_served` (set per council scheme); WA is
`licence_restricted` (SLIP terms bar commercial republication — nothing is
fetched at all); SA/NT are `not_integrated` (every host refused this
egress; no parser may ship unverified against a response nobody has seen);
an unreachable register is `unavailable`, is never cached, and can never
read as "no zoning exists".

**Prompt honesty extended (§25's pattern):** the 38-page property prompt's
"Population & Development Trends" placeholder — which invited "[planned
infrastructure and residential developments] set to [impact]" — now
instructs the model to write ONLY from the planning block and to name no
project the data does not contain.

Verified: 30-test spec on captured live fixtures; the composed adapters
executed against all five services and the DA register through the shipped
code; deno check clean; column gate, verify-jwt gate (427/427) and the
deterministic inventory regenerated in order. The `planning_data_cache`
migration is applied in production; the service and rewired generator ship
on merge.

## §28 — Recorded crime arrives: BOCSAR and QPS by the platform's own geography (2026-09-06)

Q1 of the confirmed build queue. The §24 crime fabricator (postcode bands
inventing counts, a `safetyScore`, "22% higher than state average") is
replaced by two loaded registers, production-verified byte-identical to
their sources:

- **NSW — BOCSAR recorded criminal incidents by month by POSTCODE**: 622
  postcodes × 21 offence categories, Jan 1995 → Dec 2025, quarterly
  releases. Postcode-keyed — the same geography as everything else.
- **QLD — QPS reported offences by LGA**: 78 LGAs × 92 offence columns,
  Jan 2001 → **Jul 2026**, monthly releases. The LGA arrives from the
  planning cadastre's own shire name (§27) and matches the register by
  the same normalised-token rule the DA lookup uses.

Three measured quirks carry the load: QPS's stray apostrophe in
`Common Assault'` (the file's own header, transcribed exactly); an
unnamed 95th cell on every QPS row that is a running row counter,
validated and discarded; and a column set that MIXES rollups with details
— the hierarchy was measured (400/400 rows per identity), the ingest
re-checks it per load, and the reading presents one level at a time so
nothing double-counts.

The reading is counts and their arithmetic: 12-month totals against the
prior window, six complete calendar years, and a per-100k rate **whose
denominator is named** — the NSW benchmark divides by the 2021 Census
population of exactly the file's own 622 postcodes (all 622 matched):
617,838 recorded offences ≈ 7,598/100k. QLD offers state count-change
context and no rate, because no LGA population source is integrated yet.
No score, rating or adjective — a spec bans the fabricated vocabulary
from the reading, the service and the prompt block, and both fabrication-
shaped prompt templates (`overallRating || 'Medium'`, `Safety Score
XX/100`) are replaced by the composed block.

Two lessons were paid for on the first production load and are recorded
in `CRIME_SOURCES.md`: a whole-table bootstrap seals after stage one (the
arm is per state now), and a 60 MB inflated string exceeds the edge
worker (the NSW stage streams the zip's single deflate entry located from
the central directory — verified byte-identical to the whole-string parse
before deploying). Other states answer `no_data_for_location` naming
their real register; VIC's CSA refuses scripted clients, the DFAT class.

## §29 — Climate arrives: SILO at the property's own grid cell (2026-09-06)

Q2 of the confirmed queue. The §24 climate fabricator (one rainfall for
all of NSW, Bourke to Bondi, cached 365 days) is replaced by the
Queensland Government's SILO Data Drill: monthly values interpolated onto
a ~5 km grid from Bureau of Meteorology observations, CC BY 4.0 with the
licence stated in the response itself. One request per grid cell covers
1991 → the last complete month; `climateReading.pure.ts` computes the
Bureau's standard **1991–2020 normals** and refuses a normal over a hole,
an implausible value (the sentinel guard), a headerless error page or a
truncated series.

Three honesty rules carry the reading: the hottest, coldest, wettest and
driest months are **named from the data**, never assumed to be January and
July (executed: Wyndham Vale's wettest month is November — the western
Melbourne rain shadow — while Brisbane's is February); the recent 12
complete months are compared **like for like** against the same calendar
months' normal, never "this year so far" against a full-year figure; and
the basis is disclosed — an interpolated grid value, not a station record,
with the SILO/BoM attribution its licence asks for.

Executed against the live service for three corpus coordinates before
shipping (Brisbane 1,103.8 mm, Parramatta 890.3 mm, Wyndham Vale
458.9 mm annual normals, all with recent windows through 2026-08). The
service caches per grid cell (`climate_normals_cache`, 30-day TTL, applied
in production), answers honestly without a coordinate, and a transport
failure or refused parse is `unavailable` and never cached.

The prompt honesty extends to the whole **Environmental Risks & Climate**
section: the old template attributed placeholder fallbacks to the Bureau
(`climateZone || 'Temperate'`, `XX.X°C` cells labelled BoM) and RATED
hazards nothing measures (`Storms | Moderate`, `Cyclones | Low` as
literals, heatwave/bushfire/flood falling back to asserted levels exactly
when no assessment existed). `climateStatBlocks` renders measured figures
with their windows, hazard rows only where the risk services returned a
real level, and instructs the model to name no climate zone and rate no
unmeasured hazard. The suburb snapshot's placeholder risk table got the
same treatment.

## §30 — Macro figures from the RBA's own tables, not a search model (2026-09-06)

**Q3 of the confirmed queue.** The Current Economic Context section was the
last place a report's figures came from a model rather than a register:
`rba-data-service` asked Perplexity for "exact current values", coerced
absences with `|| 0` (a 0.0% unemployment rate), stamped every figure with
the retrieval date, and labelled a ten-year CPI path "RBA SMP forecast"
whether or not any forecast had been read — while the generator printed
hardcoded fallbacks (`|| '4.10'` on the cash rate, a year stale against the
real 4.35%) under a heading that said "VERIFIED ECONOMIC DATA", and
`financial-calculator-service` indexed real dollar arithmetic against the
model's projections.

The figures now come from three published RBA statistical tables — F1.1
(cash rate target), G1 (consumer price inflation) and F5 (indicator lending
rates) — parsed by `_shared/rbaTables.pure.ts` from layouts transcribed off
the real files, loaded into `rba_observations`/`rba_series_meta`, and
composed by `_shared/rbaReading.pure.ts`. The acquisition log is
`docs/reports/MACRO_SOURCES.md`. What was measured before anything was
written: **rba.gov.au 403s this project's egress** (Akamai, all three CSVs,
probe deployed and executed), so the ingest takes the sanctions-register
shape — `scripts/rba/load-rba-tables.mjs` downloads where egress works and
POSTs the text verbatim; ALL parsing is server-side, refusal-shaped
(layout drift, truncation floors, per-units plausibility bounds, absent
wanted series), and **an empty value cell is an absent observation, never
zero** — G1 pre-prints future ABS reference periods with empty cells, and
reading one as 0 prints a 100-point CPI collapse.

The reading serves every figure with its own reference period ("4.35%,
monthly average, August 2026"; "3.9% year-ended, June quarter 2026") and
each table's own publication date; the cash rate's last move is dated by
arithmetic on the series (June 2026, 4.31 → 4.35), never asserted as a
board decision; the investor lending rates the old path never had are
served beside the owner-occupier ones (investor standard variable 9.35%,
July 2026). **GDP, unemployment and participation left the response and
the prompt entirely** — these tables do not measure them, a test asserts
the vocabulary is absent, and the prompt block forbids the model from
stating them (the timeliness stream brings measured labour figures). The
CPI path the financial engine indexes against is now
`cpiProjectionsFromMeasured` — the ONE implementation, the engine's silent
local convergence copy deleted — and every year's label begins
"Assumption —"; a test asserts no year can claim SMP, Treasury or
forecast.

Loaded and verified in production before merge: 11 series, 3,518
observations via the shipped loader; the per-table bootstrap arms sealed
(re-POST without the secret answers 403); the service's four-year window
measured at 394 rows against PostgREST's 1,000-row cap; and the store's
figures re-checked by SQL (4.35 / 3.9 / 9.35). The stale search-model
cache entry (`economic_data_cache`, `rba_indicators`, fetched 2026-09-04)
was purged — nothing reads or writes it any more.

## §31 — The first measured growth figures: ERP by the property's own SA2 (2026-09-06)

**Q4 of the confirmed queue, first half.** Every "population growth" figure
in every report was model memory: the Census tables carry 2021 levels and
no trend, and the prompts asked for growth prose anyway — the Demand
Drivers skeleton went as far as demanding an annual job-growth percentage,
a participation rate and an unemployment rate no source measured.

Population is measured now. `abs-regional-ingest` fetches the ABS Regional
population datacube itself (abs.gov.au answers this project's egress —
probed before building; the ABS SDMX API and the SALM hosts refuse it) and
`_shared/absRegional.pure.ts` parses ERP at 30 June per SA2, 2001–2025,
refusal-shaped: drifted headers, a broken year run, an implausible count
or value, or a latest-year national total outside the measured
plausibility anchor (27,613,654) all refuse the load; the file's ".."
marker is an absent observation, never zero (Norfolk Island's
pre-inclusion years — the one SA2 that carries it), while a measured 0 is
a real value. Loaded in production before merge: 2,454 SA2s, 61,335
observations — 61,350 minus Norfolk's 15 absences, the count being the
rule working.

The reading is the property's OWN area: `abs-regional-service` resolves
the coordinate to its SA2 through the ABS ASGS2021 geoserver (measured
reachable; cached per ~110 m cell, transport failures never cached) and
serves that SA2's series with 1/5/10-year growth windows that render only
where both endpoints were measured, never bridging a hole and never rating
growth against a zero base. Executed end-to-end on the real workbook: the
Parramatta test coordinate's SA2 (125041717 "Parramatta - North") reads
14,904 residents at 30 June 2025, +478 (+3.31%) in a year, +74.21% over
ten — figures of exactly the kind reports used to invent, now carrying
their windows and release.

The unemployment half (SALM, DEWR) is one operator action from done and
deliberately not guessed at: every vantage this programme holds is refused
at the IP level by DEWR's hosts, no reachable mirror carries the current
file, and the parser doctrine (transcribe from the real file, refuse
drift) cannot be satisfied against a file nobody can reach.
`docs/reports/REGIONAL_TRENDS.md` records the gate; the service serves
`unemployment: null`; the prompt blocks FORBID stating a rate; and the
Demand Drivers skeleton that demanded invented labour figures is rewritten
to draw only on measured tables.

## §32 — The regeneration path had drifted out of parity (2026-09-07)

Found while taking stock after the timeliness stream: **a regenerated
report was not the same report.** `regenerate-report-qualitative` is the
path a client's report takes when an operator revises it, and it had
fallen behind the generator on every stream shipped this programme.

Four faults, each of which reported as normal operation:

**It read shapes the services no longer produce.** The context block
composed its own crime and climate prose from the pre-rework fields —
`crime.safetyScore`, `crime.comparisonToState`, `climate.climateZone`,
`climate.temperature.summer/winter`, `climate.rainfall.annual`. The crime
rework deleted that vocabulary outright (a spec bans the word
`safetyScore` from the module) and the climate rework deleted zone naming
because naming a zone is exactly what the fabricator did. So eight
labelled rows rendered **"N/A" on every regenerated report** — the "blank
a model should fill" invitation this programme exists to remove, sitting
in the one path nobody re-read after the reworks.

**It asked a coordinate-keyed service without the coordinate.** Climate
was called with `{suburb, state, postcode}`; since the SILO rewrite made
the coordinate the question, that call could only ever answer
`no_data_for_location`. Climate was unconditionally absent from every
regenerated report.

**It never asked two services at all** — planning and regional trends were
not on the path, so a regenerated report silently lost the zoning block
and the population trends a freshly generated one carries.

**It misnamed five of its own sources** in the client-facing attribution
list: climate credited straight to the *Bureau of Meteorology* (it is
SILO, the Queensland Government's BoM-derived grid, whose CC BY 4.0
licence asks for its own attribution), schools to *ACARA/MySchool* and
*NAPLAN* (a schools directory and Google Places), employment to the *ABS
Labour Force Survey* (the Census), market data to *Domain/CoreLogic*
(CoreLogic is deliberately not integrated), and crime to *safety scores*
that no longer exist. A misnamed source is a fabricated citation, and it
sat under the heading "This report utilises data from the following
authoritative sources".

The fix is the doctrine, not a patch: **one rendering per reading.** Both
paths now import the same five prompt blocks (`crimeStatBlocks`,
`climateStatBlocks`, `planningStatBlocks`, `regionalTrendBlocks`,
`macroEconomicBlock`) rather than keeping private copies; the three
coordinate-keyed services are asked together after `locationTask`
resolves, with the coordinate, mirroring the generator (including its
QLD second-chance crime ask once the cadastre names the shire); and every
attribution names the register that actually served the block.
`regenerationParity.spec.ts` pins all four rules — a repo-wide sweep
confirmed this path was the last live reader of the deleted shapes.

Also measured while here, and recorded rather than acted on: **VIC's crime
register refuses this project's egress too** (403 from Supabase, matching
the sandbox), so Victoria stays honestly absent. SA's and NT's open-data
portals DO answer from this vantage — the first reachable route to those
two registers, unbuilt for now.

---

## §33 — Phase 3, part C: a stored report becomes addressable (2026-09-07)

Full account: [`SECTION_STORAGE.md`](./SECTION_STORAGE.md).

Part B built `partitionByRegistry` and verified it against four real documents
spanning both engines and three tiers. Part C's first act was to run it over
**all 1,199 stored reports**, and that measurement overturned the primitive.

### The partition was blind to 70% of the corpus

It read `##` headings only — as did the coverage fixture that vouched for it,
and both were wrong about the same thing.

| | reports | share |
|---|---|---|
| sections written at **H1** | **842** | **70.2%** |
| sections written at H2 | 357 | 29.8% |

The majority is the legacy 36-section document, `# 1. Location Overview` …
`# 36. Demographic & Economic Data`, carrying at most a `## 📞 CONTACT US` /
`## ⚖️ PROFESSIONAL DISCLAIMER` pair at H2. **A partition hard-coded to `##`
finds zero sections in 842 documents and hands back each whole report as
preamble** — indistinguishable from a report with no structure at all.

`detectSectionLevel` now decides per document, by asking which level's headings
**resolve to registry sections** rather than by counting headings: H3
sub-headings outnumber sections in the H2 cohort (36 a document), so "most
headings" picks the wrong level. A tie resolves to 2, preserving every
previously verified behaviour.

### The coverage guard was measuring a quarter of what it claimed

`fixtures/corpusHeadings.json` was H2-only for the same reason, so §21's
percentage was computed over **10,185 heading instances while 26,860 sat
outside it**. Ten headings the registry could not name carried more than 400
reports each and none of them could have surfaced — `12. Amenity Scores` on
578, `22. Principal & Interest Loan` on 541, `28. Final Loan-to-Value Ratio
(LVR)` on 541.

Thirteen aliases were added from that inventory. Across all 575 fixture rows
they are **purely additive**: 30 headings gained a section, **0 changed section
and 0 lost one**. H1 instance resolution went **78.9% → 96.0%**, and the corpus
gained **4,692 addressable sections** — 26,581 → 31,273, 22.2 → 26.1 a report.
The fixture carries `level` now and both halves; its H1 side has a floor of ten
reports rather than two, because below ten that inventory is dominated by title
blocks naming a client's property, which are neither sections nor ours to keep
in a repository.

Two section headings are deliberately **not** named and are frozen with the
reason, the way `PRODUCER_GAPS` is: `37. Methodology Notes`, because the corpus
writes it as a colon sub-heading on 31 reports against 22 as a section and
normalisation cannot tell them apart; and `6. Investment Insights`, a real
section on 17 reports whose target the corpus does not settle.

### The storage rules

- **A repeat is an occurrence, never a merge.** The key is `(report_id,
  ordinal)`. Briefing `89b451f6` carries `marketPosition` four times; keying on
  `(report_id, section_id)` would silently collapse a client's document.
- **An index is written only where re-assembly proves it lossless**, and a
  report that fails gets a row saying so with **no** section rows. Measured:
  **1,199 of 1,199 conserve**; nothing was refused. The whole corpus is now
  indexed in production — 31,273 section rows across 37 distinct ids, the
  deepest repeat being **10 occurrences of one id in a single report** — and
  re-assembling every document **in SQL** from the stored rows reproduces its
  non-whitespace content exactly, **1,199 of 1,199, 0 mismatched**. That second
  proof runs on a different implementation from the one that wrote the rows,
  which is what makes it worth taking: it sees truncation at the column, a lost
  row and a wrong ordinal, and the in-memory check cannot.
- **The stored counts describe what is stored** — a refused report reads zero,
  because `total_sections = 21` beside no rows is the shape this programme
  removes.
- **9 reports (0.8%) yield no section** and are indexed as preamble-only, which
  is a truthful description rather than a failure.

### The deployment was checked against this repository, not assumed to match it

`report-sections-index` answers a `sample` — it partitions text it is handed and
reads nothing — and every response carries a `registry` digest, a SHA-256 over
every normalised alias and the section it owns. The 2026-09-07 deployment
returned digest `976341c1…`, 226 headings, and a fixture index identical field
for field with the local run, before a single row was written.

Nothing reads the index yet: `sectionIdForHeading` still has no consumer in a
shipped document path, so these aliases changed the index and no client's
report. Assembling a tier's document *from* stored sections is the next part.

---

## §34 — Two more recorded-crime registers: SA and NT (2026-09-07)

Full account: [`CRIME_SOURCES.md`](./CRIME_SOURCES.md).

§32 recorded that SA's and NT's open-data portals answer this project's egress
where VIC's refuses. They are integrated now, the same way NSW and QLD were:
every column name transcribed from the real file, every bound measured from
the real data, and a file that drifts refusing rather than loading something
else. Eight files were parsed in full before a line of schema was written, and
each parse was cross-checked against an independent implementation.

### SAPOL reclassified its offences, and a crosswalk would have been an invention

The finding that shaped the design. **From 2025-07 SAPOL changed its offence
classification, and it is a reclassification rather than a rename.** Eight of
its nine Level 2 categories changed name — `ACTS INTENDED TO CAUSE INJURY` →
`ASSAULT`, `THEFT AND RELATED OFFENCES` → `THEFT`, `PROPERTY DAMAGE AND
ENVIRONMENTAL` → `PROPERTY DAMAGE` — and the tempting move is a mapping.

The Level 3 leaves say no. `THEFT` carries `Theft from retail premises`,
`Theft from a person` and `Motor vehicle theft and related offences` where the
old category carried `Theft from shop`, `Theft from motor vehicle` and
`Theft/Illegal Use of MV`; `HARM OR ENDANGER PERSONS` (`Abduction and
kidnapping`, `Acts that threaten, harass, or control`, `Driving causing
serious injury`) corresponds to no single old category at all. **The
boundaries moved.** A "change on the same window a year earlier" computed
across a hand-made crosswalk would be a confident number that is not a
like-for-like comparison — this programme's own failure class, arrived at
through diligence rather than laziness.

So SA is stored at two grains. **Level 1** (`OFFENCES AGAINST PROPERTY` /
`AGAINST THE PERSON`) is stable in all seven published files and measured
continuous across the boundary — the monthly series shows no step at 2025-07,
property running ~6,900–8,000 a month either side and person ~2,100–2,700 —
so it carries the total, the year-on-year change and six calendar years.
**Level 2** is stored for the current classification only, with `prior12`
NULL and a `series_note` saying why. 1,836 of SA's 2,527 postcode rows carry
that null, and all 1,836 carry the note.

`crime_reference.prior12` became nullable for this, and the report block
renders `not comparable` rather than a blank cell — a blank reads as missing
data, and a model handed a blank and no reason will reach for one.

### Three more SAPOL quirks, and NT's opposite of the QLD trap

**The catalogue holds a trap beside the data.** Sixteen Family & Domestic
Abuse files sit next to the sixteen crime files, and SAPOL's own note is
explicit that the FDA file is a SUBSET of the crime file for the same year and
the two must not be added together. The matcher recognises only the crime
family; every FDA name returns null.

**One postcode arrives under two spellings** — `0872` with 699 offences and
`872` with 9 more, one postal area split by an export that lost a leading
zero. **And SAPOL records incidents outside the state**, 27–55 rows a year on
NSW, VIC, QLD, WA and TAS postcodes; keeping them would put "2 recorded
offences" against Sydney's postcode 2000 in a register that is not Sydney's.

**NT's rows are a cross-tabulation, not a hierarchy** — the opposite of QLD's
rollup trap, and measured rather than assumed: across 7,256 distinct (period,
offence, area) keys, **0 carry a repeated (alcohol, DV) cell and 0 mix the `-`
marker with Yes/No**, so summing them is exact. It is re-checked on every load.
Its header carries `Offence type ` with a trailing space, transcribed exactly
for the reason QPS's `Common Assault'` apostrophe is.

### A row the register declines to place is not a malformed row

The first parser conflated them and refused SAPOL's own data. `NOT DISCLOSED`
in the postcode column is South Australia Police saying the location is not
published — a stable feature of every file at **1.18%–1.90% of rows**. Rows of
the wrong SHAPE are a different thing, and the measured worst case is ONE in
84,949. They now have separate counters and separate caps, and the ratio
checks do not run at all below 500 rows, because one unplaced row in four is
25% and says nothing about whether a column moved. Truncation is asked
separately, by the loader, against each register's own measured floor.

### Loaded and verified in production

Every figure the deployed function reported matched the local parse to the
digit — 9,723 NT rows / 84,862 offences / 7,256 cross-tab keys, and SA's seven
years at 83,304–98,687 rows each. Finalised: 2,527 SA postcode rows, 67 NT
region rows and 181 SA2 rows. SA's benchmark names its denominator the way
NSW's does: 116,151 offences over 1,790,479 2021 Census usual residents of the
342 matched postal areas = 6,487 per 100k. NT keeps `population` null and
offers count-change context only, because no population is published for a
reporting region and a rate with an unnamed denominator is the one thing this
layer will not publish.

VIC still refuses every vantage; WA, TAS and ACT remain unverified and are
answered `no_data_for_location` naming their real register.

---

## §35 — The last fabricator is replaced: real transport stops (2026-09-07)

Full account: [`TRANSPORT_SOURCES.md`](./TRANSPORT_SOURCES.md).

§24 named six acquisition paths. Demographics, SEIFA, climate, crime and the
macro figures are real; employment is stalled on SALM's IP-level refusal. The
sixth, **public transport, had never been started** — and it was the clearest
fabricator of the six: eight per-state "fetchers" that ignored the coordinate
entirely, so every NSW property was 450m from Central Station with the T1–T8
lines and every VIC property 250m from a Swanston Street tram. That invention
was cached for 30 days and drove **up to 30 points of every report's walk
score** through `location-intelligence-service`.

`transport_stops` now holds **185,177 real stops** across four networks, each
loaded from the operator's own published GTFS feed.

### The archive is addressed, not downloaded

The constraint that shaped everything. NSW's bundle is **292,247,414 bytes**
and VIC's 319,320,298 — neither fits the crime-ingest pattern. But
`shapes.txt` alone is 77% of NSW's download and answers nothing about what is
near a property, while `stops.txt` is 4.09 MB compressed.

Every publisher measured honours HTTP range requests and a zip's central
directory sits at the END, so the archive is addressed rather than fetched:
read the tail, parse the directory, take one member. **1.467% of NSW's
archive, in 5.2 seconds, inflating byte-exact to the 16,997,242 bytes the
archive declares.** That is the difference between this fitting in an Edge
Function and not.

### What only real data revealed: a station is not its platforms

Within 1.6 km of the Parramatta test coordinate the table holds **thirteen
rows all carrying `parent_station: 215020`** — Platforms 1–4, Stands A1, A2,
B1–B3, Darcy St, two KAR Fizwilliam St and a TXI Fizwilliam St. A
nearest-eight over the rows lists six platforms of one station and calls them
six stops. Grouping by the publisher's own `parent_station` collapses sixteen
real rows to six places, named by the station rather than the platform.

### The rule that governs an empty answer

**A stop found is a fact about the area; no stop found is a fact about the
FEEDS.** A Perth property is not badly served — it is outside every network
loaded, and saying "no stops nearby" about it is the
confident-answer-against-nothing failure this programme has removed twice.
`outside_loaded_networks` is therefore a distinct verdict returned as
`no_data_for_location` naming the networks held, and coverage is decided by
measured distance rather than by a state name.

Victoria is **declared and deliberately not loaded**: PTV nests eight per-mode
archives inside one zip, each deflated rather than stored, so a member cannot
be range-addressed without inflating up to 139 MB. It keeps its entry with
`loadable: false` and a rendered reason, because a feed that vanished would
let an empty answer read as "no public transport in Victoria".

### Nothing returns a score, and mode is absent

The invented `qualityScore` is what corrupted the walk score, and a score from
stop counts alone would be the same invention in new clothes — a stop served
hourly counts the same as one served every four minutes. Mode is NULL on every
row because it lives behind `stop_times.txt` (399 MB uncompressed for NSW), so
the reading omits it rather than guessing from a stop's name. `notMeasured`
says both on every answer, including a full one.

### Three faults the loader found by running rather than by being read

**The bootstrap arm counted the whole table**, so loading `nt_darwin` sealed
`nt_alice` and `qld_seq` out of their own first load — the exact fault its own
comment described. **Counting any row then sealed a feed on its FAILURE**: NSW
was killed at 117,000 of 171,061, left a `running` row, and refused its own
resume, which could lock a feed permanently half-loaded. And **`HEAD` is not
how you ask an archive's length** — TransLink answers HEAD with no
`content-length` while answering a ranged GET with `Content-Range:
bytes 0-0/37356493`, so a perfectly range-addressable feed was written off.

A fourth belongs to the tooling rather than the data: a deployed Supabase
function **cannot hash its own sources** (they are compiled away; every
`import.meta.url` read answers "path not found"), so the fidelity check
digests what the modules DO. Repo and deployment agree on
`47d61cace23e474dddc827ce80326037207c33772080903085e28568f4e57e41`.

SA, TAS and ACT were reported as refusing "every vantage this project holds"
when only the repo sandbox had tried them. That asserted more than had been
measured, about exactly the distinction `probe` exists to make, and §35a
corrects it.

---

## §35a — The claim that had not been measured (2026-09-07)

§35 recorded SA, TAS and ACT as refusing "every vantage this project holds".
Only one vantage had ever tried them: this repository's sandbox. The Edge
Function that would actually do the loading had never asked — which is the
precise distinction the loader's own `probe` stage was built around, and the
reason SALM is stalled rather than guessed at. The claim happened to be right,
and that is luck rather than rigour.

`GTFS_CANDIDATES` and the `probe_candidates` stage exist so it rests on
evidence. Measured from both vantages: Adelaide Metro, Transport Canberra and
Metro Tasmania all answer **403 at the Edge Function too**, so the three are
now genuinely established rather than assumed.

**WA turns out to be a different state, and was being described as the same
one.** Transperth's published GTFS page answers 200 from both vantages, but
its 82 KB of static HTML names no archive at all (the page is client-rendered)
and a headless Chromium cannot reach the site from this environment either.
Transperth is not refusing the data; this project has not established where the
archive lives. Recording that as a refusal would repeat the same error in the
other direction.

Two rules came out of it. **A candidate is probed and never loaded** —
admitting one means moving it into `GTFS_FEEDS` with a stop floor a real parse
produced. And **the candidate list is FIXED**: a probe taking a URL from the
request body would be server-side request forgery in a function holding
service-role credentials, which is far worse than an unprobed feed.

It also caught a trap in the first version: `probe`, `probe_candidates` and
`digest` were gated on `succeeded < loadable feeds`, so **the diagnostics
sealed themselves the moment every feed had loaded** — when a maintainer most
needs them, and making `probe_candidates` unusable by construction since it
exists for networks that are not loaded. They are permitted behind the gateway
JWT now; the per-feed seal on the load stages is untouched.

## §36 — One definition per figure, and the first arithmetic check the product has ever had (2026-09-07)

Full detail: [`DERIVED_FIGURES.md`](./DERIVED_FIGURES.md).

Every report states three numbers a client acts on that the property record
does not contain — gross rental yield, net rental yield, loan-to-value ratio.
Nothing checked any of them after the model wrote it. `runQAValidation`'s seven
rules are page band, keyword presence, placeholders, editorial labels,
duplicate headings and section counts: **no rule in this product had ever
compared a number.**

**The divergence was mostly not a bug, and finding that out changed the work.**
Gross yield is computed in six places, net yield in four, LVR in eight. But
`liveProjectionRow.ts` divides the settlement loan by the purchase price while
the strategy surfaces divide the remaining balance by today's value — those are
*different quantities*, origination LVR and current LVR, and they coincide only
at settlement. Collapsing them onto one definition would have destroyed a real
distinction and silently changed documents. What was missing was a NAME for
each and a way to say which you meant, so in
`_shared/reports/metrics/propertyMetrics.pure.ts` **the basis is part of the
call**, the answer carries its basis back, and `labelFor` prints "Gross yield
(on purchase price)" rather than a bare "Gross yield". Two rules travel with
it: **absent is never zero** — 84 of 1,072 stored reports print a `0.00%`
yield, 206 times, because the rent was unknown — and **net yield is unlevered
while cash-on-cash is not**, pinned by a test showing the same property at
3.39% and −1.73% depending on whether interest was wrongly swept into the cost
base.

`reconcileFacts` now judges all three, and they are the strongest possible
targets because the prompt does not merely supply them, it orders their use
("USE THESE EXACTLY - DO NOT RECALCULATE"). The call site passes the exact
variables the prompt interpolates, because recomputing them would only prove
that two formulas agree. Three things had to be right. **Tolerance is absolute
for a percentage** — a 2% relative band on 4.83 is ±0.097, which rejects the
ordinary rounding "5%" — so yields carry 0.25 points and LVR 0.5. **The
vocabulary was measured**: 543 of 2,153 gross mentions are a working column
(`| Gross Rental Yield | $33,800 ÷ $700,000 × 100 | 4.83% |`), so the pattern
must cross arithmetic, and it is bounded by never crossing a newline, a `%`, or
a second `yield`. And **a wide gap alone is not enough** — the corpus long tail
read "gross rental yield provides substantial buffering against interest rate
increases. A 1%" as the figure — so the value must arrive either through a
delimiter (a table pipe, a colon, an `=`) or sitting adjacent to the label. A
verb may never introduce the number.

**LVR is the one place a value-after-label rule had to be refused.** `LVR, 6.5%`
and `LVR at 6.5%` are the interest rate; `banks cap LVR at 95%` is policy;
`| Final LVR | 52% |` is the correct *current* LVR at year ten. A prose-connective
rule read 22 of 57 reports as contradicted and almost all of it was the
detector. Admitting only the value-first form and structurally-connected label
forms doubled coverage (57 reports → 115) and cut disagreement to 10.

Those 10 are all one real defect, and it is not the model's. **14 of 143 stored
reports contradict themselves inside `financial_calculations`**: a deposit
taken at 20% of the price beside a loan taken at 90% of it, `keyMetrics.lvr`
of 80 beside `loanDetails.lvr` of 90. On one, the deposit and the loan come to
$739,200 against a $672,000 purchase — the client is shown two lines that
exceed what they are buying by $67,200 — while the customer's own override says
80% and names the right loan. The written analysis then says "90% LVR" nine to
twelve times, because the loan block is what the model was handed.
`financeIdentityBreaches` states the three identities a finance block cannot
break and still describe one deal, and discloses them beside the prose
findings. It is deliberately **not** repaired here: the engine itself is
self-consistent, so a later merge is putting the two halves out of step, and
finding which one is a change to how a report is generated that deserves its
own evidence.

`derivedFigureDefinitions.spec.ts` is a ratchet rather than a ban — 22 modules,
53 inline definitions, frozen. It does not forbid the copies, because most of
them are the real distinction above; it fixes their number so the next one is a
decision somebody makes rather than a line somebody adds. Stamp duty had
exactly this shape and reached four *different* answers before anyone compared
them.

## §37 — The 0.00% yield, and the record that described two deals (2026-09-07)

Full detail: [`DERIVED_FIGURES.md`](./DERIVED_FIGURES.md) §5 and §6. Both were
found by §36's reconciliation and both are now fixed at the cause.

**The yield: two rents, in two scopes.** 83 stored reports print a `0.00%`
rental yield, 74 of them with no rent supplied by the customer, and the zero
flowed onward — annual income `$0`, a *net* yield that was a confident negative
number made of nothing but costs, and a model ordered to "USE THESE EXACTLY".
The generator resolved the rent twice: `effectiveWeeklyRent` knew only what a
person typed, while the SQM market lookup landed in `calcWeeklyRent`, declared
**inside the enrichment block** and out of scope by the time the prompt was
assembled. So a report whose rent came from the lookup had correct projections
beside a document saying the yield was zero. Four prompt lines had already been
patched by hand with `|| enhancedData.financials?.income?.weeklyRent` — someone
had seen the symptom — but a per-line patch cannot fix a figure computed once
from the wrong variable. **A third consumer had it too**: the investment
scoring service was handed `weeklyRent: effectiveWeeklyRent || 0` and scored
the property as earning nothing (mean score 47.5 against 48.9 elsewhere).

`rentalEvidence.pure.ts` resolves **one** rent, in the calculator's own order,
carrying whether it is established at all; where it is not, every figure
derived from it is absent and the prompt forbids an estimate while still
permitting qualitative discussion — a prohibition with no permitted action is
one a model routes around. Three things make it safe on a path that has run on
every investment report ever generated: the ordering returns the same number
the old expression did wherever a rent was typed or carried (the spec asserts
that against the old expression, not against an idea of it); arithmetic keeps
its zero, because management fees are a percentage OF the rent; and the `%`
sign moved INSIDE the formatter, since every call site read
`${preCalculatedGrossYield}%` and a null there would have printed `null%`.

One thing was deliberately **not** adopted, and measuring is what settled it.
Routing the pre-calculated yields through `propertyMetrics.grossYield` would be
the tidier call, but swept over 2,207,223 realistic (rent, price) pairs its
`Math.round(x * 100) / 100` disagrees with `toFixed(2)` on **2,763** of them —
half-way values like 1.105 printing as 1.10 one way and 1.11 the other. That is
0.125% of documents shifted by a hundredth for no reader's benefit. The module
owns the definition; the generator owns the presentation.

**The finance identity: healed on read, not migrated.** 21 stored reports carry
a deposit taken at one LVR beside a loan taken at another — on one, $134,400
and $604,800 against a $672,000 purchase, exceeding it by $67,200 while the
customer's own override names the right loan ($537,600). The live path is
already sound: `manage-investment-reports` recomputes through the engine, and
**17 reports carried an LVR override in August and September and all 17 are
consistent**, against 10 broken of 33 in April–June. What remained was history.

The naive repair is wrong. "The loan is stale, re-derive it from price minus
deposit" invents a third figure on the one row where it is the *deposit* that
is stale. **`keyMetrics.lvr` is the arbiter** — the engine derives it from the
inputs it was actually given — so whichever half agrees with it survives and
the other is re-derived; where NEITHER agrees, nothing is healed, because a
repair that cannot say which figure is sound is just a third opinion. Verified
against all 21: 17 heal the loan, 1 heals the deposit, 3 are left alone, and of
the 13 carrying an independent witness (`manual_overrides.loanAmount`) **13
agree and none contradict**.

It lives in `reconcileStoredFinancials`, which the register, the PDF renderer,
the comparison and both cash-flow projections already call — so the repair
reaches every reader of all 21 rows **without a migration and without
overwriting a stored byte**, reversible by deleting code rather than restoring
a backup. Placement is load-bearing: after the series heal (the projections'
ROI denominator is the stored deposit, and re-basing a ten-year table would
rewrite rows this has no business touching) and before the upfront total (which
IS the deposit plus the acquisition lines and must follow). The same function
runs at the write boundary too, on the two paths where the recompute is skipped
and the client's own object is stored.

## §38 — Portfolio: deterministic code becomes the sole numerical authority (2026-09-07)

Full detail: [`PORTFOLIO_TRUST_BOUNDARY.md`](./PORTFOLIO_TRUST_BOUNDARY.md).

The Portfolio generator handed the model the portfolio's own metrics and then
asked for numbers back in its JSON schema — rate-sensitivity impacts, current
cashflow, current repayments, projected value and equity, borrowing-capacity
utilisation. **It was not doing arithmetic**, and the corpus shows something
worse than inaccuracy: the field does not hold one quantity. Every client with
a stored sensitivity block holds interest-only loans, so the true step is exact
(`balance × Δ ÷ 12`) and needs no term — and measured against those loans, of
the 13 blocks whose loans carry a recorded structure, **4 encode the monthly
level *after* the rise, 3 encode the change itself, and 6 are wrong under both
readings** (best-case error: median $718 a month, $10,611 at worst). All of
them print under the same PDF label. One report's +2% figure ($0.15) is smaller
than its +1% ($1,010.15), which no rate rise can produce. One
`currentMonthlyCashflow` differed by $492 a month from the `portfolioMetrics`
figure sitting beside it in the same object. **A field that means two things is
not repairable by prompt wording**, which is why the fix moves the producer
rather than the instructions.

**The trace came first, and it changed the design twice.** Two different fields
share the name `interestRateSensitivity` — a numeric object read only by the
pdf-lib generator, and a PROSE string under `riskAssessment` read by the
WeasyPrint normaliser; conflating them would have blanked a risk row. And
**there is no loan term in this data model** — not unpopulated, no such column,
while `loan_repayment_amount` exists and is populated on 0 of 47 loans.

That last fact splits the mathematics rather than being worked around. An
interest-only loan is exact as `balance × rate ÷ 12` — verified against the
data, where `monthly_interest_repayment` equals that expression for 20 of 20
interest-only loans and 0 of 21 principal-and-interest ones, which is how we
know it is not the same quantity there. A P&I loan needs a term to amortise and
is **refused rather than assumed**: a thirty-year guess on a loan with eight
years left misstates both the payment and the shock. A group containing any
unmodellable loan is unavailable in whole, because a figure covering three
loans of four understates the exposure while sitting beside the portfolio's
full debt. Across the 23 clients holding loans that is 15 exact and 8 absent —
a strict improvement on a figure produced for all 23 and wrong for most. The
remedy for the rest is a data change (capture a loan term), named and out of
scope.

**Fifteen deterministic fields left the model's schema.** Not computed and then
compared — *not asked*, so there is nothing to overwrite and nothing to
reconcile. `healthScore` and `diversificationScore` stay model-authored and are
bounded 0–100 on the way out, **dropped rather than clamped** when out of
range, because clamping 250 to 100 publishes an excellent rating the model
never gave. Cashflow has one authority: the assembly assigns
`portfolioMetrics.netMonthlyCashflow` directly, so no second derivation exists
to disagree with it.

Three rules carry it. **The persisted shape did not change** — both renderers
read the same paths and the new fields are additive — so historical rows still
render, and the renderer hides a figure only on an explicit `available ===
false`, which a stored row does not carry. That was checked by execution rather
than by reading the guard: across all 26 stored reports, 0 carry an `available`
flag, 26 of 26 hold a numeric projected value, and every capacity and
sensitivity block that exists holds numeric figures — nothing stored loses a
number, and no backfill was run. **`projectedMonthlyCashflow` is
typed `null` so it cannot be set**: projecting it needs a rent-growth and an
expense-growth assumption this repository does not have, and capital growth is
not rental growth. And **`formatCurrency(null)` returned `'$0'`**, so an
unavailable figure would have printed `$0/mo` — a rate shock of zero reads as
"rates rising costs you nothing", the exact inversion this work exists to end;
the KPI boxes distinguish "Not available" from "Not projected" now and draw the
reason beneath. **That component draws the block twice** — into the PDF and
again on screen, from the same object, through the same helper — and the first
attempt healed only the pdf-lib path, so the review a client is shown before
the document exists went on printing `$0/mo`. The invariant is stated over the
whole file for that reason, and an absent cashflow is no longer painted green
by `safeNumber(null) >= 0`.

**The label now says which quantity it is showing.** "IF RATES RISE +1%" is
true of both readings the corpus contains, which is exactly why it could sit
over either without looking wrong. A calculated row reads "+1%: MONTHLY CHANGE";
a historical row — one with no `available` flag — keeps the wording it shipped
with, because relabelling it would be a second guess about which quantity it
holds, and the point of this change is to stop guessing.

The tests deliberately do **not** assert that the +2% impact is twice the +1%.
That was an audit sanity band, not an invariant: a principal-and-interest
payment is convex in the rate. Six invariants pin the rest — no default term,
rate or structure exists to fill a gap with; no rate figure can reach the page
as a currency zero; the absence explanation is drawn on an explicit
`available === false` and never on a falsy check, so a historical row still
renders; the persisted paths both renderers read did not move; and the negative
sign convention is asserted in the type, in prose beside the field, and in the
arithmetic. Each was mutation-checked against the change it forbids.

---

## §39 — Stage 1: the record knows more than the report uses (2026-09-07)

Three defects on the primary report family, each found by executing the real
modules against the live corpus rather than by reading code, and each the same
shape: **a fact the record holds is not used, or a figure the record cannot
support is printed anyway.**

**A yield outlived the rent it rests on.** Run against
`Lot 2267 Hunza Road TRUGANINA`, whose `income` is null outright,
`composeFinancialChapters` produced a section headed *"Rental Assessment,
Gross Yield & Net Yield"*, strapline *"Recorded rental income and the yields it
produces"* — containing two yields and no income. The weekly and annual rows
had correctly suppressed themselves; the two figures computed FROM them had
not. **The absence discipline was applied to the inputs and not to what depends
on them**, which is the one arrangement that reads as a working page while
asserting a return on an income the record does not hold.

**Four readers print a yield**, and the fix is one rule they all ask:
`rentIsEstablished` in `rentalEvidence.pure.ts`, the module that already owns
the question. `financialChapters` (the FIN fork and condense), `toFinancial`
(WeasyPrint), `reportBindingProjection` (every bound template) and
`condenseFacts` (the block handed to the model) — the last of which is the
widest consequence, because an unfounded yield published there comes back as a
figure the model states as authoritative. A zero rent is deliberately NOT
establishment: `income.weeklyRent === 0` is the shape the original 0.00% defect
wrote, and admitting it would readmit every figure §37 removed. 16 stored
reports were in that state; a report that HAS a rent renders byte-identical,
asserted rather than assumed.

**The duty assessment ignored two things the request already told it.**
`financial-calculator-service` receives `borrowerType` — it picks the interest
rate with it — and then hardcoded `intent: 'owner_occupier'` for stamp duty. So
**143 stored reports that declare an investor were assessed on the
owner-occupier scale.** Measured against the canonical engine at the twelve
affected reports' own prices, QLD understates by **exactly $7,175** at every
price (its home concession is a flat rebate); ACT by $2,992, VIC by $3,100
below its $550k owner-occupier ceiling, and the other five states share one
scale so nothing moves. The second is `PropertyCategory`, which has always had
three values and every state schedule declares a `vacantLand` first-home
concession — the caller only ever computed `isNewBuild ? 'new' : 'established'`,
so those schedules were unreachable. That one is **latent, not realised**:
category affects first-home relief only, verified by execution across every
state and price for a non-FHB buyer with zero differences, and 0 stored reports
are FHB-eligible. Both are now derived from what the request carries.

**There were five property-type vocabularies in one flow.** The generator sent
the raw string to three services with a silent `|| 'house'`;
`overrides.pure.ts` normalised separately (`apartment` → `unit`, `villa` /
`duplex` → `townhouse`); the scoring service defends itself with its own
`apartment` branch and its own `|| 'house'`; and the prompt builds a sixth
"standardised" label by substring. The engine's only use of the type is
`strataFees = o.strataFees ?? (propertyType === 'unit' ? 4800 : 0)`, so
`apartment` never matched and never drew the strata estimate — **264 of 1,071
stored reports carry a type outside the engine's `house|unit|townhouse`
vocabulary.**

Three rules carry the fix. **One answer per request** —
`effectivePropertyType`, taken by the calculator, the validation service and
the scoring service. **`?? raw`, never `?? 'house'`** — a type that will not
resolve stays unresolved, because `residential property` matches no branch and
draws no adjustment, which is the honest neutral; defaulting it to a house
would have awarded the scoring service's `+3` house bonus to 145 reports nobody
has classified. And **the market rent lookup deliberately keeps the raw
string**, annotated at the site: it selects a published rent SERIES, so its
vocabulary is the market data's rather than the engine's, and mapping `villa`
onto `townhouse` there would change which rent is looked up.

Two things worth recording about the method. The realised exposure was
**smaller than the mechanism** in two of the three cases, and both times the
measurement corrected an earlier overstatement of mine — 81 land and
house-and-land reports carry no financial block at all, so the engine never
computed rent or residential duty on them (1 report did, `Mount Sylvia Road`,
$650/week on vacant land), and 29 of 32 apartments carry a body-corporate
override that supplies the real figure. And the spec caught **three call sites
I had missed** and the edge gate caught **a fatal redeclaration I introduced**,
which is what those gates are for.

---

## §40 — Stage 2: the renderer knew, and nobody asked (2026-09-07)

Stage 1 read the corpus as data. Stage 2 read one report as a **document** —
`28 Bligh Street, Muswellbrook NSW 2333`, 5 September, compass-40, the shape
the generator writes today — and the two defects worth fixing were both
already detected by code that exists.

**A render that loses content says nothing.** `renderMarkdown` returns a
complete degradation report: twenty-four notices covering truncation, rejected
and ragged tables, dropped columns, rows, list items, headings, images, glyphs
and figures, plus `degraded`. **Every caller throws it away.**
`reportBindingProjection`, `reportQaProjection`,
`marketIntelligenceProjection` and both converted-report renderers take
`.blocks`, `.html` or `.lines` and read no notice at all; the investment
renderer reads exactly **two of the twenty-four** (`figuresDrawn` /
`figuresDropped`) and discards the rest — including every one that means a
client's content did not reach the page.

On the Muswellbrook report a table row written
`… | General evidence only || Tenant stability …` — two rows concatenated by a
stray `||` — renders with `tablesRagged: 1` and **`tableColumnsDropped: 5`**,
and nothing anywhere is told. Across the corpus **12 reports carry that shape
and 118 carry an unterminated row**, out of 1,138 with tables.

`contentLosses` draws the line once: a notice that means content was **lost**
is a problem; a notice that means content was **transformed** is not.
`tablesLandscaped`, `listsFlattened`, `linksFlattened`,
`glyphsTransliterated`, `urlsNeutralised`, `listRunsMerged` and
`inlineSkipped` all keep the words, and reporting them would bury the ones that
do not. `tablesRagged` is likewise silent because the loss it causes is
counted separately as dropped columns — reporting both would double it. The
losses join the `problems` list the spine validation already populates and
count towards the `degraded` flag the plan already carried, so nothing new was
built: a chapter dropped for budget, prose cut for length and content the
markdown renderer could not carry are now the same kind of fact.

**Two services measure the same distance and both reach the report.** The
document says *"Muswellbrook Public School at 0.29 km"* and *"Pacific Brook
Christian School, is 0.46 km away"*. Its own stored
`location_intelligence.schools.topSchools` holds **0.21** and **0.42** for
those schools. Neither is the model inventing: `school-data-service` measures
its own distances and is interpolated into the prompt, while
`location-intelligence-service` measures them separately into the column that
is stored, projected and rendered. The model quotes the first; every
downstream surface reads the second.

The **stored** figure is the authority, because it is the one the record keeps.
`schoolDistance.pure.ts` replaces a prompt distance wherever the record names
the same school, and leaves a school the record does not name at the distance
it arrived with — a reconciliation rather than a filter, because dropping the
high school would lose a real fact to fix a disagreement it does not have.
Nothing here judges which service measures better; that is a separate question
about two great-circle implementations, and this one is only that a document
must not state a figure its own record contradicts.

**Three things this stage got wrong before it got them right.** A first render
harness ran without the production figure renderer and reported that both
charts were dropped and the Disclaimer heading discarded; wired as production
does, `figuresDrawn: 2`, `figuresDropped: 0`, `headingsDroppedEmpty: 0` — none
of it was real. The Sydney transport data in that report (Central Station,
450 m, on a property 292 km away) is **pre-fix**: the GTFS work landed two days
after it was generated. And the new spec caught a bug in the new module —
`St Joseph's` keyed as `st joseph s` and never matched `St Josephs`, which is
the one spelling difference these two services actually produce.

**What the corpus does well** is worth recording beside that. The prompt
carries `[School Name]` and `X.XX km` fallbacks and **not one of 1,180
completed reports contains either**; the walk score's distance fallback
correctly absorbs the new transport service's deliberate absence of a
`qualityScore`; and the renderer's detection is complete and accurate — it was
only ever unheard.

Two things are named and not fixed. Chart duplication is **8 of 45
chart-bearing reports (18%)**, worst three times, and the repeats are
*near*-identical — different dash characters, `3,120` against `3120` — which
is why the generator's own "render ONCE" instruction and any exact-match dedup
miss them. And **19 of 35 reports using `::: stat` (54%) draw at least one card
with a label, a unit, a sub-caption and no value.** Both wait on whether
surfacing the notices makes them self-evident first.

## §41 — Stage 3: the derived reports agree with the record, and with each other (2026-09-07)

Stage 3 of the staged validation programme — **Align Subsidiary / Derived
Reports**. The Compass family is one parent and four children:

| variant | engine | rows | producers (registry) |
| --- | --- | ---: | --- |
| `compass` | `generate-investment-report` | 1,109 | 3 projection, 11 authored |
| `briefing` | condense (model) | 23 | 3 projection, 10 authored, **7 composed** |
| `snapshot` | condense (model) | 26 | 2 projection, **9 authored, 0 composed** |
| `financial` | fork (deterministic) | 11 | 2 projection, 9 routed, **8 composed** |
| `strategic` | fork (deterministic) | 11 | 2 projection, 16 routed, 1 composed |

### The corpus could not answer the question

**All 71 derived reports predate the code that produces them.** The
`condenseFacts` fix landed 2026-09-04 07:39:50; the newest child of any variant
is 2026-09-04 05:53:15. `reconcileFacts` landed 2026-09-02 and only **3**
compass reports have been generated since 2026-08-20.

So the stored documents testify about engines that no longer exist. Two figures
that looked like live defects — a briefing stating a score of 60 where the
record says 62, a snapshot stating five `/100` figures the record does not hold
— are pre-fix artefacts of exactly the defect `condenseFacts` was built to end.
Stage 3 was therefore done by **executing the current modules against real
parent rows**, chiefly `1/27D Mitchell Street` (`0478c410`).

### 1. One annual rent, and the basis it is stated on

`reportBindingProjection` published `annualRent = weeklyRent × occupancyWeeks`,
and `financialChapters.rentalAndYield` copied that derivation deliberately so
"this table and the verdict page's tiles state the same annual figure". They
did. Both disagreed with the **yield printed beside them**:

> | Weekly rent | $600 |
> | Annual rent (50 occupied weeks) | $30,000 |
> | Gross rental yield | 5.67% |

$30,000 ÷ $550,000 is 5.45%. The 5.67% is $31,200 ÷ $550,000 — the rent at 52
weeks. Two rows apart, in one four-row table, on the deterministic path.

What the record says, measured across the completed corpus:

| question | answer |
| --- | ---: |
| stored `income.annualRent` equals `weeklyRent × 52` | 18 of 18 |
| ... equals `weeklyRent × occupancyWeeks` | 0 of 18 |
| stored `grossRentalYield` rests on `weeklyRent × 52` | 149 of 153 |
| reports with `occupancyWeeks < 52` whose yield is still on 52 | 61 of 62 |

`rentBasis.pure.ts` is the one module that answers both questions and names
each: `contractual` (what a yield rests on, and what belongs beside a weekly
rent under a bare "p.a.") and `atOccupancy` (what the assumption expects to
collect), the latter present only when the report states an occupancy that is
not 52. The projection, the composed chapters and the recorded-facts block all
read it.

Effect on the corpus, computed over the 153 reports carrying a weekly rent, a
gross yield and a price:

| | before | after |
| --- | ---: | ---: |
| published no annual rent at all | 27 | **0** |
| annual rent reconciles with the yield beside it | 64 | **149** |
| diverges | 62 | **4** |

The remaining 4 are records whose stored yield rests on neither basis. That is a
record-level inconsistency of the `healFinanceIdentity` family (§36), not
something this change introduced or can resolve.

### 2. The Snapshot was the only member of the family composing nothing

Briefing 7 sections from the record, Financial 8, Snapshot **0** — while four of
its nine model-authored sections were numeric. Its structure guide asked for:

```
## Investment Score
- Recommendation: [BUY/HOLD/SELL]

## Score Breakdown (simplified)
| Component | Score |
- Growth, Location, Yield, Demand, Risk
```

Two things are wrong with that, and both are the record contradicting the guide.

**The verdict vocabulary does not exist.** The engine issues `HOLD` (855
reports), `CAUTION` (99), `HOLD/BUY` (33) and `BUY` (2). `SELL` is never issued;
`CAUTION` is never offered; `HOLD/BUY` cannot be spelled in three words. A model
handed `HOLD/BUY - Moderate investment potential` and told to choose one of
three must change the recommendation to answer.

**The five components are not five.** The record marks a dimension it could not
score `excluded: true`, `weight: 0` and `hasData: false`, with a placeholder
`score` of 50 that is not a score. Both the projection and the composed briefing
section already withhold those correctly. The guide enumerated all five with no
omission rule — while the two sections either side of it had one — and the facts
block hands the model three. Exclusions are the **current** state rather than a
legacy rarity: 17 of 992 reports overall, but **16 of the 17 generated since
August 2026**.

`Investment Score`, `Score Breakdown` and `Financial Snapshot` are composed from
the record now and removed from the guide. `Key Market Stats` stays authored on
purpose: median price, vacancy rate, days on market and walk score are not in
`financial_calculations`, and composing it would mean inventing a source.

Two things the composed sections add that the guide could not ask for. The
ten-year projected value was in the guide's metric list and in **no** facts
block, so a model asked for it had to project one itself; it is read from
`projections.moderate` now. And the score's **partial coverage** is disclosed —
`InvestmentReportViewer` and `InvestmentGradeSummary` have always shown
`coverage.partialLabel` when `coverageRatio < 1`, so staff reading the record
were told the score rests on 3 of 5 dimensions and the client reading the
document was not.

### 3. Composed sections were appended, never placed

`trimToDeclaredSections` filters and has never reordered, and the composed
chapters were appended after everything the model wrote. So the Briefing's
financial tables, score breakdown and SWOT — registry orders 11–17 — printed
after `Recommendation` (20) and after `Market Data Sources` (90). Reproduced by
execution:

| before | after |
| --- | --- |
| … Top 3 Risks, Recommendation, Market Data Sources, **Purchase Costs**, Rental Assessment, Loan Structure, Sensitivity, 10-Year Cashflow, Investment Score Breakdown, SWOT | … Risk Overview, **Purchase Costs**, Rental Assessment, Loan Structure, Sensitivity, 10-Year Cashflow, Investment Score Breakdown, SWOT, Top 3 Opportunities, Top 3 Risks, Recommendation, Market Data Sources |

`tierAssembly.pure.ts` places every section at its declared order. It runs
**after** the trim rather than replacing it: the trim drops an undeclared
heading with its body, which is what stops a condensed report carrying the
parent's own 36 headings, while `partitionByRegistry` absorbs an unrecognised
heading into whichever section is open — right for reading a stored document,
wrong for enforcing a structure guide. A section it cannot place is appended and
**named** rather than dropped.

### Named and not fixed

**No child is fact-reconciled.** `reconcileFacts` has exactly one caller, the
parent generator, and 0 of 71 children carry a validation flag of any type (the
corpus holds `error`, `quality`, `structure` and `warning`; `fact` appears
nowhere, on any report, because only 3 parents postdate it). Composing the
snapshot's numeric sections removes the model's authority over the figures a
reconciliation would have checked, which is the stronger fix; extending the
detector to the children is the first candidate for the next stage, and it
should not be done until the detector has production mileage on the parent.

### Verification

Executed against the real parent row rather than a fixture: the composed rental
chapter, the three composed snapshot sections and both tiers' assembled section
order. 22 new tests. Two existing registry contracts were renegotiated
deliberately — the snapshot guide test now asserts it asks for exactly its
**authored** headings (the briefing's contract, and the stronger one, since it
also forbids the guide asking for a section we compose), and the producer
resolver learned two new shapes.

## §42 — Stage 4: a labelled block is a promise, and one correction (2026-09-07)

Stage 4 of the staged validation programme — **Rendering and Presentation
Validation**, carrying the three items Stage 2 named and deliberately left.

### The correction first

§40 recorded that "771 of 1,180 completed reports contain the firm's *general
informational purposes only* wording in the model's prose", and this programme
proposed stopping the prompt writing its own disclaimer. The count was right and
the reading of it was wrong.

Measured 2026-09-07: those 769 Compass reports carry the phrase at **93% of the
way through the document on average, and 729 of them in the last 10%** — inside
the disclaimer section, which is where a disclaimer belongs. It is not scattered
through the analysis. And it was **last produced 2026-07-21**: of the 10 reports
generated since August, zero contain it. The cohort is overwhelmingly December
2025 (663 of 686 that month).

The generator had already stopped doing the thing that was proposed to stop.

What is live is smaller and different. On the newest report (`28 Bligh Street,
Muswellbrook`, 5 Sep) the section reads:

```
### Disclaimer
{{glance: ◆ General information only | ⚠ Not tailored to your personal
  circumstances | ✓ Independent advice and due diligence are essential |
  ★ Use alongside professional financial, legal and tax guidance}}
```

A heading called "Disclaimer" whose entire body is a decorative chip strip,
while the operator's authored disclaimer (`global_report_settings.
professional_disclaimer`, enabled) is set on its own branded back page by
`render-investment-report-pdf`. That is a presentation question about a legal
statement on a client document — whether four chips are an acceptable rendering
of a disclaimer — and it is the operator's to answer, not this programme's. It
is named here and deliberately unchanged.

### 1. The stat card with no value

`::: stat` draws the largest single element on a page. Measured across the 24
Compass reports that use it: **23 of 71 cards (32%) carry a label, a unit and a
sub-caption and no value**, on 15 of those 24 reports. Verbatim:

```
::: stat label="Nearest station access" unit="m" sub="Muswellbrook Station from local transport references"

:::
```

The renderer draws `stat-value` unconditionally:

```ts
`<div class="stat-value">${esc(inner)}${unit ? `<span class="stat-unit">${unit}</span>` : ""}</div>`
```

So what a client receives is not a blank space. It is an oversized **"m"**, or
an oversized **"/100"**, set in display type with a caption underneath
explaining what it measures. **The unit becomes the statistic.**

A card with nothing to state is not drawn — not a dash, not a zero, not the unit
alone. A measured `0` is a statement and is kept.

### 2. The chart drawn twice

The generator's prompt tells it to render each figure once. 5 of the 26
chart-bearing reports since June repeat a directive anyway, 7 redundant draws in
all. The repeats are **near**-identical — a different dash character, `3,120`
against `3120` — which is why the prompt's own instruction and any exact-match
comparison both miss them. Normalisation is therefore the whole mechanism, and
it is deliberately narrow: case, whitespace, dash variants and thousands
separators. `{{bars: … 1-450}}` and `{{bars: … 1-451}}` remain two charts.

### Where it runs, and why in two places

`blockHygiene.pure.ts` holds both passes and one predicate. It is applied on the
**write** path — the parent's `compassPostProcessor` (phase 7, on the assembled
document, because a chart repeated across two sections is only visible once the
sections are one string again), plus condense and fork — and on the **read**
path, in the PDF renderer.

Both ends, because the write path alone leaves the 15 reports already carrying
an empty card, and those documents have been sent. That is the asymmetry
`healFinanceIdentity` settled on in §36 and for the same reason. `stripPlaceholderRows`,
the rule's existing enforcement on table rows, is called by condense and fork and
has never been called on a parent at all — which is how this class survived on
the Compass.

One predicate shared by both ends is load-bearing rather than tidy: the
renderer's fence pass is a plain `gm` regex with no code-fence awareness, so a
`::: stat` inside a ``` block IS drawn as a card today. The scrubber matches
exactly that set. A scrubber that were *smarter* than the renderer would leave a
card the renderer then draws as a bare unit. That behaviour of the renderer is
pre-existing and out of scope here; a test pins the agreement rather than the
behaviour.

### Named and not fixed

- **The Disclaimer sub-section**, above — the operator's call.
- **A bullet promising a continuation that never comes**: 5 occurrences across 5
  of 33 reports (`- **NSW Government and Muswellbrook Shire Council**` with a
  hard line break and then a blank line). Same family, small, and the fix is in
  the prompt rather than in a scrubber.

### Verification

- 12 new tests, executed against the verbatim production blocks
- `tsc --noEmit`, `security:edge-check` (339 against a 339 baseline) — clean

---

## §43 — Stage 4: reading the document, and who it says it is from (2026-09-08)

§42 fixed what a labelled block promises. This is the rest of Stage 4: the whole
document rendered through the **production** renderer and read page by page, and
then the same document rendered as an unbranded clone would produce it.

The harness imports `buildHtml` from `render-investment-report-pdf` itself and
feeds it a real `investment_reports` row (`6 Acer Court, Bowral NSW 2576`,
2026-09-02) plus the operator's real `global_report_settings`. Only
`loadHouseCoverArt` needs Supabase and it fails gracefully, so the HTML is the
production article. WeasyPrint **69.0** — the version the container pins —
turns it into the PDF. Fifteen pages, read as a document.

### Three chart defects, none of which a code review would have found

**1. The bar chart plotted dimensions the engine never scored.** Acer's
`investment_score.breakdown` marks `demand` and `growth` `excluded: true`,
`hasData: false`, `weight: 0` — and leaves a placeholder `score` of **50**
sitting in the field regardless. "Score drivers" drew five bars: risk 60,
yield 10, location 65, **demand 50, growth 50**. The two invented bars sit
mid-range between the three real ones, so the chart looks entirely normal.

Three readers ask that question and one asked nothing at all.
`reportBindingProjection` tests `excluded === true || hasData === false`;
`breakdownEntries` tests that plus a zero weight; the renderer's
`extractScoreBreakdownItems` read `.score` straight off the entry.
`dimensionWasScored` is the one predicate now, exported from
`scoreSections.pure.ts` and imported by the renderer. Re-rendered: five bars →
three.

**2. `&` printed as `&AMP;` on every chart label.** The Executive Verdict radar
read `&AMP; AMENITY`. `svgEscape` runs first and `.toUpperCase()` ran on its
output, so the entity's own letters were uppercased. The Contents page spells
the same heading correctly — that path decodes — which is why it survived.
`decodeHtmlEntities` / `svgLabel` / `svgLabelUpper` now carry the 15 label call
sites, and `&amp;` is decoded **last** so `&amp;lt;` cannot become `<`.

**3. The radar's longest label was clipped to `ASTRUCTURE`.** Labels anchor at
`cx ± (R + 22)` and ran outside a 460-wide viewBox. The box is 560 now — a
label gutter — with word-boundary wrapping at 15 characters and the score value
shifted down by the extra lines. Re-rendered: `INFRASTRUCTURE & AMENITY`, in
full, on two lines, clear of the polygon.

### An unbranded deployment signed its reports with another business's name

The same report rendered with the settings a freshly provisioned clone actually
holds — `contact_details.company_name` empty, no white-label brand, the seeded
`professional_disclaimer` row — carried **three businesses that are not the
issuer**, on one document:

| where | what it printed |
| --- | --- |
| watermark, tiled across every body page | `NPC` |
| PDF `Author` and `dcterms.creator` | `NPC Property` |
| back-page masthead | `PROPERTY` / `CONSULTING` |
| PDF `Creator` | `NPC Premium PDF (WeasyPrint)` |

`NPC` and `NPC Property` are the prime's trading name. `Property Consulting` is
a name no business holds — a placeholder that reads as a firm, and one of six
invented identities the fleet falls back to (`Property Consulting` ×14,
`Property Report` ×7, `NPC Property`, `NPC`, `a property advisory firm`,
`the Agency`).

The fourth copy is the one that matters most, and it was not in the renderer at
all. `useGlobalReportSettings.defaultDisclaimer` held the prime's own wording,
verbatim:

> *As a Professional Property Consultant & Buyers Agent, we provide information
> and advice based on our expertise… Our services include assisting you in
> identifying and evaluating potential opportunities, negotiating purchase
> terms, and navigating the transaction process… By engaging our services, you
> acknowledge…*

Under an unbranded masthead every clause of that is false. The platform is not
engaged by the reader, holds itself out as nobody's buyer's agent, and
negotiates nothing. It is not a cosmetic slip: acting as, or holding out as, a
real estate or buyer's agent is licensed conduct in every Australian state.

### The rule

**An identity and its disclaimer travel together**, because a disclaimer is a
statement by the issuer about the issuer. `issuerIdentity.pure.ts` resolves both
in one place, and there are exactly two issuers and never a third:

- **`workspace`** — the deployment has said who it is (report contact company
  name, or white-label brand). Its own name, its own disclaimer.
- **`platform`** — the deployment has said nothing. **Aurixa Systems**, and the
  technology provider's disclaimer.

No invented trading name, no other tenant's name, no blank masthead — the same
rule `platformBrand.ts` applies to the favicon and `submissionRecordBrand.ts`
to the AML submission record, and the "no brand" set is deliberately kept in
step with the latter so a document and its compliance record cannot disagree
about who issued them.

### Why the switch is on the READ and not on the default

Fixing the default alone would not have closed it. A clone whose
`global_report_settings` were seeded from the prime carries the prime's text in
the row, and no default ever fires. So `resolveReportDisclaimer` is keyed on the
resolved issuer, and the platform issuer prints the platform wording whatever is
stored.

The rule that makes that safe to state: *a deployment that has not said who it
is cannot have a disclaimer of its own.* A disclaimer written by an
unidentified party and printed under Aurixa's name is exactly the confusion this
closes, and the escape is one keystroke — typing a company name moves the whole
document to the `workspace` issuer.

`is_enabled: false` is honoured for a named business and **not** for the
platform: a report going out under Aurixa's name with no statement of what
Aurixa is would be the same defect reached by a different route.

### What the platform disclaimer says that the consultancy one could not

Five paragraphs, each closing something the inherited wording left open. Two are
worth naming.

**It disclaims the licensed CATEGORY, not merely the responsibility.** "Accepts
no responsibility" leaves the category claim standing, and the category claim is
the licensing one — so it says, in terms, that Aurixa Systems is not a real
estate agent, buyer's agent, property manager or licensed valuer, does not
provide financial product, credit, taxation or legal advice, and is not a party
to any property transaction. Stated as role and conduct rather than as a claim
about which registrations the company holds, because the licensing question
turns on what is *provided* and because this module cannot verify a corporate
registration.

**It does not extinguish the operator's own obligations.** A platform disclaimer
that appeared to wipe out a reader's rights against the business that handed
them the report would be a worse document than the one it replaces, so the
limitation carries its own limit: *"That does not limit the obligations of the
business that provided this report to you, whose own terms of engagement govern
its relationship with you."* The word "we" appears nowhere — "we" is what made
the consultancy wording read as an engagement.

The word **"Compass"**, the ten-year cash flow tables and the modelled
projections are all in the document, so the third paragraph says plainly that a
projection rests on stated assumptions and that *assumptions are not
predictions*.

### The back page, and a promise it could not keep

`CONTACT US` was drawn unconditionally over a contact list an unbranded
deployment has no rows for — a whole section heading over nothing, which is
§42's rule at page scale. It is drawn only when there is a row.

### Nothing changed for anyone who has a brand

The branded render, diffed before and after: **byte-identical** apart from the
generation timestamp, two source comments, and the `generator` meta — the tool
is Aurixa's rather than the prime's. The masthead, the contact rows, the
disclaimer body and the watermark are unchanged. The prime has held
`company_name: "Naidu Property Consulting Services"` since 2026-02-19, so
nothing here can reach its documents.

Verified on the unbranded render: **zero** occurrences of the string `NPC`
anywhere in the HTML (from 10), PDF `Author` = `Aurixa Systems`, masthead
`AURIXA` / `SYSTEMS`, no `CONTACT US` heading, the platform disclaimer on the
page.

### Named and not fixed

Found by reading the fifteen pages, all outside this package's scope:

- **Title and subtitle promoted to chapters** — Contents entries 02 and 03, and
  a near-blank page 5.
- **A WATCH callout truncated mid-word** at "finan".
- **Weekly cash flow reads −$1,844** in the document against a stored
  `weeklyNet` of −1,544.
- **The cover states the address twice.**
- **`1922` on the stat card, `1,922` in the prose** — one figure, two
  thousands conventions.
- **The cover's decorative SVG data-URI is rejected by WeasyPrint**, and
  `repeat(auto-fit/auto-fill)` is unsupported (4 warnings).
- **The disclaimer renders the source's hard line breaks** rather than
  reflowing.
- **`security-contract.test.ts` is wired into no script or workflow.** It was
  updated so it stays truthful, and `stage4ChartTruth.spec.ts` covers the same
  ground in a suite that does run — but a dormant contract test is a guard
  nobody is holding.
- **Five more invented-identity fallbacks outside the reporting engine** —
  `client-portal-login`, `portal-notification-email`, `manage-agency-agreements`
  and `_shared/brand-config.ts`, the last of which also falls back to the
  prime's own `@npcservices.com.au` sender addresses with a stated reason
  (a verified Resend sender). Same class, different surface.

### Verification

- 31 new tests across `stage4ReportIssuer.spec.ts` (19) and
  `stage4ChartTruth.spec.ts` (12), the second proved to go red on the bug it
  guards and green on the fix
- Branded and unbranded documents rendered end-to-end through WeasyPrint 69.0
  and read as documents, before and after
- `tsc --noEmit`, `eslint`, `security:edge-check` (339 against a 339 baseline),
  `audit:style`, `vitest run`, `npm run build` — clean

---

## §44 — The scorecard is bars, not a radar (2026-09-08)

Rugesh rejected the Executive Verdict's radar outright on sight of the §43
render. It is removed rather than discouraged.

### Two of the objections are about the data, not about taste

**The polygon's area depends on the arbitrary order of the axes.** The same
five scores arranged differently enclose a different area and read as a
different result. Nothing in `investment_score.breakdown` says what the order
should be — it is object key order — so the chart's most visually dominant
property carried no information at all.

**Area scales with the square of the values.** A dimension at 86 beside one at
64 contributes roughly 1.8× the area rather than 1.34×, so the picture
overstated every gap it drew.

Two more follow from the form. The space between two spokes means nothing —
there is no continuum between "tenant appeal" and "risk profile" — and filling
it implies one. And comparing lengths along five spokes at five angles is
measurably harder than comparing them against one baseline, while the corner
labels crowd: §43's `ASTRUCTURE` clipping was a symptom of the geometry, and
the gutter-and-wrap that fixed it is what a radar needs merely to be legible.

Bars close all four at once: one baseline, length proportional to value,
nothing enclosed, labels set horizontally in a column that sizes itself.

### Removed, not deprecated

`renderScoreWheel` (design system, ~6.7 KB of radar geometry) and
`renderScoreWheelSvg` (investment renderer) are **deleted**. A dormant
renderer is one import away from coming back — the reasoning that deleted
`ResponsibilityNotice.tsx` rather than unmounting it. `renderScoreBars` and
`renderScoreBarsSvg` replace them, both delegating to the `renderBars`
primitive that already existed beside them.

**The directive vocabulary is unchanged.** `{{wheel: …}}` is still recognised
and still draws, because ~35 stored reports emit it and dropping it would
blank a figure on every one. Content is transformed, never lost — and the
minimum score count drops from three to two, because three was the radar's
constraint (a polygon needs three vertices; bars do not).

The generator prompt now names the section SCORECARD and says in terms that it
is drawn as horizontal bars and never as a radar or spider chart.

Zero of 112 `report_templates` carry a `chart-radar` or `score-wheel` block, so
no stored template changes. The Template Builder still *offers* `chart-radar`
in its block palette — a separate product surface, named here and not touched.

### Two things the change surfaced

**The entity bug came back in a new form.** Moving the scorecard onto
`renderBarsSvg` printed `Infrastructure &amp; amenity`: labels arrive from
prose `marked` has already escaped, and `svgEscape` ran on them a second time.
Latent on `{{bars:}}` — no production bar label had ever carried an ampersand —
and immediate the moment the scorecard landed on that primitive. Fixed at the
primitive with §43's own `svgLabel`, so `{{bars:}}` gets it too.

**Two bar charts of the same kind must not be coloured by different rules.**
The document now draws two: Figure 01 "Score drivers" (the composite's
weighted dimensions) and Figure 02 "Qualitative scorecard". `renderBarsSvg`'s
default ramp colours by magnitude and turns **green** (`VIZ_GOOD`, `#4F7A33`)
above 0.66 — a colour this gold-and-cream document uses nowhere else, and one
that would have painted four of the scorecard's five dimensions. Both charts
pass an explicit gold accent and let the bar lengths do the comparing, which is
the entire argument for bars. Score drivers' labels also moved to sentence case:
`dimensionLabel`'s lowercase is for PROSE ("weighted across growth, location and
yield") and read as a typo in a label column beside "Location strength".

### Not sorted, deliberately

Bars can be sorted without distortion — there is no enclosed area whose shape
depends on order — and a sorted scorecard answers "which dimension is weakest"
instantly. It is left in the record's order for two reasons: the breakdown
table directly beneath it uses that order, and two orders on facing content is
a real cross-referencing cost; and the order is stable across reports, so a
reader comparing two properties finds the same dimension in the same row.

### Verification

- Rendered end-to-end and read: the scorecard prints five bars on one baseline,
  every label whole, `Infrastructure & amenity` correct, zero `&amp;` anywhere
  in the document
- The label guard MOVED rather than being deleted — `reportRenderDefects.spec`
  still asserts a long dimension label prints whole, now against the chart that
  replaced the radar, plus a measured ink-fits-the-column assertion
- A source guard asserts no radar renderer survives on either path, and that
  the directive still draws
- `vitest run` — 21,938 passed, 0 failed; `tsc`, `eslint`, `build`,
  `audit:style`, `security:edge-check` at baseline — clean

---

## §45 — Stage 5: the record must hold what the document asserts (2026-09-08)

Stage 5 asks whether the pipeline is right across the range of properties the
business actually sees. Doing that naively — render five more reports and read
them — is Stage 4 five times, so the space was derived from what the pipeline
genuinely **forks on** and the live corpus was counted into it.

The first measurement changed the question. **The range has collapsed.**

### `property_specs` is a hardcoded string and eight nulls

Every one of the 68 reports generated since June 2026 carries
`property_specs.property_type = 'Residential Property'` and **null in every
other field** — no bedrooms, no land size, no build size, no parking, no year
built, no zoning, no council area. `1/27D Mitchell Street` is unmistakably a
unit and its record says nothing. `6 Acer Court` is a four-bedroom house on
1,922 m² and its record says nothing.

Except the record does know. All of it is in `manual_overrides`:
`propertyType: "house"`, `landSizeSqm: 1922`, `buildSizeSqm: 253`,
`carSpaces: 2`.

The generator resolves every one of those correctly — `effectiveLandSizeSqm`
and its siblings merge the overrides over the listing, and those merged values
build the prompt, the duty assessment and the score — and then persists the
**un-merged half**:

```ts
land_size_sqm: propertyDetails?.landSizeSqm || null,
property_type: standardizedPropertyType || propertyDetails?.propertyType || 'Residential Property',
```

The answer is computed, used, and discarded at the moment of writing it down.
Measured across the completed corpus:

| the operator supplied | the spec column stored |
| --- | ---: |
| `landSizeSqm` | null on **127** |
| `buildSizeSqm` | null on **122** |
| `carSpaces` | null on **144** |
| `propertyType` | the literal on **84** |

`'Residential Property'` is not a measurement. `normalisePropertyType` returns
undefined for it, `dRisk` tests `unit|apartment|townhouse|house` and hits none,
`financialEngine` tests `=== 'unit'` for the strata estimate and misses. It is
a placeholder that reads as a classification — the same class as a `0.00%`
yield standing in for an unknown rent.

### Two rules

**The record must hold what the document asserts.** `composePropertySpecs`
takes the merged facts; every field is `| null` and a caller that knows nothing
writes nulls, which is a true statement about the record.

**Reading heals as well as writing.** Fixing the write alone would leave all
1,180 stored reports with an empty spec block for ever while the facts sit in
`manual_overrides` on every one of them. `readPropertyFacts` resolves the spec
column first and falls back to the overrides — the asymmetry
`healFinanceIdentity` settled on, for the same reason: a read-path repair
reaches every reader with no migration and no stored byte overwritten.

### The fork read four keys and three had never been written

`fork-investment-report` built its score input from
`parent.property_specs?.price`, `?.weeklyRent`, `?.state` and `?.propertyType`.
The writer has only ever emitted `land_size_sqm`, `building_size_sqm`,
`bedrooms`, `bathrooms`, `parking`, `year_built`, `property_type`, `zoning`,
`council_area`. Three of the four names do not exist and the fourth is the
writer's `property_type` misspelled.

This is the `aml.cases.tenant_id` class in JSONB, where **nothing errors**: the
read yields `undefined`, `Number(undefined)` yields `NaN`, and the `||` chain
silently takes the next rung.

Realised exposure, measured rather than assumed: `price` and `weeklyRent` are
shadowed by working rungs above them, so they cost nothing. `propertyType`
resolved to the placeholder while the operator's own answer sat in `overrides`,
destructured two lines above. `dRisk` is its only consumer and is weighted 15%
on the financial fork, 5% on the composite and **absent from
`DUE_DILIGENCE_WEIGHTS`** — so the strategic fork is unaffected, and my first
hypothesis that it moved every fork was wrong. Executed against a real parent:
a unit grades **B at 60 where the record says C+ at 57**. There are 19
apartments in the corpus and **none has ever been forked**, so this is latent —
and armed, and in the inflating direction.

### The prompt instructed the fabrication

`Property Characteristics` supplied the model a fill-in-the-blank on six rows:

```
| Land Size | ${effectiveLandSizeSqm ? … : 'Estimated XXX-XXX m² (typical for suburb)'} |
| Bedrooms  | ${effectiveBeds  || 'X (typical for property type)'} |
| Parking   | ${propertyDetails?.carSpaces || 'X-X spaces'} |
| Condition | ${propertyDetails?.condition || 'Good to excellent'} |
```

**169** stored documents print an `Estimated N–N m²` land size and **201**
assert `| Condition | Good to excellent |` about a property nobody inspected.
Three sampled reports state a land size roughly **double** the operator's own
recorded figure and then reason from it: `38 Larcom Crescent` says `~500 m²`
throughout — council rates, land tax and rent comparables — against a recorded
**255**. `80 Alison Street` prints `Estimated 500-650 m²` against a recorded
450. The prose is a literal expansion of the prompt's placeholder; the model
did exactly what it was told.

Era-split, because the mechanism and the exposure are different questions:

| era | reports | `Estimated N–N m²` | `Condition: Good to excellent` |
| --- | ---: | ---: | ---: |
| since Jun 2026 | 68 | **0** | **0** |
| Mar–May 2026 | 40 | 2 | 14 |
| before Mar 2026 | 1,072 | 167 | 187 |

So it is **historical** — the Compass-40 overlay does not draw that section.
A broader regex initially matched 14 current reports; read, all fourteen are
legitimate qualitative prose ("crime levels are moderate and broadly typical
for a coastal residential suburb"), which is a measurement error of mine and
not a finding. The placeholders are removed anyway, because a dormant
instruction to fabricate is one routing change from firing — the reasoning that
deleted the radar rather than deprecating it.

A prohibition with no permitted action is one a model routes around, so the
rows are omitted and the permitted action is stated: it may say an attribute is
not recorded, and may discuss the suburb's stock provided it attributes none of
it to this property.

### Coverage, per era

What fraction of the document's promised facts the record can actually
produce, reading spec **or** override:

| fact | historical (1,112) | current (68) |
| --- | ---: | ---: |
| property type | 88% | 57% |
| land size | 8% | 54% |
| build size | 8% | 49% |
| purchase price | 38% | 72% |
| weekly rent | 14% | 72% |
| investment score | 87% | **37%** |
| coordinates | 95% | **59%** |

Operators entering overrides have lifted land and build coverage sixfold. The
two that fell are worth their own work: 63% of current reports carry no score
at all, so the Executive Verdict scorecard draws nothing on most of them, and
41% have no coordinates, so no map.

### Verification

- 18 new tests; the phantom-key guard proved **red on the bug and green on the
  fix** rather than assumed
- The scorer executed against a real parent to measure the fork's cost, which
  corrected my own hypothesis about which variants it reaches
- `vitest run` full suite green; `tsc`, `eslint`, `audit:style`,
  `security:edge-check` at its 339 baseline

---

## §46 — Evidence-Backed Scoring: what market data this platform actually has (2026-09-08)

Step 1 of the Evidence-Backed Scoring brief is to trace the real Cotality
entitlement and every other authoritative market source, on the instruction not
to assume a vendor's public field list is what this application is entitled to.
It is a gate: the Growth Evidence Layer cannot be built on a source that returns
nothing.

**There is no capital-growth evidence in this platform.** Both candidate
sources are traced below, and neither has ever delivered a value.

### Cotality / CoreLogic — scaffolding, never connected

`supabase/functions/cotality-service/index.ts` says so in its own header:
*"SCAFFOLDING ONLY. Status: awaiting sandbox credentials from Cotality."* While
`COTALITY_API_KEY` is unset every branch returns a `modelled` envelope with
`value: null` and confidence 0.3.

Measured rather than taken on trust:

| check | result |
| --- | ---: |
| `data_provenance` rows (where the envelope would persist) | **0** |
| `cotality_*` / `corelogic_*` tables | **none exist** |
| calls in `api_usage_log` (7 months, 20 services) | **0** |
| callers of `cotality-service` anywhere in the repo | **0** |

The only references outside the function are three comments in
`investment-scoring-service` — `cotalityReady: true`, *"when cotality-service
envelopes land"*. It is a placeholder for an integration that was never
completed.

### Domain — wired, called, and returns nothing

`domain-data-service` is real code against a real endpoint:

```
https://api.domain.com.au/v1/suburbPerformanceStatistics/{state}/{suburb}
  ?propertyCategory={house|unit}&chronologicalSpan=12&tPlusFrom=1&tPlusTo=12
```

Its declared `SuburbPerformance` is close to exactly what the Growth and Demand
dimensions need — `medianSoldPrice`, `numberSold`, `medianRentListingPrice`,
`numberRented`, `daysOnMarket`, `auctionClearanceRate`, `annualGrowth`,
`rentalYield` — at suburb + state + dwelling-type granularity. It **is** called
by `generate-investment-report` (guarded on `suburb && state`).

And it has never returned a value. The generator's own provenance record is the
proof, because it stamps every source it attempted:

```
"seifa":     { source: abs_seifa,   confidence: 0.9  }
"economics": { source: rba,         confidence: 0.9  }
"employment":{ source: abs_employment, confidence: 0.9 }
"crimeStatistics": { source: state_crime_data, confidence: 0.8 }
"locationIntelligence": { source: google_maps, confidence: 0.95 }
"marketData": null                          ← the only null
```

46 of the 68 reports since June carry the `marketData` key; **0 of 68 carry a
non-null value**, and `demographics_data.marketData.medianPrice`,
`.annualGrowth`, `.vacancyRate` and `.daysOnMarket` are absent on **all 992**
scored reports.

**Absence from `api_usage_log` is not the evidence here**, and saying so would
repeat a mistake this programme has already made twice: `domain-data-service`
uses a bare `fetch` rather than `meteredFetch`, so a working call would not
appear there either. What is evidence is that it writes nothing to
`api_health_log` while six sibling services do, which matches the code path
where `DOMAIN_API_KEY` is unset — that branch returns `dataQuality:
'unavailable'` *before* any fetch or logging.

So the distinction that matters commercially: **this is most likely a missing
credential, not a missing capability.** Domain's Suburb Performance
Statistics product would supply most of the Growth and Demand layer. That is a
procurement question, not an engineering one, and it should be settled before
any further scoring work.

### What the platform DOES hold

| source | rows | what it can evidence |
| --- | ---: | --- |
| `abs_sa2_population` | **61,335** (2001–2025, 2,454 SA2s) | population growth at 1/3/5/10-year horizons, real CAGR |
| `rba_observations` | 3,518 | macro rate and lending series |
| `abs_census_poa` | 2,643 | income, tenure, household composition |
| `abs_seifa_poa` | 2,627 | socio-economic advantage deciles |
| `suburb_directory` | 18,519 | geography resolution |
| `median_rent_cache` | 156 (38 suburbs) | rents, thin |

Every one of these is a **growth driver**, not capital growth. Under the
brief's own §2 distinction — *"population growth is not itself evidence that
property values have grown"* — the platform can currently evidence the
supporting half of the Growth dimension and **none of the primary half**.

### The consequence for scoring

A Growth dimension built only on population, SEIFA and macro series would be
labelled Capital Growth while measuring none of it. That is the same class of
defect as the placeholder 50 it replaces — a dimension asserting more than its
evidence supports — and it would fail the brief's own test of surviving a
client challenge.

Scoring V2 therefore stops here, unwired, pending a decision on the market-data
source. The arithmetic corrections are built and backtested (§45); what is
missing is the evidence, and no amount of engineering substitutes for it.

---

## §47 — The wire is cut in four places, and the ABS answers (2026-09-08)

§46 stopped at "there is no market-data credential" and put a procurement
question to the owner. That was the right gate and the wrong stopping point:
following the payload the rest of the way to the scorer shows that **restoring
a credential would not have moved a single score**, and probing the public
registers shows that the primary evidence the brief demands is available for
nothing.

### Part 1 — Four independent breaks between market data and a grade

Each is fatal on its own. Each reports as normal operation.

**1. No credential.** `domain-data-service` reads `DOMAIN_API_KEY` and returns
HTTP 500 `Domain API key not configured` before any fetch. It is alone among
its siblings in writing no `api_health_log` row — `abs-census` (2,441),
`climate-data` (2,289), `crime-statistics` (1,747), `public-transport` (639),
`bc-segment-engine` (194) and `risk-assessment` (172) all do, Domain has never
written one. Consistent with the unset branch; not proof of it, because the
function logs health only after a successful call.

**2. The payload never reaches the scorer.** This is the break that matters.
`generate-investment-report` stores the Domain response as
`enhancedData.domainData` — a **sibling** of `demographics` — and then calls
the scorer with:

```ts
body: JSON.stringify({
  property: { … },
  demographics: enhancedData.demographics,
  locationIntelligence: enhancedData.locationIntelligence,
  financials: enhancedData.financials
})            // ← domainData is not here, and never has been
```

while every scorer reads

```ts
const marketData = demographics.marketData || financials.marketData || {};
```

— `investment-scoring-service` (twice: `transformScoringInput` and
`transformAreaInput`), `_shared/investmentScoreEngine.ts`, and
`backfill-investment-scores`. **No writer anywhere in the repository writes
`marketData` under either key.**

Measured across the whole corpus on 2026-09-08:

| assertion | result |
| --- | ---: |
| reports stored | 1,199 |
| distinct keys ever present in `demographics_data` | **7** — `dataQuality`, `dataSource`, `population`, `employment`, `income`, `housing`, `cached` |
| `demographics_data ? 'marketData'` | **0** |
| `financial_calculations ? 'marketData'` | **0** |
| `data_sources->'marketData'` populated | **0** of 1,049 carrying the key |

So `marketData` has evaluated to `{}` on every report this platform has ever
generated, and `medianSuburbPrice`, `priceGrowth1Year`, `priceGrowth3Year`,
`vacancyRate` and `daysOnMarket` have been `undefined` every time. This is the
`aml.cases.tenant_id` class again — reading a name no writer writes, with
nothing to report it — except in JSONB, where there is not even a 42703.

**3. A name mismatch behind the disconnect.** Were the payload routed, Domain
returns `medianSoldPrice`; the scorer reads `marketData.medianPrice`.
`annualGrowth` and `daysOnMarket` would map; the median would not.

**4. The series is fetched and thrown away.** The request asks for twelve
windows (`chronologicalSpan=12&tPlusFrom=1&tPlusTo=12`) and the handler keeps

```ts
series.seriesInfo[series.seriesInfo.length - 1]
```

— one point. So even a live, routed, correctly-named integration yields **one**
growth horizon, where the brief's §3 requires 5-year, 3-year, 1-year and a
consistency reading. And two fields the scorers want are not in the declared
`SuburbPerformance` interface at all: `priceGrowth3Year` and `vacancyRate`.

**The conclusion the credential question was hiding:** breaks 2–4 are ours, they
are free to fix, and until they are fixed no market-data purchase can change a
grade.

### Part 2 — The primary evidence is public, and it was measured

Probed live from this egress on 2026-09-08 (single range requests, no crawl):

| source | result |
| --- | --- |
| ABS Data API (`data.api.abs.gov.au`) | **answers** |
| VIC / QLD / SA open-data portals (CKAN) | answer |
| NSW Valuer General bulk sales | blocked at this proxy (502 CONNECT) — re-probe from the Supabase egress, as G2 did |

Two ABS dataflows carry property values. **`RPPI`** (Residential Property Price
Index) returns nothing after **2021-Q4** — five years stale, and a reminder of
the sanctions rule that *freshness of the load is not currency of the data*.
**`RES_DWELL`** is current and is the answer:

> **`ABS,RES_DWELL` — Residential Dwellings: Unstratified Medians and Transfer
> Counts by Dwelling Type, GCCSA and Rest of State**
>
> - 4 measures: transfer **counts** and **median prices**, each split
>   *established houses* vs *attached dwellings*
> - 15 regions (8 Greater Capital Cities + 7 Rest-of-State), plus state and
>   two weighted averages in the codelist
> - **2002-Q1 → 2026-Q2**, 98 quarters, 60 series, 92–98 observations each
> - medians are `AUD` at `UNIT_MULT=3`; counts are `NUM` at `0`

Executed end to end, median price of established house transfers, growth to
2026-Q2, annualised:

| region | median | 1yr | 3yr p.a. | 5yr p.a. | 10yr p.a. |
| --- | ---: | ---: | ---: | ---: | ---: |
| Greater Sydney | $1,488,000 | −2.13% | 3.16% | 4.28% | 5.21% |
| Rest of NSW | $810,000 | 5.06% | 4.49% | 6.54% | 6.66% |
| Greater Melbourne | $850,000 | 1.19% | 0.38% | 0.48% | 3.37% |
| Rest of Vic. | $625,000 | 8.70% | 3.12% | 5.49% | 7.44% |
| Greater Brisbane | $1,155,000 | 18.83% | 14.22% | 12.89% | 8.84% |
| Rest of Qld | $800,000 | 10.10% | 12.62% | 10.76% | 6.53% |
| Greater Adelaide | $975,000 | 13.24% | 11.57% | 12.13% | 8.28% |
| Rest of SA | $584,000 | 15.74% | 13.95% | 13.52% | 8.23% |
| Greater Perth | $1,010,000 | 18.82% | 18.96% | 13.34% | 6.86% |
| Rest of WA | $665,000 | 20.91% | 18.46% | 11.90% | 7.26% |
| Greater Hobart | $750,000 | 4.90% | 2.50% | 3.55% | 7.47% |
| Rest of Tas. | $625,000 | 13.64% | 5.32% | 8.27% | 9.47% |
| Greater Darwin | $752,000 | 21.37% | 8.45% | 5.90% | 3.22% |
| Rest of NT | $450,000 | 1.28% | −1.99% | −0.44% | 0.55% |
| ACT | $1,030,000 | 3.00% | 1.57% | 2.62% | 5.16% |

This is capital growth in the brief's own sense — **actual value movement**,
measured, government-published, dwelling-type aware, and reproducible by anyone
issuing the same request. It discriminates: Greater Perth and Greater Melbourne
are twenty points apart on the three-year reading, where today both score 50.
The transfer counts on the same dataflow are a genuine turnover signal for the
Demand dimension.

Two limits travel with it, and must be recorded on every figure rather than
argued away:

- **It is unstratified.** A raw median of transfers, not quality-adjusted, so
  composition shifts move it. The ABS says so in the dataflow's own title.
- **The grain is regional, not suburb** — Greater Sydney, Rest of NSW. Under
  the brief's §9 (persist the geographical level) and §8 (evidence confidence)
  that is exactly what the design already anticipates: a coarse measure,
  labelled coarse, beats a placeholder 50 and beats a fabricated suburb figure.
  It is a floor to build on, not a ceiling — suburb-grain sales registers are
  the next layer, and NSW's needs re-probing from the Supabase egress.

### What this changes

The gate in §46 asked the owner to choose a vendor. The measurement says the
first move needs no vendor and no spend: route the market payload to the
scorer, fix the field names, keep the series, and stand a deterministic Growth
dimension on `RES_DWELL`. A vendor purchase remains the route to *suburb*
grain, vacancy and days-on-market — but it is now an improvement on a working
dimension rather than the precondition for having one.

Scoring V2 stays unwired, per the brief's §14.

---

## §48 — Backtesting the ABS growth layer: it works, and that is the problem (2026-09-08)

§47 found a real, free, authoritative capital-growth source and recommended
standing the Growth dimension on it. Requirement 12 of the brief says to
backtest before wiring. Doing so changes the recommendation, and the reason is
one the brief anticipated in its own §8.

Method: the 992 scored reports, `scoringV2.pure.ts` **unmodified**, with
`priceGrowth1Year` and `priceGrowth3Year` supplied from `ABS,RES_DWELL` for
the report's state and dwelling type. Reads only; nothing written.

### The grade becomes a statement about the state

| state | n | growth subscore | composite min | median | max | spread |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| WA | 71 | **100** | 73 | **90** | 98 | 25 |
| QLD | 52 | **100** | 66 | 82 | 91 | 25 |
| VIC | 56 | 44 | 45 | 54 | 59 | 14 |
| NSW | 13 | 35 | 46 | 53 | 55 | 9 |

Growth carries 0.40 of the nominal weight and **every property in a state
receives the identical figure**, so the within-state spread is 9–25 points
while the between-state swing is 55. Under this layer the median Perth
property is an **A+** and no Sydney property can reach **A** at all, whatever
its merits.

That fails the brief's own test. "Why is my property A+?" answered with
"Greater Perth median house prices rose 18.8% last year" is a statement about
Perth. "Why is mine C+?" answered with "Greater Sydney fell 2.1%" is a
statement about Sydney. Neither is a defence of a grade awarded to a property.

### Every A+ in that run is a renormalisation

| the A/A+ cohort (119 of 216 resolvable) | |
| --- | --- |
| graded on 4 of 5 dimensions | 73 |
| graded on **3 of 5** | 46 |
| `weightCovered` values observed | **0.60, 0.70, 0.85** — never 1.00 |

So not one A+ here rests on the full nominal evidence; each is ≤85% of it
renormalised to 100%. Requirement 8 forbids precisely this — *"Do not simply
renormalise 45% of evidence to 100% and allow an A+"* — and the backtest shows
the gate is load-bearing rather than decorative. Arithmetic that renormalises
correctly is still not a defensible grade when what it renormalises is thin.

### A third finding, from the resolution attempt

Only **216 of 992** reports could be resolved to a state from
`property_address`, and the reason is not a parsing weakness: **743 of the 776
unresolved carry no comma at all** — `6 Acer Court`, `1/27D Mitchell Street`,
`Parmelia`, `The Glengarry Hotel (The Glen Pub)`. Bare street lines with no
suburb, no state, no postcode.

But 967 of 992 carry `location_intelligence.coordinates`. So the geography is
recoverable, from the coordinate and never from the address string — and the
join is already in the database: `abs_sa2_meta.gccsa_name` carries all fifteen
region names **exactly** as `RES_DWELL` spells them ("Greater Sydney", "Rest of
Vic.", "Australian Capital Territory"), so no correspondence needs inventing.
Any growth layer must be keyed on the resolved coordinate.

### What this changes

The ABS layer is worth having and is not the Growth dimension. Three
conclusions:

1. **`RES_DWELL` belongs in the product as regional CONTEXT**, labelled as the
   region's movement and carrying its own weight, never presented as this
   property's capital growth.
2. **Suburb-grain evidence is genuinely required** for a property-level growth
   score that survives a client challenge. That is now measured rather than
   asserted, and it is the case for the purchase §47 said was optional.
3. **The evidence-confidence gate comes first, whatever the source.** On this
   corpus it is the difference between a grade and a renormalisation, and no
   data purchase substitutes for it.

Scoring V2 stays unwired.

---

## §49 — The Domain trace, and one contract the engine may read (2026-09-08)

Step 1 of the Canonical Market Evidence brief: trace the existing Domain
integration completely before introducing another provider. No production
calls were made and no live scoring was changed.

### 1. What the integration requires

One credential, `DOMAIN_API_KEY`, sent as an `X-Api-Key` header. It is the
**only** Domain name anywhere in the repository — there is no OAuth client id
or secret, so the integration is built for Domain's API-key style of access
rather than its OAuth client-credentials style. It is declared in four places
and nowhere else: the Integrations registry (`domain` card, one required
password field), `integrationSecrets.ts`'s allow-list, the placeholder-key seed
migration, and `apiUsageBilling.pure.ts`.

`domain-data-service` reads it with `Deno.env.get('DOMAIN_API_KEY')` and, when
it is absent, returns **HTTP 500** `Domain API key not configured` before any
outbound request.

### 2. Does a credential exist in this deployment?

**Not established, and the three routes that should have answered it are all
mute.** This is worth stating precisely rather than guessing:

| route | reading |
| --- | --- |
| `integration_configs` row for `DOMAIN_API_KEY` | present, **empty**, `updated_at` still the 2026-08-02 seed |
| `update-integration-secret` | writes the project environment through the Management API and **never writes that table**, so the empty row is suggestive, not conclusive |
| `activity_logs` audit of secret updates | **zero rows** — and see below |
| edge function logs | retain 24 h; the last report was generated 2026-09-05, so no runtime evidence survives |
| `api_health_log` | Domain has never written a row, while six sibling services have |

**A new finding sits inside that table.** `update-integration-secret` logs every
change with `entity_type: 'settings'`, and `settings` **is not one of the 26
values of the `activity_entity_type` enum**. The insert is `await`ed without
its error being read, so PostgREST's rejection is discarded: every secret
update ever made through the Integrations page has failed to write its audit
row while returning `success: true` to the operator. That is an audit-trail
gap in its own right, and it is why the log cannot answer the question above.
Out of scope for this stage; recorded, not fixed.

**What would settle it, in one look:** Supabase Dashboard → Project Settings →
Edge Functions → Secrets, and check whether `DOMAIN_API_KEY` is listed. If it
is absent, that is the whole answer. If it is present, the service already
carries the exact probe — `POST domain-data-service { "healthCheck": true }`
returns the status code and a decoded message, and because the health check
runs *after* the missing-key guard it distinguishes **unset** (500, our own
message) from **set but unentitled** (403) and **set but invalid** (401). That
is a production call, so it is left for explicit go-ahead.

### 3. Entitlement and scopes

The endpoint is `GET /v1/suburbPerformanceStatistics/{state}/{suburb}`.
Whether this deployment's key is entitled to it **cannot be established from
the repository** — entitlement is a property of the Domain account, not of the
code, and the audit log that would show a successful call has never recorded
one. The honest statement is: *the required scope is whichever Domain package
includes Suburb Performance Statistics, and confirming it needs either the
dashboard or the health-check call above.* Anything more specific would be a
guess presented as a trace.

### 4. The exact fields, and the two that are not there

The service declares and reads nine values off the latest series entry:
`medianSoldPrice`, `numberSold`, `medianRentListingPrice`,
`numberListedForRent`, `daysOnMarket`, `auctionClearanceRate`,
`medianSoldPricePercentChange` (mapped to `annualGrowth`), plus a locally
computed `rentalYield` and a `dataQuality` flag.

Two fields the scorers ask for are **not in that interface at all**:
`priceGrowth3Year` and `vacancyRate`. No configuration change produces them
from this endpoint.

### 5. The multi-period series

The request is `?propertyCategory={house|unit}&chronologicalSpan=12&tPlusFrom=1&tPlusTo=12`
— twelve windows. The handler then keeps

```ts
series.seriesInfo[series.seriesInfo.length - 1]
```

one element, and discards the rest. **The history is fetched and thrown away.**
This is the single most consequential line for the brief's §4, because
multi-horizon growth needs exactly what is being dropped.

### 6–8. The three breaks already recorded

Traced in §47 and unchanged: `domainData` is a sibling of `demographics` and
is never included in the scoring call; the scorers read
`marketData.medianPrice` while Domain returns `medianSoldPrice`; and the
series truncation above. Breaks 6–8 are ours and free to fix; break 2 is a
credential question.

### Can Domain be the national evidence source?

On the evidence available: **partly, and not alone.** Suburb Performance
Statistics is nationally consistent in shape and is keyed by state + suburb
with a dwelling split, which is the right grain. But it carries no vacancy
rate and no multi-year growth field, and its per-suburb coverage for thin
markets is unknown until a key exists. It is a strong *primary* adapter for
median, 1-year growth, days on market, sales count and rent — with the series
retained rather than truncated, several horizons become derivable from the
same call — and it needs the ABS and the state registers behind it for
benchmarks and for the fields it does not carry.

### The contract itself

`_shared/reports/market/marketEvidence.pure.ts` is the structure the scoring
engine will be allowed to read, and the only one. Its shaping rule:
**provenance is per MEASURE, not per envelope.** The obvious design puts one
`level`/`source`/`asOf` on the bundle, and it cannot work, because the
hierarchy fills different fields from different levels in the same request — a
median from the suburb, a vacancy from the postcode, a benchmark from the
GCCSA. An envelope-level `level: 'suburb'` would be a false statement about
most of the fields and the report would print it.

So every measure is an `EvidencePoint` carrying its own level, area name,
dwelling-type match, provider, period, sample size, periods available and
method. Three rules are pinned by tests:

- **Absent is absent.** Every field optional; a measured `0` is a value and an
  absent point is the absence of one.
- **A dwelling-type MATCH outranks a finer geography.** A suburb figure mixing
  houses and units is a statement about a different market; a postcode house
  figure is the same market read more broadly.
- **Benchmarks resolve to the COARSER point.** Filling a benchmark from the
  subject's own suburb makes every property exactly average against itself and
  deletes the relative-performance signal §48 says the score needs.

The module holds no score, grade, weight or confidence verdict — only the raw
inputs a confidence calculation consumes. Nothing is wired.

---

## §50 — The credential audit trail was never written (2026-09-08)

Found while tracing the Domain credential (§49) and fixed here as an isolated
security correction, separate from any scoring change.

### What was wrong

`activity_logs.entity_type` is the Postgres enum `activity_entity_type`.
`update-integration-secret` wrote `entity_type: 'settings'`, which is **not one
of its 26 values**, and `await`ed the insert without reading its `error` — so
PostgREST's `22P02` rejection was discarded and the handler returned
`success: true`.

**Every credential change ever made through the Integrations page failed to
record who changed which secret, and told the operator it had worked.**
Measured 2026-09-08: `activity_logs` holds **5,037 rows across 22 enum values**
and not one `settings` row has ever existed, because not one could.

A second instance had the same shape: `aml-verification` wrote
`entity_type: 'aml_provider_config'` and discarded the error explicitly with
`.then(() => undefined, () => undefined)`, so promoting the AML screening
provider from simulator to live — a change to what the platform may do —
recorded nothing either.

An audit row that silently fails to write is worse than none, because the
absence reads as *"nothing happened"* rather than *"nothing was recorded"*.

### A correction on scope

A first scan counted 108 invalid literals across 25 files and that was **wrong**
— the pattern matched any `entity_type:` property, including AML purchasing
structures (`Individual`, `Company`, `SMSF`) and the portal functions, which
write to their own tables (`finance_portal_activity_log`,
`solicitor_portal_activity_log`). Scoped to literals inside an actual
`activity_logs` insert, the real count is **two**, both fixed here.

### The fix

`_shared/activityAudit.ts` is the one place that knows the vocabulary and the
one way to write a row. Three rules:

- **The vocabulary is checked before the write.** A PostgREST enum rejection is
  an opaque runtime `22P02` on a path that may run rarely; `recordActivity`
  throws a named error instead, and `check-activity-entity-types.mjs` makes it
  a build failure. The guard reads `ACTIVITY_ENTITY_TYPES` from the module, so
  a migration that extends the enum is declared in exactly one place.
- **A failed audit write is reported, never swallowed.** `recordActivity`
  returns an outcome rather than throwing for a database fault. For a secret
  update the Management API write has *already* succeeded, so failing the
  request would be a lie in the other direction — the response now carries
  `auditLogged` and, when false, `auditError`.
- **An audit row never carries a credential.** Metadata records secret
  **names**; `assertNoSecretValues` refuses a value under a key matching
  secret/token/password/api_key/credential.

`entity_type: 'system'` is the enum's value for a platform-level change, which
is what both call sites are.

Verified by execution: the guard was re-run against the original defect and
fails on it (`update-integration-secret/index.ts:227 entity_type: 'settings'`),
then passes once restored. Test files are excluded from the scan, because a
spec that feeds `'settings'` in to prove it is refused is the opposite of the
defect. 12 new tests; edge type-check back to its 339 baseline.

Secret-update behaviour is otherwise unchanged.

---

## §51 — The Domain integration is legacy, and the route is gone (2026-09-08)

Step 2 of the brief: verify Domain authentication against the *current* API
contract rather than assuming the repository's `X-Api-Key` implementation is
right. Established by unauthenticated execution — **no credential was sent** in
any of these calls.

### The measurement

| request (no credential) | result |
| --- | --- |
| `GET /v1/suburbPerformanceStatistics/NSW/Bowral` | **404** `{"title":"Not Found","detail":"No Matching Route"}` |
| `GET /v2/suburbPerformanceStatistics/NSW/Bowral/2576` | **401** `{"title":"Not Authorized","detail":"Unable to verify credentials"}` |
| `GET https://auth.domain.com.au/v1/connect/token` | **400** `{"error":"invalid_request"}` |

**The v1 route this repository calls no longer exists.** That is a routing
answer, not an authorisation one: Domain's gateway says there is no such
endpoint, and it says so *before* any credential question arises. The v2 route
— with the `{postcode}` third segment — exists and is credential-gated.

The token endpoint answering `invalid_request` to a bare GET means it is live
and rejecting a malformed request, rather than absent.

### What that changes

`domain-data-service` could not have worked in its current form **whether or
not a credential was ever configured**. A valid key would have produced a 404,
`response.ok` false, `return null`, and `marketData: null` — which is precisely
the reading on every one of the 992 scored reports (§47). The missing
credential was never the whole story, and on this evidence it may not have been
any of it.

The implementation is legacy on three independent counts:

1. **Version** — `/v1/` is removed; the current route is `/v2/`.
2. **Path shape** — v2 takes `{state}/{suburb}/{postcode}`; the repo sends
   `{state}/{suburb}` and holds no postcode in that call at all.
3. **Authentication** — the repo sends `X-Api-Key`. Domain's own access
   documentation states *"All Authorisation and Token requests are via
   `https://auth.domain.com.au/`"*, and the live token endpoint confirms an
   OAuth2 client-credentials flow.

### The limit of what probing can settle

Sending a dummy `X-Api-Key`, a dummy `Authorization: Bearer`, and no header at
all produced **byte-identical 401 bodies**. Domain's gateway does not
distinguish "unrecognised scheme" from "invalid credential", so the accepted
scheme cannot be read off an unauthenticated probe — it is settled by the
project's own configuration, not by the API's error text. Saying otherwise
would be a guess dressed as a trace.

### Package and scope

Domain's package catalogue lists **Properties & Locations** — *"Explore auction
results and property datasets. Access market performance and demographic
stats."* That is the package containing suburb performance statistics, and the
brief names the scope as `api_suburbperformance_read`. Their documentation is
explicit that *"You will not be able to access any API Endpoint until the
required API package(s) have been added to your project."*

Whether the Aurixa/Naidu project holds that package and scope is a fact about
the Domain account and is not establishable from this repository or from an
unauthenticated call.

### What is required, named exactly

- A Domain project with the **Properties & Locations** package added, granting
  **`api_suburbperformance_read`**.
- **`DOMAIN_CLIENT_ID`** and **`DOMAIN_CLIENT_SECRET`** for the OAuth2
  client-credentials flow against `https://auth.domain.com.au/v1/connect/token`
  — neither name exists anywhere in this repository today, which is itself
  evidence that the integration predates the current contract.
- The call rewritten to `/v2/.../{postcode}` with a Bearer token.

### The probe

`market-source-probe` is a read-only diagnostic added here and, as of this
section, not yet run (it has since run exactly once, on 8 Sep 2026 — §66):
it deploys on merge to `main`, and its own `verifyAuth` means it needs an
authenticated administrator session rather than a session key this work holds.
It reports which credential NAMES are set — never a value, never a length,
never a prefix, because a length is a hint and a prefix identifies the issuer —
and probes a **fixed allow-list** of source URLs. Targets are selected by name
from that list and can never be supplied in the request body: a probe that took
a URL from its caller would be server-side request forgery in a function
holding the service-role key. It writes nothing, and it classifies rather than
summarises — `credential_absent`, `credential_invalid_or_scope_missing`,
`not_entitled`, `route_not_found`, `rate_limited`, `blocked_by_origin` and
`reachable` are different findings with different owners, and "unavailable"
sent this investigation to the wrong remedy twice already.

It carries the government sources too (VIC, NSW Valuer General, SA, ABS),
because those refuse *this* development egress — `land.vic.gov.au` answers 403
and the NSW Valuer General 502 — exactly as `directory.gov.au` and `aph.gov.au`
did during the PEP work, where the two egresses turned out to differ. Whether
they answer the Supabase runtime is the open question, and it is the gate on
whether any suburb-grain source is reachable without a purchase.

---

## §52 — What the Supabase runtime can actually reach (2026-09-08)

The government suburb-grain sources were probed from **Supabase infrastructure**
using `pg_net` (0.14.0), which is the same mechanism the platform's own
scheduled HTTP already runs on. Read-only `GET`s; nothing written to any report.

This matters because §48 recommended government sources as the free
suburb-grain fallback on the strength of them answering *this repository's*
development egress. They do not answer the platform's.

### Measured

| source | from Supabase | reading |
| --- | --- | --- |
| ABS `RES_DWELL` data | **200**, 43,854 bytes SDMX | works |
| ABS dataflow catalogue | **200** | works |
| VIC open-data **catalogue** (`discover.data.vic.gov.au`) | **200**, 11.5 KB JSON | works |
| VIC median-house **file** (`land.vic.gov.au`) | **403** `<title>Just a moment…</title>` | Cloudflare JS challenge |
| NSW Valuer General **index** | **200**, 26.6 KB | works |
| NSW Valuer General **bulk zip** (`valuergeneral.nsw.gov.au/__psi/…`) | **403** `Just a moment…` | Cloudflare JS challenge |
| QLD Government Statistician | **200**, 82 KB | works |
| `data.qld.gov.au` API | **202**, empty body | bot interstitial |
| `data.sa.gov.au` | **403**, and **403 again with a browser User-Agent** | IP-blocked |
| Domain v2 | **401** "Unable to verify credentials" | reachable, needs credential |
| Cotality `/property/au/v2/statistics/locality/…` | **401** "Access token is missing" | reachable, needs credential |

### The pattern, and a correction

**Catalogue and index pages are reachable; the bulk DATA FILES are behind
Cloudflare bot challenges.** VIC and NSW both publish an openly licensed
dataset whose landing page answers and whose file does not. `data.sa.gov.au`
blocks the address range outright — and it answered **200** from the
development egress, so this is the reverse of the assumption that the platform
egress would be the more permissive one.

One correction to record: the first NSW probe returned "Couldn't resolve host
name", which looked like a block and was not. It used
`www.valuation.property.nsw.gov.au`; the host is
`valuation.property.nsw.gov.au` without the prefix, and it answers 200. The
finding stands only because it was re-probed.

A "Just a moment…" page is a JavaScript challenge. A server-side `fetch`
cannot solve one by design — that is what it is for. So the free suburb-grain
government route is **not automatable as a live fetch**. It remains viable
exactly the way `abs_census_poa`, the crime registers and the GTFS feeds were
loaded: an operator downloads the file, and a loader ingests it on a schedule.
That is a periodic manual acquisition, not an API.

**One caveat stated rather than glossed:** `pg_net` egresses from the database,
and Edge Functions egress from Deno Deploy. The two are not guaranteed
identical, and `market-source-probe` — now on `main` — is the definitive test
for the runtime that generates reports. Cloudflare challenges are normally
applied per ASN rather than per host, so the reading is expected to carry, but
it is evidence about the database's egress until the edge probe runs.

### Source qualification matrix

| | ABS `RES_DWELL` | Domain v2 | Cotality | VIC / NSW files | SA |
| --- | --- | --- | --- | --- | --- |
| geographic precision | GCCSA + rest-of-state (15) | suburb + postcode | suburb (locality) | suburb | suburb |
| dwelling-type precision | house vs attached | house vs unit | per product | house (VIC), all sales (NSW) | house |
| history depth | **98 quarters, 2002→2026** | series per request | per product | 11 years (VIC) | multi-year |
| transaction/sample depth | transfer counts | `numberSold` | per product | every sale (NSW) | counts |
| freshness | quarterly, current | on demand | on demand | annual/quarterly | quarterly |
| capital growth | **yes, measured** | yes (1yr; multi-year from the series) | yes (branch 4) | yes | yes |
| demand | volume only | DOM, clearance, listings | DOM, vendor discount, stock | volume only | volume |
| licence | open, attribution | commercial | commercial, **unverified** | CC-BY 4.0 | CC-BY |
| runtime availability | **200** | 401 (credential) | 401 (credential) | **Cloudflare-blocked** | **IP-blocked** |
| production suitability | benchmark/context only | primary candidate | primary candidate, licensing-gated | manual ingest | not available |

### Recommended canonical ownership

Per measure, not per provider — which is what the contract's per-measure
provenance exists for:

- **Capital growth (suburb)** — Domain or Cotality, whichever is credentialled
  first. Neither is today.
- **Demand (DOM, vacancy, listings, vendor discount)** — Domain or Cotality;
  no government source publishes these at suburb grain.
- **Regional benchmark** — **ABS `RES_DWELL`**, which is proven working, free
  and openly licensed. It is the one source that needs no decision, and §48
  already fixed its role as context and never as the property's score.
- **State fallback** — VIC and NSW by scheduled manual ingest; SA unavailable
  from this egress.

### Licensing is now carried in the contract

`EvidencePoint.licensingStatus` defaults to **`unverified`** and is never
inferred. `mayReachClientReport` admits only `open` and
`licensed_for_client_reports`, so a measure whose rights nobody has confirmed
can be **scored in a shadow backtest and cannot be rendered or persisted as a
derived metric**. That is what lets qualification proceed while Cotality's
commercial questions stay open, without ever assuming an answer to them.

### realestate.com.au — the licensed route is PropTrack, and scraping is refused in writing

Asked whether suburb growth could also come from realestate.com.au. The answer
is yes, through **PropTrack** — REA Group's data licensing arm, which is what
realestate.com.au's data is sold as — and **not** by reading the consumer site.

REA states the prohibition itself. `realestate.com.au/robots.txt`, fetched
2026-09-08, opens:

> *"In accessing or using any REA Group Website you agree that you will not use
> any automated device, software, process or means to access, retrieve, scrape,
> or index any REA Group Website…"*

That is the site owner's own term, not an inference, and it settles the
question without needing a view on whether a scraper would technically work.
It would also be a *worse* version of the Cotality position: Cotality's rights
are **unverified**, whereas this one is **expressly refused**, and the material
would be going into a commercial document a client receives.

**The slot already exists.** `registry.ts` declares `proptrack` — *"PropTrack
(REA) — REA Group valuations, AVMs and listing performance data"*, tagged
`realestate.com.au` — with `PROPTRACK_API_KEY` and `PROPTRACK_BASE_URL`. Both
are empty, seeded 2026-08-02 and never set, exactly like Domain and Cotality.

Probed from Supabase, no credential sent:

| request | result |
| --- | --- |
| `data.proptrack.com/api/v2/market/sale/historic-median-sale-price?…` | **403 Access Denied** (edge) |
| `data.proptrack.com/` | **403 Access Denied** |
| `realestate.com.au/robots.txt` | 200 — the clause above |
| `sqmresearch.com.au` | 200 |

A 403 at the edge without a credential is what a gated commercial API looks
like; it is not evidence of an entitlement problem.

**Two further declared providers matter to the matrix**, both with empty slots:
**Pricefinder** (*"property attributes, sales evidence and owner records"*) and
**SQM Research** (*"vacancy rates, stock on market and rental series"*). SQM is
the **only declared source for a vacancy rate at suburb grain** — no
government publisher offers one — so if Demand is to include vacancy at all, it
comes from there or from a provider that bundles it.

So the commercial shortlist is four, not two: Domain, Cotality, PropTrack and
Pricefinder, plus SQM for vacancy specifically. Every one of them has an empty
credential slot, which is the single fact standing between this programme and
suburb-grain evidence.

---

## §53 — ME-3: the deterministic methodology, and the dimension that was never once measured (2026-09-08)

Three pure modules, none of them wired to report generation. They are the
methodology; connecting it waits on a licensed suburb-grain source (§52) and on
the shadow backtest (ME-4).

- `_shared/reports/market/growthScoring.pure.ts`
- `_shared/reports/market/demandScoring.pure.ts`
- `_shared/reports/market/yieldScoring.pure.ts`
- `_shared/reports/market/gradeEligibility.pure.ts`

Each reads `MarketEvidence` (§49) and nothing else: no provider names, no HTTP,
no model. Same evidence in, same score out, and every component can be shown to
a client beside the measurement it came from.

### 53.1 Demand was not mostly a placeholder — it was entirely one

§46 recorded Growth pinned at a placeholder `50` on 975 of 992 reports. Demand
is worse, and the measurement leaves no room for interpretation. Across the 999
scored reports:

```
demandScore.score   = 50     999 of 999   (100.0%)
demandScore.hasData = false  999 of 999
demandScore.details = ""     999 of 999
```

The base score of `50`, never once moved by any evidence, on every report the
platform has produced — holding **15% of the composite weight** and saying
nothing at all about why. Not one report has a single demand data point.

All four inputs fail, each for its own reason:

| input | the scorer reads | what the record holds | reports |
| --- | --- | --- | ---: |
| `vacancyRate` | `marketData.vacancyRate` | no `marketData` key exists in any record | 0 of 1,201 |
| `daysOnMarket` | `marketData.daysOnMarket` | ditto | 0 of 1,201 |
| `medianSuburbPrice` | `marketData.medianPrice` | ditto | 0 of 1,201 |
| `unemploymentRate` | `demographics.unemploymentRate` | `demographics.income.unemploymentRate`, as a **string** | 865 unreachable |

The fourth is the instructive one, and it fails twice over. It is a **container
error** — the value sits one level below where the reader looks, so a real
number is invisible — and **849 of those 865 carry the identical value
`"3.5"`**, stamped `source: "ABS Census 2021 estimates"`, `dataQuality:
"estimated"`. Only 16 reports carry a figure that varies at all.

That matters for what the repair had to be. Correcting the path would have
moved Demand from one flat constant (50) to another (~68), attributed the
second one to the ABS on the way, and produced a dimension that discriminates
between properties exactly as well as the first: not at all. **A dimension can
be wired correctly and still be worthless**, which is the argument for routing
it through `MarketEvidence` rather than repairing the reader — a constant
cannot pass as a measurement there, because every point has to name its
provider, geography, period and sample size.

### 53.2 One characteristic, charged once

Three inputs to the property investment composite are scored in **two of its
dimensions each**, and the second site says so in its own words:

| input | scored in | and again in | what the second site calls it |
| --- | --- | --- | --- |
| `vacancyRate` | `calculateDemandScore:835` | `calculateRiskScore:1016` | *"Very high vacancy (>6%) signals weak rental **demand**"* |
| `daysOnMarket` | `calculateDemandScore:861` | `calculateRiskScore:1036` | *"Very extended selling time (>120 days) indicates weak **demand**"* |
| `populationGrowth` | — | `calculateGrowthScore:736` | *"Strong population growth driving **demand**"* |

The Risk dimension deducts up to 22 points for a vacancy rate the Demand
dimension has already scored, and its reason string names the characteristic as
demand while doing it. The Growth dimension adds 10 points for population
growth on the stated grounds that it drives demand — inside the dimension that
measures capital growth, which is the confusion this programme's brief names
directly: population growth is not evidence that values have risen.

One thing this table deliberately does **not** claim. The same file also holds
a separate *area* score (`calculateAreaScore` → `calcRentalMarket:420`,
`calcMarketMomentum:348`, `calcEconomicStrength:360`) which reads the same
three fields. That is a different product with its own composite, not a fourth
count against the property score, and an earlier draft of this section
mis-attributed those lines. The claim above is confined to one composite.

`DEMAND_EXCLUSIONS` states what the module refuses and which dimension owns it,
and a test asserts the refusal by feeding the scorer nothing but excluded keys
and requiring `score === null`. Two boundaries are worth naming:

**Demand is not Growth.** Price movement is Growth's at every horizon. A suburb
where prices rose is not thereby in demand *as well* — that is one fact counted
twice, and it is how a strong market comes to look exceptional on two
dimensions for one reason. Population growth is the single exception, and only
because it is a **driver**: people arriving is a reason to expect demand, not
evidence that values rose. It carries 0.15, so it can inform a score and cannot
carry one.

**Demand is not Yield.** Yield measures the rent level against the price;
vacancy measures whether the property lets at all. A 6% yield at 7% vacancy is
a different proposition from a 6% yield at 0.8%, and collapsing them loses
exactly that.

### 53.3 The four Demand components

| component | weight | measures |
| --- | ---: | --- |
| rental tightness | 0.35 | can it be let (`vacancyRate`) |
| sale urgency | 0.35 | how hard buyers compete |
| absorption | 0.15 | sales against stock advertised |
| population driver | 0.15 | whether the resident base is growing |

Sale urgency takes three readings — days on market, vendor discount, auction
clearance — and **blends them into one component rather than scoring three**.
They are three lenses on a single characteristic, and giving each its own
weight would charge for it three times inside the dimension that exists to stop
charging twice across dimensions. A test asserts that three strong readings
carry the same 0.35 as one.

Absorption needs both halves. A sales count alone is ambiguous: it rises with
demand and it rises with churn, and nothing in the number says which.

Two anchors put 50 in the middle, and in both cases **that 50 is a
measurement**: 3.0% vacancy and a 60% auction clearance rate are the
conventional balance points of the Australian market, where neither side has
the upper hand. The rental-tightness component says so in its own sentence when
the reading lands there, so a report cannot print a balanced-market 50 that
looks like the placeholder this work removes.

### 53.4 Demand confidence decays faster than Growth confidence

| factor | Growth | Demand |
| --- | ---: | ---: |
| geography | 0.30 | 0.30 |
| dwelling type | 0.20 | 0.15 |
| sample | 0.20 | 0.25 |
| history | 0.20 | — |
| freshness | **0.10** | **0.30** |

Not a copy with different numbers. A five-year CAGR ending two years ago still
describes how a suburb compounds; a vacancy rate from two years ago describes a
rental market that no longer exists — so freshness carries three times the
weight and decays on a steeper curve, and a test asserts a stale demand reading
loses more confidence than a stale growth reading.

There is no `history` factor: demand measures are point-in-time. And breadth is
deliberately **not** folded in — it is reported as `weightCovered` beside the
score, because putting it in confidence too would break this module's own rule
inside its own confidence calculation. A single impeccably sourced vacancy rate
is high confidence and 35% coverage at the same time, and both are true.

### 53.5 The Yield double-count, corrected at the economics

`calculateYieldScore` bands the gross yield and then subtracts 20 more points
when weekly cash flow is below −$100. Both halves measure the same economic
fact, and the band's own wording says so. Measured across the stored scores,
**every stored subscore is exactly 20 below the band its own `details` names**:

| stored score | its own `details` | band that text comes from |
| ---: | --- | ---: |
| 0 | "Poor yield (<2%)" | 10 |
| **10** (778 rows, 78.3%) | "Below average yield (2-3%)" | 30 |
| 30 | "Average yield (3-4%)" | 50 |
| 50 | "Good yield (4-5%)" | 70 |
| 65 | "Excellent yield (5-6%)" | 85 |

So a document says *"Good yield (4-5%) — Adequate cash flow"* beside a score of
50 the reader cannot reconcile with it.

The penalty also discriminates nothing: it landed on essentially the whole
corpus, because an Australian residential property at current prices is almost
always negatively geared before tax. **A term that applies to ~99% of cases
carries no information** — it shifts the whole dimension down 20 points and
compresses an already-narrow scale.

The correction is economic, not a recalibration: **yield measures the
property's rental return, and nothing else.** Whether the buyer's financing
makes the holding position negative is a fact about the loan, the deposit and
the tax position — not about the property — so it goes to `holdingCashFlowSignal`,
exported separately and named for its destination, so wiring it back into Yield
would be a visible decision rather than an accident. Its `typical_negative`
reading is the honest label for ordinary negative gearing.

Anchors are calibrated to the corpus rather than to intuition: the measured
median gross yield is **4.36%** and p75 **5.49%**, so 4.36% scores 50. The
bands were never the problem; the 20 points taken off afterwards were.

**The module bands a figure and never derives one.** The first version of
`scoreYield` computed `(weeklyRent * 52 / price) * 100` inline, and
`derivedFigureDefinitions.spec.ts` — the ratchet §MX-B left behind — failed on
it by name. That was the gate working: gross and net yield have exactly one
definition in this programme, in `_shared/reports/metrics/propertyMetrics.pure.ts`,
and adding a twenty-third module to the frozen list would have bought a green
run at the cost of the thing the ratchet exists to hold. `scoreYield` calls
`grossYield` and `netYield` now.

Delegating forced a second correction, and it is the more valuable one. The
input was `propertyPrice`, documented as *"purchase price or current value"* —
the exact ambiguity `DERIVED_FIGURES.md` records as the reason six gross-yield
sites disagreed while none of them was wrong. **Basis is part of the call**, so
the input is `basisAmount` plus a required `basis`, the result carries a
`BasedMetric` rather than a bare percentage, and `label` reads *"Gross yield
(on purchase price)"* from `labelFor`. A report cannot now print one basis
under the other's name.

### 53.6 The evidence ceiling — where a high score does not become a high grade

The fixtures produce one result that is correct and must not become an A+: a
suburb with a single strong twelve-month figure, at regional level, on six
transactions, two periods, dwelling type unmatched. It scores **93** with
**10%** coverage and **low** confidence. Nothing is wrong with the 93 — it is
what the evidence says. What would be wrong is printing "A+" on it, because the
honest sentence underneath reads *"exceptional, on the strength of one year of
regional data covering six sales of a different dwelling type."*

`gradeEligibility.pure.ts` caps the grade and **never changes the score**, so
the number and the reason stay legible side by side. Thresholds are untouched
(A = 75, A+ = 85). It is deliberately **not** "4 of 5 dimensions" — counting
dimensions treats a missing vacancy rate as equivalent to a missing five-year
growth series, and they are nothing alike. The rule is about Growth
specifically plus a floor on overall coverage:

| | growth confidence | growth coverage | overall coverage |
| --- | ---: | ---: | ---: |
| A | ≥ 45 | ≥ 45% | ≥ 55% |
| A+ | ≥ 70 | ≥ 70% | ≥ 70% |

### 53.7 Synthetic methodology tests — NOT market evidence

Every fixture is a controlled input constructed to exercise the mathematics.
None is a real suburb, median or growth rate, and **no result below is a
backtest, a forecast, or a statement about any Australian market**. Fixtures
are named for the shape they test rather than for any place. The real
historical backtest waits on a licensed suburb-grain source (§52, ME-4).

```
GROWTH                          score   conf    band   cover
exceptional sustained              90     95    high    100%
strong recent / weak long          31     95    high    100%
average                            55     95    high    100%
declining                          10     95    high    100%
average in booming region          47     95    high    100%
strong in slow region              85     95    high    100%
thin but strong                    93     24     low     10%
no evidence                         —     10     low      0%

DEMAND                          score   conf    band   cover
tight market, fast sales           95     93    high    100%
balanced on every reading          53     93    high    100%
oversupplied and slow               7     93    high    100%
tight rental, slow sales           58     93    high     70%
population only                   100     93    high     15%
stale readings (2024-Q2)           88     68  medium     70%
no evidence                         —     17     low      0%

YIELD                           score  gross      basis
4.5% gross, no gearing info        53   4.50%     gross
4.5% gross, -$350/wk geared        53   4.50%     gross   (unchanged — the double-count is gone)
9.9% gross                        100   9.88%     gross
1.6% gross                          1   1.56%     gross
rent unknown                        —       —     unavailable
```

Two readings deserve comment. *Average in booming region* scores **47** while
*strong in slow region* scores **85** — the §48 failure inverted: a regional
tide no longer lifts an ordinary property, and a slow region no longer sinks a
strong one, because the benchmark carries 0.15 and the suburb's own performance
carries 0.85. And *population only* scores 100 at 15% coverage: the component
is genuinely at the top of its scale, the renormalisation is arithmetic, and it
is the **coverage** beside it — not a suppressed score — that stops it becoming
a grade.

### 53.8 Legitimate A and A+ pathways exist without moving a threshold

The question §48 left open was whether the engine can produce an A+ that Aurixa
could defend. Composite over the five dimensions at the existing weights
(growth 0.40, location 0.25, yield 0.15, demand 0.15, risk 0.05), with the
evidence ceiling applied:

```
case                             growth   cover  score  grade  capped
fully evidenced, exceptional         90    100%     87     A+   no
fully evidenced, strong              85    100%     79      A   no
fully evidenced, average             55    100%     56      B   no
thin evidence, strong reading        93     40%     91     B+   yes (would have been A+)
```

A+ is reachable at 85 on fully evidenced, genuinely exceptional performance —
without lowering anything. A is reachable on strong performance. An average
property lands at B. And the fourth row is the point of the exercise: a
composite of **91** is refused A+ and capped at B+, because 40% coverage and
low growth confidence cannot carry the claim.

**These are algorithm fixtures.** They demonstrate the scale is functional and
the ceiling binds. They say nothing about how many real properties would earn
an A, which is ME-4's question and needs real suburb evidence.

### 53.9 "Evidence Behind the Score"

A grade is a claim Aurixa has to defend to the client it was given to. Today it
cannot be: the number arrives with a one-line `details` string which, on the
corpus, either contradicts the score beside it (53.5) or is empty (53.1). A
reader who disagrees with a B+ has nothing to disagree *with*.

`evidenceStatement.pure.ts` composes the disclosure — per dimension, what was
measured, where it came from, how far it can be relied on, and what could not
be measured and what that cost. Rendered from the fixture bundle:

```
GRADE A+  (score alone: A+)

Capital growth — 90, confidence 95 (high), 100% of methodology
   [w 0.35]  93  Five-year capital growth: 11.5% per annum over five years
   [w 0.25]  86  Three-year capital growth: 12.2% per annum over three years
   [w 0.10]  76  Twelve-month movement: 10.8% over the last twelve months
   [w 0.15]  94  Consistency of growth: 6 of 6 periods rose, spread 1.0 points
   [w 0.15]  97  Against the wider market: +7.3 points over the five-year window

Market demand — 92, confidence 93 (high), 70% of methodology
   [w 0.35]  91  Rental vacancy: 0.9% rental vacancy
   [w 0.35]  93  Competition for stock: 16 days on market, 84% auction clearance
   not measured: Sales against stock advertised, Population growth

Rental return — 52, 100% of methodology
   [w 1.00]  52  Gross yield (on purchase price): 4.50% gross, 3.46% net …

NOT AVAILABLE   cotality: no credential configured
LIMITATIONS     Market demand was scored on 70% of its methodology; sales
                against stock advertised, population growth could not be measured.
```

Four rules carry it. **It states and never derives** — every number is read
from a result object, because a disclosure that recomputes its own subject can
disagree with it, in the one place a reader is being invited to check the
working. **Absence is content** — a dimension that could not be measured gets a
row saying so, in the same shape as one that could, since silence about a
missing five-year series reads as "there was nothing to say". **Licensing
decides what may be shown, per measure** — the statement takes an AUDIENCE, and
an unquotable source is named as withheld rather than dropped, because a source
list with a silent hole is a worse disclosure than one that says a source is not
quotable; the figure still informs the score for both readers. And **the cap is
explained where the grade is stated**, not in a footnote, because it is the
first thing a reader will ask about.

Yield deliberately carries **no confidence reading**. It is not measured from
market evidence — it is computed from this property's own rent and price — and
printing a confidence beside it to make the table symmetrical would be
inventing a number for a layout. For the same reason the property's own rent
and price is never withheld from a client: it is not third-party licensed
material.

### 53.10 What is deliberately not done

Nothing here is connected to report generation. `investment-scoring-service` is
untouched, the stored corpus is untouched, and no document changes. The modules
are the methodology, verified by execution against synthetic inputs; the
decision to adopt them belongs after the shadow backtest, on real evidence.

---

## §54 — Provider discovery closes: PropTrack activation, SQM, and the final hierarchy (2026-09-08)

Discovery stops here. This section fixes the source hierarchy and states, for
the two sources that could change it, exactly what has to happen next — and
what must not be assumed in the meantime.

### 54.1 PropTrack qualification: what is known, and what cannot be known yet

| question | answer | how established |
| --- | --- | --- |
| Is it the licensed route to realestate.com.au data? | Yes | PropTrack is REA Group's data-licensing arm |
| Is scraping the consumer site an alternative? | **No** | `realestate.com.au/robots.txt` expressly refuses automated access (§52) |
| Is the API reachable from this platform? | Yes — 403 at the edge without a credential | `pg_net` probe from Supabase |
| Does this repository have a slot for it? | Yes — `PROPTRACK_API_KEY`, `PROPTRACK_BASE_URL` | `registry.ts:693` |
| Is a credential present? | **No.** Both empty, seeded 2026-08-02, never set | credential presence check |
| What does the API return? | **Unknown, and not guessed** | see below |
| What does it cost? | **Unknown, and not guessed** | commercial |

The last two are the honest answers. `developer.proptrack.com` does not
resolve and `data.proptrack.com/docs` returns 403 — PropTrack's documentation
is behind the same gate as its data. **No endpoint name, field name, response
shape or price appears anywhere in this specification**, because inventing one
is how an adapter comes to be written against an API that does not exist. The
standing rule holds: entitlement is never inferred from public vendor
documentation, and here there is not even public documentation to misread.

### 54.2 PropTrack activation specification

Three parts, in order. Part A is commercial and belongs to Aurixa; parts B and
C are engineering and are specified precisely enough to start the day part A
lands.

**Part A — what to obtain from REA Group / PropTrack.** Not a shopping list: a
set of questions whose answers determine whether the adapter is worth writing
at all. Each maps to a field the scoring engine actually reads.

| # | ask | why it decides something |
| --- | --- | --- |
| A1 | An API credential for a named environment (sandbox and production) | nothing below can be verified without one |
| A2 | The **suburb-grain** median sale price series, house and unit separately, with the available history depth in periods | Growth's long-term component needs ≥ 5 years; `growth5YearCagr` is 0.35 of the dimension |
| A3 | Whether the series is delivered as a series or as point statistics | `priceSeries` drives the consistency component; point figures alone forfeit 0.15 |
| A4 | Transaction counts behind each median | `sampleSize` is 0.20–0.25 of every confidence reading; absent, it scores 30 rather than 0 |
| A5 | Days on market, vendor discount, auction clearance at suburb grain | the three lenses of Demand's sale-urgency component |
| A6 | Rental vacancy rate at suburb grain — **or a statement that it is not offered** | if not offered, vacancy has exactly one other declared source (54.3) |
| A7 | Median advertised rent at suburb grain | Yield currently derives from a property-level rent only |
| A8 | Rate limits, and whether they are per key or per tenant | this platform forwards the prime's keys to every clone; a per-key limit is a fleet-wide ceiling |
| A9 | **Permitted cache duration** | the platform caches; an unstated duration cannot be complied with |
| A10 | **Redistribution rights for a client-facing PDF**, in writing | this is the gate on `licensingStatus`; see below |
| A11 | **The right to persist a derived metric** (a score computed from their data) | the grade is derived and stored |
| A12 | Attribution wording required on a rendered document | it has to be typeset, not appended later |

A10 and A11 are not paperwork. `EvidencePoint.licensingStatus` defaults to
`unverified`, and `mayReachClientReport` admits only `open` and
`licensed_for_client_reports` — so **until A10 is answered in writing, a
PropTrack figure can be scored in a shadow backtest and cannot be rendered in
a client document or persisted as a derived metric.** That is a working state,
not a blocked one, and it is the reason qualification can proceed while the
commercial conversation runs.

Cost is deliberately absent from this table. It is a commercial negotiation
and no figure is stated here.

**Part B — what this repository must build.** One file and one registration.

1. `_shared/reports/market/adapters/proptrackAdapter.pure.ts` — maps
   PropTrack's response onto `MarketEvidence`. Pure, no HTTP.
2. `'proptrack'` added to `EvidenceProvider` in `marketEvidence.pure.ts`.
3. The fetch goes through `_shared/meteredFetch.ts`, never bare `fetch`, or the
   call is billed to nobody (`API_USAGE_METERING.md`).
4. `PROPTRACK_API_KEY` is added to `_shared/listingsPipelineSecrets.pure.ts`
   **only if** it is to be Mission-Control-managed and forwarded to clones.
   Otherwise it stays a per-workspace credential on the Integrations page.

Nothing else changes. The scorers read `MarketEvidence` and do not know
providers exist — which is the property §49 exists to create, and its first
real test.

**Part C — the qualification gate, before a single figure reaches a
document.** Run `market-source-probe` against the credentialled endpoint and
record, per measure: geographic level actually returned, whether the dwelling
type matched what was asked, sample size, period covered, and history depth.
A provider that answers 200 with a *postcode* median when a suburb was
requested is a correct answer to a different question, and the contract already
has the vocabulary to say so — but only if the adapter sets `level` from what
came back rather than from what was asked.

### 54.3 SQM Research qualification

SQM matters for one reason and it is a sharp one: **it is the only declared
source of a rental vacancy rate at suburb grain.** No Australian government
publisher offers one. Vacancy is 0.35 of the Demand dimension — the single
largest component — so without SQM or a commercial provider that bundles
vacancy, Demand runs at a maximum of 65% coverage by construction.

| question | answer |
| --- | --- |
| Declared in this repository? | Yes — `SQM_RESEARCH_API_KEY` (`registry.ts:817`) |
| Credential present? | **No.** Empty, never set |
| Reachable from Supabase? | `sqmresearch.com.au` answers 200 |
| Scraping? | **Refused.** Not attempted, not planned |
| What it publishes | vacancy rates, stock on market, rental series |
| Grain | suburb / postcode |

The same three questions decide it: does the licence permit a figure in a
client-facing PDF, what cache duration is permitted, and may a derived metric
be persisted. Until answered, the same rule applies — `unverified`, scorable,
not renderable.

One point of sequencing: **A6 above may make SQM unnecessary.** If PropTrack
supplies vacancy, one commercial relationship covers growth, sale urgency and
rental tightness together. So A6 is asked before SQM is pursued, not after.

### 54.4 Pricefinder — deliberately not pursued

Declared (`PRICEFINDER_API_KEY`), empty, and left there. Its stated coverage —
property attributes, sales evidence, owner records — overlaps what Domain,
Cotality and PropTrack already offer, and it publishes no measure the other
three lack. A fourth commercial relationship is not investigated until the
first one is credentialled and qualified.

### 54.5 The final source hierarchy

Resolved **per measure**, which is what per-measure provenance is for. First
row that can answer wins; the contract's `mergeEvidence` implements the
contest.

| measure | 1st | 2nd | 3rd | if none |
| --- | --- | --- | --- | --- |
| suburb median price | Domain / Cotality / PropTrack | state file (manual ingest) | — | absent |
| growth 1 / 3 / 5 yr (subject) | Domain / Cotality / PropTrack | state file (manual ingest) | — | absent |
| price series | same, where delivered as a series | — | — | consistency excluded |
| **regional benchmark growth** | **ABS `RES_DWELL`** | — | — | relative component excluded |
| days on market | Domain / Cotality / PropTrack | — | — | lens dropped from sale urgency |
| vendor discount | Cotality / PropTrack | — | — | lens dropped |
| auction clearance | Domain / PropTrack | — | — | lens dropped |
| **vacancy rate** | **SQM**, or PropTrack if A6 | — | — | rental tightness excluded |
| sales count | Domain / Cotality / PropTrack | ABS transfer counts (regional) | — | absorption excluded |
| listing activity | Domain / Cotality / PropTrack | — | — | absorption excluded |
| population growth | ABS ERP | — | — | driver excluded |

Three properties of that table are the point of it. **ABS is the benchmark row
and only the benchmark row** — §48 is what happens when a regional figure
stands in for a local one, and the contract keeps `benchmark*` as separate
fields so the two can never be confused. **Every "if none" is *absent*, never a
default** — no zero, no 50, and the coverage figure beside the score says how
much of the methodology ran. And **no row is a scrape**: where a licensed route
does not exist, the measure is absent and the report says so.

### 54.6 What is still blocking the real backtest

One thing, and it has not moved: **every commercial credential slot is empty.**
Domain, Cotality, PropTrack, Pricefinder, SQM — five declared providers, five
empty keys. ABS answers and is regional. The government suburb-grain files are
behind Cloudflare challenges a server-side fetch cannot solve by design (§52).

So the historical A/A+ backtest over the 992 stored reports **cannot be run**,
and running it on regional data would reproduce §48's failure with better
arithmetic. The methodology is built, tested and version-stamped; it waits on
one credential, and the shortest path to it is A1.

---

## §55 — ME-4: scoring integration hardening and backtest readiness (2026-09-08)

Nine pure modules now, still connected to nothing.
`investment-scoring-service` is untouched, the stored corpus is untouched, no
document changes, and thresholds are unmoved (A 75, A+ 85).

### 55.1 The Dimension Ownership Matrix

Extracting each live dimension scorer's body and listing the `input.*` it reads
gives **five inputs read by two dimensions**:

| input | read by | verdict |
| --- | --- | --- |
| `vacancyRate` | Demand, Risk | **duplicate** — Risk's reason string says *"weak rental **demand**"* |
| `daysOnMarket` | Demand, Risk | **duplicate** — Risk's string says *"indicates weak **demand**"* |
| `cashFlow` | Yield, Risk | **duplicate** — the ME-3 yield double-count |
| `priceGrowth1Year` | Growth, Risk | **declared exception** |
| `propertyPrice` | Yield, Demand | not a duplicate — a yield denominator and a price-to-median ratio are different quantities |

The clearest evidence is that the code names the characteristic it is measuring
and the name belongs to another dimension. Risk deducts up to 22 points for a
vacancy rate Demand has already priced at 0.35 of its weight.

`populationGrowth` is read by exactly one dimension — the wrong one. It sits
inside `calculateGrowthScore` adding 10 points on the stated grounds that it
*"drives demand"*, inside the dimension that measures capital growth.

`dimensionOwnership.pure.ts` assigns one owner per input with the reason and the
dimensions forbidden from reading it. Two rules: **an owner is the dimension
whose QUESTION the input answers**, not the one that reads it first; and **a
shared input needs a declared exception, never silence**. There is exactly one
exception — Growth rewards twelve-month performance while Risk prices its
reversal, in **opposite** directions, at a measured magnitude of roughly +4.0
composite points against −0.9.

### 55.2 Growth overlap: the components were awarding one signal three times

The question was whether the five components measure different characteristics
of one price series or award the same performance repeatedly. Measured over 600
synthetic series varying trend, volatility, shape and benchmark independently:

```
                   longTerm  mediumTerm    momentum consistency    relative
longTerm               1.00        0.97        0.81        0.47        0.86
mediumTerm             0.97        1.00        0.91        0.40        0.83
momentum               0.81        0.91        1.00        0.11        0.70
consistency            0.47        0.40        0.11        1.00        0.41
relative               0.86        0.83        0.70        0.41        1.00
```

**The five-year and three-year LEVELS correlate at r = 0.97.** They share three
of their five years, so of course they agreed — and together they held **0.60
of the Growth weight**. That is the inadvertent double-award this audit set out
to detect, and the economic reasoning does not hold for it.

The fix is economic, not a re-weighting. The question that component existed to
answer was never *"what was the three-year rate?"* but **"has the recent period
confirmed or contradicted the long run?"** — which is `3yr − 5yr`, orthogonal to
the level by construction:

```
                   longTerm  trajectory    momentum consistency    relative
longTerm               1.00        0.02        0.81        0.47        0.84
trajectory             0.02        1.00        0.51       -0.21        0.02
```

**r = 0.97 → 0.02.** `longTerm` takes the freed weight (0.45) because it is now
the sole measure of the rate, which is also the brief's own priority.

Two correlations remain high and are kept deliberately, stated in the module
rather than quietly carried. **Momentum's 0.81 is partly a sweep artefact** —
the last-year return is a deterministic function of the same trend that drives
the five-year rate, a real suburb's last year diverges far more, and at 0.10 the
weight bounds it either way. **Relative's 0.84 is inherent to what "relative"
means**: with the benchmark held still, out-performance is monotone in the
subject's own growth, and it decorrelates exactly when benchmarks move, which is
the case §48 protects.

`GROWTH_WEIGHTS_V3_0` is retained so the harness can score a corpus both ways.

### 55.3 Source independence is not performance breadth

Confidence had **no measure of corroboration at all**, so a bundle drawn
entirely from one vendor read exactly like one two providers agreed on. Three
horizons from one provider are one source with more history.
`sourceIndependence` counts distinct providers at 0.10, and `history` now reads
*"periods of history"* so the two claims cannot be confused. A test asserts that
adding a second horizon from the same provider raises history and leaves source
independence unchanged.

### 55.4 Location independence

**Location is the dimension that works**, and that is worth saying: 972 of 1,001
reports carry all three inputs, with 64 distinct walk scores and 512 distinct
commute times across 21 distinct scores spanning 14–85. Three defects.

**The state premium is not a locational characteristic.** Up to 15 of 100 points
by state — NSW/VIC/QLD 15, WA/SA 12, TAS/ACT/NT 8 — so every NSW property
collects the same 15 whether it stands in Mosman or 700 km inland, and a rural
report prints *"Major capital city location"*. Removed; `state` is owned by
nobody.

**Absent evidence scored points**: no walk score +12, no commute +12, no schools
+8. Thirty-two of 100 points available to a property with no locational evidence
at all. It bites on 29 of 1,001 reports, so the blast radius is small and the
principle is not.

**The walk score saturates.** `calculateWalkScore` sums five capped amenity
terms that all max out in any suburb with a shopping strip: **62.8% of 1,112
properties score 90 or above**, 87.1% score 70 or above, and p25→p75 spans just
84→95. A "Walker's Paradise" band holding two thirds of an Australian investment
corpus carries little information. The anchors are stretched to where the corpus
sits, and a saturated reading says so on the result.

### 55.5 Risk independence — the honest answer is that it is thin

Vacancy and days on market removed. What remains, measured over 1,204 reports:

| input | present | note |
| --- | ---: | --- |
| `propertyType` | 930 (77.2%) | at `property_specs.property_type` — **snake_case**, while the scorer reads `propertyType`, so it has never been read; 145 more rows hold the placeholder `"Residential Property"` |
| `lvr` | 201 (16.7%) | |
| `weeklyCashFlow` | 185 (15.4%) | effectively the same rows as `lvr` |

So the answer to *"can the 5% Risk dimension be populated independently and
defensibly?"* is **partly, and predominantly on one input**. Property type is
reachable on 77% once the key name is corrected; leverage and serviceability
exist on about a sixth of the corpus and are the same sixth. A Risk score on
most reports will rest on property type alone. **No input was invented to fill
the weight.**

### 55.6 The shadow orchestrator

`scoreInvestmentV2Shadow` is the one place the five dimensions, evidence
confidence, grade eligibility and Evidence Behind the Score compose — because
every defect this programme has found lived in the composition rather than in a
dimension, and those are only visible where the pieces meet.

It publishes what §48's A+ properties were never asked for: `effectiveWeights`
beside nominal ones, and `evidenceCoverage` **discounted by how much of each
dimension's own methodology ran**. Every A+ in that backtest was "85% of the
nominal evidence renormalised to 100%", and that number is now on the result
rather than implicit in it.

### 55.7 Twenty-six invariants

| rule | how it is checked |
| --- | --- |
| Monotonicity | five dimensions, each swept across its input range |
| No duplicate reward | vacancy and DOM move Demand and leave Risk **identical**; cash flow moves Risk and leaves Yield identical; population growth moves Demand and leaves Growth identical |
| The one exception | asserted to move its two dimensions in **opposite** directions |
| Missing is absent | no dimension returns 0 or 50 from absence; an unmeasured dimension leaves the composite; a location with no evidence scores `null`, not 32 |
| Depth ≠ corroboration | a second horizon from one provider raises history and not source independence |
| Grade integrity | a high score on thin evidence is capped, and both grades are always reported |
| State independence | changing **only** the benchmark is bounded to six composite points; a booming region cannot lift an ordinary property to an A |
| Property differentiation | two suburbs in one region differ by more than 40 growth points on their own evidence |

### 55.8 Corpus readiness — and a second blocker nobody had counted

The resolver run over all 1,204 stored reports:

```
Readiness state                          Geography resolution
  unresolved_geography  1204  100.0%       none               92    7.6%
  backtest_ready           0    0.0%       coordinates_only  1112   92.4%
                                           resolved             0    0.0%

Missing field counts
  suburb            1204  100.0%      purchase_price  1004  83.4%
  weekly_rent       1023   85.0%      lvr             1003  83.3%
  weekly_cash_flow  1019   84.6%      dwelling_type    311  25.8%
```

**0 of 1,204 are backtest-ready, and market evidence is not why.** Suburb,
postcode and state are stored nowhere structurally — 0 of 1,204 — while
coordinates are present on 92.4%. There are **two** blockers, not one, and the
second is entirely within our control: a licensed suburb dataset cannot be
joined to a corpus that has no suburb.

The resolver will not parse `property_address` to close that gap, and
`ADDRESS_COMPOSITION.md` is why: Make geocodes `{{address}},{{suburb}}` with no
street number, Google answers with a suburb centroid, and a second model call
writes eight address columns back over the extraction — so `Full Address` reads
`Cobblebank VIC 3338, Australia` on a record that knows `Mortlock Street`. A
string that has been through that loop cannot prove which suburb a property is
in, and wrong geography would attach real market evidence to the wrong property
with every downstream figure inheriting it.

The pieces for the mapping exist and are simply not connected: `suburb_directory`
holds 18,519 suburb/state/postcode rows but no coordinates; `listing_geocodes`
resolves coordinate→suburb on 1,030 rows but is keyed for the Listings
marketplace; `sa2_point_cache` holds one row. The remedy is a bounded
reverse-geocode pass over 1,112 coordinates, validated against
`suburb_directory` — a **proof** from the provider's own locality answer, not an
inference from the address label.

Two resolver corrections found by execution: neither `purchasePrice` nor
`propertyPrice` appears anywhere in `financial_calculations` on any row (the
figure is `initialCosts.propertyValue`, and for builder stock it is split across
`landPrice` and `buildPrice`, so the sum is labelled as a sum in its
provenance); and each field declares candidate paths in priority order with the
result recording **which** path resolved, because the corpus spans several eras
of the writer and a backtest has to be auditable back to the byte it read.

### 55.9 Provider-neutral ingestion

One contract over four routes — `api_adapter`, `licensed_csv`, `licensed_json`,
`operator_import` — so a licensed export is usable the day it lands, without
waiting for API access. **Licensing is enforced per ROW, not per file**, because
a provider may deliver open ABS-derived benchmarks alongside proprietary medians
in one export and refusing the file would discard material we are entitled to
use. An unverified row is accepted for shadow scoring and refused a client
document. Nothing in the module writes.

### 55.10 The harness, and diagnostics that only report

The harness scores exactly the rows it is handed evidence for and reports the
rest as unresolved: **no synthetic fallback, no regional stand-in, no default**,
because a backtest run on invented inputs produces a distribution that looks
exactly like a real one and would be acted on.

Nine checks — state domination, one dimension dominating, compression,
inflation, single-grade collapse, top grades on low confidence, highs resting on
one horizon, highs resting on renormalisation, and movement driven by data
availability rather than performance. **Every one reports and none adjusts.**
§48 was found by looking at a distribution, and a system that silently corrected
for it would have hidden the finding instead of surfacing it.

### 55.11 What is deliberately not done

No production wiring. No historical backtest — real or simulated. No threshold
change. The system is methodology-ready and backtest-ready; it is not data-ready
until geography is resolved and a licensed suburb source lands, and it is not
live until real distributions have been inspected.

---

## §56 — ME-5: canonical geography, and what the historical record really holds (2026-09-08)

### 56.1 The geography blocker is removed

ME-4 measured suburb, postcode and state stored on **0 of 1,204** reports. After
this stage, **931 carry a full ASGS chain**.

Resolution is point-in-polygon against the ABS ASGS 2021 boundaries — the ones
the ABS publishes its own statistics against — so the geography and the
evidence will share one definition. Reachability was proved from **Supabase
infrastructure** rather than from this repository's development egress, because
§52 already caught that distinction the hard way; all 25 ASGS layers answer 200.

One coordinate resolves the chain:

```
SAL → suburb + locality code        POA → postcode
SA2 → statistical area              → local join to abs_sa2_meta for SA3/SA4/GCCSA/state
RA  → remoteness                    UCL → the urban centre it actually sits in
```

Deriving the hierarchy locally rather than fetching it means fewer calls **and**
a hierarchy that cannot disagree with itself.

| | reports |
| --- | ---: |
| resolved | **931** (83.6%) |
| unresolved | 183 |
| requires_review | 0 |
| resolved_with_warning | 0 |
| distinct suburbs / SA2s | 302 / 274 |

445 distinct Australian coordinates, 2,225 point queries, **445 of 445 resolved
on all five layers, zero failures.**

Remoteness: Major Cities 657, Inner Regional 220, Outer Regional 46, Remote 6,
Very Remote 2 — so **274 reports are non-metro**, which is the population the
Location fairness work exists to protect.

**The address is never consulted.** `ADDRESS_COMPOSITION.md` records why, and
the corpus proves it: the coordinate whose stored address reads `Cobblebank VIC
3338` resolves to **Melton South**, correctly, with urban centre **Melton**
rather than Melbourne.

### 56.2 Independently cross-validated, 100%

All 144 initial `suburb_not_in_directory` warnings were the ABS's own
disambiguating qualifier — `Fernvale (Qld)`, `Armadale (WA)`, `Churchill
(Vic.)`, `Springfield (Ipswich - Qld)` — against a directory that stores plain
names. Normalised, **all 144 matched, and postcode AND state agreed on all
144, with zero disagreements.**

So across all 931 resolved reports: **0 state mismatches, 0 postcode
mismatches**, confirmed by a source independent of the boundaries themselves.

### 56.3 The 183 unresolved are an integrity finding, not a resolver weakness

**16.4% of stored coordinates fall outside Australia** — latitudes as far north
as 55.9, longitudes as far west as −122.3. They are left unplaced. Coverage is
not the objective: forcing them into a suburb would attach real market evidence
to the wrong property, and every figure downstream would inherit it silently.

### 56.4 The financial figures were not missing — they were in the wrong drawer

ME-4 reported purchase price on 203 of 1,204. That was true of
`financial_calculations` and wrong about the record.

**997 of 1,207 reports have no financial block at all**, so the gaps are whole
reports rather than scattered fields — but **459 carry `manual_overrides`**,
and those hold exactly the figures in question, **entered by an operator**:

| figure | `financial_calculations` | `manual_overrides` | **either** |
| --- | ---: | ---: | ---: |
| purchase price | 203 | **431** | **493** |
| weekly rent | 184 | 193 | 227 |
| LVR | 204 | 200 | 251 |

`manual_overrides` also carries the full cost structure — council and water
rates, management and letting fees, insurance, repairs, stamp duty, solicitor
fees, occupancy rate, loan amount, interest rate, term.

Purchase-price coverage is therefore **2.4× what ME-4 reported**, from a source
that was already in the record. An operator-typed figure is the strongest
provenance available and outranks anything derived.

### 56.5 The historical transport data is fabricated, and it contaminates Location

ME-4 recommended preferring "actual evidence such as amenity distances and
transport" over the saturated walk score. **Measured, that recommendation
cannot be followed on historical data, because the transport block is worse.**

`distanceToStop` holds **five distinct values across 1,108 reports**, one per
state:

| distance | "nearest stop" | reports |
| ---: | --- | ---: |
| 450 m | Central Station | **822** |
| 250 m | Swanston Street Tram | 117 |
| 350 m | Queen Street Bus Station | 86 |
| 320 m | Wellington Street Bus Station | 79 |
| 280 m | Currie Street Bus Stop | 4 |

This is precisely the defect `TRANSPORT_SOURCES.md` records — *"eight per-state
fetchers that ignored the coordinate, so every NSW property was 450 m from
Central Station"*. The GTFS work fixed the forward path; **the historical
records still hold the fabricated values.**

Three consequences, and the second is the one that bites:

1. The transport block cannot complement or replace the walk score for a
   backtest. It has 5 distinct values against the walk score's 65.
2. **The historical walk score is itself contaminated.** `calculateWalkScore`
   takes up to 30 of its 100 points from `publicTransportData.qualityScore` —
   and that field is present, at one constant per state (83, 82, 56, 70, 78).
   So the saturation is not only scale compression: roughly a third of the
   historical walk score is a per-state constant.
3. Location on historical reports therefore rests partly on fabricated input.
   For the backtest it must be recomputed from the real GTFS stops the platform
   now holds, or declared not-evidence. It must not be silently scored.

This is why the walk-score recalibration in ME-4 was correctly marked
provisional, and why recalibrating against this corpus would have been
calibrating against a fabrication.

---

## §57 — ME-5: the Location evidence, measured end to end (2026-09-08)

§56 closed the geography blocker. This is the item the revised brief called the
highest remaining priority: *"Audit the entire historical Location intelligence
object for common template/state-level patterns."*

The audit's own Section 24 named one contaminated field, `distanceToStop`. A
sweep of all **1,114** stored `location_intelligence` objects found five
distinct kinds of contamination, and the headline is one number:

> **Three reports of 1,114 carry both a measured walk score and a measured
> commute.**

### 57.1 The whole transport block is a per-state constant

1,108 of 1,114 objects carry the legacy transport shape. Across all of them:

| field | distinct values | modal value | reports at the mode |
| --- | ---: | --- | ---: |
| `stopsWithin1km` | **1** | `3` | 1,108 |
| `nearestStop` | 5 | `Central Station` | 822 |
| `distanceToStop` | 5 | `450` | 822 |
| `qualityScore` | 5 | `83` | 822 |
| `serviceFrequency` | 5 | `{peak:18, offPeak:8}` | 822 |
| `routeCoverage` | 5 | `T2 Inner West Line …` | 822 |
| `summary` | 5 | `Excellent public transport access with 3 stops within 1km.` | 822 |
| `transportTypes` | 3 | `[Train, Light Rail, Bus, Ferry]` | 822 |

The five values are the capital-city interchanges — Sydney's Central Station,
Melbourne's Swanston Street trams, Brisbane's Queen Street, Perth's Wellington
Street, Adelaide's Currie Street — and Sydney is the fallback. **The 822
reports that say the nearest stop is Central Station, 450 m away, span all
eight states and territories.**

### 57.2 The walk score is that constant plus four saturated counts

`calculateWalkScore` spends its whole 30-point transit allowance on
`publicTransportData.qualityScore`. The other four components saturate at
counts of 3–5, against a hard `.slice(0, 10)` in `fetchNearbyPlaces`:

| component | formula | maxes at | reports maxed |
| --- | --- | ---: | ---: |
| Shopping & dining | `min(25, (shops + restaurants/2) × 2)` | 10 + 10 | 676 |
| Schools | `min(15, count × 3)` | 5 | 952 |
| Healthcare | `min(15, count × 5)` | 3 | 919 |
| Recreation | `min(15, count × 3)` | 5 | 967 |

**641 objects have all four maxed.** For those the walk score is the state
constant and nothing else — **four distinct values across 641 properties**.
Reconstructing the formula from the stored counts reproduces the stored score
exactly on **1,109 of 1,114**, so this is the mechanism rather than a theory
about it.

### 57.3 The commute is a real query to the wrong city — and 438 are not queries at all

`getCBDCoordinates` ended `|| cbdLocations['NSW']`, so a request carrying no
state measured a transit journey to Sydney.

The marker and the cause turn out to be one thing. Of the non-NSW reports:

| stored `nearestStop` | non-NSW reports | commute consistent with Sydney only | with own capital only |
| --- | ---: | ---: | ---: |
| `Central Station` | 519 | **494** | **0** |
| `Swanston Street Tram` | 117 | 0 | 93 |
| `Queen Street Bus Station` | 86 | 0 | 68 |
| `Wellington Street Bus Station` | 78 | 0 | 66 |
| `Currie Street Bus Stop` | 4 | 0 | 4 |

One absent `input.state`, two symptoms. Concretely: **Bentley WA, 8 km from
Perth, stored 3,283.6 km and 82.1 hours** — straight-line Bentley→Sydney is
3,284 km. Richmond Vic, 3 km from Melbourne, stored 968.7 km.

This is not merely a wrong number. The Location score bands the commute in
**minutes**, so all 494 land in *"Limited CBD access (>60 min)"* for **3 points
of 30** — while **74 of them are within 10 km of their own CBD**, the closest
0.4 km. A 27-point inversion on a dimension weighted at 25%.

Separately, **438 of the 1,114 commutes were never a route**: when the Distance
Matrix call fails, the helper returns straight-line distance × 1.5 minutes as
`mode: 'estimated'`, mean 10,125 minutes. `commute.mode` is the only thing that
tells the two apart.

### 57.4 Counts, failed reads, and 183 foreign measurements

Every "within N km" count is `min(actual, 10)` — the field names promise a
radius count they do not deliver. At the ceiling: restaurants 990/1,114
(88.9%), schools 851 (76.4%), parks 818 (73.4%), healthcare 686 (61.6%),
shopping 596 (53.5%).

A failed read is stored as an empty area: the fetch helper's `catch` returns
`{ count: 0, results: [] }`, which becomes `nearest*: 'N/A'` and
`distanceTo*: 0`. Zero is the modal school and hospital distance.

And 183 objects measure a location outside Australia. **US school vocabulary
appears in 31 of those 183 and in 0 of the 931** whose coordinate resolves to
an ASGS boundary — an independent confirmation of §56's classification, from a
completely different field. One object's coordinate is 53.44, −2.98 (Liverpool,
England) with "Early Learners Day Nursery" as its nearest school.

Two further findings that are real but weaker, recorded as such: Google's
`type=school` admits childcare centres, driving, swim and music schools — the
modal nearest school across the corpus is "Style Academy Australia", 66 reports
at 0.02 km — and `topSchools[].rating` is a Google user rating, zero where
absent, not an academic one.

### 57.5 What was built

`locationEvidenceProvenance.pure.ts` classifies every field into seven kinds.
Four are non-evidence (`legacy_non_evidence`, `measured_misdirected`,
`read_failed`, `offshore`); `measured_capped` and `measured_unverified_class`
are **disclosed rather than discarded**, because a saturating count still
separates a remote property from an urban one.

`report_location_provenance` holds the verdict beside the record. Nothing
edits `location_intelligence` and no issued report changes.

| walk score | commute | reports |
| --- | --- | ---: |
| `legacy_non_evidence` | `measured_misdirected` | 364 |
| `legacy_non_evidence` | `measured` | 307 |
| `legacy_non_evidence` | `legacy_non_evidence` (estimated) | 253 |
| `offshore` | `offshore` | 183 |
| `measured_capped` | `measured` | **3** |
| `measured_capped` | `legacy_non_evidence` | 2 |
| `legacy_non_evidence` | `read_failed` | 2 |

The table is materialised in SQL and the classifier is TypeScript, so
`locationEvidenceProvenance.spec.ts` compares the two on **23 verbatim
production objects** covering all four stored shapes. That comparison is what
stops them drifting — and it is what caught the `estimated` commute, which the
first version of the classifier wrongly called a measurement.

**Three rules.** A template is not a measurement, and a measurement of the
wrong thing is not a template — they need different remedies, and collapsing
them would discard 364 recoverable commutes. A ceiling is disclosed, never
silently trusted. And `legacy_non_evidence` is a status, not a deletion.

### 57.6 The live writer, fixed

Four faults, all still live before this:

1. **The Sydney default is gone.** `resolveCbdDestination` returns null for an
   absent or unrecognised state and the caller measures nothing rather than
   something else.
2. **The invented commute is gone.** A failed route returns an explicit
   not-measured with a reason, and no number a reader could mistake for a
   journey. `destination_unknown` and `no_route_returned` send an operator to
   different remedies.
3. **A latent crash is fixed.** `public-transport-service` answers
   `{ success, data: {…} }` and the consumer took the *envelope*, so
   `publicTransportData.stopsWithin1km.length` dereferenced undefined —
   reproduced by execution against the service's real success body. It would
   have thrown for every location a loaded feed covers: Sydney, south-east
   Queensland, Darwin, Alice Springs, 185,177 stops. Latent rather than fired,
   because the last eight reports are all outside those feeds.
4. **The `qualityScore` branch is deleted, not left dormant.** The service
   publishes no such field now, and a dormant branch is one service change away
   from restoring the contamination.

`projectTransportForLocationIntelligence` states the rule once: **naming a
field the source cannot fill is how a template gets written.**
`TEMPLATE_ONLY_TRANSPORT_FIELDS` names the nine a stops feed cannot answer and
a test asserts the stored block contains none of them. Typing that projection
caught a real error in this change's own first draft — it read
`nearest.distanceMetres` where the field is `metres`, which would have stored
null for every property.

### 57.7 Staged readiness, recalculated

Measured over the whole corpus of 1,207, with geography from §56 and the
financial precedence from §56.4:

| stage | ready | of 1,207 | what binds it |
| --- | ---: | ---: | --- |
| Geography | **931** | 77.1% | 183 coordinates outside Australia, 93 with none |
| Growth | **0** | 0% | no licensed suburb price series is held |
| Demand | **0** | 0% | no licensed vacancy / days-on-market series |
| Yield | **222** | 18.4% | weekly rent — 493 have a price, 226 a rent |
| Risk | **105** | 8.7% | weekly net (188), then LVR (251) |
| Location | **3** | 0.2% | §57.5 |
| Partial composite (≥3 dimensions) | **2** | 0.2% | |
| Full composite (5 dimensions) | **0** | 0% | Growth and Demand are empty |
| **A/A+ evidence ready** | **0** | 0% | |

Component coverage, so the constraint is legible rather than only the verdict:

| input | present | of 1,207 |
| --- | ---: | ---: |
| dwelling type (a real one) | 896 | 74.2% |
| purchase price | 493 | 40.8% |
| LVR | 251 | 20.8% |
| weekly rent | 226 | 18.7% |
| weekly net | 188 | 15.6% |

The purchase-price figure is 493 rather than ME-4's 203 because §56.4's
precedence reads `manual_overrides` as the calculator's input. That is a
2.4× gain from data already stored, and it is the only one of these numbers
that improved by better reading rather than by acquiring anything.

**Nothing here changes the A = 75 / A+ = 85 thresholds, and nothing here is a
backtest.** A backtest on this corpus would be a measurement of an empty
Growth dimension and a quarantined Location one.

---

## §58 — ME-5: the centre a property belongs to, and the risk that is the buyer's (2026-09-08)

§57 quarantined the historical Location evidence. This is what replaces it, and
what the same measurement turned up about Risk.

### 58.1 Two wrong commutes, only one of which is a bug

The corpus measured every property's access to its **state capital**:

* **Bentley WA, 8 km from Perth, stored 82.1 hours.** A defect — the
  destination defaulted to Sydney (§57.3).
* **Moranbah QLD stored 1,487 minutes to Brisbane.** *Not* a defect. The
  Distance Matrix answered correctly. The **question** is wrong: nobody in
  Moranbah commutes to Brisbane, and grading the property on how long that
  takes grades it on being regional.

`resolveActivityCentre` reads the answer the ABS already publishes, in three
tiers, most specific first:

| tier | what it is | why it is trusted |
| --- | --- | --- |
| `capital_labour_market` | a Greater capital's GCCSA | the GCCSA is *defined* from journey-to-work data |
| `significant_urban_area` | an SUA of 10,000+ | the functional town outside a capital |
| `local_centre` | the Urban Centre itself | where the property **is**, not where its jobs are |

The UCL is deliberately **last**. The brief's caution — that a UCL is not
automatically the right activity centre — is exactly right: a dormitory town's
UCL says nothing about where its residents work.

SUA was resolved for all 931 placed reports against the ABS ASGS 2021 layer
(931 of 931 answered HTTP 200). The result:

| tier | reports | distinct centres |
| --- | ---: | ---: |
| capital labour market | **587** | 12 |
| significant urban area | **236** | 34 |
| local centre | **108** | 35 |
| none | 0 | — |

So **344 reports — 37% — were being graded on a commute to a city they have no
relationship with**, the Sunshine Coast's 92 among them.

That resolution also found the trap a loader has to know about: **the ABS tiles
the continent, so "no urban centre here" arrives as a NAMED polygon** —
`Not in any Significant Urban Area (Qld)`, on 131 of 931 rows. Reading it as a
place would route every rural property's access to a centre of that name.

Two tiers resolve a **named centre with a null coordinate**, because the ABS
publishes the boundary and not the centre, and a polygon centroid would be an
invention of exactly the kind this programme keeps removing. Those report
access as *not yet measurable* rather than measuring to a guess.

### 58.2 A jurisdiction's own feed, or nothing

Reconstructing the transport reading for all 931 placed reports against the
185,177 loaded stops — boardable stops within 1,600 m, grouped to places by
`parent_station`:

* **355 have a stop within 1,600 m.** Median nearest 113 m, closest 11 m,
  furthest-nearest 1,512 m. Against a stored template that said *"3 stops
  within 1 km"* for all 1,108.

But the raw reconstruction hides a trap. **`nsw_sydney` is Transport for NSW's
whole bundle**, not Sydney's, and it carries the interstate rail and coach
network — so a **Docklands property finds "Melbourne (Southern Cross) Station"
225 m away**, a Wodonga property finds NSW border-town buses, and a Lyneham
property finds NSW school services in Canberra.

| state | a stop within 1.6 km | in-jurisdiction | interstate feed only |
| --- | ---: | ---: | ---: |
| QLD | 221 | 221 | 0 |
| NSW | 123 | 123 | 0 |
| VIC | 6 | **0** | **6** |
| ACT | 4 | **0** | **4** |
| SA | 1 | **0** | **1** |

Every one of those 11 is a real stop at a real distance, and none measures the
network the property's residents use. It is **worse than the honest
`outside_loaded_networks`**, because a Docklands property with trams every three
minutes would be reported as having one stop nearby. `readingIsInJurisdiction`
applies the rule where both the live service and a backtest must apply it
identically. **344 of 931 carry a genuine in-jurisdiction reading.**

### 58.3 Location Evidence V2, and its neutrality

| component | source | held today |
| --- | --- | --- |
| transit stops | loaded GTFS, by coordinate | NSW, QLD SEQ, NT ×2 |
| activity centre | ABS ASGS 2021 | all 931 placed |
| access to that centre | not acquired | no |
| schools, shops, health | not acquired | no |

Three rules, each with a test.

**There is no composite score.** A weighting over one measured component and
three absent ones is a confident answer to a question the evidence cannot
settle. The module publishes components and coverage; whether that is enough to
grade is the caller's decision.

**Transit is measured or unmeasured, never poor.** Inner-metro Perth reads
`not_covered` because WA publishes no loaded feed, and a test forbids that
absence being worded as poor service. Scoring those 587 as badly served would
grade them on which state government publishes an open feed.

**Nothing compares across tiers or across coverage states.** Minutes to the
Perth CBD and minutes to a country town's main street are different quantities.
A test asserts a Moranbah property scores no worse than an inner-Perth one on
components measured.

### 58.4 Risk: 70% of its weight is the buyer, not the property

The same repeated-address analysis settles the Risk model question with
evidence rather than preference. 55 addresses appear in more than one report:

| what differs for the same address | addresses |
| --- | ---: |
| purchase price | 7 of 55 |
| **LVR** | **16 of 55** |
| **weekly cash flow** | **21 of 55** |

The property is stable; the financing is not. Concretely: **1 Boxer Drive,
Wyndham Vale — two reports, the same day, the same $635,000, the same −$562
weekly net — one at 80% LVR and one at 90%.** Three more Truganina addresses
carry the identical pair. On the leverage anchors that is 62 → 30, weighted
0.40: **12.8 points of Risk for a number an operator typed into a calculator.**

| model | what it scores | the buyer's position |
| --- | --- | --- |
| **A** asset only | asset type, overheating | dropped |
| **B** asset scored, finance disclosed | asset type, overheating | reported beside the grade |
| **C** blended (today) | all four | folded into the grade |

They are separated by an **invariant**: the same property, on the same day, at
the same price must receive the same property Risk score. A and B hold it by
construction; **C fails it on 16 of 55 repeated addresses.**

The fair counter-argument, which is the strong one: a report IS about a
specific purchase at a specific LVR, so the buyer's leverage really does bear
on that investment's risk, and **Model A throws it away.** That is precisely
why **B is preferable to A** — it moves the information out of a number
presented as a property grade and reports it as what it is.

The trade-off in the other direction is coverage: A and B are scoreable on
**879** of 1,207 reports against C's **1,010** — and **131 of C's are scoreable
on buyer facts alone**, which is to say C can produce a Risk score for a report
that carries no property attribute at all. That is not a point in C's favour.

**Recommendation: Model B**, on the invariance evidence and on the coverage
composition — not because it was the preferred hypothesis. `scoreRisk` is
untouched, nothing is switched, and no live path calls `riskModels.pure.ts`.

**Overheating sensitivity (item 13).** The anchors are flat below 12% growth,
so ordinary appreciation is not charged as risk — charging for it would be a
second opinion on Growth. Dropping leverage raises overheating's share from
0.10 to 0.33, which is the trade-off to weigh rather than a free improvement,
and it is pinned by a test. Overheating remains **unscoreable on this corpus
anyway**, because no suburb price series is held.

### 58.5 The forward geography writer (item 15)

`report_geography` holds 1,114 rows, all stamped 2026-09-08, all written by the
backfill — and **nothing wrote a row for a report created afterwards.** A grep
of the whole fleet finds the table named in four places, every one of them a
pure module or a spec. The same is true of `report_location_provenance`.

A derived table that only a backfill maintains is correct on the day it lands
and silently stale from the next one, which is the failure this programme keeps
finding. `resolve-report-geography` is what maintains it: it resolves the
geography for reports that have no row, from the report's own stored
coordinate, through the same `asgsGeography.pure.ts` the backfill used.

Four rules. The **coordinate is the question** and the free-text address is
never consulted. A **failed boundary service is `unresolved`, never guessed** —
and the ArcGIS endpoint reports failure as HTTP 200 with an error body, so that
shape is treated as transport and left retryable, unlike `outside_australia`,
which is final. It **never writes to `investment_reports`**. And the **batch is
bounded at eight** — one report costs six queries to a public service somebody
else pays to run, so a small batch that drains over several invocations is the
courteous shape, and a bad deploy cannot spend an afternoon of somebody's rate
limit.

`verify_jwt = true` is a decision rather than a default: the function holds the
service-role key and performs no auth check of its own, so the gateway is the
only thing between an anonymous caller and a sweep that spends the ABS
geoserver's budget on our behalf. A service-role key is itself a valid JWT, so
a scheduled invocation still reaches it.

**It is not deployed and not scheduled**, and that is deliberate: deploying an
Edge Function and adding a cron entry are production changes, and this stage's
instruction was to fix the writer, not to switch it on.

### 58.6 The asset-type component, challenged (item 12)

`ASSET_TYPE_SCORES` asserts house 82, duplex 74, townhouse 66, unit 55,
apartment 55, land 45. Four things are true of it, and none is comfortable.

**The numbers are unevidenced.** Nothing in this repository justifies why a
duplex is eight points safer than a townhouse. They are a plausible ordering
somebody wrote down, and the programme's own rule — a point must come from a
real observation or a deterministic calculation — does not admit them as they
stand.

**It barely discriminates.** The stored distribution:

| stored type | reports | scored |
| --- | ---: | ---: |
| house | 631 | 82 |
| *residential property* (placeholder) | 145 | — |
| *(empty)* | 128 | — |
| apartment | 110 | 55 |
| land | 72 | 45 |
| *other* (placeholder) | 38 | — |
| unit | 37 | 55 |
| duplex | 18 | 74 |
| townhouse | 11 | 66 |
| **house_and_land** | **9** | **—** |
| **villa** | **8** | **—** |

Of the 896 carrying a real type, **631 are `house`: 70.4% receive the identical
82**, so for seven reports in ten this component is a constant.

**Two real types resolve to nothing.** `house_and_land` and `villa` are genuine
stored values absent from the table. Under Model C that costs 0.20 of the
weight; under A and B, where asset type carries 0.67, it costs most of the
dimension — a test asserts C keeps three components on such a report while A
keeps one.

**Vacant land is a category error, not a low score.** Land has no dwelling, no
rent, no depreciation and different financing, so its risk is not a point on the
same scale as a house's. Scoring it 45 says *"a somewhat worse house"*, which is
not what it is.

The honest conclusion: **asset type is a classifier, not a score.** Nothing here
changes it — this records what it is worth *before* anybody weights it more
heavily, which is precisely what Models A and B would do.

---

## §59 — ME-5.1: correcting Risk, and what the geography really contains (2026-09-08)

### 59.1 The contradiction in ME-5's own recommendation

§58.6 established with evidence that **asset type is a classifier, not a
score**. §58.4 then recommended Model B — which weights `assetType` at **0.67**,
more than triple the **0.20** the live model gives it. The recommendation would
have *tripled* property-type bias while the same document argued it should not
score at all.

Property invariance did not catch it because **invariance is the wrong
instrument**: it asserts the same property scores the same across reports, and
is silent on whether a house and a unit are compared fairly. A test now records
that Model B separates a house from a unit by more than ten points on type
alone.

### 59.2 Model D — type selects the questions and scores none of them

    propertyType → selects the applicable risk QUESTIONS
                 → genuine property evidence answers them
                 → Risk exists only where enough of it does

What Aurixa actually holds, measured rather than assumed:

| candidate source | rows | grain | property-level? |
| --- | ---: | --- | --- |
| crime | 54,001 | postcode / LGA / SA2, four states | no |
| SEIFA + Census | 5,270 | postcode | no |
| climate | 1,237 | area | no |
| `planning_data_cache` | **2** | — | effectively empty |
| flood, bushfire, strata, condition, inspection | **none** | — | not held |

**There is no property-level risk evidence in the platform**, so every question
resolves `unavailable` and **Risk is null**. Crime and SEIFA remain *named* in
each schema, excluded from scoring and attributed to Location, so the overlap is
visible rather than silently double-counted. `acquisitionBacklog()` publishes the
seven questions with what would answer each — the schema is also the shopping
list, and **none of it is built in this stage**.

### 59.3 The second renormalisation problem

Removing asset type left a subtler version of the same fault: with exactly one
question answered, averaging over "the questions that were answered" made that
single observation **100% of Risk**.

`observations` and `eligibility` are now separate. Hazard and planning are both
the `site` category, so two answers there are **one** independent category, not
two. `MINIMUM_INDEPENDENT_CATEGORIES` is declared **uncalibrated** and
`RISK_METHODOLOGY_STATUS` is `provisional / uncalibrated`. **D2 remains the
leading candidate and is explicitly not final.**

A design flaw of mine that the tests caught: overheating was averaged in at 25%
of the weight, and its anchors sit at 100 below 12% growth — so **a calm market
raised the risk score of every property**. Taking `min()` instead lets a hot
market become the whole score. It is now a bounded deduction: at most 25 points
off, never an addition.

### 59.4 Finance Suitability

Two results, structurally separate. `FinanceSuitabilityResult` exposes no
`score`, `points`, `value`, `weight` or `grade` field, so a composite cannot
read it by accident. On the real Wyndham Vale pair the leverage reading differs
and the property risk does not.

### 59.5 The trusted geography population is 867, not 931

Of the 931 ME-5 called trustworthy, **64 sit at exactly −33.8688, 151.2093 —
Sydney CBD to four decimal places, the geocoder's former literal fallback.** All
26 reports whose address is `Unknown Property (rec…)` are among them, and **none
of the 64 has an address mentioning Sydney.** `assessAuPoint` could never catch
them: Sydney is in Australia and in NSW.

**Final classification of the 1,207:**

| class | count |
| --- | ---: |
| trusted — anchored address | **336** |
| trusted — unanchored but validated | **531** |
| **trusted total** | **867** |
| geocode failure value | 64 |
| offshore / unplaceable | 183 |
| no geography row (no coordinate stored) | 93 |

### 59.6 Why the required-anchor gate was rejected

| cohort | has state token / postcode / "Australia" | has none |
| --- | ---: | ---: |
| corrupted (183) | 3 | **180** |
| resolved (931) | 338 | **593** |

Recall is excellent and the cost is ruinous: **593 of 931 legitimate reports —
63.7%** — are ordinary bare street lines that geocoded correctly.
`property_specs.state` and `.postcode` are **NULL on every report in both
cohorts**, so there is nothing to compose the missing context from. The anchor
is a **disclosed signal**; 531 of the 867 trusted records are unanchored and
validated, and their provenance says so.

Enforcement sits where it discriminates: refuse what is definitively not an
address, and adjudicate the answer. A fallback coordinate raises
`suspected_failure_value`; `confirmed_failure_value` needs positive evidence.
**A genuine 1 Martin Place must stay geocodable.**

Item 5 asked whether the continent centre is measured or theoretical. I added it
on theory and then checked: **two stored coordinates sit on it exactly.** Every
entry now carries its measured `occurrences` — 64 and 2.

### 59.7 Location provenance, all nine families

Only `genuine_measured` is admissible to V2, and `admissibleToV2` is *derived*
from the class so the two cannot drift. Beyond §57's transport findings:

* every "within N km" count is the Places page slice — **Public Transport 974 of
  1,114 at the ceiling (87.4%)**, restaurants 990, schools 851, recreation 818,
  healthcare 686, shopping 596;
* **`amenities[].score` is a pure function of the capped count**, taking 6–11
  distinct values across 1,114 objects;
* `schools.nearestSchool` is a real nearest place of Google type `school`, which
  admits childcare, driving, swim and music schools — the modal value is **"Style
  Academy Australia" on 66 reports at 0.02 km**;
* `topSchools[].rating` is a Google *user* rating, zero where absent;
* **no employment or activity-access field exists at all.**

### 59.8 National transport coverage

`nsw_sydney` is misnamed: its bounding box runs lat −37.82 to −27.46 and lon
138.59 to 153.62, reaching Melbourne, Adelaide and Brisbane, because it is
Transport for NSW's **whole** bundle. `route_type` is NULL on all 185,177 stops,
so **mode is not established anywhere.**

| state | settlement | reports | own-feed stop | interstate only | none |
| --- | --- | ---: | ---: | ---: | ---: |
| QLD | metro | 226 | 200 | 0 | 26 |
| **WA** | **metro** | **164** | **0** | 0 | **164** |
| **VIC** | **metro** | **145** | **0** | 3 | **142** |
| QLD | inner regional | 149 | 44 | 0 | 105 |
| NSW | metro | 47 | 47 | 0 | 0 |
| ACT | metro | 4 | 0 | 4 | 0 |

**The two largest metro cohorts after south-east Queensland — Perth and
Melbourne — have no transport evidence at all.** Scoring transport on this
coverage would rank a Brisbane property above an identical Perth one because
Queensland publishes a feed and Western Australia has not been ingested. So
transport is `unavailable`, never neutral-scored, and a test forbids the absence
being worded as poor service.

### 59.9 Readiness, recalculated

| stage | ready | of 1,207 |
| --- | ---: | ---: |
| Geography Ready | **867** | 71.8% |
| Growth Ready | **0** | 0% |
| Demand Ready | **0** | 0% |
| Yield Ready | 222 | 18.4% |
| Property Risk **Evidence** Ready | **0** | 0% |
| Finance Suitability Ready | 251 | 20.8% |
| Location — centre resolvable | 867 | 71.8% |
| Location — transport possible at all | 465 | 38.5% |
| Partial composite (geography + yield) | 174 | 14.4% |
| Full Composite Ready | **0** | 0% |
| A/A+ Evidence Eligible | **0** | 0% |

Property Risk and Finance Suitability are counted separately, as instructed.

### 59.10 What is NOT done, and why

**Item 14's stratified Location V2 sample is not delivered.** It would be
dishonest to produce one: of the nine Location families, eight are inadmissible
and the ninth (the coordinate) is not a Location reading. The only genuinely
measurable components today are the activity centre — resolvable for all 867 —
and transit, possible for 465 and *only* in NSW, QLD and NT. A "stratified
sample" spanning Perth, Adelaide and regional Victoria would consist of rows
reading `unavailable` in every column. **The sample becomes meaningful once at
least one more evidence family is genuinely re-derived**, and that is the next
piece of real work rather than something to simulate now.

**No A/A+ backtest.** Growth 0, Demand 0.

## §60 — ME-5.1: the provider activation pack, and one action (2026-09-08)

Two deliverables close ME-5.1's stop point: what each of the four candidate
providers must supply before an adapter is worth writing, and the single
operator act that moves the programme off its one remaining blocker.

### 60.1 What this pack may and may not state

One rule decides the shape of everything below, and it is the same rule §54
opened with: **entitlement is never inferred from public vendor
documentation.** Three of the four providers publish their reference material
behind the same gate as their data — `developer.proptrack.com` does not
resolve, `data.proptrack.com/docs` answers 403 — so for those an endpoint name
written here would be an invention, and an adapter written against an invented
endpoint fails at the first call with a defect that looks like a credential
problem.

So each provider's row is split. **Measured** is what execution established
from this platform, cited to the section that measured it. **To be obtained**
is a question put to the vendor, phrased so its answer decides something in
this repository. A cell that is neither is left as *not established* rather
than filled.

**No price appears in this pack.** Commercial terms are Aurixa's negotiation
and no figure — not a band, not an order of magnitude — is stated or implied.

### 60.2 What every provider is asked, and why each answer decides something

The eleven questions are the same eleven for all four, because the thing being
qualified is the same: whether a figure from this provider can reach a client's
document, and what the scoring engine may do with it if it can.

| # | question | what it decides in this repository |
| --- | --- | --- |
| Q1 | exact endpoints for each measure below | whether an adapter can be written at all |
| Q2 | authentication scheme, token endpoint, scope names | `market-source-probe` cannot classify a 401 without it |
| Q3 | finest geography grain actually returned | a postcode median answering a suburb request is a correct answer to a different question |
| Q4 | dwelling-type segmentation (house / unit, separately) | `resolveAssetClass` distinguishes four classes; a blended median serves none |
| Q5 | history depth, in periods | `growth5YearCagr` is 0.35 of Growth and needs ≥ 5 years |
| Q6 | series or point statistic | the consistency component reads a series; point figures forfeit 0.15 |
| Q7 | transaction count behind each figure | `sampleSize` is 0.20–0.25 of every confidence reading |
| Q8 | rate limits, per key or per tenant | the prime's keys are forwarded to every clone, so a per-key limit is a fleet ceiling |
| Q9 | **permitted cache duration** | the platform caches; an unstated duration cannot be complied with |
| Q10 | **redistribution rights for a client-facing PDF**, in writing | `mayReachClientReport` admits only `open` and `licensed_for_client_reports` |
| Q11 | **right to persist a derived metric**, and required attribution wording | the grade is derived and stored; attribution has to be typeset, not appended |

Q9–Q11 are not paperwork. Until Q10 is answered in writing, a figure from that
provider **may be scored in a shadow backtest and may not be rendered in a
client document** — `EvidencePoint.licensingStatus` defaults to `unverified`
and the gate is already enforced in code. That is a working state, which is why
qualification can run while the commercial conversation does.

### 60.3 Domain — the only provider whose contract has been measured

| | |
| --- | --- |
| **Credential names declared** | `DOMAIN_API_KEY` (legacy) |
| **Credential names required** | `DOMAIN_CLIENT_ID`, `DOMAIN_CLIENT_SECRET` — named only by `market-source-probe`, and **settable nowhere**: the Integrations registry's Domain card declares `DOMAIN_API_KEY` alone |
| **Measured — route** | `/v1/suburbPerformanceStatistics/{state}/{suburb}` answers **404 No Matching Route**; `/v2/…/{state}/{suburb}/{postcode}` answers **401** (§51) |
| **Measured — auth** | `https://auth.domain.com.au/v1/connect/token` is live and answers `invalid_request` to a bare GET — an OAuth2 client-credentials endpoint (§51) |
| **Measured — limit of probing** | a dummy key, a dummy Bearer and no header at all produced **byte-identical 401 bodies**; the accepted scheme cannot be read off an unauthenticated probe (§51) |
| **Package named** | Properties & Locations, scope `api_suburbperformance_read` |

Domain is the one provider where Q1 and Q2 are already answered by execution.
What remains is Q3–Q11 plus one account fact: whether the Aurixa/Naidu project
holds that package. Domain's own documentation is explicit that no endpoint is
reachable until the package is added, and that is a property of the account
rather than of this code.

One thing the pack surfaced that was not previously recorded: **the credentials
Domain's current contract requires cannot be entered anywhere in this product.**
`DOMAIN_CLIENT_ID` and `DOMAIN_CLIENT_SECRET` are named only by
`market-source-probe`'s presence list; the Integrations registry's Domain card
declares a single `DOMAIN_API_KEY` field. So even with the commercial side
settled and a client id and secret in hand, an operator has no field to put them
in — the card would have to gain two, and the service would have to read them.
That is small and it is a genuine blocker sitting behind the commercial one,
and it is recorded here rather than fixed, because changing an Integrations card
is not this stage's scope.

The engineering consequence is fixed and small: `domain-data-service` calls a
route that no longer exists, so **it could not have worked whether or not a
credential was ever configured** — a valid key would have produced 404,
`response.ok` false, `return null`, and the `marketData: null` that is the
reading on all 992 scored reports. Rewriting it is `/v2/` plus the postcode
segment plus a Bearer token; nothing downstream changes, because the scorers
read `MarketEvidence` and do not know providers exist.

**Growth fields sought:** median sale price by period, house and unit
separately, at suburb grain, ≥ 5 years. **Demand fields sought:** days on
market, auction clearance. **Sample fields sought:** transaction count per
period. **Not offered as far as is established:** vacancy rate.

### 60.4 Cotality (CoreLogic) — an existing relationship, no outbound call

| | |
| --- | --- |
| **Credential names declared** | `COTALITY_API_KEY`, `COTALITY_BASE_URL` |
| **Credential names likely required** | `COTALITY_CLIENT_ID`, `COTALITY_CLIENT_SECRET` — the probe reports presence for both shapes because the repository models a single key while the API wants client credentials |
| **Measured — implementation** | **scaffolding only.** Every branch resolver in `cotality-service` is a stub; there is no `fetch` to Cotality anywhere in it, so a credential alone changes nothing (§52) |
| **Measured — licensing** | `unverified`. Cotality's own scoping document leaves cache duration, redistribution rights for client PDFs and derived-metric persistence **open** |
| **Endpoints** | *not established.* Behind the account |

Cotality is the provider with the strongest commercial starting position and
the weakest engineering position: Aurixa already holds a relationship, and this
repository has never made a call. It is therefore the one where Q1 has to be
answered before anything else, and where **Q10 and Q11 are the decisive
questions** — the scoping document raising them and not settling them is
recorded evidence that they are live, not an oversight to be assumed away.

The additional ask specific to Cotality: whether the entitlement includes
**vendor discount**, which is one of the three lenses of Demand's sale-urgency
component and which Domain is not established to publish.

### 60.5 PropTrack — the licensed route to realestate.com.au

| | |
| --- | --- |
| **Credential names declared** | `PROPTRACK_API_KEY`, `PROPTRACK_BASE_URL` (both empty, seeded 2026-08-02, never set) |
| **Measured — reachability** | 403 at the edge without a credential, from the Supabase runtime (§54) |
| **Measured — documentation** | `developer.proptrack.com` does not resolve; `data.proptrack.com/docs` answers **403**. The documentation is behind the same gate as the data (§54) |
| **Scraping the consumer site** | **refused.** `realestate.com.au/robots.txt` expressly bars automated access (§52). Not attempted, not planned |
| **Endpoints, fields, response shape** | *not established, and deliberately not guessed* |

Every one of Q1–Q11 is open for PropTrack, and that is the honest reading
rather than a gap in this work: there is not even public documentation to
misread. One question is sequenced ahead of the others — **Q-vacancy: does
PropTrack publish a rental vacancy rate at suburb grain?** If it does, one
commercial relationship covers growth, sale urgency and rental tightness
together, and SQM need not be pursued at all. So it is asked before SQM is
approached, not after.

### 60.6 SQM Research — one measure nobody else is established to publish

| | |
| --- | --- |
| **Credential name declared** | `SQM_RESEARCH_API_KEY` (empty, never set) |
| **Measured — reachability** | `sqmresearch.com.au` answers 200 from the Supabase runtime (§54) |
| **Scraping** | **refused.** Not attempted, not planned |
| **What it publishes** | vacancy rates, stock on market, rental series |
| **Grain** | suburb / postcode |
| **Endpoints and licence** | *not established* |

SQM matters for exactly one reason and it is a sharp one: it is **the only
declared source of a rental vacancy rate at suburb grain**, and no Australian
government publisher offers one. Vacancy is 0.35 of Demand — the single largest
component — so absent SQM or a provider that bundles vacancy, **Demand runs at
a maximum of 65% coverage by construction**, and that ceiling is a fact about
the methodology rather than about any property.

Its pack is therefore the eleven questions narrowed to three measures
(vacancy rate, stock on market, advertised rent series) plus Q9–Q11 unchanged.

### 60.7 The order, and what it turns on

Not a preference — each step's outcome decides whether the next is needed.

1. **Domain.** The only measured contract, an account that may already hold the
   package, and the smallest engineering delta (`/v2/` + postcode + Bearer).
2. **Cotality.** An existing relationship; Q1 and Q10/Q11 in the same
   conversation.
3. **PropTrack**, with Q-vacancy asked first.
4. **SQM**, only if none of the three above returns vacancy.

**Pricefinder is deliberately not pursued.** Declared, empty, and left there:
its stated coverage overlaps Domain, Cotality and PropTrack and it publishes no
measure the other three lack. A fourth relationship is not investigated until
the first is credentialled and qualified.

### 60.8 What does not change while this runs

The scoring engine reads `MarketEvidence` and does not know providers exist, so
adding one is an adapter plus a `EvidenceProvider` value — not a change to any
scorer. Three standing rules hold throughout:

- **Every "if none" is absent, never a default.** No zero, no 50; the coverage
  figure beside a score says how much of the methodology ran.
- **ABS is the benchmark row and only the benchmark row.** §48 records what
  happens when a regional figure stands in for a local one, and the contract
  keeps `benchmark*` separate so the two cannot be confused.
- **No row is a scrape.** Where a licensed route does not exist, the measure is
  absent and the report says so.

### 60.9 The probe had no door, and now has one

The probe was written in §51 and, when this section was written, had **never
been run** (its one production run came 28 minutes after this work deployed —
§66). Not because it is
broken: `verify_jwt = true` at the gateway *and* its own `verifyAuth` mean it
needs an authenticated administrator session, and **no surface in the product
invoked it** — a grep of `src/` returns nothing. The only ways to reach it were
a browser console or a service-role key on the wire, and neither is an
instruction worth giving. A diagnostic nobody can run is a diagnostic that does
not exist.

So the deliverable for this item is a door rather than a procedure:
`MarketSourceProbePanel` on the Integrations page — one button, invoked with
`invokeSecureFunction` on the operator's own session, which is exactly the
authentication the probe already requires. Nothing about the probe changed; it
still writes nothing, still takes its targets by name from its own allow-list,
and still never returns a credential value.

The verdict vocabulary is now **one implementation**, in
`sourceProbeReading.pure.ts`, which the panel renders and a spec checks against
the function's own `Verdict` and `ProviderStatus` unions and its
`CREDENTIAL_NAMES` list by reading the source. Two copies of "what does
`not_entitled` mean and whose problem is it" is precisely how a commercial
question comes to be handed to an engineer.

Three rules are pinned by that spec. **A credential is presence only** — the
reading takes `Record<string, boolean>`, so no value, length or prefix is ever
in scope; a length is a hint and a prefix identifies the issuer. **An
unrecognised verdict is its own reading, never a default**, and a test asserts
no unknown value can be drawn as positive — a fabricated finding here routes a
real problem to the wrong person. And **owner is part of the finding**:
`not_entitled` is `commercial` (entitlement is a property of the provider
account and is never worked around in code), `route_not_found` is
`engineering`, `credential_absent` is `operator`, `server_error` is `vendor`.
"Unavailable" sent this investigation to the wrong remedy twice; a verdict that
does not say whose it is gets routed by guesswork.

One more thing the reading refuses to say: `reachable` does **not** mean the
payload carries the measures the engine needs. It means the route exists and
the request was accepted. Qualification — geographic level actually returned,
dwelling type matched, sample size, period covered, history depth — is a
separate step, and a test asserts the reading says so.

### 60.10 The one operator action

> **Where:** the Command Centre, signed in as an administrator —
> **Integrations** — reached from the sidebar under Administration. The route
> is **`/integrations`**; there is no `/admin/integrations` and the router
> 404s on it.
>
> **What to do:** press **Run source probe** at the top of the page. One click.
> Nothing is written, no report or score is touched, and no credential value
> leaves the runtime.
>
> **What to send back:** the panel's three blocks — the credential-name list
> (which names read *set* / *not set*), the per-provider standing, and the
> per-source verdict rows. Presence only. **Do not send a key, a fragment of
> one, or a screenshot that includes one.**

**Correction — this instruction named the wrong URL when first written.**
ME-5.1 said `/admin/integrations`. `App.tsx` declares
`<Route path="integrations">` and the navigation registry points at
`/integrations`; loading `/admin/integrations` in a built bundle logs
*"404 Error: User attempted to access non-existent route"* and renders the
not-found page. An operator clicking the sidebar entry was never affected —
that link has always been right — but an instruction naming a URL that 404s
is one an operator cannot follow, and it is exactly the kind of detail that
turns "the feature is missing" into a half-day investigation.

Two things that answer are worth the click even though every credential slot is
expected to be empty.

**The runtime presence read has never been taken.** §49 recorded the
`integration_configs` row for `DOMAIN_API_KEY` as present-and-empty and said in
as many words that this is *suggestive, not conclusive* — because
`update-integration-secret` writes the project environment through the
Management API and **never writes that table**. Only the runtime can see
`Deno.env`, and this is the first read of it across all twelve names.

**The government sources are being asked from the right egress.** VIC, the NSW
Valuer General, SA and ABS refuse *this development* egress — `land.vic.gov.au`
answers 403 and the NSW Valuer General 502 — exactly as `directory.gov.au` and
`aph.gov.au` did during the PEP work, where the two egresses turned out to
differ. §52 answered part of this with `pg_net`; the probe asks from the Edge
Function runtime, which is where a report generator would ask.

If every credential reads *not set*, that is the answer and it is a complete
one: the blocker recorded in §54.6 has not moved, it is commercial, and no
engineering step unblocks it. The provider order in §60.7 is then the next act,
and it is Aurixa's rather than this repository's.

---

## §61 — ME-6: real market evidence activation (2026-09-08)

ME-6's objective is one thing: get genuine, licensed, suburb-level Australian
market evidence flowing through `MarketEvidence` so Growth (40%) and Demand
(15%) can be computed from real data. This section records what was established
by execution, what was built, and the exact point at which provider access
becomes the gate.

**Stage outcome: B — commercial activation remains blocked.** No credential
exists for any provider, so no genuine market figure was retrieved. Everything
that does not require one is complete, and §61.8 states precisely what unblocks
it. **No substitute Growth or Demand data was invented to keep engineering
moving.**

### 61.1 The ME-5.1 components are present

All eleven confirmed on `0eda00b02`: canonical geography and its maintenance
columns, trusted/untrusted classification, the `MarketEvidence` contract,
provider-neutral ingestion, the shadow scorer, the backtest harness, Model D
property Risk, separate Finance Suitability, Location evidence provenance,
`market-source-probe`, and the Integrations probe UI. None was redesigned.

### 61.2 Provider contracts, established by execution — and two ME-5.1 corrections

Every call below was made **with no credential**. Reproducing §51's
measurements on today's date:

| request | result | reading |
| --- | --- | --- |
| `GET /v1/suburbPerformanceStatistics/NSW/Bowral` | **404** No Matching Route | the route the repo calls is gone |
| `GET /v2/suburbPerformanceStatistics/NSW/Bowral` | **401** | exists, credential-gated |
| `GET /v2/suburbPerformanceStatistics/NSW/Bowral/2576` | **401** | exists, credential-gated |

**Domain's developer portal is public**, which §54 did not establish — the 401
body names it, and its sitemap enumerates every page. Reading it corrects ME-5.1
§60.3 on two counts.

**Correction 1 — `X-API-Key` is NOT obsolete.** `/docs/latest/authentication/`
documents *two* current schemes side by side: an API key (as an `X-API-Key`
header or an `api_key` query parameter) **and** OAuth2 client credentials. ME-5.1
called the repository's implementation "legacy on three independent counts" and
the third count was wrong. The correct reading is that Domain offers both and
the account decides which applies.

**Correction 2 — the path shape was not wrong either.** `/v2/…/{state}/{suburb}`
exists as its own documented route beside `/v2/…/{state}/{suburb}/{postcode}`,
and both answer 401. So of the three counts, exactly one survives: **the version
prefix**. That is a materially smaller change than ME-5.1 recorded, and it is
the kind of error that comes from inferring a contract from an error code
instead of reading the vendor's own documentation.

What the documentation settles, precisely:

| question | Domain's answer |
| --- | --- |
| token endpoint | `POST https://auth.domain.com.au/v1/connect/token` |
| token auth | **HTTP Basic** — client_id as username, client_secret as password |
| scope for suburb performance | `api_suburbperformance_read` |
| allowed environments | **Any** (sandbox included) |
| user context required | **No** — client credentials suffice |
| unavailable scope | `400 invalid_scope` |
| authorisation rate limit | 3,000 token requests/hour; cache to expiry |
| general rate limit | 1,000–3,000 requests/minute by plan |
| daily quota | per plan, reset **10am AEST** |
| usage headers | `X-Quota-PerMinute-Limit`, `-Remaining`, `X-Quota-PerDay-Limit` |
| package gate | *"You will not be able to access any API Endpoint until the required API package(s) have been added to your project."* |

One measured obstacle: from **this development egress**, presenting an
`Authorization` header to the token endpoint returns **403 Access Denied** from
an edge WAF, while a bare POST returns the ordinary `400 invalid_request`. That
is an egress fact, not a credential fact, and it is exactly the class §52
recorded — two egresses differing. It must be re-measured from the Supabase
runtime before any conclusion is drawn, which is what `market-source-probe` is
for.

**Cotality/CoreLogic — a live gateway, and the registry points at the wrong
host.** `developer.corelogic.asia` answers 200 (a client-rendered portal, no
server-side content). The API gateway is real:

| request (no real credential) | result |
| --- | --- |
| `POST api.corelogic.asia/access/oauth/token`, no credential | `401 {"error":"unauthorized","error_description":"There is no client authentication…"}` |
| same, Basic auth with an obviously-fake key | `401 …"clientId 'not-a-real-key' not known"` |
| `https://api.cotality.com` (the registry's placeholder base URL) | **404** |

Two things follow. The registry's `COTALITY_BASE_URL` placeholder names a host
that does not serve the API; `api.corelogic.asia` does. And — decisively for
diagnosis — **CoreLogic's gateway distinguishes "no credential" from "unknown
client", which Domain's does not.** §51 recorded that a dummy key, a dummy
Bearer and no header at all produced byte-identical 401s from Domain, so the
accepted scheme cannot be read off an unauthenticated probe. CoreLogic's
Apigee gateway names the failure. That materially improves what
`market-source-probe` can report once a credential exists.

**PropTrack — unchanged from §54.** `developer.proptrack.com` does not resolve;
`data.proptrack.com/docs` answers 403. There is still no public documentation to
read, so no endpoint, field or response shape is written anywhere in this repo.

**SQM Research** — `sqmresearch.com.au` answers 200; no public API
documentation was found.

### 61.3 What the corpus gives a provider to match on

The provider-independent denominator, measured against the 867 trusted
geography records (item 19's structural half — the provider-matched numerator
waits on access).

A provider is asked for `(state, suburb, postcode, dwelling type)`. **All 867
trusted records carry the first three and no untrusted record carries all
three** — the trusted set and the provider-addressable set are the same set,
which is a useful accident of how ME-5 resolved geography.

| state | trusted | house | attached | land | type unresolved | growth-addressable | provider calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| QLD | 404 | 276 | 60 | 20 | 48 | 336 | 112 |
| VIC | 201 | 100 | 11 | 3 | 87 | 111 | 37 |
| WA | 179 | 88 | 47 | 3 | 41 | 135 | 59 |
| NSW | 59 | 27 | 9 | 0 | 23 | 36 | 26 |
| SA | 11 | 7 | 0 | 0 | 4 | 7 | 5 |
| TAS | 7 | 5 | 1 | 0 | 1 | 6 | 3 |
| ACT | 4 | 4 | 0 | 0 | 0 | 4 | 2 |
| NT | 2 | 2 | 0 | 0 | 0 | 2 | 1 |
| **total** | **867** | **509** | **128** | **26** | **204** | **637** | **245** |

Three readings matter.

**245 provider calls cover 637 properties.** One call answers a (suburb,
postcode, dwelling type), and the corpus concentrates: 225 distinct suburbs
behind 637 properties, a 2.6:1 amplification. Whatever the plan, the first
genuine extraction is a few hundred calls — well inside a single day's quota on
any tier. Cost is not the blocker and should not be modelled as one.

**637 of 867 (73.5%) are growth-addressable**, or 52.8% of the whole
1,207-report corpus.

**The largest single loss is ours, not the provider's.** 204 records — 23.5% —
carry no resolvable dwelling type: `residential property` (81), `other` (28),
absent (95). ME-5 already ruled those must resolve to unavailable rather than
default to house. Recovering them needs no provider and no licence, and it is
worth more than any secondary provider would add.

### 61.4 The sample frame — structural, never outcome-selected

`evidenceSampleFrame.pure.ts` fixes 37 cells across NSW/VIC/QLD/WA/SA, four
remoteness classes and both dwelling types.

The brief asks the sample to span strong, average and weak markets and also
forbids cherry-picking historically strong examples. Those are in tension only
if the first is satisfied at selection time — and we have no growth data, which
is the whole reason ME-6 exists. **Any strong/average/weak label applied now
would be our guess about a market, and selecting on it would manufacture the
spread the extraction is meant to test for.** So the frame is drawn on measured
structural axes (state × ABS remoteness × dwelling type, ordered
deterministically), and the performance spread is **verified after retrieval**.
If the sample turns out to contain no falling market, that is a finding about
the corpus and a real one. A test asserts no cell carries a performance label
and that the module cannot even spell one.

Item 15's differentiation tests are **named before the data arrives**, so the
eventual result cannot be a search for whichever pair happened to differ:
Parmelia vs Gosnells (WA metro houses), Elanora Heights vs Kellyville (NSW
metro houses), and Buddina QLD 4575 house vs unit — with Truganina VIC 3029
house vs unit as a second-state control so the first is not a QLD artefact.

### 61.5 Aurixa owns the growth arithmetic

`growth/growthPeriods.pure.ts` computes 1-year movement and 3- and 5-year CAGR
from a provider's observations. Every result persists the start observation, the
end observation, the exact elapsed period, the formula version, the value, the
provider and the working as a reader would check it.

Four mixings are refused before any arithmetic runs, because none is detectable
from the numbers afterwards: house with unit, suburb with regional, observed
with forecast, median price with valuation index. A blended series looks
entirely plausible.

Three rules bite. **A shorter window is never reported as a longer one** — the
start observation must sit within ±0.5 years of the anniversary, `actualYears`
records what was really used, and 2 years of history refuses a 5-year figure
rather than producing one. **A refusal is never a zero.** And **each period
refuses independently**, so a missing 5-year does not cost the 1-year.

### 61.6 The validator rejects what is not evidence and never rewrites a market

`evidenceQuality.pure.ts` separates two failures that look alike in a validator
and are opposites in a market.

**Malformed** — a period in the future, a duplicated period, a series running
backwards, a suburb the request never asked about, a coarser geography than was
requested — is **rejected**. Using it is using something that is not evidence.

**Extreme** — a 75% quarter-on-quarter move — is **flagged and passed through at
full value**. Perth houses genuinely moved like that; a thin regional median
genuinely halves when three cheap sales land together. Clipping it would rewrite
a real market event into a plausible one and nothing downstream could tell. The
words `clip`, `clamp`, `winsorise` and `Math.min(Math.max` do not appear in the
module and a test asserts it, and no finding may carry a corrected value.

Geography is **matched against the trusted Aurixa record, never trusted from the
provider's echo** — including the state, because Australian suburb names repeat.
That check found a real defect in this module's first version: the suburb
normaliser strips a bracketed state disambiguator (`Araluen (NSW)`), and
applying it to the *state field* reduced every state to the empty string, so
`VIC` matched `NSW`. Two separate normalisers now, and the regression is pinned.

Dwelling-type substitution is **flagged, not rejected** — usable as context,
never as this dwelling type's own growth. Sample sizes are retained exactly and
absence is flagged rather than assumed. Freshness is measured from the period
the source describes, never from when we fetched.

### 61.7 The snapshot that makes ME-7 reproducible

`evidenceSnapshot.pure.ts` plus `20261117090000_market_evidence_snapshots.sql`.

ME-7 decides whether the methodology needs calibrating; that is only meaningful
if re-running it gives the same answer. A provider's median moves every quarter
and its API can be re-priced or withdrawn, so a backtest driven by live calls is
a measurement whose instrument changes while it is being read.

A snapshot is `draft` while records accumulate and `sealed` afterwards, and
sealing takes a content hash over a canonical ordering — so re-extraction in a
different order hashes identically while any changed value does not.
`extractedAt` (when we asked) and `evidenceAsOf` (the newest period the data
describes) are separate fields, for the reason the sanctions work settled.
Licensing aggregates to the **most restrictive** record and defaults to
`unverified`, which means scorable in a shadow backtest and not renderable to a
client.

**Sealed is enforced by the database, not only by TypeScript**, because this
repository has twice found a rule that lived only in application code and was
bypassed by the one caller that mattered. Proven by execution in production: a
draft is editable; a sealed snapshot cannot be edited, cannot be deleted, and
cannot have a record added to it. The fixture was removed and 0 rows remain.

### 61.8 The gate, exactly

Everything above is provider-neutral and complete. What ME-6 cannot do without
access:

| item | state |
| --- | --- |
| 10 — retrieve a real multi-state sample | **blocked** — frame ready, 37 cells, 245-call budget known |
| 11 — normalise through `MarketEvidence` | **blocked** — contract and validator ready |
| 13 — Growth Performance + Confidence on real data | **blocked** — arithmetic ready and tested |
| 14 — Demand Performance + Confidence on real data | **blocked** — which components a provider supports cannot be known until one answers |
| 15 — real property differentiation | **blocked** — four pairs named in advance |
| 19 — provider coverage of the corpus | **half done** — denominator measured (§61.3); numerator needs a provider |
| 20 — is a secondary provider necessary | **blocked** — it is a question about measured coverage, and there is none |

**The provider decision is deliberately not made.** Item 3 says to decide from
evidence rather than preference once actual entitlement is established, and
entitlement is a property of an account that this repository cannot read. What
the evidence so far favours is worth recording without pretending it is a
decision: Domain has a fully public contract, both auth schemes documented, a
named scope, sandbox access and published quotas; Cotality has an existing
commercial relationship and a gateway that diagnoses failures precisely, but no
outbound call has ever been written and its own scoping document leaves cache
duration, client-report redistribution and derived-metric persistence open.

**No credential model was changed.** Item 5 says to correct Domain's
configuration *if* the real contract confirms it is needed — and the real
contract says `X-API-Key` remains current, so ripping it out on ME-5.1's reading
would have removed a working scheme on a false premise. What ME-5.1 recorded as
a defect (that `DOMAIN_CLIENT_ID`/`DOMAIN_CLIENT_SECRET` cannot be entered
anywhere) is real and still true, but it is now an *addition* to make when
OAuth is the chosen scheme, not a replacement.

### 61.9 What did not change

Scoring V2 is not wired into live report generation. A = 75 and A+ = 85 are
untouched. No Growth weight, Demand weight, dimension weight or eligibility rule
was modified — calibration belongs to ME-7. Risk remains `null` and no
flood/strata/planning acquisition was started. Finance Suitability remains
separate. No contaminated historical Location composite was reused.

---

## §62 — ME-6: the first authoritative runtime result, and what it corrected (2026-09-08)

`market-source-probe` ran from the deployed Command Centre. This is the first
reading of this deployment's own runtime, and it settled a question §49 could
only call *suggestive* — **`DOMAIN_API_KEY` is SET**. It also exposed a defect in
the probe itself, which is recorded first because two of its findings were
fabrications.

### 62.1 What the run returned

**Credential presence — 1 of 11 names set.** `DOMAIN_API_KEY` set;
`DOMAIN_CLIENT_ID`, `DOMAIN_CLIENT_SECRET`, all four Cotality names, both
PropTrack names, Pricefinder and SQM Research all **not set**.

| target | status | first verdict | corrected verdict |
| --- | ---: | --- | --- |
| `domain_v2_suburb_performance` | 403 | Not entitled | **under diagnosis** (62.3) |
| `domain_v1_suburb_performance` | **404** | Route does not exist | unchanged |
| `cotality_suburb_statistics` | 401 | Credential rejected, or scope missing | **credential absent** |
| `proptrack_market_api` | **404** | Route does not exist | unchanged |
| `vic_data_catalogue` | 206 | Reachable | unchanged |
| `qld_statistician` | 206 | Reachable | unchanged |
| `vic_median_house_by_suburb` | 403 | Not entitled | **refused, not about entitlement** |
| `nsw_valuer_general_psi` | — | Unreachable | unchanged |
| `sa_data_portal` | 200 | Reachable | unchanged |
| `abs_res_dwell` | 200 | Reachable | unchanged |

Four government sources answer this runtime, which is a real and useful finding
in its own right: VIC's catalogue, the QLD Statistician, data.sa.gov.au and ABS
are all reachable where the development egress could not always reach them.

### 62.2 The classification defect — two fabricated findings

`classify(response.status, isDomain ? hasDomainKey || hasDomainOAuth : true)`.
The third argument is the literal `true` for **every non-Domain target**, so the
classifier was told a credential had been sent when none had.

Two consequences reached an operator as instructions:

**Cotality** answered 401 to an unauthenticated request and was reported as
*"Credential rejected, or scope missing — confirm the credential and that the
account holds the named scope."* There is no Cotality credential. The advice was
to check something that does not exist.

**A Victorian Government spreadsheet** answered 403 and was reported as *"Not
entitled — owner: commercial. Entitlement is a property of the provider account;
it is added to the account, never worked around here."* Nobody holds an account
with `land.vic.gov.au`. That is a fabricated finding pointing at a fabricated
commercial relationship, and it is precisely the class of error this programme
exists to remove — it would have sent someone to negotiate with a vendor that
is not a vendor.

The correction has three parts. **`classify` takes real credential presence**,
resolved per target from the names that would authenticate it. **Every target
declares its `kind`**, and a `government` 403 can never be an entitlement
finding however the request was made — only a commercial party has an
entitlement to withhold. And **`auth` is declared per target**, because a
credential that exists is not a credential that was sent: Cotality needs an
OAuth token exchange this diagnostic does not perform, and PropTrack publishes
no documentation at all, so the header its key belongs in is unknown and
inventing one would be fabricating a contract. Those read as
`authNotImplemented` and the panel says so in words.

Two rules, pinned by tests that read the function's source: **an
unauthenticated refusal says nothing about entitlement**, and **no call site may
assert that a credential was sent**.

### 62.3 The Domain 403 — what it does and does not prove

The word "not entitled" is withheld until the evidence carries it. What is
measured:

| request | credential | result |
| --- | --- | --- |
| v2 suburb performance, development egress (§61.2) | none | **401** *"Unable to verify credentials"* |
| v2 suburb performance, Supabase runtime | `DOMAIN_API_KEY` | **403** |

**The transition is the evidence.** Domain's gateway answers 401 when it cannot
verify a credential and 403 when it can but refuses the request. Moving from one
to the other on the same route, when the only difference is that a key was
attached, is consistent with the key being **recognised** — and inconsistent
with hypothesis B, an invalid or disabled key, which would have stayed at 401.

Domain's own documentation supplies the mechanism: *"You will not be able to
access any API Endpoint until the required API package(s) have been added to
your project."* A project whose key is valid but which does not hold
**Properties & Locations** would answer exactly this.

That is strong, and it is not yet conclusive, because a WAF refusal (hypothesis
D) also presents as 403 — and §61.2 measured this development egress being
403'd by an edge WAF on Domain's token host. Two things settle it and both are
now in the probe rather than in an argument:

1. **The provider's own diagnostic is captured and rendered** — content type,
   a bounded body preview, and an allow-list of response headers
   (`www-authenticate`, the `X-Quota-*` family, `retry-after`, `server`,
   `cf-ray`). A JSON body in Domain's own error shape is the API refusing; an
   HTML *"Access Denied"* page is a WAF. The allow-list never reads
   `authorization`, `cookie` or `set-cookie`, so no credential or session
   material can travel in this field.
2. **A second Domain package is probed on the same key** —
   `domain_address_suggest`, Domain's documented read-only Address Suggestion
   route. If the key answers 200 there and 403 on suburb performance, the key
   is valid and the product is not in the project. If it answers 403 on both,
   the key is unpackaged entirely. If 401 on both, the key is not recognised.
   One run, three distinguishable outcomes.

Item 4 asked whether the key is already used successfully elsewhere in this
repository. It is not: `domain-data-service` is the only Domain caller and it
calls the **v1 route Domain has removed**, so it has never succeeded and cannot
serve as a control. The second package is therefore the control, and it is
Domain's own published route rather than one invented for testing.

### 62.4 Dwelling-type recovery — the record does not hold it

204 of 867 trusted reports carry no resolvable dwelling type. Every deterministic
route was measured; none infers from narrative, price or address.

| route | recoverable |
| --- | ---: |
| sibling report on the same `canonical_property_key`, unambiguous | **4** |
| same key, ambiguous (two different types) | 0 |
| `property_listing_id` → `listings_cache` | **0** — 41 links, **0 rows survive** |
| an alternative structured key in `property_specs` | **0** — one key exists, `property_type`, present on 109 and specific on none |
| `client_property_id` → `client_properties` | **0** — no report carries one |
| **total recovered** | **4** |
| **not recoverable from the record** | **200** |

The revised Growth-addressable denominator is therefore **641 of 867 (73.9%)**,
against 637 before. That is the honest answer and it is a small one: item 8's
premise — that lineage recovery would return a material number — does not hold
against this record.

The reason the listing route returns nothing is documented elsewhere in this
repository and is the same fault: Airtable prunes `Property Intake Master` at 30
days, and `listings_cache` mirrored that prune until it was made an archive. The
41 listings that would have answered this question aged out before the archive
existed. **The dwelling type for 200 properties is not somewhere else in the
system; it is gone.**

### 62.5 Why it was gone — and the writer that will stop taking the next 200

`generate-investment-report/index.ts` composed the stored property type as
`… : (rawPropertyType.includes('house') ? 'House' : … : rawPropertyType ||
'Residential Property')`. When nothing was known, the generator wrote the
literal `'Residential Property'` — and that string is indistinguishable, to
every downstream reader, from a type somebody actually established.

This repository had already written the rule down. `propertyRecord.pure.ts`
says in as many words: *"Absent is absent — never a placeholder."* The generator
did it anyway, and it is why 81 rows say `residential property` today.

One value became two. **`resolvedPropertyType` is the fact** and is `null` when
nothing authoritative is known — it is what reaches `composePropertySpecs` and
the stored record. **`propertyTypeLabel` is prose**, used in the six prompt and
table positions where a readable phrase is wanted and no fact is asserted. A
generic label can no longer overwrite absence, and it never could overwrite a
specific value — the specific branches are unchanged and still win.

### 62.6 Provider standing corrected

The live panel read *"Credential present, scheme obsolete"* and described this
repository as *"v1 + X-Api-Key (obsolete)"*. §61.2 had already established from
Domain's public developer portal that the API key is a **current documented
scheme**, so that status was stale the moment it was measured. With
`DOMAIN_API_KEY` set, Domain now reads **configured — testable**, `authScheme`
is `api_key`, and the repository description names the one defect that survives:
the version prefix.

### 62.7 Cotality and PropTrack stay where they are

Neither has a runtime credential, so neither unauthenticated result says
anything about entitlement — which is the whole point of 62.2. They remain
fallback candidates. Domain remains the first activation path because a
credential exists, the contract is public and measured, the required route is
documented, and the implementation delta is a version prefix.

---

## §63 — ME-6: one trustworthy Domain diagnostic (2026-09-08)

§62 corrected a probe that fabricated two findings. This pass corrects a third
thing it still did — concluding from a status code — and adds the one header
Domain itself says to read.

### 63.1 `X-Domain-Security-Reason`

Domain's troubleshooting guidance names it as the **first** diagnostic for a 401
or 403. It carries a reason phrase, never credential material, so it joins the
response-header allow-list and is lifted into its own field because it is the
one header that decides what the verdict means. The panel renders it under the
Domain row, quoted verbatim.

The allow-list stays an allow-list: `authorization`, `cookie`, `set-cookie`,
`x-api-key` and `proxy-authorization` are never read, and nothing anywhere reads
back the request headers the probe sent. Three tests assert it.

### 63.2 A 403 with a credential is not an entitlement finding

The `not_entitled` reading asserted its own conclusion — *"the account is not
entitled to this endpoint"* — and routed it to `commercial`. Domain documents
several causes for one 403: a missing scope, a plan that does not include the
API, an environment restriction, an access restriction, an invalid or expired
key, and other internal denials. **They do not share an owner.** Sending that to
a commercial negotiation on the status alone routes a key problem to the wrong
department.

The verdict is now *"Refused with a credential — reason required"*, owner
`unassigned`, next action: read the provider's own reason before assigning it to
anybody. A standing test permits `unassigned` **only** where the reading also
states what would resolve it — a verdict that names nobody and asks for nothing
is a dead end rather than a caution.

### 63.3 The two-product matrix, and the case it refuses to conclude

`domain_address_suggest` requires `api_properties_read`; suburb performance
requires `api_suburbperformance_read`. Probing both on one key separates a key
problem from a product problem, which no single status can.

| Address Suggestion | Suburb Performance | reading |
| --- | --- | --- |
| 2xx | 2xx | the key works and both capabilities are reachable — qualify the payload |
| 2xx | 403 | **strong**: the key itself works; the issue is specific to Suburb Performance access, scope or plan. The stated reason names which |
| 401 | 401 | an authentication or key problem is likely — qualify with the header and body before replacing anything |
| 403 | 403 | **AMBIGUOUS.** Never *"the key has no packages"* |

The both-403 row is the point of this section. It is the reading that was
written here once and is now refused: project or package configuration, missing
scopes, an environment restriction, a plan restriction, the key's own state, a
WAF or origin refusal that never reached Domain's gateway, and other Domain
access policies all present identically. `interpretDomainAccess` returns
`conclusive: false` and `owner: null` for it, and its next step forbids raising
a commercial request until something names the cause. Where Domain does state a
reason it is quoted into the reading verbatim.

Two more rules fall out. **One product alone concludes nothing** — a single
result cannot separate the two failure modes, so the matrix says so rather than
reading the one it has. And **an unnamed combination is never concluded from**:
anything the matrix does not name is a reason to look, not a reason to guess.

### 63.4 The v1 404 is a deprecation control, not a blocker

Domain deprecated v1 Suburb Performance and replaced it with v2. The v1 target
stays in the probe as evidence the old route is gone — that is what it proves,
and it proved it — but it is not an ME-6 blocker and the production adapter
targets v2. Its note now says so.

### 63.4a The local gate runner was under-reporting, and that is on me

CI failed `security` on a head my local run had called clean. The cause was not
the repository: **the local harness was reporting the wrong exit status.** Each
step ran as `( cmd1 \n cmd2 \n … ); echo "EXIT:$?"`, and without `set -e` a
subshell's `$?` is the status of the LAST command only. Any failure earlier in a
multi-command step was swallowed, and every step in that runner is
multi-command.

So the "all 47 gates, 0 failures" reported for the ME-6 heads was weaker than it
sounded: it meant *the last command of each of 47 steps passed*. The runner now
carries `set -e` in all 47 groups, and the first failure in a group is the
group's status.

Re-running it immediately surfaced a second failure that had been hidden — and
both remaining local failures are the same environment-bound class rather than
defects: `migrationSyntax.test.ts` at 5,029 ms and `diditProviderConfigTruth`
at 8,584 ms, each against a 5,000 ms limit, on a corpus of 1,030 migrations and
4,495 tests. CI settled it on this exact head: **`verify` passed on GitHub**,
running both of those specs, while `security` failed on the one real defect
below. This container is slower than the runner; the repository is not broken.

The real defect CI caught was `check-cors-contract.mjs`, and its finding was
sound in the way it was raised even though the conclusion did not apply. The
gate scans `src/` for `headers.get('x-…')` and requires the header to be in
`CORS_EXPOSED_RESPONSE_HEADERS`. It matched a **test file** — the spec asserting
that the probe lifts `x-domain-security-reason` into its own field quoted the
whole call expression as a string literal.

The header is read **server-side**, inside the Edge Function, from *Domain's*
response, and its value leaves in the probe's JSON body; it never crosses a
browser CORS boundary. Adding it to the expose list to quiet the gate would have
declared that our own function emits a header it does not — a false statement to
a security gate, in order to go green. The test asserts the same rule without
embedding the call expression instead, and the gate is untouched.

### 63.5 What is settled, and what the next run decides

The dwelling-type conclusion stands as measured: 204 unresolved, **4**
deterministically recovered, ~200 genuinely unrecoverable from the structured
record, and a Growth-addressable corpus of **641 of 867**. No LLM, narrative,
price or address inference was used to manufacture the missing types and none
will be. `resolvedPropertyType` is the fact and is null when unknown;
`propertyTypeLabel` is prose; a generic label can no longer be persisted as a
factual type.

Demand qualification is deliberately deferred until Suburb Performance actually
answers. Domain's documented series may expose median sold price, number sold,
sale listing count, auction counts, days on market, discount percentage, median
rent listing price and rent listing count — which could carry a substantial part
of Demand as well as Growth. Only the fields genuinely present under this
deployment's data access will be used, and **no secondary provider is added
unless a measured evidence gap remains** after that inspection.

---

## §64 ME-6 zero-cost evidence strategy — how far $0 actually goes

A commercial constraint arrived mid-phase: **no additional property-data
subscriptions.** The instruction was to continue ME-6 on authoritative open
data, entitlements already held, and legitimate free trials — without lowering
the evidence standard and without scraping commercial sites.

This section is the measurement. Every reachability reading was taken on
2026-09-08 from two networks: this repository's development container, and the
**production Supabase egress** through `pg_net`, which is the network a
scheduled ingestion would actually run on. The inventory is code
(`_shared/reports/market/zeroCostSources.pure.ts`), not prose, because a
markdown table cannot be executed and therefore cannot be wrong out loud — the
failure mode this programme has hit repeatedly.

### 64.1 The finding that reframes the strategy

The open data is **not where the properties are.**

Measured over `report_geography` joined to `investment_reports`, resolving
dwelling type exactly as §62.4 did:

| state | geo reports | Growth-addressable | share | open suburb × type median sale price |
| --- | ---: | ---: | ---: | --- |
| QLD | 404 | **356** | 53.7% | **none** |
| WA | 179 | **138** | 20.8% | **none openly licensed** |
| VIC | 201 | **114** | 17.2% | yes, CC BY — **unreachable** |
| NSW | 59 | 36 | 5.4% | raw bulk sales only |
| SA | 11 | 7 | 1.1% | partial, file host 403 |
| TAS | 7 | 6 | 0.9% | rental bonds only |
| ACT | 4 | 4 | 0.6% | not established |
| NT | 2 | 2 | 0.3% | not established |
| **total** | **867** | **663** | | |

*(663 on this resolution against §62.4's 641; the two differ because §62.4 also
required the sibling-recovery pass. The distribution is what matters here and it
is unaffected.)*

**Three quarters of the corpus sits in the two states with the least usable open
data.** Queensland's Government Statistician publishes building approvals under
its housing theme and no median sale price series at all; Western Australia's
only candidate is Landgate's *Residential Property Attributes Data*, licensed
`Custom (Other)`. Neither is a suburb-level median residential sale price.

ABS does not close the gap either. All **1,227** published dataflows were
enumerated: `RES_DWELL_ST` is *state* grain, `RPPI` is *capital city* grain, and
**none** carries suburb-level price.

### 64.2 Licence and reachability are independent, and both were measured

The finest-grained open dataset in the country is Victoria's **Property Sales
Report — Median House / Unit by Suburb, Time Series**: CC BY 3.0 Australia,
quarterly, dwelling-segmented, published as XLSX for exactly this use.

It cannot be fetched. `land.vic.gov.au` answers **403** with a Cloudflare
*"Just a moment…"* interstitial — to curl with no User-Agent, to curl with the
repository's own identifying User-Agent convention, and to the **production**
egress via `pg_net` (requests 126902, 126922). Two independent networks, the
same refusal: it is the host's bot protection, not our address.
`www.dffh.vic.gov.au` (Moving Annual Rents by Suburb, also CC BY) failed
separately — an Akamai block from development citing volume from our network,
and *"Stream error in the HTTP/2 framing layer"* from production.

So the inventory records `licence` and `reachability` as **separate fields that
are never inferred from one another**, and `blockedByTransport()` is its own
reading — because a licensing gap needs a commercial conversation and a
transport gap needs the publisher contacted about their bot rules, and
reporting one as the other sends somebody to the wrong door.

What *is* reachable from production, verified by execution: `data.gov.au`
(206, real XLSX payload), `catalogue.data.wa.gov.au` (206),
`valuation.property.nsw.gov.au` (200), `data.api.abs.gov.au` (200), and
`data.melbourne.vic.gov.au` — whose CSV export answered 200 with the header
`sale_year;small_area;type;median_price;transaction_count`, exactly the Growth
shape, for exactly one local government area.

### 64.3 The acquisition footing — so a trial can never become production

`EvidencePoint` now carries `acquisition`, orthogonal to `licensingStatus`.
Licensing asks *may this be printed for a client*. Acquisition asks *on what
footing do we hold it at all* — and the footing decides whether a number may
become production evidence, which no rendering rule decides.

`open_public` · `existing_licensed` · `trial_shadow_only` ·
`commercial_upgrade_required` · `licensing_unverified` (the default).

The failure this closes is specific and quiet: **a trial measure silently
becoming production evidence.** Nothing about a number's shape reveals its
footing — a PropTrack trial median and a licensed one are the same float — so
the footing travels on the point and `acquisitionLicensingConflict` refuses the
contradictory combinations outright.

Three rules. **The default is conservative** — an undeclared footing is not
production evidence. **A trial may be shadow-scored and never rendered**, which
is what makes `trial_shadow_only` genuinely useful for ME-7 rather than merely
blocked. And **the addition is additive**: `mayReachClientReport` keeps its
exact meaning and all four existing callers
(`evidenceStatement`, `growthScoring`, `demandScoring`, its spec) are untouched,
with a test pinning that.

### 64.4 SQM — recorded, not automated

SQM Research publishes free property charts, and its terms prohibit automated
and systematic retrieval without permission; its historical series is sold
commercially. **No scraping, no hidden endpoints, no browser automation, no
systematic ingestion, no client-report use.** SQM is
`manual/context only — automated commercial ingestion not authorised`, and that
stands unless SQM gives explicit written permission or offers a free commercial
API. This is the one source where the block is a considered policy rather than
a generic WAF rule, and the distinction is why land.vic was retried and SQM was
not.

### 64.5 The strongest $0 stack, and what it cannot do

In the brief's own preference order:

1. **Authoritative open government data** — real, and it serves *Demand and
   context*, not Growth: Tasmanian rental bonds (CC BY 4.0, reachable), NSW
   bulk sales (CC BY, reachable, medians must be derived and dwelling type is
   not a column), QLD land valuations (CC BY, and a land valuation is not a
   sale price), ABS `RES_DWELL_ST` / `RPPI` / Census / SEIFA as benchmark.
2. **Domain's existing entitlement, if it costs nothing** — the pending probe.
3. **The official PropTrack trial** — Market API supply & demand, rent
   insights, sale insights, per suburb; qualification request drafted.
4. **ABS benchmark** — already loaded.
5. **SQM manual/context only.**

**Growth coverage attainable for $0 today: effectively none of the corpus.**
Not one zero-cost source can serve suburb-level, dwelling-segmented median sale
price for QLD or WA, and a test asserts that no row in the inventory claims
otherwise. Victoria's would reach 17.2% if the host admitted a scripted client.
NSW's 5.4% is reachable but requires deriving medians from individual sales
without a dwelling-type column.

**Demand coverage attainable for $0: partial and real** — rental evidence in
VIC (blocked), TAS (reachable), SA (blocked at the file host), plus ABS
population and household context nationally.

### 64.6 Is the free stack strong enough to begin ME-7?

**No — not on open data alone.** A historical shadow backtest needs Growth for
the properties the corpus actually contains, and the zero-cost open stack
reaches almost none of them. Proceeding on it would mean scoring three quarters
of the corpus with Growth absent, which the methodology correctly renders as
absent rather than as a number — a backtest with no signal in its principal
dimension.

**It becomes strong enough the moment either commercial lever lands at $0**:
Domain's two scopes enabled on the existing key, or a PropTrack trial that
permits internal evaluation. Either supplies suburb-level, dwelling-segmented
Growth across QLD, WA and VIC together.

So ME-7 is not blocked on a purchase — it is blocked on two questions that cost
nothing to ask, both of which are now drafted
(`DOMAIN_ACTIVATION_REQUEST.md` §Zero-cost addendum, `PROPTRACK_TRIAL_REQUEST.md`).

### 64.7 How the ME-7 shadow stack would differ from a production stack

If ME-7 runs on `trial_shadow_only` evidence, the difference is not cosmetic and
is enforced rather than remembered:

| | ME-7 shadow stack | production-authorised stack |
| --- | --- | --- |
| Growth source | PropTrack trial (`trial_shadow_only`) | a source classified `existing_licensed` or `open_public` |
| may be rendered to a client | **no** — `acquisitionLicensingConflict` refuses the combination | yes |
| may be sealed as production evidence | **no** — `mayEnterProductionEvidence` returns false | yes |
| may be scored in a backtest | yes | yes |
| what the calibration proves | that the **methodology** is sound | that the **deployment** is sound |

A methodology validated on trial evidence is a validated methodology. It is not
a licence to ship, and the two must never be conflated — which is exactly why
the footing is a field on the point rather than a note in a document.

## §65 ME-6 closure — one denominator, and a frozen ME-7 population

ME-6 reported two Growth-addressable counts for the same idea — **641** and
**663** — and an ambiguous denominator makes every coverage percentage that
follows unfalsifiable. This section settles it by arithmetic and freezes the
result, so that ME-7 has a subject population that cannot move under it.

### 65.1 Why the two numbers differed — measured, not inferred

Both were computed over the same 867 trusted-geography reports. They are the
same predicate with and without one exclusion:

| step | count |
| --- | ---: |
| trusted geography (suburb AND state present) | 867 |
| `property_specs.property_type` present and not a placeholder | **663** |
| less `land` (26) | **637** |
| plus §62.4's sibling recovery (4) | **641** |

Neither was wrong about what it measured. They measured different things while
both being called "Growth-addressable".

**663 was too loose** — it counted 26 vacant-land reports. A land parcel has no
dwelling, so no house/unit median series describes it: Domain segments
`suburbPerformanceStatistics` by house and unit, and PropTrack's sale insights
do the same. Counting land inflates the denominator with rows no provider can
ever answer for.

**641 was too narrow** — it read one field. Two further deterministic routes to
the same fact were already in the record and unused.

### 65.2 The canonical answer is 665, and it is not "the bigger one"

`_shared/reports/market/growthPopulation.pure.ts`, predicate `me7.pop.1`:

| route | reports |
| --- | ---: |
| `property_specs.property_type` | 663 |
| `financial_calculations.propertySpecs.propertyType` | +15 |
| unambiguous sibling on the same `canonical_property_key` | +13 |
| any type resolved | 691 |
| less `land` | −26 |
| **canonical Growth-ready** | **665** |

It is simultaneously **stricter** than 663 (land excluded) and **more complete**
than 641 (three routes instead of one). Landing two above 663 is a coincidence
of two independent corrections, not a preference for a larger number.

The 15 the financial block adds are **all `house`** — specific, and stated by
the operator rather than derived, which `historicalFactAuthority.pure.ts`
already established: `financial_calculations.propertySpecs` is the calculator's
INPUT record. The sibling route yields 13 against §62.4's 4 because its pool is
enriched by the financial route, which §62.4 did not consult.

A measurement bug of my own is fixed here too: coalescing the raw values and
*then* testing for a placeholder never consults the second source, because
`'Residential Property'` is non-null. Each route is now tested for specificity
before the fall-through, and a test pins it.

### 65.3 What Growth readiness requires — and what it must never require

**Required**: trusted geography (suburb AND state), and a dwelling type
resolvable by one of the three routes that maps to a class a provider
publishes.

**Not required, deliberately**: LVR, cash flow, rent, Risk, composite scoring
readiness — none is an input to a suburb median series. **Postcode is not
required either**: measured, 0 of the 663 lack one, so it discriminates nothing
today, and Domain's route is `/{state}/{suburb}` with postcode an optional
refinement.

**Sibling recovery is a ROUTE, never a REQUIREMENT.** §62.4 introduced it while
measuring what could be recovered. It belongs in the definition as one of three
ways the type may be established, not as a condition — requiring one would
exclude 663 reports to gain 13.

### 65.4 The frozen population

`me7_backtest_populations` / `me7_backtest_population_members`, sealed under
`me7.pop.1`: **867 considered, 665 ready**, one row per considered report
carrying canonical geography, dwelling type and class, resolution route, and
inclusion or an exclusion reason.

| state | Growth-ready | houses | attached |
| --- | ---: | ---: | ---: |
| QLD | 338 | 278 | 60 |
| WA | 137 | 89 | 48 |
| VIC | 131 | 120 | 11 |
| NSW | 40 | 31 | 9 |
| SA / TAS / ACT / NT | 19 | 18 | 1 |
| **total** | **665** | **536** | **129** |

228 distinct suburbs. Excluded: 176 `dwelling_type_unresolved`, 26
`dwelling_type_not_segmentable`.

The rule the table exists to enforce: **provider coverage is measured AGAINST
the population and never defines it.** Without that, a provider outage shrinks
the denominator and the coverage percentage *improves* — the metric moves the
wrong way under exactly the fault it should reveal. Membership is therefore
settled before any provider is called, and immutability mirrors
`market_evidence_snapshots`: draft → sealed once, no unseal, UPDATE and DELETE
refused on a sealed row and on its members. Both refusals were proven by
execution against the sealed row.

### 65.5 Precedence, and the ME-7 entry gate

`me7EntryGate.pure.ts` carries both as code. Subject Growth resolves
Domain-at-$0 → PropTrack trial → open state suburb series → **unavailable**;
Demand resolves provider/open → government context → **unavailable**. There is
no benchmark tier in the subject ordering, and `mayServeSubjectGrowth` refuses
the ABS series by name — a state mean price is identical for hundreds of
properties, so using it as the subject's own Growth is how a score comes to
rest on nothing about the suburb.

The gate refuses a sample without QLD or WA, because those two are 475 of the
665 and a VIC/NSW-only backtest would validate the methodology against 26% of
the portfolio while reporting a number about the other 74%. It explicitly does
**not** require 100% coverage, a complete Demand set, or Victoria.

### 65.6 Where this leaves ME-7

The population is locked and the gate is written. What the gate is waiting on is
evidence, and both remaining zero-cost levers are **outside this repository's
reach**: Domain's answer on enabling two scopes at no charge, and PropTrack's
answer on trial terms. Neither can be measured, inferred, or substituted — and
an ME-7 run assembled from anything else would be a backtest of a methodology
against evidence it will never use in production.

---

## §66 ME-6 — the probe ran once, and the answer is the ambiguous case

*Run 2026-09-08; recorded 2026-09-11.*

The operator ran the source probe exactly once, from the Integrations page, 28
minutes after #2575 deployed the corrected function. The run is verified in
the production function logs rather than assumed: `function_edge_logs` holds
exactly one non-OPTIONS invocation of `market-source-probe` across the whole
retained window (8–11 Sep, swept in 24-hour slices) — `POST | 200` at
**2026-09-08T15:42:54Z**, 3,331 ms. The probe persists nothing by design
(§60.9), so the per-target readings below are the operator surface's own
rendering of that one response.

What it read:

- `DOMAIN_API_KEY` **present**; Domain classified configured/testable.
- `domain_address_suggest` → **HTTP 403**.
- `domain_v2_suburb_performance` → **HTTP 403**.
- **No `X-Domain-Security-Reason`** visible on either refusal — the one header
  Domain names as the first diagnostic for a 401/403.
- Cotality credentials **absent**. PropTrack credentials **absent**. SQM **not
  authorised** for automated ingestion (policy, not transport — §64).

Under the pre-registered four-case reading (§63, unchanged), 403 + 403 is the
ambiguous case and **stays ambiguous**: it is equally consistent with a
project or account configuration, a missing scope, a plan or environment
restriction, the key's own state, and a WAF refusal that never reached
Domain's gateway. Entitlement, an invalid key, a WAF and a missing scope were
each deliberately **not** inferred from the status code alone — inferring any
one of them sends an operator to the wrong remedy, and with no security-reason
header nothing on the wire distinguishes them.

Three consequences:

1. **The probe does not need to be run again.** Its question — what does this
   key get, from this deployment, today — is answered, and the answer is
   deterministic on Domain's side. Re-run only if Domain configuration changes
   (a new key, an activated scope, an account change); one run then re-settles
   the state.
2. **The resolution is with the provider, not the pipeline.**
   `DOMAIN_ACTIVATION_REQUEST.md` now carries the both-403 branch as the
   applicable message: because no security reason was returned there is
   nothing to quote, so the message asks Domain to state which restriction
   produces the 403 on this key, and whether `api_properties_read` and
   `api_suburbperformance_read` can be enabled on the existing application at
   no additional charge.
3. **Nothing upstream of the gate moves.** The ME-7 entry gate (§65) still
   waits on evidence, and a 403 whose cause is unresolved contributes none.

---

## §67 Scoring V2 finalisation — the buyer leaves the composite, and absence stops buying badges (2026-09-11)

The owner's mandate for this phase: finish Scoring V2 completely — final
specification, independence, missing-data contract, A/A+ eligibility,
adversarial synthetic proof, one canonical output — before any report-family
refinement, with the real backtest still gated on real QLD + WA evidence.
Everything below is synthetic-proof work; **no market evidence was fabricated
and no real corpus was scored.**

### 67.1 The drift finding: the composition never adopted its own decision

§59–60 decided Risk Model D — property type selects the schema and scores
nothing; buyer LVR and buyer cash flow score nothing; finance is the separate
Finance Suitability reading; one observation is never the dimension. The
report-side modules were built then (`riskModelD.pure.ts`,
`financeSuitability.pure.ts`). **The shadow composition was not moved onto
them**: `scoreInvestmentV2Shadow` still called the ME-4 interim scorer, whose
components were 40% buyer leverage, 30% buyer serviceability, 20% asset type,
10% overheating. Under it, 1 Boxer Drive's two same-day reports at 80% and
90% LVR would have carried different property Risk — the exact defect Model D
was designed against, alive in the engine that will run ME-7.

**Corrected**: `2.1.0-shadow` composes `scorePropertyRisk(…, 'D2')`; the
buyer's position rides beside the score as `financeSuitability`;
`RiskInputs`/`FinanceInputs` make the separation type-level; the ownership
matrix moves `lvr` and `weeklyCashFlow` to a non-dimension `finance` owner
with every dimension forbidden. The ME-4 scorer is retained, marked
superseded, solely as the component record the A/B/C model comparison is
expressed over. Consequence stated plainly: with no property-risk question
answerable from today's record, **Risk is structurally null platform-wide**
and the composite renormalises over four dimensions with that fact published
— which is the honest state, not a regression.

### 67.2 A calibration, in the required form

- **Before**: eligibility `1.0.0` — Growth-centred ceilings plus an overall
  coverage floor of 0.70 for A+.
- **Defect (measured by fixture, before any real evidence)**: the composite
  renormalises over measured dimensions, so removing a WEAK dimension raises
  it. Growth 90 / Location 80 / Yield 85 / Demand 55 composites to ~81 with
  Demand measured and ~86 without it — absence crossing the A+ line that
  presence could not. "Do not reward missing evidence through
  renormalisation" was a stated rule with no mechanism.
- **Correction**: eligibility `2.0.0` adds a second ceiling —
  `gradeFor(nominalMeasuredScore)`, the points the evidence actually
  delivered at nominal weights over the full 100. The score, the coverage and
  every disclosure are untouched (absence still never punishes); the printed
  grade simply cannot exceed what was delivered, and adding a measured score
  (≥ 0) can only raise the ceiling — the anti-reward property holds by
  construction, not by threshold.
- **After, measured**: dimension ceilings — Growth saturates at 91, Location
  reaches 95, Yield 100, Demand 93 — so the maximum deliverable with Risk
  structurally null is ≈ 89.1 of 100. **A+ (85) remains mathematically
  reachable**, on genuinely exceptional evidence across all four live
  dimensions; A (75) needs a ~79 average. The renormalisation-reward fixture
  now shows the badge holding while the renormalised score rises, with the
  mechanism on the record in `gradeCapReason`.
- **Distribution manipulation**: none possible — no real property has been
  scored under either version; the first distribution ME-7 produces will be
  the first ever read.

### 67.3 What is now pinned, and where

- `SCORING_V2_METHODOLOGY.md` — the one authoritative specification;
  `scoringMethodology.spec.ts` pins every load-bearing number and version in
  it to the modules, and asserts **no production edge-function entrypoint
  imports the engine** (the unwired guard — checked, not promised).
- `scoringInvariants.spec.ts` (29) — renegotiated to Model D: buyer leverage
  and cash flow move Finance Suitability and nothing else; the property type
  selects the schema and moves no score; one Risk observation cannot become
  the dimension; the declared exception charges overheating only beside a
  measured peer; the Boxer Drive rule as a test.
- `scoringScenarios.spec.ts` (17) — the mandate's adversarial matrix:
  sustained vs surge vs declining growth, the yield/growth and
  demand/location trade-offs, regional-excellent vs metro-weak (commute
  measured to the NEAREST centre per §58 — a 95-minute figure describes a
  remote property, not a regional hub), house/attached and state parity,
  missing-Growth and missing-Demand behaviour, the renormalisation-reward
  regression, capped-grade-states-a-reason.
- `scoreOutputContract.pure.ts` (`1.0.0`) — the canonical object no renderer
  recalculates: versions, score, both grades, cap reasons, per-dimension
  performance/confidence/effective weight/contribution/reason, provenance
  rows with acquisition footing, unavailable dimensions, Finance Suitability
  separately. Contributions reconcile to the composite by test.
  `overallConfidence` is deliberately null until methodology lock, and the
  field says where the definition will be made.
- Suite state at the finding of record: **154 files, 3,673 tests, all
  passing** under `src/lib/reports/`.

### 67.4 What still gates ME-7, exactly

Unchanged and outside this repository: real QLD + WA subject-Growth evidence
at $0 — Domain's answer to the both-403 letter (§66) or PropTrack's trial
terms. The moment either lands: record the acquisition footing, build that
one adapter, ingest QLD + WA, normalise into `MarketEvidence`, seal the first
genuine snapshot, evaluate the gate, and if it opens, run the backtest.

## §68 Scoring V2 Core frozen — shadow only (2026-09-11)

**SCORING V2 CORE FROZEN — SHADOW ONLY.** PR #2588 was merged into `main`
(merge commit `db59a8056`, PR head `846db6f2b`) after a final adversarial
closure review run against that exact head, and the core is now a settled
structure: changes to anything in §68.2 require a demonstrated defect, a
version bump and a re-run of whatever backtest has run by then — never a
silent edit.

### 68.1 The closure review, and what it found

A closure audit, not a new methodology exercise. Method: the composition path
was traced through the callers (not the type definitions), the repository was
swept for the engine's markers, and the mandated invariants were re-proved by
execution in a new closure spec (`scoringV2Closure.spec.ts`, 14 checks) run
beside the full suite — **155 files, 3,687 tests, all passing** on the merged
head.

What the review confirmed, each item measured rather than trusted:

- **Risk ownership.** `scoreInvestmentV2Shadow` calls
  `scorePropertyRisk(input.propertyRisk, 'D2_requires_a_peer')` — Model D is
  the composition's Risk, not merely a module beside it. `PropertyRiskInputs`
  cannot express a buyer fact, so LVR, cash flow, serviceability, borrowing
  capacity, deposit and affordability have no path into the dimension at the
  type level, and the body reads none of them. The asset class appears in
  schema selection and the result, and in no arithmetic. One answered
  category cannot compose (`MINIMUM_INDEPENDENT_CATEGORIES = 2`); overheating
  only ever deducts (max 25), only beside an eligible peer, floored at 0.
- **Finance Suitability isolation.** `assessFinanceSuitability` returns a
  band, readings and prose — no field a composite can read. End to end, two
  scenarios at 60%/95% LVR and +$50/−$900 weekly produce byte-identical
  score-side results and different suitability bands.
- **Missing evidence never improves the printed grade.** Proved at the
  boundaries (`gradeFor` and `applyEligibility` at 74.99/75/75.01 and
  84.99/85/85.01) and pairwise on every dimension removal — weak removed,
  strong removed, two removed, sparse-strong, sparse-weak, single-dimension.
  A = 75 and A+ = 85, unchanged; A+ reachable uncapped on the exceptional
  fixture. The construction argument: the composite always ≥ the delivered
  points (renormalising divides by ≤ 1), and the printed grade ≤
  `gradeFor(delivered points)`, so removing a measured dimension can raise
  the composite but never the badge.
- **Absent is not zero.** A measured terrible yield scores 0, carries weight
  and drags the composite; an unknown rent scores null, carries zero weight
  and leaves the composite, with the reason printable. Risk distinguishes
  no-schema / nothing-answered / one-category, each with its own sentence.
- **Output contract.** Every mandated field present on
  `scoreOutputContract.pure.ts` (`1.0.0`); contributions reconcile to the
  composite within rounding; no consumer needs to recompute anything.
- **Shadow isolation.** Repo-wide marker sweep: the engine's modules, their
  `src` bridges and the test suites are the only references. **No edge
  function entrypoint imports anything from `_shared/reports/market` or
  `_shared/reports/risk` at all**, so the transitive route to the engine is
  empty, not merely unused. The one non-test `src` importer of the bridges is
  `MarketSourceProbePanel` importing `sourceProbeReading.pure` — operator
  diagnostics for the probe, not a scoring consumer. The CI guard in
  `scoringMethodology.spec.ts` continues to assert entrypoint cleanliness on
  every run.
- **Determinism and numeric integrity.** Same input → byte-identical output
  (scorer and contract). An adversarial battery (zero/negative rents and
  bases, absurd yields, ±50% growth, scored Risk under maximum overheating,
  buyer at −$50k/week, nothing at all) produced no NaN, no Infinity, no
  negative weight, no dimension outside 0–100, effective weights summing to
  1 where a composite exists, and a stated reason wherever there is none.
  Rounding sits at the publication boundaries only (dimension scores,
  composite, 4-dp weights, 2-dp points).

**No genuine defect was found.** The two defects of this release — the
composition still calling the ME-4 interim Risk, and renormalisation buying a
badge — were found and fixed before this review (§67); the review confirms
their fixes hold under adversarial input.

### 68.2 Structurally complete (the frozen set)

Scoring architecture and composition; dimension ownership; Growth, Yield,
Demand and Location methodologies; Risk Model D; Finance Suitability
separation; missing-evidence behaviour; grade eligibility (both ceilings);
A = 75 / A+ = 85; the score output contract; the scenario suite; the
invariant suite; the closure suite.

### 68.3 Explicitly incomplete — the programme is NOT production complete

- **ME-7**: the real historical evidence backtest has **not run** — the
  sealed population (`me7.pop.1`, 665 ready of 867 considered) is a
  denominator, not a result.
- **Real-world grade-distribution and empirical calibration**: none has
  happened; every threshold is calibrated against fixtures and the corpus's
  own stored figures only, and `RISK_METHODOLOGY_STATUS` still reads
  `provisional / uncalibrated`.
- **Production activation (ME-8)**: not authorised. The engine is unwired and
  the guard asserts it.
- **Migration of production reports to Scoring V2**: not begun, and no mass
  backfill of historical reports will occur.

Reporting work (RF-7) may build against the score output contract — shape
compatibility, developer-only shadow comparison — without any of the above
moving. Trial-footed evidence stays shadow-only throughout.


## §69 SCORING ACCURACY $0 PROGRAMME — CLOSED (2026-09-11)

Merged into `main` as `11920f1e7` (PR #2596, head `0759bbf4b`), after
`1695fab74` (#2594, the trusted-input gate) and `db59a8056` (#2588, the V2
freeze). **The programme is closed.** Scoring is not reopened unless a genuine
defect is discovered, or actual V2 activation is separately authorised.

### 69.1 What the replays established

Read-only, over the live corpus, no production write at any point.

| Reading | Measurement |
| --- | --- |
| Growth scored exactly `50` | **1,005 of 1,006** reports, `hasData: false` on all 1,006 |
| Demand scored exactly `50` | **1,005 of 1,006** reports, `hasData: false` on all 1,006 |
| Share of every issued grade that was a placeholder | **55%** (Growth 0.40 + Demand 0.15) |
| Grade-eligible under frozen V2 (≥3 measured dimensions) | **0 of 1,006** |
| Location coverage before the trust gate / after | **975 → 0** |
| Yield coverage before / after (operator-entry recovery) | **164 → 188** |
| Walk score reproducing a per-state constant | **1,109 of 1,114** |
| Commute mean, with 494 non-NSW reports routed to Sydney | **10,125 minutes** |
| Schools at the ceiling | **851 of 1,114** |
| Risk narratives citing buyer LVR / buyer cash flow / a type bonus | **235 / 167 / 418** |

No V2 defect was found by any replay. The corpus is not grade-eligible because
the evidence does not exist, not because the methodology is wrong.

### 69.2 The closing state — what is authoritative and what is not

| Item | State |
| --- | --- |
| Historical V1 snapshots | **PRESERVED.** No rewrite, recompute, migration or backfill. A score carrying no policy stamp is a legacy snapshot and renders exactly as it always did. |
| New V1 overall score | **NOT AUTHORITATIVE.** `totalScore` is null when no engine holds authority. |
| New V1 letter grade | **NOT AUTHORITATIVE.** Withheld with a client sentence, never a letter, never a zero. |
| New V1 dimension assessments | **NOT AUTHORITATIVE** under `unavailable` authority. |
| New V1 score-derived qualitative verdicts | **NOT AUTHORITATIVE.** `claimPermits` gates every SWOT push; a sentence is an assessment. |
| Trusted deterministic metrics | **AVAILABLE.** Price, rent, the finance block, stamp duty, demographics, crime, climate, transport — unchanged and fully rendered. |
| Buyer finance (LVR, holding cash flow) | **FINANCE SUITABILITY ONLY.** Owned by `finance`, admitted to no dimension under any authority. A borrowing position is not a property weakness. |
| Scoring V2 | **FROZEN / UNWIRED.** §68.2 is the frozen set; the CI guard asserts no entrypoint reaches it. |
| Future V2 activation | **MUST WIRE THE ACTUAL V2 ENGINE** and consume its published score output contract. It is structurally NOT a constant edit: `LegacyScoringAuthority = Exclude<ScoringAuthority, 'v2'>` makes `PRODUCTION_SCORING_AUTHORITY = 'v2'` a `TS2322` and passing `'v2'` to `policyStamp` a `TS2345`. |
| Empirical calibration | **DEFERRED.** ME-7 has not run; `RISK_METHODOLOGY_STATUS` stays `provisional / uncalibrated`. |
| Historical rewrite | **NONE.** Zero rows written by this programme. |

### 69.3 The two independent questions, kept apart

**Evidence** — may a dimension *count* this input? `scoringInputPolicy.pure.ts`
rules on **ownership** first (does this dimension own the input at all?) then on
**trust** (is the value believable?). The order matters: ownership is why V1's
Risk has no admissible input left even where the buyer's figures are perfectly
trustworthy.

**Authority** — which engine may *speak*? Separate and prior. Gating inputs
alone left a trapdoor: verify three inputs later and the legacy methodology
silently becomes the production grade engine. A grade issues only when
**authority and evidence both hold**.

### 69.4 Deliberately not done

- No historical report rewritten, recomputed or migrated.
- V1 not deleted; the area scorer untouched; `verify_jwt` untouched.
- No new feature-flag framework.
- `verifiedInputs` is **not propagated by the live request path** —
  `transformInputData` rebuilds the nested request field by field and no caller
  sets it. Internal and test use only, and a test forbids the overstated
  wording returning.
- No data purchased, no prohibited source scraped, no LLM asked to determine
  geography or to supply a missing figure.

### 69.5 The successor's rule

Absent is absent. A withheld grade is a statement about the **evidence**, never
about the **asset** — and the client wording, the viewer block and the PDF
projection all read the one shared module so no surface can print a grade
another withholds.

## §70 RF-7.1 — the Report Fact Contract, added beside the engine (2026-09-11)

`REPORT_FACT_CONTRACT_V1.md` is the specification;
`RF71_CAPABILITY_INVENTORY.md` is the characterisation it rests on. This
section records only what a successor needs to know without opening either.

**The shape of the stage.** A strangler, not a replacement:
`existing system + contract`. Forty-eight Investment Report capabilities were
inventoried by tracing ACTUAL callers, the contract was built as an adapter over
owners that were not touched, and **zero production consumers were switched**.

### 70.1 What the caller census corrected

Two readings that a naive search gets wrong, recorded because both would have
justified deleting something live:

- **The frontend does not call `supabase.functions.invoke`.** It calls
  `invokeSecureFunction`. A census on the first form reports **0 callers** for
  `generate-investment-report`, which has six.
- **A function with no frontend caller may be the most important one.**
  `resume-investment-reports` has none and runs every two minutes under pg_cron
  (`investment-report-resume-2min`) — it is the watchdog that finishes a report
  the browser abandoned.

### 70.2 The finding that shaped the design

`facts/historicalFactAuthority.pure.ts` — a complete, tested, measured
precedence layer for eight fields (140/140, 150/150, 153/153 exact agreement
across 443 paired rows) — has **zero production consumers**. Its only non-test
reference in the repository is a doc comment.

So the contract ADAPTS it rather than becoming a third implementation of the
same ordering. That is the difference between a truth layer and a second
opinion, and it is why this stage adds one file family rather than editing five.

### 70.3 Parity, measured

Thirty-two real production rows across twenty strata (overrides, sentinel and
missing coordinates, finance with and without rent, house-and-land, land,
attached, placeholder types, high LVR, metro, regional, forked, derived,
multi-version, and each of the five variants):

```
comparisons  896
matched      896
mismatches   0
non-null     504 of 896  (56.2%)
```

Every material fact — price, rent, LVR, deposit, loan, cash flow, outgoings,
duty, upfront, gross and net yield, origination LVR, type, beds, baths, parking,
land, building, year built, suburb, postcode, state, coordinates, variant, tier,
version, grade issuance — reproduces the current path exactly, on the first run.

### 70.4 Three deliberate refusals

Each would be a plausible figure and each would be a new one:

- **LVR at settlement is not reconstructed** as `price − deposit`. That identity
  breaks on 21 stored reports, so a reconstruction is most confident exactly
  where the record is least reliable.
- **Stamp duty is read, never re-run.** Duty needs a purchase intent and a
  concession status the report does not record.
- **Current LVR is absent**, because it is a different quantity from origination
  LVR and they coincide only at settlement.

### 70.5 Surfaced, deliberately not changed

`annualOutgoings`' second authority path (`annualCosts.total`) is **inert on the
whole live corpus**: measured across 1,207 rows, `total` exists on **0**,
`totalAnnual` on 208, `totalAnnualExcludingLandTax` on 173. The engine has never
emitted `total`. On the 35 rows carrying only `totalAnnual`, `annualOutgoings`
therefore resolves as absent — which is the CORRECT outcome reached by accident,
because `totalAnnual` includes land tax and the other excludes it. Pointing the
fallback at `totalAnnual` would silently change a published figure's basis, so
it is recorded rather than repaired: the remedy is a labelled `BasedMetric`, in a
later stage.

### 70.6 The preservation guarantees, and how each is proved

| Guarantee | Proof |
| --- | --- |
| No production consumer switched | a test walks `src` and `supabase/functions` and fails on any non-test file naming `buildReportFactContract` |
| No owner edited | a test asserts no owner module names the contract |
| The arrow points one way | a test walks three roots for reverse imports |
| Pure — no clock, network, database, write or `await` | the module's own source is read and asserted |
| Absent never becomes 0 / '' / false / a default | asserted per leaf, on fixtures and on all 32 real rows |
| Every historical shape tolerated | nine adversarial shapes plus the real corpus; nothing throws |
| Nothing mutated | input rows are JSON-compared before and after |
| Capabilities intact | 65 characterisation tests over 22 edge functions, 17 surfaces, the routes, the cron schedule and the delivery fallback chain |

`rf71Preservation.spec.ts` is deliberately the inverse of the rest of the suite:
a failure there does not mean the code is wrong, it means **a capability that
existed has changed** — which must then be deliberate, named and approved.
