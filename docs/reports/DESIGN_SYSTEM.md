# Report design system — the contract

How generated reports get their colour, type, structure and branding, and where
that will live. This is the architecture doc for the report-rendering programme;
the brand rules themselves are in the
[`npc-services-design`](../../.claude/skills/npc-services-design/) skill.

**Status:** Phase 0 (this document + the skill), Phase 1 (the Kit foundation),
Phase 2 (stylesheet, primitives, document spine), Phase 3 (brand, logo and
snapshotting), Phase 4 (fonts and the render container) and **Phase 5 (charts)**
delivered. The design system is complete.

**Formats migrated:** six, each with its own contract document, payload,
document, brand snapshot, server-side render route and tests, and each keeping
its legacy generator reachable rather than retiring it.

1. The Borrowing Capacity Snapshot — [`BORROWING_CAPACITY.md`](./BORROWING_CAPACITY.md).
   Also carries a golden diff against a capture of what shipped before it.
2. The 10 Year Cash Flow Analysis — [`CASH_FLOW.md`](./CASH_FLOW.md). The one
   format whose arithmetic stays in the browser, because the adviser's overrides
   are not persisted when the document is produced.
3. The Portfolio Performance Review — [`PORTFOLIO.md`](./PORTFOLIO.md). The first
   long enough to need a contents page, the first whose length scales with its
   subject, and the only one that reads a second, optional table.
4. The Property Comparison Analysis — [`COMPARISON.md`](./COMPARISON.md). The only
   format with no deterministic figures at all, the only one that reads part of
   its content back out of a model response that was cut off mid-write, and the
   only one whose migration makes downloading a saved document *free* — the path
   it sits beside asks a model to rewrite the report on every download.
5. The Cash Flow Comparison Analysis — [`CASH_FLOW_COMPARISON.md`](./CASH_FLOW_COMPARISON.md).
   Two to five 10 Year Cash Flow Analyses side by side, so its payload is N of
   another format's and it imports that format rather than restating it. The
   first comparison with real deterministic figures, the only format with
   *nothing* persisted about its subject, and the first migration to edit the
   legacy path it sits beside rather than only leaving it reachable.
6. The Client Details report — [`CLIENT_DETAILS.md`](./CLIENT_DETAILS.md). The
   only format whose subject is a person rather than a transaction, the only one
   where the ordinary record has most of its sections empty (26 of 771 clients
   hold any property), and the only one replacing a generator that rasterised
   every page with html2canvas — so it is also the only migration whose headline
   result is simply that the document is text.

Each new route needs its function deployed and its migration applied before its
call sites do anything; both are manual.
Scope is the report/PDF layer. The Template Library catalogue and the Template
Builder editor are out of scope, but the shared **block renderers** in
`src/lib/reportTemplate/blocks/*.html.ts` are in scope as reusable infrastructure.

---

## 1 · Why

Reports are the artefact clients actually receive. Today they do not look like one
product.

| | Measured |
| --- | --- |
| PDF engines in use | **4** — WeasyPrint (server), pdf-lib (Deno), pdf-lib (browser), jsPDF (browser) |
| Client-side generation code | ~31,000 lines |
| Server-side | ~6,200 lines |
| Orphaned / unreachable | ~2,600 lines orphaned, plus ~1,400 unreachable in `useReportGenerator.tsx` (returns at :698) |
| Distinct hardcoded "brand golds" | **8** — see §2 |
| `setFont('helvetica')` calls | **599** |
| Reports embedding a logo | **0** |
| Golden / fidelity tests on shipping PDF paths | **0** |

## 2 · The eight golds

None of these is `--brand` (`43 74% 49%` → `#D9A521`).

| Hex | Where |
| --- | --- |
| `#BF9B50` | `src/utils/pdfDisclaimerPage.ts:19`, `MarketIntelligencePDFGenerator.ts:14`, `OverviewSnapshotPDF.ts:13`, `blocks/charts.html.ts` default |
| `#D4A843` | `render-investment-report-pdf/report.brand.ts:14` **and** `index.ts` `THEME` |
| `#B8902F` | `render-investment-report-pdf/index.ts` `THEME` |
| `#B9923E`, `#8B6B23` | `index.ts` `DESIGN_PALETTES` (`editorial_navy` preset) |
| `#ca8a04` | `CashFlowAnalysisModal.tsx:2424` |
| `#c9a55a` | `BorrowingCapacityPDFReport.tsx:243` |
| `#D4A017`, `#c9a227` | the app (White-Label default accent, legacy) |

## 3 · Two corrections to the obvious plan

Both were verified before writing this, and both change the shape of the work.

### 3.1 The editorial track is a prototype, not the live renderer

`render-investment-report-pdf/report.brand.ts`, `report.css.ts` and `report.html.ts`
are a well-designed brand-token module, print stylesheet and HTML primitive library
— and **nothing imports them.** `index.ts` imports only `createClient`, `marked`,
`auth`, `authz`, `csrfGuard`, `storageSign` and `markdownSafety`, and carries its
own inline `THEME` and `DESIGN_PALETTES`.

So they are the right *seed*, but adopting them is a **rewire of a live 5,580-line
function**, not "reuse what is already running". Sequence that rewire as
substitution-only — tokens and CSS swapped, markup untouched — so any visual diff is
attributable to the token change alone.

### 3.2 Single-source the modules; do not mirror them

Edge functions cannot import from `src/`. But **`src/` can import from
`supabase/functions/_shared/`**, and five production modules already do it with a
one-line re-export bridge:

```ts
// src/lib/reportTemplate/pdfImport/typographyFidelity.pure.ts — the entire file
export * from '../../../../supabase/functions/_shared/typographyFidelity.pure.ts';
```

Vite resolves the explicit `.ts`, Deno reads it natively, Vitest imports it
directly. This is strictly better than the mirroring used by
`compassSectionRegistry.ts` — which is exactly why those two copies have **already
drifted to 672 lines edge-side versus 174 in `src/`**, despite
`docs/COMPASS_40_PAGE_ARCHITECTURE.md` stating they "must stay in sync".

**Rule for this programme:** canonical `.pure.ts` in
`supabase/functions/_shared/reportDesign/`, one-line `export *` bridges in
`src/lib/reportDesign/`, and a test asserting every bridge file is *only* a
re-export and that the two directories are 1:1. Mirroring plus a parity test is the
fallback for cases where sharing is genuinely impossible — for this work, there are
none.

## 4 · Target module layout

```
supabase/functions/_shared/reportDesign/     ← canonical, pure TS
  color.pure.ts        ✅ hex/HSL conversion, contrast, ensureContrast()
  tokens.pure.ts       ✅ GENERATED from tokens.css — surfaces, ink, semantics, scale
  roles.pure.ts        ✅ role union, INK_LEGALITY, ResolvedReportPalette
  brandResolve.pure.ts ✅ resolveReportPalette(), auditPaletteContrast()
  typography.pure.ts   ✅ print stacks, CONTAINER_INSTALLED_FAMILIES, missingFamilies()
  page.pure.ts         ✅ page geometry + the seven named pages
  options.pure.ts      ✅ ReportDesignOptions, density metrics, clamping
  css.pure.ts          ✅ buildReportCss({palette, options, masthead})
  primitives.pure.ts   ✅ cover, chapter, KPI strip, table, callout, company page…
  companyBlock.pure.ts ✅ contact/disclaimer shaping shared by all three renderers
  structure.pure.ts    ✅ REPORT_ARCHETYPES, buildSpine(), validateSpine()
  assets.pure.ts       ✅ inline policy, slot fallback chains, budget
  snapshot.pure.ts     ✅ ReportBrandSnapshot, fingerprint, palette/contact adapters
  (the house cover art and mark are NOT here — see "Where the house artwork lives")
  charts.pure.ts       ✅ 16 SVG charts, palette-driven, sized in points

src/lib/reportDesign/<same names>.pure.ts    ← one-line export * bridges
src/lib/reportDesign/__tests__/designSystemSourceOfTruth.spec.ts
src/lib/reportDesign/__tests__/printContrast.spec.ts
src/lib/reportDesign/__tests__/reportSourceHygiene.spec.ts   ← no literals, no "NPC"
src/lib/reportDesign/__tests__/reportCss.spec.ts             ← print legality
src/lib/reportDesign/__tests__/reportPrimitives.spec.ts      ← escaping + contract
src/lib/reportDesign/__tests__/reportStructure.spec.ts       ← spine validation
src/lib/reportDesign/__tests__/reportCharts.spec.ts           ← colour, size, safety
src/lib/reportDesign/__tests__/reportTypography.spec.ts       ← the Dockerfile contract
src/lib/reportDesign/__tests__/reportAssets.spec.ts           ← inline policy
src/lib/reportDesign/__tests__/reportSnapshot.spec.ts         ← fingerprint coverage
src/branding/__tests__/brandAssetSlots.spec.ts                ← the two resolvers agree
scripts/reportDesign/buildTokens.ts          ← the generator (+ `--check` for CI)
scripts/reportDesign/buildDefaultAssets.ts   ← asset inliner (+ `--check` for CI)
scripts/reportDesign/generated/defaultAssets.generated.ts ← its output (NOT under supabase/functions/)
scripts/reportDesign/buildSpecimen.ts        ← `npm run reportkit:specimen`
supabase/migrations/20260813000000_report_brand_snapshots.sql
weasyprint-service/fonts/                    ← the three brand faces, OFL licences, PROVENANCE.md
```

### Where the house artwork lives

The house cover art and mark are ~490 KB of base64 between them. They used to sit
in `supabase/functions/_shared/reportDesign/defaultAssets.generated.ts`, and that
was a deploy-blocking mistake rather than a tidy one: **every file under
`supabase/functions/` is uploaded with every function**, so those bytes counted
against all ~349 of them. Three unrelated functions —
`manage-partner-agreements`, `aml-client-portal` and `generate-investment-report`
— went past Supabase's ~4.5 MB bundle cap and could not be deployed at all,
which is invisible until you try to ship a fix to one of them.

So the bytes live in `public.report_default_assets`, keyed by `asset_key`
(`npc_house_cover_art`, `npc_house_mark`), and `render-investment-report-pdf`
loads the cover at request time via `loadHouseCoverArt()` — cached per isolate,
returning `null` on failure so a missing photograph degrades to the gradient/foil
cover instead of failing the render. It is still a `data:` URI by the time
WeasyPrint sees it, so the no-network policy in `assets.pure.ts` is intact.

The generator remains the source of truth: `npm run reportkit:assets` writes
`scripts/reportDesign/generated/defaultAssets.generated.ts` and
`reportkit:assets:check` gates it in CI. Re-seeding the table after a regenerate
is a manual step — stage a throwaway edge function that imports the generated
file and upserts the two rows, run it once, then delete it. Do **not** re-add the
generated file anywhere under `supabase/functions/`.


`premiumPdfDesign.ts` (the design panel's option contract) and
`src/utils/pdfDisclaimerPage.ts` (the jsPDF and pdf-lib closing pages) are now
adapters over these modules rather than second definitions.

`src/branding/color-utils.ts` is now a bridge onto `color.pure.ts` rather than a
second implementation of the same ten functions.

CI gates added: `npm run reportkit:tokens:check` (token drift),
`npx vitest run src/lib/reportDesign` (bridge purity + contrast), and
`deno check supabase/functions/_shared/reportDesign/*.pure.ts` (the modules must
resolve in the runtime that actually renders).

`src/branding/brandPalette.ts` becomes a deprecated adapter over
`resolveReportPalette` so its consumers keep compiling during migration, then is
deleted.

## 5 · Token derivation

`tokens.pure.ts` states every print value **as a derivation of** a
`src/styles/tokens.css` variable, with the reason inline. The adjustments are real
and non-obvious:

- **Paper is `#FAF7EF`, not white** — `--background`, derived, not the `#FAF7F1`
  the dead prototype invented. Panels are *darker* than the sheet, inverting the
  screen relationship.
- **Contrast floors by size** (see the skill's `reports/REPORT_RULES.md` §2).
  `--brand` on ivory is 2.10:1 and fails at the 8.5pt eyebrow — the single most
  important adjustment, and the reason eight golds exist.
- **Category B keeps its hue, never brand-derives.** `PRINT_SEMANTIC` is frozen
  and `resolveReportPalette` accepts no override for it, so tenant leakage is a
  type error rather than a code-review question.

  It used to be spread in as literals, which was right while the grounds were
  four permutations of three values we chose. The four clear 4.5:1 on NPC's
  darkest stock by about a percent — `negative` is 4.58:1 on `#F2EBDE` — so they
  stopped being safe as literals the moment a design system could bring its own
  paper: any panel slightly darker pushed all four under the floor. They now go
  through `ensureContrast` against whichever ground they read worst against,
  which walks lightness and preserves hue. Risk is still red, the hue still
  comes from a frozen constant, and no input reaches it. For all four presets it
  is a no-op, and `printContrast.spec.ts` proves that byte for byte.
- **The token derivation is executable, not only documented.** Every statement
  of the form "`paper` is `--background`" above is mirrored by an entry in
  `brandDesign/import.pure.ts › NEUTRAL_SOURCES`, and
  `src/lib/brandDesign/__tests__/import.spec.ts` runs it over the real
  `_ds_manifest.json` pulled from claude.ai/design, requiring every print token
  to come back byte-identical. `npm run brand:sync` is the same check on the
  command line. That is what makes importing somebody else's design system
  possible: it is this derivation over their tokens instead of ours.
- **Screen-only constructs are dropped, not translated** — gradient text,
  `box-shadow`, blur, motion.

The colour-format chain (`H S% L%` → hex → pdf-lib 0–1 floats) collapses to one
conversion at snapshot time; downstream everything is `#RRGGBB`.

### What the derivation actually found (Phase 1)

- **The NPC gold is a dark-ground colour.** `--brand` is **7.26:1 on obsidian**
  and **2.10:1 on ivory**. It fails at every size on paper, including the 8.5pt
  eyebrow that is the brand's own signature. On the cover it needs no help at
  all; on paper it steps down the ramp. That asymmetry — not carelessness — is
  why eight golds accumulated: each was someone solving the paper case locally.
- **The step is `--brand-800` (`#8E6C15`, 4.56:1).** `ensureContrast()` and the
  `--brand-*` ramp arrive at the same value independently, so the derived colour
  is one the design system already names.
- **A uniform lightness does not work for Category B.** At 33% L the warning
  gold is 4.35:1 and fails, while the success green passes comfortably —
  contrast is a function of hue, not lightness alone. Each semantic is therefore
  darkened until it clears the floor against the *darkest* stock any preset can
  put it on.
- **The floor is 4.5:1, not 7:1.** Body copy is graphite at **13.22:1** and
  clears AAA regardless; the floor only ever binds on accent type, which is
  short, bold and letterspaced. Forcing AAA there turns the brand gold brown.
- **`accentOnPaper` must be derived against the worst paper ground, not the
  default one.** Under `minimal_ink` the `paper` role is porcelain while
  `paperAlt` is champagne; deriving against `paper` alone shipped a palette that
  was legible on one ground and not the other. The contrast test caught it.

## 6 · Brand, logo and snapshotting

Resolution order: NPC defaults → `whitelabel_settings` → `global_report_settings`.
Today `render-investment-report-pdf` reads only the third, so **tenant brand colour
never reaches a PDF** — that is the gap.

Needs adding:

- a **`report` logo slot** (and a reversed `report-mono`) on `logo_config`; today
  the slots are `auth | sidebar | sidebar-icon | favicon`
- an **ABN** on the snapshot — `client_fact_find_brand_snapshots` has no ABN field
  and only `global_report_settings.contact_details` carries one
- a `report_brand_snapshots` table modelled on `client_fact_find_brand_snapshots`,
  referenced `ON DELETE RESTRICT`

Assets inline as base64 `data:` URIs. `weasyprint-service/app.py` permits `data:`
explicitly and bypasses its SSRF guard for it, under a 25 MB HTML cap. Inlining
makes renders reproducible and network-free, and PDF/A-2b — the variant the code
already requests — forbids unresolved external references. It also unblocks local
development, where the SSRF guard rejects `localhost` asset URLs outright.

This retires the hardcoded `lovable.app` cover URL in `index.ts:3078`.

### What Phase 3 delivered

- **`report` and `report-mono` logo slots** in `logo_config`, wired through
  `BrandLogoConfig` → `BrandProvider` → `getBrandAssetSrc` → the White Label page.
  Additive: no `theme_version` gate, so a tenant on version 1 keeps saving.
- **`resolveReportAsset()`** — the fallback chain `report → sidebar → auth →
  sidebarIcon`, with the inline policy enforced at each step. A key that fails
  policy does not stop the walk, so a tenant whose report mark is a 12 MB PNG
  still gets their sidebar logo rather than a blank space, and the skip is
  reported with a reason.
- **`report_brand_snapshots`** (migration `20260813000000`) — deduplicated by
  content fingerprint rather than one row per artefact, with
  `investment_reports.brand_snapshot_id … ON DELETE RESTRICT`. The upsert is a
  single `ON CONFLICT` statement because read-then-write races two concurrent
  renders of the same brand.
- **The `lovable.app` cover URL is gone.** `render-investment-report-pdf` now
  imports the same JPEG as an inlined `data:` URI. Same pixels, no outbound
  fetch, no dependence on a preview host still serving that path.
- **A generated report carries a logo for the first time.** `lockupFor()` puts
  the mark on the cover and the closing page; verified in a real render.

### The finding that changes the migration plan

`public/templates/npc-portfolio-cover-new.jpg` — the cover art the live
investment report has always used — **is not a photograph.** It is a finished
NPC cover with *"NAIDU PROPERTY CONSULTING SERVICES"*, the tagline and the
monogram burned into the pixels. Rendering the new cover over it produces two
company names and two marks on one page.

This is the same class of problem as the `public/icons/*` files (email-signature
banners carrying the director's mobile number). The consequence for the
migration phases: **no legacy cover asset can become a white-label default**, and
any format still using one needs replacement artwork before it can be re-skinned.
`NPC_HOUSE_COVER_ART` is named to make misuse obvious, and
`reportSourceHygiene.spec.ts` fails if any design module imports the asset file
at all.

## 7 · Charts

**Reuse, not rebuild.** `render-investment-report-pdf/index.ts` already carried
fifteen chart renderers and two sparklines, written for Deno and deliberately
local so a render makes no network calls — `renderGauge`, `renderWaterfall`,
`renderHeatmap`, `renderScoreWheel`, `renderBullet`, `renderMarimekko`,
`renderMicroMap`, `renderCalendarHeatmap`, `renderBars`, `renderQuadrant`,
`renderPictograph`, `renderDonut`, `renderTiles`, `renderTimelineRibbon` and the
two sparks. They are good drawings. `charts.pure.ts` is that work promoted, with
the geometry ported faithfully so a migrated report draws the same shapes.

Extracting them also retires the `html2canvas` rasterisation in
`useChartExport.tsx`, `CashFlowAnalysisModal.tsx` and
`PropertyReportGenerator.tsx`, none of which can work server-side.

### Four defects found in the port

| Defect | Consequence | Fix |
|---|---|---|
| **Eleven more hardcoded colours** — `VIZ_GOLD #D4A843`, `VIZ_NAVY #0A2540`, `VIZ_GOOD #4F7A33`, `VIZ_RISK #A8401C` and seven others | A twelfth palette: unreachable from a tenant, unaudited for contrast, with its own idea of what "risk" looks like | Every colour is a role. The semantic three are Category B, so a chart cannot be where risk turns green. |
| **Chart type was too small to read** | Sizes were viewBox units, which say nothing about printed size. A 9.5-unit label in a 760-unit viewBox across the 174mm measure is **6.2pt** — under the product's own floor | Sizes are declared in points and converted per chart. `reportCharts.spec.ts` walks every `font-size` in every chart and fails below 7.4pt. |
| **A chart in a grid column printed at the column's scale** | A chart built for the full measure and dropped into a 38% column printed every label at 38% of the size asked for. Visible in the first charted render as ~4pt axis labels | `chartContextForSpan()`, and `GRID_SPANS` moved into `page.pure.ts` so the stylesheet and the chart sizer read one definition. |
| **A fixed gradient id and an inverted arc flag** | Two gauges on a page shared `id="gauge-fill"`; and the value arc set the large-arc flag whenever the score exceeded half, drawing it the long way round — two disconnected segments | Ids hash the chart's own content. The flag is always 0: the sweep is `pct` of a half circle and can never exceed 180°. |

A fifth, found by rendering: at the corrected type sizes a donut legend beside
the ring does not fit a 66mm column — the label printed through the percentage.
The legend now stacks beneath the ring below `DONUT_STACK_BELOW_MM`.

The render caps carried over unchanged (`MAX_WATERFALL_ITEMS`,
`MAX_HEATMAP_CELLS`, `MAX_WHEEL_SCORES` …). Chart data is model-generated and,
on the shared-report path, attacker-influenced; the reason for each cap is still
true.

### What Phase 4 found and fixed — and what Phase 5's CI then found in it

The font contract in `typography.pure.ts` described itself as "a contract with
`weasyprint-service/Dockerfile`". Nothing checked it, and it was wrong in a way
with a much larger consequence than bad typography.

**The image could not be built.** The Dockerfile installed
`fonts-playfair-display`, `fonts-cormorant-garamond`, `fonts-fraunces` and
`fonts-ibm-plex`. **None of the four exists as a binary package in Debian** —
bookworm or trixie. `apt-get install -y` exits non-zero on an unknown package, so
that `RUN` layer failed and the build aborted. Whatever image is serving Cloud
Run today was not built from this Dockerfile.

That also explains the one typographic defect visible in the Phase 2 render: the
accent stack led with Cormorant Garamond, which was never installed, so every
standfirst and dek fell through to the engine's default serif and was *not
italic at all*.

`fonts-ibm-plex` survived the first attempt at this fix, and the reason is worth
recording because the mistake is easy to repeat: it is a Debian **source**
package name, so `packages.debian.org/bookworm/fonts-ibm-plex` returns a page and
a website check reads it as available. Only the binary index disagrees. **Check
`dists/<release>/main/binary-amd64/Packages.gz`, not the website.** The
`render-container` CI job caught it on its first real run against `main` — which
is the entire argument for that job existing.

| Fixed | How |
|---|---|
| Four non-existent packages | Removed. Playfair Display and IBM Plex Mono arrive as COPY-ed TTFs. |
| Cinzel absent | `weasyprint-service/fonts/Cinzel-Bold.ttf`, extracted from the repo's own `Cinzel_Playfair_Display.zip` with its OFL licence. |
| No italic for the accent role | `PlayfairDisplay-Italic.ttf`. Without a real italic the engine synthesises a slant, which on a high-contrast didone reads as a printing fault. |
| **Every Playfair weight synthesised** | Shipping Medium alone while the stylesheet asks for 400, 600 and 700 does not produce a *missing* font — it produces a **faked** one. Invisible locally, where a distribution package fills the gaps. The font set is now exactly what the report requests. |
| Two serif families where the second never loaded | The accent role is now the *same* family as display, set in italic. One editorial serif used two ways is a system; two where the second is missing is a bug. |
| Unpinned base image | `python:3.12-slim-bookworm`. A font contract is only checkable against a known release, and `-slim` moves distribution when the tag is rebuilt. |
| Stale service README | It claimed an Api2PDF fallback on WeasyPrint failure. `index.ts:5567` re-throws — deliberately. The service is critical infrastructure and the README now says so. |

Three gates, because a font failure is uniquely invisible — the engine
substitutes silently, the PDF renders, every test passes, and only the client
sees it:

1. `reportTypography.spec.ts` reads the Dockerfile and fails if the packages, the
   COPY-ed files, `CONTAINER_INSTALLED_FAMILIES` and the type stacks disagree,
   with a named regression check for the phantom packages. It also reads the real
   stylesheet **and the chart drawings** and fails both ways on weight coverage:
   on a weight something requests with no file to answer it, and on a file
   nothing requests. Writing that check found two further defects — the closing
   page requested Cinzel at 400 from a bold-only face, and Playfair Bold is
   requested only by charts, which the first version of the scan did not read.
2. The Dockerfile's own `fc-cache` layer asserts each brand family resolves, so a
   missing face breaks the build rather than the document.
3. CI builds the image, checks `fc-list` inside it, renders a smoke document
   through the service and asserts with `pdffonts` that the faces are
   **embedded** — a substituted face still produces a valid PDF.

Font hashes and sources are in `weasyprint-service/fonts/PROVENANCE.md`.

## 8 · Two migration targets

Not every report can move server-side. `CashFlowAnalysisModal` computes its three
PDFs from live form state; there is no row for a server to read.

| Target | For | Path |
| --- | --- | --- |
| **A** — server-side | data already persisted: investment, **market intelligence**, portfolio, borrowing capacity, property comparison, cash flow comparison, client details, **Report Q&A** | edge function reads the row → builds HTML → WeasyPrint |
| **B** — client-side HTML | data that exists only in browser state: the cash flow modal's live overrides | client imports the same design system via the bridge → POSTs HTML to `render-template-pdf` |

**Q&A moved from B to A**, and the move is the interesting part of that format.
It was classified client-side because the browser holds the conversation, but
every message is a row in `report_qa_messages` and the write-up is a column on
`report_qa_conversations` — so the browser had nothing the database did not.
Reading server-side is not only tidier: a transcript the caller posts up is a
transcript the caller can edit, and that document's whole claim is that it is a
record of what was asked and what was said. See [`QA.md`](./QA.md).

The Client Details form moved for the same reason and is no longer "Formara" in
this table: its nine tables are read by `render-client-details-pdf`.

**Market Intelligence was always Target A on paper and had nothing implementing
it.** The archetype had been declared years before anything rendered against it,
and its note described a locality report — comparables and commentary for a
suburb — which is not that document and never was. It reads as having been
written from the archetype's name rather than from the generator, which is the
hazard of declaring an archetype before something implements it. The band was
wrong in the same way and is now pinned by render. See
[`MARKET_INTELLIGENCE.md`](./MARKET_INTELLIGENCE.md).

That format is also where the design system's own contents page ran out: it is
the first with enough chapters to need two, so `buildSpine` gained an optional
`contentsPages` and `.toc-row` gained `break-inside: avoid` after a render put a
contents entry's title on the page after its number.

### The first format: Borrowing Capacity Snapshot

The Snapshot is a Target A format and the first one being migrated. Its ground
truth — the five competing implementations, the captured golden, and eleven
numbered findings against the shipping output — is
[`BORROWING_CAPACITY.md`](./BORROWING_CAPACITY.md). Phases 1–5 of that migration
cite those findings by number.

#### What the first format's render found in the design system

Two rules in `css.pure.ts` contradicted each other, and neither shows up until
a format with long tables is actually rendered. `table.data` carried
`page-break-inside: avoid` alongside `thead { display: table-header-group }` —
the latter exists precisely so a table can repeat its head across a break, which
the former made impossible. A table that did not fit at the foot of a page moved
whole and left a hole; **a table longer than one page could not break at all**,
so a client with thirty liabilities would lose rows off the bottom of it.

Tables now break, `tr` still never splits, and `caption { break-after: avoid }`
keeps a caption with its first row. Numeric cells gained `white-space: nowrap`,
because line-breaking treats the minus sign and the space before a period suffix
as break opportunities — `-$10,600 pa` was rendering as `-` on one line and the
figure on the next.

Both are asserted in `reportCss.spec.ts`.

#### And what the first tenant-branded render found

`assets.pure.ts` capped bytes, restricted MIME and refused URLs and SVG — and
never looked at how big the picture was. A 1×1 PNG passed every check and
printed on the cover as a 22mm block. `logo_config` accepts whatever a tenant
uploads, so a favicon-as-report-mark is a real case, not a contrived one.

The module now reads pixel dimensions from the header — PNG from `IHDR`, JPEG by
walking the marker chain past EXIF or ICC to the first frame header — and
rejects below `MIN_ASSET_EDGE_PX` (96) with the measured size in the reason, so
`resolveReportAsset` walks on to the next mark in the chain. WebP reports "cannot
measure" rather than guessing across its three containers, and an unmeasurable
asset is accepted: refusing to print a logo whose header would not parse is worse
than printing one that might be small.

Target B is already in production for Compass via
`routeReportThroughTemplate.ts` → `render-template-pdf`, with auth, resource-safety
(`assertSafeRenderResources`), upload and an audit row all solved. Both targets share
one design system, so brand consistency does not depend on which one a format uses.

## 9 · Verification

- **Bridge purity + 1:1 directory parity** — every `src/lib/reportDesign/` file must
  be only an `export *`.
- **Contrast** — every colour role × every legal ground, against the §5 floors.
- **Golden PDFs** — build the WeasyPrint container, render fixtures, rasterise,
  pixel-diff. Fixtures must inline every asset, because the SSRF guard rejects
  non-global hosts — which is also the production policy, so the goldens exercise
  the real path. **This will be the first fidelity coverage any shipping PDF path
  has had.**
- **Brand-drift ratchet** — clone `scripts/audit-style-tokens.cjs`: count `helvetica`
  calls, jsPDF/pdf-lib/html2canvas imports, the eight golds, and `lovable.app` under
  `supabase/functions/`; fail on any increase.
- **Structure QA** — extend `compassQAValidator.ts` to every format.
- **Edge tests must actually run.** `vitest.config.ts` includes only
  `src/**/*.{test,spec}.{ts,tsx}`, so every `supabase/functions/**/*.test.ts` —
  including `render-investment-report-pdf/security-contract.test.ts` — never
  executes in CI.

### What the first real render found (Phase 2)

`npm run reportkit:specimen` builds a document that exercises every primitive;
rendering it through WeasyPrint and rasterising the pages found six defects that
no amount of reading the CSS would have. All six are fixed, and each one is now
either impossible by construction or asserted by a test.

| Defect | Cause | Fix |
|---|---|---|
| No running head on any continuation page of a chapter | `page: chapter-opener` applies to **every** page an element spans, not its first | The low title is `padding-top` on `.chapter`; `openChapter()` defaults to the `body` page |
| Table caption stranded on the previous page | A `<caption>` is a separate box; `page-break-inside: avoid` on the table does not cover it | `renderDataTable` wraps table + caption in `.table-block` |
| A pale stripe down the left of every banded row | The first cell is `<th scope="row">` for the tagged-PDF structure tree, and the band selector named only `td` | Cell selectors hoisted to constants that name both, so a variant cannot forget one |
| Contact block ran off the right edge of the closing page | `.company-page` is 210mm **plus** 22mm padding on a zero-margin page | `box-sizing: border-box` on every full-bleed block |
| Running foot wrapped to two lines | The `@bottom-left` box is a third of the measure; company + document name does not fit in letterspaced mono | `mastheadFor()` returns the company name alone; the document name lives on the cover, in the PDF title and in the running head |
| The drop cap printed on top of the words it opened | WeasyPrint places a floated `::first-letter` but does not shorten the first line box around it | Ships a raised initial instead; `reportCss.spec.ts` fails on `float: left` |

That render was produced by WeasyPrint 69 on this workspace rather than by the
container, and for a long time that was a real caveat: the container pinned
**62.3**, and the two disagree — 62.3 rejects `width: calc(210mm - 44mm)`,
drops the declaration and renders on, which is how the cover's masthead printed
the classification and the reference as one word in every shipped copy with
nothing red anywhere.

**Both halves of that caveat are now closed.** The faces are installed in the
image and the specimen re-renders with Inter, Playfair Display (upright and
italic), Cinzel and IBM Plex Mono; and `weasyprint-service/requirements.txt`
pins `weasyprint==69.0`, the version this workspace runs. The two cannot drift
silently again — `PINNED_ENGINE` in `engineSupport.pure.ts` mirrors that line,
`engineSupport.spec.ts` reads the requirements file and fails if they differ,
and CI's `render-container` job asserts the installed version against the pin
inside the built image.

What that pin does **not** prove is which image is *deployed*. There is no
deploy workflow; see [`CONTAINER_RELEASE.md`](./CONTAINER_RELEASE.md), whose
first step is asking the running service what engine it has.

The specimen is also the re-skin proof: the same content rendered with
`--preset=minimal_ink --brand='#00A3FF' --density=compact --table=ledger
--chapter=opener_band` changes stock, rhythm, rules and every brand mark, while
the negative figures stay the one red and the positives the one green.

### Every format, rendered and read

Until this table existed, **two of the ten formats had ever been rendered and
looked at**: the Borrowing Capacity Snapshot, whose render spec wrote its HTML,
and the converter, done by hand. The other eight were asserted with `toContain`
against an in-memory string — which cannot see a page, and every real defect
this programme has fixed was found by looking at one.

```
npx tsx scripts/reports/renderAll.mts
```

Renders all ten from their fixtures, measures each page with `measure_pages.py`,
judges each with `judgeDocument`, and leaves the page images under
`reports/pages/<format>/`. The ink column is the fastest signal: **a natively
designed page in this system measures 0.133 to 0.221**, and a document whose
body pages sit at 0.05 does not have one sparse page, it has no page economy.

| format | pp | median body ink | in band | high | medium | outline | validates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| borrowing-capacity | 12 | 0.131 ↓ | 2/10 | 0 | 3 | 14 | PDF/UA-1 |
| cash-flow-projection | 10 | 0.167 | 5/8 | 0 | 1 | 6 | PDF/UA-1 |
| cash-flow-comparison | 21 | 0.093 ↓ | 3/19 | 0 | 9 | 23 | PDF/UA-1 |
| client-details | 14 | 0.119 ↓ | 5/12 | 0 | 4 | 14 | PDF/UA-1 |
| investment-compass | 28 | 0.096 ↓ | 5/26 | 0 | 7 | 44 | PDF/UA-1 |
| market-intelligence | 22 | 0.060 ↓ | 2/20 | 0 | 12 | 44 | PDF/UA-1 |
| portfolio-performance | 26 | 0.173 | 5/24 | 0 | 6 | 28 | PDF/UA-1 |
| property-comparison | 15 | 0.070 ↓ | 1/13 | 0 | 8 | 22 | PDF/UA-1 |
| report-qa | 9 | 0.121 ↓ | 3/7 | 0 | 2 | 18 | PDF/UA-1 |
| converted | 10 | 0.091 ↓ | 1/8 | 0 | 3 | 13 | PDF/UA-1 |

**Zero `high` findings across all ten, and zero engine warnings.** The last two
columns come from `scripts/reports/validateUa.mts` rather than `renderAll.mts`;
every one of the ten had an outline of **zero** until `bookmark-level` reached
the stylesheet, and none of them had ever been through a validator.

The `medium` column is almost entirely `sparse-page`, and the `↓` on median ink
is the page economy this programme has **not** finished with. Eight of the ten
sit below the 0.133 floor — several spend a sheet on two-thirds of a sheet's
content. Reading the pages says where it comes from, and it is one thing rather
than eight: `.chapter { page-break-before: always }` is global, the chapter
opener's furniture is about a third of a sheet on its own, and a chapter with
less than two-thirds of a sheet of content therefore leaves the rest blank —
`market-intelligence` page 5 is a 40pt title, a dek, a rule, five one-line
bullets and 55% empty paper. Two formats already solved it for themselves
(Investment groups 36 prose sections into four chapters; the converter packs
thin chapters through `packThin`), and neither fix is available to the other
eight. That is the next thing to work on and it is stated here rather than left
to be rediscovered.

Two of these numbers moved for a reason worth recording. Borrowing Capacity was
eleven pages at 0.151, inside the band; it is twelve at 0.131 because its
subheads moved from `h3` to `h2` to satisfy PDF/UA clause 7.4.2, and `h2` — the
design system's actual subhead — carries 3pt more type and 16pt more air than
the `h3` six formats had each invented for themselves. The document is correct
now and costs a page for it. Investment lost a page and Portfolio gained one
from the same change.

Three things this table taught, none of which was visible from the code:

- **A section is not a chapter.** Investment gave each of the generator's 36
  numbered prose sections its own chapter, `.chapter` carries
  `page-break-before: always`, and a corpus section runs to about two
  paragraphs. A full report was 46 sheets at 4.1% ink. The archetype band said
  43–53 and the document sat inside it, which is what a band cannot tell you.
- **The measurer was wrong twice**, both producing `high` findings on correct
  documents — a trim band derived from the portrait constants on a landscape
  sheet, and a full-bleed test that exempted a tinted page from the trim rule.
  `scripts/reports/test_measure_pages.py` now guards both.
- **The rubric's only `high` rule was fully occupied by fixture noise.** Every
  `duplicate-block` finding across four formats came from a fixture repeating
  itself, so the strongest check in the harness could not have caught a real
  repetition on any of them.

### What the engine says about the stylesheet

Two declarations added on the strength of the specification alone are **unknown
properties on WeasyPrint 69.0**, and only rendering found them:

| declaration | what happens | what to write instead |
| --- | --- | --- |
| `font-synthesis: none` | ignored; the engine still emboldens a face with no such cut | pin `font-weight` to a cut that ships |
| `hyphenate-limit-lines` | ignored; `hyphenate-limit-chars` beside it is accepted | nothing — this engine has no ladder control |

Both are in `UNSUPPORTED` in `engineSupport.pure.ts` and in the container's
`DEFAULT_PROBES`, so a reintroduction fails a test rather than a render whose
stderr nobody reads.

## 10 · Known hazards

1. ~~**Cinzel is not in the render container.**~~ **Resolved in Phase 4.** Cinzel
   and Playfair Display (upright *and* italic) are `COPY`-ed from
   `weasyprint-service/fonts/` and `fc-cache`-d, the build fails if either
   family fails to resolve, and CI builds the image and asserts the faces embed
   in a rendered PDF. **The container must be redeployed** before any report set
   in Cinzel ships — the image on Cloud Run predates this change.
2. **Signed-URL TTLs are inconsistent and long** — 7 days in
   `render-investment-report-pdf:5447`, 24h in `render-template-pdf`, against a
   15-minute ceiling that `secure-storage` enforces on client-originated requests.
   Migrating volume onto these paths multiplies the exposure. Unify before the
   first format migration.
3. **WeasyPrint hard-fails.** Contrary to `weasyprint-service/README.md`, the
   Api2PDF fallback is disabled when WeasyPrint is configured, so a render failure
   is user-visible. The README is stale.
4. **PDF/A + tagged output** constrain markup: heading levels must be semantically
   correct, and external references are forbidden. ~~And the output was tagged.~~
   **It was not.** The service read `tagged` from the request body, defaulted it
   to true, and never passed anything to the engine — the option that writes a
   structure tree is `pdf_tags`, and it does not exist before WeasyPrint 63.
   Every report the programme shipped was untagged: valid, printable, and
   unnavigable to a screen reader. Fixed with the engine upgrade; asserted by
   `X-Pdf-Tagged` in CI and by a service test that renders uncompressed and
   looks for `/StructTreeRoot`.
5. **Three divergent `InvestmentReport` types** bridged by a hand-maintained
   `overrideMapping` table. The system needs one payload contract or it inherits
   the drift.
6. **Most brand artwork in the repo is unusable in a client PDF.** The cover
   JPEGs carry NPC's company name and tagline in their pixels; every
   `public/icons/*` file is an email-signature banner with the director's mobile
   number. The monogram at `public/images/npc-logo-monogram.png` is the only
   clean mark. A white-label rollout needs artwork, not just plumbing.
7. **Server-side generation changes delivery** — a Blob download becomes an
   authenticated invocation plus a storage object plus a signed URL, with Cloud Run
   cold-start latency. The UI needs progress states.
8. ~~**`page_count` is null on every render in the programme.**~~ **Resolved.**
   `countPdfPages` scanned the raw bytes for `/Type /Page`; WeasyPrint packs its
   page objects into a compressed object stream, so the token appears nowhere
   outside `/Type /ObjStm … /Filter /FlateDecode` and the scan found zero
   matches — and, by its own rule, returned null. It was not wrong, it was
   blind, and it had been blind since the first migrated format shipped.
   `countPdfPagesAsync` inflates the object streams with `DecompressionStream`
   and counts inside; all nine render routes now call it. Verified against a
   WeasyPrint PDF whose true page count is four. Slicing the stream at
   `endstream` overshoots by the end-of-line the spec requires before the
   keyword, and one trailing byte makes a deflate stream fail outright rather
   than inflate what it can — so the dictionary's `/Length` is used when it has
   one. That single byte is why the first attempt at the fix also counted zero.

---

## 11 · The render engine

Everything above assumes the stylesheet reaches the page. It does not
automatically, and the ways it fails to are all silent.

### 11.1 The version split

The stylesheet was written and visually reviewed against WeasyPrint **69**, on a
developer machine. `weasyprint-service` pinned **62.3**. Those two do not agree,
and the disagreement was invisible in exactly the way that costs the most:

```
WARNING: Ignored `width: calc(210mm - 44mm)` at 665:5, invalid value.
```

62.3 rejects `calc()` in a width. The declaration was dropped, the cover's
masthead row had no width for its `table-layout: fixed` to fix to, the row
auto-sized to its content, and the classification and the document reference
printed as **one word**. The fix for that had shipped a day earlier and been
verified — against 69. The render succeeded. Nothing was red.

The container is now on 69.0, and the pin is mirrored by `PINNED_ENGINE` in
`reportDesign/engineSupport.pure.ts` with a spec that reads
`requirements.txt` and fails on drift. The `calc()` itself is gone regardless:
every length in the sheet derives from a constant TypeScript already holds, so
`calc()` buys nothing and costs a dependency on which engine is installed.

### 11.2 Three lists, and where each is checked

`engineSupport.pure.ts` carries them:

| List | Meaning | Checked by |
| --- | --- | --- |
| `UNSUPPORTED` | the engine drops it | a spec sweeping all 1,296 generatable stylesheets |
| `DISCOURAGED` | it renders, and must not be written anyway (`calc()`) | the same sweep |
| `LOAD_BEARING` | the engine **must** render it — flex, grid, radius, gradients, hyphens, `break-inside`, `string()` | the container's own answer |

The nine unsupported constructs were found by rendering probes, not by reading a
support table: `box-shadow`, `filter`, `backdrop-filter`,
`word-break: break-word`, `position: sticky`, `text-wrap`, `aspect-ratio`,
`mix-blend-mode`, `writing-mode`.

### 11.3 The list cannot rot

A list of what an engine cannot do goes stale the moment the engine moves, and a
stale one gets worked around rather than updated. So the engine grades the list,
not the reverse: `POST /capabilities` answers, for a supplied set of probe
declarations, which ones it ignored. `reconcileCapabilities` compares that to
the three lists and distinguishes **broken** (a load-bearing construct dropped —
the reports will not lay out) from **stale** (something listed as unsupported
that now renders — news, and a prompt to move the entry).

```bash
npm run reportkit:engine:capabilities                    # the local binary
npx tsx scripts/reports/engineCheck.mts \
  --service $URL --token $TOKEN --capabilities *.html    # the deployed one
```

### 11.4 What is not on any list

The defect that started this was not on a list, because nobody had met it yet.
So `/render` returns the engine's warnings —
`X-WeasyPrint-Warnings`, `X-WeasyPrint-Warning-Count` — and CI fails the
Borrowing Capacity render if the count is not zero. `strict: true` turns any
warning into a 422 for callers that want it. Before this, every one of those
lines went to a container's stderr and no caller ever saw one.

Two things the engine does **not** warn about, and how each is caught instead:

- **A `font-family` naming nothing installed.** No log line at all. Caught by
  the Dockerfile's build-time `fc-list` assertion, by CI's `pdffonts` check on a
  real report, and now at runtime by `/capabilities`, which asks fontconfig as
  the unprivileged user that actually renders — a face root can see and uid
  10001 cannot is a substitution that happens only in production.
- **A page that is technically correct and badly composed.** Nothing mechanical
  sees it. That is what `critique.pure.ts`, `measure_pages.py` and the
  `report-critic` agent are for.

### 11.5 A typographic decision made by an omission

`Cinzel-Bold.ttf` was the only weight of the brand cover face in the image, so
the cover title and the closing wordmark were both set Bold — and
`typography.pure.ts` recorded the face as "confined to the two places set large
and short" *because of it*. That reads as a design rule. It was a Dockerfile.

Cinzel is an inscriptional roman cut after Trajan-column capitals, and those are
light. At 34pt the Bold reads as blunt rather than grand, and it blooms on the
obsidian ground a cover is set on, because light-on-dark type optically gains
weight. Regular and SemiBold were sitting unused in
`public/fonts/Cinzel_Playfair_Display.zip` — the same committed archive the Bold
came from — the whole time.

The cover title is now **Regular**, the closing wordmark **SemiBold**, and Bold
is gone: `reportTypography.spec.ts` fails on a shipped file nothing requests,
and inventing a use to keep 77KB would be the same mistake in the other
direction.

Two things now hold that open:

- **`PROVENANCE.md`'s hashes are checked.** A font is a binary in a repository:
  nothing about it is reviewable in a diff, and it is copied into the image that
  renders every client's document. The table used to claim a SHA-256 per file
  and nothing verified it. The spec now hashes each file, fails on a mismatch,
  and fails on a file the table does not record.
- **`selfcheck.py` proves resolution, not just presence.** It walks the font
  directory, reads each file's own family, weight and italic flag out of its
  `name` and `OS/2` tables, asks the engine for exactly that, and checks the face
  that came back is the file that asked. Shipping a file is not the same as being
  able to reach it: `Cinzel SemiBold` answers to `font-family: Cinzel;
  font-weight: 600` only because it carries a typographic-family record, and when
  that resolution fails fontconfig returns the nearest weight in silence. There is
  no manifest to keep in step — the fonts are the source of truth about themselves.

### 11.6 Render options: what was measured, and what not to change

Measured against the real eleven-page Borrowing Capacity Snapshot, so these are
numbers rather than opinions. Recorded because each one looks like an easy
quality win and is not.

| Option | Measured | Verdict |
| --- | --- | --- |
| `optimize_images` | 157,498 vs 157,502 bytes | **Irrelevant.** The reports embed *no raster images at all* — every figure is SVG. `jpeg_quality` and `dpi` are moot for the same reason. |
| `full_fonts` | 157KB → **1.69MB** | No. Subsetting does not change how a glyph draws; this is 10× the file for nothing a reader can see. |
| `hinting` | +7KB (4.5%) | No. Modern viewers rasterise with their own hinting and ignore the embedded instructions. |
| `pdf_variant: pdf/a-2b` | **pixel-identical** to plain across all 11 pages | Superseded — see 11.7. The variant is now `pdf/ua-1`. |

One artefact worth not chasing: under `pdf/a-2b`, poppler prints `Bad color
space 'srgb'` ten times. WeasyPrint defines a named `/srgb` colour space in the
page resources and its transparency-group XObjects reference it from their own
resource dictionaries, where it is not defined. It is upstream, it affects
nothing — the pixel diff above was taken with those warnings present — and the
only way to avoid it would be to stop emitting SVG.

The `optimize_images` row above is **wrong**, and the way it got that way is
the more useful part: it was measured on a fixture with no cover art, and the
"the reports embed no raster images at all" premise it rests on is true of the
*figures* and false of the *document*. See 11.7 for the re-measurement.

### 11.7 The conformance claim, and the sheet a press can trim

A conformance claim that fails validation is worse than no claim: it tells a
procurement officer, a screen-reader user and an accessibility auditor that the
document is navigable, and none of them finds out otherwise until they try. So
the validator came first.

**veraPDF 1.30.2 is in the image**, installed headlessly beside `default-jre`,
and `selfcheck.py` fails the build if the specimen does not validate as
PDF/UA-1. `scripts/reports/validateUa.mts` is the same check over all ten
formats; CI runs veraPDF against the Borrowing Capacity Snapshot it already
renders through the container.

Its first run said `FAIL … ua1` on documents this repo had been tagging as
accessible for months — clause 7.4.2, heading level 2 skipped in a descending
sequence, on six of ten formats. Each had grown its own `const h3 = …` helper
for "a subhead" while the design system's own subhead, `h2`, went unused in all
six. That defect was reachable from the code and nobody had reached it.

**The variant is `pdf/ua-1`**, and that was a choice between two claims rather
than a free addition. Measured:

| rendered as | PDF/UA-1 | PDF/A-2A | PDF/A-2B |
| --- | --- | --- | --- |
| `pdf/a-2b` (what shipped) | fail | fail | **pass** |
| `pdf/a-2a` | fail | **pass** | **pass** |
| `pdf/ua-1` | **pass** | fail | fail |

The middle row is the interesting one: `pdf/a-2a` fails UA-1 on exactly **one**
rule and one check — clause 5, the PDF/UA identification schema in the XMP.
Everything structural passes on both. So these documents already satisfy both
standards' *content* rules and can carry only one standard's *declaration*. It
went to accessibility; nothing asks these reports to be archival, and fonts
stay embedded 168 of 168 either way.

Three things the switch cost or exposed, each now closed:

- **`pdf/ua-1` drops the output intent** the PDF/A variants added for free,
  because accessibility says nothing about colour. `output_intent: "srgb"` is
  now sent by name and is in `REQUIRED_OPTIONS`, so an engine that stopped
  honouring it would be caught rather than silently shipping colourless files.
  `srgb` is a **keyword** the engine resolves to its own bundled `sRGB2014.icc`
  — a path matches nothing and produces no intent at all, which is what the
  first attempt did.
- **A chart was unreachable and validated clean anyway.** Probed three ways,
  only one produces a `/Figure` with `/Alt`: an inline `<svg role="img"
  aria-label>` lands under `/NonStruct`, an inline `<svg><title>` likewise, and
  a `data:` URI `<img alt>` is the only one that tags. With the drawing under
  `/NonStruct` there is no figure for a validator to demand alternative text
  for — **the document passes PDF/UA with every chart in it unreachable**. The
  validator cannot catch this one; `conformance.spec.ts` does.
- **`pdf-1.7` is not a variant the engine has.** `weasyprint.pdf.VARIANTS`
  holds eighteen names and that is not among them; asking for it raises
  `KeyError` and the service returns a 500. The Export Pipeline dialog has
  offered it as "PDF 1.7 (standard)" the whole time, so that option had never
  produced a file. It now means "send no variant", which is the engine's way of
  saying the same thing, and its default version is already 1.7.

**A PDF now names the row it came from.** `custom_metadata` copies the
document's own `<meta name=…>` tags into the file, and the render routes put
`npc-format`, `npc-render-id` and `npc-source-id` in the head. The engine
lowercases the key and strips everything that is not a letter or a digit, so
`npc-render-id` arrives as `/npcrenderid`, and the entries land in the Info
dictionary rather than the XMP packet — fine for UA, and not for PDF/A, which
requires the two to agree.

**Press marks are behind `pressMarks`, off by default**, because crop marks on
a client document read as a proof. On, the base `@page` emits `marks: crop
cross` and `bleed: 3mm`, which measured as MediaBox `-8.5 -8.5 603.8 850.4`
around a TrimBox of `0 0 595.3 841.9` — 8.5pt is 3mm, the trade convention. The
three named pages that already declare `bleed: true` only paint the field
colour and suppress the running chrome; they never extended the trim, so until
now a full-bleed obsidian cover trimmed short showed a white hairline.

**`dpi` and `jpeg_quality` stay unset, and this is the measurement.** Taken on a
document with the house cover art spliced in — a 224 KB JPEG data URI, the only
raster a report carries:

| setting | file |
| --- | ---: |
| `optimize_images` off | 320.1 KB |
| `optimize_images` on | **254.9 KB** ← ships |
| `dpi: 300` | 254.9 KB |
| `dpi: 150` | 254.9 KB |
| `dpi: 96` | 247.9 KB |
| `dpi: 72` | 218.1 KB |
| `dpi: 36` | 181.4 KB |
| `jpeg_quality: 85` | 286.7 KB |

So the cover art sits between 96 and 150 dpi on the page: 150 and 300 do
nothing at all, and anything low enough to save bytes visibly degrades the one
image a reader looks at first. `jpeg_quality` makes the file **larger** — it
re-encodes an asset that is already a JPEG, paying a generation of loss to grow
by 31 KB. `optimize_images` is worth 65 KB and is on.

**The container ships on its own deploy.** `ci.yml` builds the image to test it
and publishes nothing, so everything in this section that lives in
`weasyprint-service/` — veraPDF, `output_intent`, `custom_metadata` — reaches
production through `deploy-weasyprint-service.yml`, or by hand. The
document-side half (heading levels, tagged chart figures, `bookmark-level`,
`pressMarks`) ships with the edge functions and does not wait for it.

That split has an order to it, and getting it wrong is not cosmetic: the render
routes ask for `pdf/ua-1`, an engine that does not have that variant raises
`KeyError` and the service returns a 500 on **every** report. So the container
goes first, and the first thing to do is ask the running service what engine it
has. The whole procedure — canary, verification, rollback, the edge-function
half, and what to look for inside a delivered PDF — is
[`CONTAINER_RELEASE.md`](./CONTAINER_RELEASE.md).

## The brand mark on a generated document

`REPORT_RULES.md` §5 allows a mark on exactly two surfaces — the **cover** and
the **contact/disclaimer page** — and explicitly none in a running header, a
chapter opener or a footer. All 543 library templates now carry it on both.

### It is bound, never baked

No template embeds an asset. Each binds `{{org.mark}}` or `{{org.markMono}}`
and the deployment supplies the bytes, because `defaultAssets.generated.ts` is
blunt about the rule: *a tenant who has uploaded no mark gets no mark, not
ours.* A spec asserts no seeded schema contains `data:image` or names an image
file, and a second asserts none of them can name `npc-signature-logo`, any
`icon-*`, `apple-touch-icon`, `og-image` or `favicon` — every one of which is
the same email-signature banner with the director's mobile number burned into
the pixels.

### Two slots, because the mark is not inverted

The mark is a gold gradient and inverting it produces a muddy blue, so there is
no single lockup that works on both grounds. `org.mark` is the paper lockup and
`org.markMono` the obsidian one, and each surface binds the one its own ground
calls for — a compass cover chooses by `cover_overlay` (`field` and `band` put
the head on the field; `paper` does not), and the contact page is always
obsidian.

### Where the bytes come from

`adapters/organisation.ts` reads `whitelabel_settings.logo_config`, walks
`ASSET_FALLBACK` for the `report` and `report-mono` slots, and inlines the
result through the existing `fetchBrandAssets.ts` — the same machinery the
legacy render routes have used for a while. Inlined rather than linked:
`renderResourcePolicy` would admit a project-storage URL, but a `data:` URI is
what makes the render network-free and reproducible.

This is exposed as `applyOrganisationAndBrand(data)`, and all nine production
adapters call that single function rather than the projection directly —
because `org.*` had no producer at all for long enough that every document this
product generated printed a blank letterhead, and an adapter that can remember
the letterhead and forget the mark is the same failure waiting to happen.

**The design-system path had supplied no brand at all.** `routeReportThroughTemplate`
passes no `brand`, so every adapter built `brand: { logo: null }`; binding a mark
without this would have put an unresolved path on 543 covers, which renders as
the empty string.

### What a document does without one

Nothing. The image blocks carry `placeholder: false`, so an unbound mark renders
no frame and no grey "No image" rectangle, and the compass cover's block is
additionally page-conditional. Asserted in `brandMark.spec.ts` for all three
template shapes: exactly two marks when one is supplied, zero and no placeholder
when none is.

### The fifteen without a cover

Fifteen voice templates are deliberately cover-less — "One page, no cover", as
the Property Snapshot's own description puts it. Their first page is the face of
the document, so `brandMark()` puts the paper lockup at the head of it as a flow
item, which moves the heading down rather than printing over it. The other 528
carry it on a `cover` block.

---

## The adapter layer's contract with the router

An adapter turns a stored record into the one data object a template binds:
load the rows, run them through the format's own legacy normaliser, project
the result, add the letterhead. Nine of them are production-capable, and each
answers two questions — `resolveRoutingContext`, which is cheap and decides
*whether and as what* this record may be rendered, and `buildBindingContext`,
which does the reading.

### Null means "do not produce a document"

Every adapter's header promises the same thing: it returns `null` rather than a
document full of blanks, and the caller falls back to the legacy generator.
That promise was true of the adapters and false of the pipeline.
`routeReportThroughTemplate` read the context as `ctx?.data ?? {}` and carried
on, and because **an unresolved binding renders as the empty string rather than
as a visible `{{…}}`**, a refusal did not raise an error or print a marker: it
rendered the entire document with every field empty, uploaded it, and returned
a URL. The caller then had a successful result and never fell back, so a client
could have received a report of blank tables under their own letterhead — the
one outcome this programme's rules exist to prevent, produced by the only code
path that had no rule of its own.

The route now falls through on a null or empty context, with the adapter and
report id in the warning. An empty object is refused on the same ground rather
than a separate one: every adapter publishes at least `report` and `brand`, so
there is no record for which `{}` is the right answer.

### Routing must decline whatever binding would decline

Routing resolves first. If it resolves for a record the binding then refuses,
the operator is offered a ready-looking template that produces nothing — and,
before the fix above, something worse. `cashFlowAdapter` states the rule and
checks `hasProjections` in both methods; `commercialCapacityAdapter` shares one
loader between them for the same reason.

Two adapters did not, and one was live: **Report Q&A resolved routing for any
conversation that loaded, while its binding refuses one with no assistant turn
— 22 of the 252 stored conversations, 21 of them holding no message at all.**
It now counts assistant messages with a `head` request (a count, no body), and
refuses the `structured` subject for a conversation that stores no structured
report, which is free because the routing read already selects that column.
Market Intelligence likewise refuses a row with no payload and one whose
`status` is not `completed` — both latent across the six stored reports, both
free for the same reason.

What routing deliberately does **not** replicate is a refusal it cannot reach
cheaply: Market Intelligence's "nothing substantial to typeset" needs the build
itself, and Client Details' nine-table read can fail for reasons that are not a
property of the record. Those land on the router's refusal, which is why that
one has to be right.

### Every format now asks, and it asks in one place

`tryTemplateDocument(reportType, reportId, { variant })` is the question, and
the `deliver*` modules are where it is asked — not the buttons — because that
is where every surface for a format already meets: the download, the email
attachment, the blob a broker portal uploads. Wiring one module reaches all of
them.

It is inert until somebody activates a template (resolution matches only active
`report_templates` rows), and **every failure is a fallback, never an error**: a
refused adapter, no active template, a render that failed, a signed URL that
will not fetch, a zero-byte body. A templated document is an improvement on a
working path, so it may never be the reason somebody cannot get their file.

All eight route — seven of them by simply asking, and the Cash Flow behind the
proof described at the end of this section. The metadata each `deliver*`
returns — brand gaps, section lists, turn counts — describes the *flowing*
render, so on the templated path it is left empty and a `templated: true` flag
says why. Every caller's toast notes are already conditional, so they simply
say less rather than saying zero.

**The exceptions are documents somebody asked for by name**, and each is a
guard rather than an oversight:

| Format | Routes except when |
| --- | --- |
| Borrowing Capacity | `variant: 'legacy'` (a chosen layout), or no `assessmentId` — "most recent" is the route's job, not an adapter's |
| Portfolio | the `stored` variant (one particular existing file), or `includeReview: false` — the adapter always joins the review |
| Market Intelligence | `persist` is on — that writes the `pdf_storage_path` a scheduled email attaches, and the template route does not write it |
| Commercial Capacity | `refreshAnalysis` — a request to re-run the model, which a stored-run render cannot answer |

**The 10 Year Cash Flow routes only behind a proof**, and it is the one worth
reading twice. `requestCashFlowPdf` takes the projection *as an argument*:
`CashFlowAnalysisModal` recomputes ten years in the browser from
`manual_overrides` plus whatever the adviser has changed since it opened.
`cashFlowAdapter` reads the stored `financial_calculations.projections` — a
different series whenever an override exists, which is the normal case for the
reports that modal is opened on. Asking unconditionally would hand a client a
document whose numbers are not the ones the adviser was looking at while they
sent it, and a misread figure in a client's financial report outranks a nicer
layout.

So `storedSeriesMatch.ts` has to name a stored scenario before the question is
asked, and the modal then asks for *that* scenario — not the adapter's
`moderate` default, which would typeset the wrong series of the three. The
match is deliberately hard to satisfy, because the two mistakes are not worth
the same: refusing a series that does match costs the legacy layout, accepting
one that does not ships wrong figures. Equal lengths; every field both sides
state equal in every year (`annualRent` against the wire's `rentalIncome`);
the stored `cashFlow` equal to *the same one* of the wire's `preTaxAnnual` and
`afterTaxAnnual` in every year, because the stored series states no tax
treatment; and exactly one scenario matching, since the page prints the
scenario's name and a document labelled with an assumption nobody made is
wrong even when its figures are right.

Two facts from production shape it. All 162 stored projections carry ten years
numbered from 1 — lining up with a wire series that has already dropped its
settlement row — and **`loanBalance` is identical across all three scenarios**,
because amortisation does not depend on a growth assumption. A check on
balances alone could not tell the three apart, which is why the property value,
the rent and the cash flow are compared too. That last one is the check that
matters most: an interest-rate override moves the cash flow and leaves the
balances exactly where they were.

`cashFlowTemplateRouteGuarded.spec.ts` asserts the request stays conditional
and carries the matched scenario; `storedSeriesMatch.spec.ts` runs the whole
question against a row taken verbatim from production.
