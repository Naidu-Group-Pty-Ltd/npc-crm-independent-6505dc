# Borrowing Capacity Snapshot — the format's contract

The Snapshot is the document a client is handed when they ask *"how much can I
borrow?"*. It is the most-generated report in the product and the least
governed: five separate PDF implementations draw parts of it, three of them
carrying their own copy of the same untyped adapter, and none of them has ever
had a test.

This is the contract for the migration described in
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md). It starts as the Phase 0 output —
what the format does *today*, in numbers rather than impressions — and each
later phase adds what it settled and corrects what the previous ones got wrong.

Everything below was read from the source or measured from a captured PDF. Where
a claim comes from a rendered page, the page is named.

---

## 1. The five implementations

| | Path | Lines | Engine | Status |
|---|---|---|---|---|
| **A** | `src/components/borrowing-capacity/BorrowingCapacityPDFReport.tsx` | 1325 | jsPDF | **This is the Snapshot.** Live, 4 call sites |
| **B** | `src/utils/borrowingCapacityPdfSections.ts` | 1369 | jsPDF | Live — section pack for the Formara report |
| **C** | `src/utils/borrowingCapacityPdfLibSections.ts` | 940 | pdf-lib | Live — section pack for the Portfolio report |
| ~~**D**~~ | ~~`src/components/borrowing-capacity/BorrowingCapacityPDFSection.tsx`~~ | ~~401~~ | ~~pdf-lib~~ | **Deleted in Phase 5** — was orphaned, re-exported by the barrel, zero consumers |
| **E** | `src/components/borrowing-capacity/scenarios/StrategyRationalePDF.ts` | 718 | jsPDF | Live — the Strategy Rationale Brief |

4753 lines drawing one subject in two engines.

**D is dead code.** `src/components/borrowing-capacity/index.ts:14` does
`export * from './BorrowingCapacityPDFSection'`, so it survives tree-shaking
analysis by eye, but every one of its six exported functions has zero references
outside its own file. It is not a fallback and not a work in progress; it is a
copy of C that was never wired up. Phase 5 deletes it.

### Where A is called from

| Call site | Path |
|---|---|
| Results panel "Download PDF" | `ResultsPanel.tsx` |
| Scenario modelling export | `StrategyScenarioModeling.tsx` |
| Client card quick action | `BorrowingCapacityCard.tsx` |
| Client reports tab — download | `ClientReportsTab.tsx` |
| Client reports tab — **publish to portal** | `ClientReportsTab.tsx` |

The last one matters for Phase 4: it is the only path that does not hand the
file to the browser. It calls `generateBorrowingCapacityPDF({ returnBlob: true })`
and uploads the blob to `client-files/portal-reports/<clientId>/…`. Any
replacement must keep that contract — a blob and a filename, generated without a
download side effect.

All five now go through `SnapshotDownloadButton` or `snapshotBlob`, and A is
still what runs when someone asks for it — see §13.

---

## 2. What the document is made of

A draws 19 steps into a single `jsPDF` instance. In fixture terms, with every
conditional turned on, that is 8 pages:

| Page | Content | Conditional on |
|---|---|---|
| 1 | Cover — full-bleed raster | always |
| 2 | Client name, executive summary, three KPI tiles, utilisation bar, key assumptions, LMI panel | LMI panel: `lmi_mode !== 'none'` |
| 3 | Income analysis table, expenses & liabilities tables | always |
| 4 | Capacity breakdown ledger, recommendations, warnings | recommendations / warnings non-empty |
| 5 | How this was calculated | `explanation` present |
| 6 | Audit trail — raw vs assessed | `audit_trail.entries` non-empty |
| 7 | Scenario comparison | ≥1 non-base preset |
| 8 | Closing — contact and disclaimer | settings fetch succeeds |

Pages 1 and 8 are unnumbered; the running foot on 2–7 reads *"Page N of 6"*
(`BorrowingCapacityPDFReport.tsx:1233`, `totalPgs - 2`).

### The input

`BorrowingCapacityExportData` (`:188–199`) types `assessment` as **`any`**. In
practice it is a raw `borrowing_capacity_assessments` row, and the generator
reaches into ten or so nested shapes on it without a single guard. The type
carries no information; the real contract is spread across 1300 lines of
property access. Reconstructing it is Phase 1.

---

## 3. The golden

`src/components/borrowing-capacity/__tests__/snapshotGolden.spec.ts` renders the
shipping generator against a fictional fixture and writes
`reports/golden/borrowing-capacity-snapshot.pdf` (gitignored — a golden PDF of a
*real* assessment must never be committed, and a fixture that looks real invites
exactly that). 12 assertions pin the page count, the section titles, the
typeface and the cover's identity.

This is the first fidelity coverage on any shipping PDF path in the repo.

**The fixture must carry whole objects, not patches.** `ScenarioPreset.adjustedInputs`
is a complete `BorrowingCapacityInput` and `result` a complete
`BorrowingCapacityResult` (`StrategyScenarioModeling.tsx:174`). A partial one is
not a smaller version of the real thing — it is a different thing. Feeding
`adjustedInputs: {}` for the base case makes the generator print `Rate NaN%`,
which the product never produces. Four earlier drafts of this fixture invented
shapes — `source` for `component`, `liability` for `type`, a percentage where
the code wants a 0–1 fraction, free-text audit verbs (`shade`, `floor`) where
the engine emits `shading_applied` and `hem_benchmark_applied`, an `lmi_mode`
of `capitalised` where the column holds `debt_capitalised` — and every one
produced a page of plausible-looking wrong output. **Read the reader, not a
summary of it.**

Captured today: 8 pages, 215 KB, jsPDF 4.2.1, fonts all base-14 Type 1.

Phase 1 moved the fixture to
`src/lib/reports/borrowingCapacity/__tests__/fixtures/sampleAssessment.ts` so
the golden and the payload contract are asserted against the same assessment
and cannot drift apart.

---

## 4. Findings

Numbered so Phases 1–5 can cite them. F1–F11 came out of Phase 0; F12–F14 came
out of Phase 1, from reading the producer rather than the renderer, and F9 was
corrected there.

### F1 — The cover carries our brand into a white-label tenant's report

Page 1 is `npc-cashflow-cover.jpg`, a full-bleed raster reading **NAIDU PROPERTY
CONSULTING SERVICES / YOUR DEDICATED PROPERTY PARTNER**. The generator *does*
resolve the tenant's own name at `:216–220` into `__brandLine1` / `__brandLine2`
— and then uses it **only in the `catch` branch**, when the image fetch fails.

So a tenant configured as "Meridian Property Partners" ships a document whose
cover says Naidu and whose closing page (page 8) says Meridian. One document,
two identities, and the wrong one is on the front. Verified on the captured
golden: page 1 vs page 8.

The fallback is not clean either: it prints the tenant's name in a gold that
appears nowhere else (`#C9A55A`, see F7) and then hard-codes **NPC's own
tagline**, "YOUR DEDICATED PROPERTY PARTNER", underneath it (`:250`).

The cover also carries no client name, no report title and no date. It is a
brand plate, not a cover.

### F2 — The audit trail formats interest rates as currency

Page 6 renders every `rawValue` / `assessedValue` / `delta` through `fmt()`
(`:45–49`), which unconditionally prefixes `$` and rounds to zero decimals.
`audit_trail.entries` includes `policy` entries, and
`calculate-borrowing-capacity/index.ts:1641–1642` pushes the **interest rate
override** through that category:

```ts
audit.add('policy', 'override_applied', 'Interest Rate Override',
          activePolicy.loanDefaults.interestRate, overrides.interestRate, 'Manual override')
```

On the golden, page 6, that renders as:

> Assessment rate  ·  **$6** → **$9**  ·  **+$3**  ·  Servicing buffer 2.5%

for 6.15% → 8.65%, +2.50%. A lending document is telling the client their
assessment rate is nine dollars. The unit belongs to the entry, not to the
column, and Phase 1 must carry it.

### F3 — Fixed column positions collide

Two confirmed on the golden, both from hard-coded x offsets with no width check:

- **Liabilities table, page 3.** `Balance` right-aligned at `MARGIN+140` and
  `Monthly Repayment` right-aligned at `MARGIN+174` render as
  **"BalanceMonthly Repayment"**.
- **Scenario table, page 7.** `Band` left-aligned at `MARGIN+145` and `Change`
  right-aligned at the margin overlap for every row: **"STRONG+$27,000"**,
  **"MODERA⌷$81,000"** (`:1081`).

These are deterministic, not data-dependent — the widest legitimate band label
and the widest legitimate change value do not fit between those two constants.

### F4 — Text is clipped rather than wrapped

Page 2, key assumptions box: *"Selected Lender: Example Bank — Investor P&I"*
runs past the panel's right edge and off the content area. `doc.text` without
`maxWidth` does not wrap and does not clip — it simply draws past whatever was
meant to contain it.

Page 5 has the inverse: the explanation callout's text is given a `maxWidth`
around half the box it sits in, leaving the right half of a full-width panel
empty.

### F5 — Contrast: seven of nine colour pairs fail

Measured from the constants at `:26–40` (WCAG 2.1 relative luminance):

| Ratio | | Pair |
|---:|---|---|
| 2.62:1 | **fail** | white on `GOLD` — the "Maximum Borrowing Capacity" band, page 4 |
| 2.15:1 | **fail** | `AMBER` on white — the MODERATE band label and every warning |
| 1.94:1 | **fail** | `AMBER` on `AMBER_LIGHT` — "Capitalised to Loan", page 2 |
| 3.30:1 | large only | `GREEN` on white — every surplus and positive delta |
| 3.33:1 | large only | `GRAY` on `GOLD_LIGHT` — the scenario note |
| 3.76:1 | large only | `RED` on white — every negative currency value |
| 3.95:1 | large only | `GRAY` on white — the running foot |
| 11.90:1 | pass | `BODY_TEXT` on white |
| 14.98:1 | pass | `NAVY` on white |

The "large only" exemption does not apply: those seven are drawn at 7–8 pt. And
this is a document that gets **printed** — on paper there is no display gamma to
rescue a 2:1 pair.

Category B of the design system exists for exactly this. `PRINT_SEMANTIC`'s
`positive` `#157A3A`, `caution` `#856514` and `negative` `#D31212` are the
contrast-checked equivalents, and they are frozen — unreachable from tenant
input — so no brand override can reintroduce this.

### F6 — Red and green track the arithmetic sign, not the client's interest

Page 6: the HEM floor adds $700 to assessed expenses — which **reduces**
capacity — and renders **green, "+$700"**, because the delta is positive.
Rental shading renders red because its delta is negative, and it also reduces
capacity. Same effect, opposite colour.

Page 2: capacity utilisation at 97% draws a **red** bar directly above a
narrative sentence saying the loan *"falls within the assessed borrowing limit"*.

Colour is doing arithmetic when it should be doing meaning.

### F7 — Three golds, two ambers, and none of them is the brand

| Value | Where |
|---|---|
| `#BF9B50` | A (`GOLD`), B, E |
| `#C9A55A` | A — a *second* gold in the same file |
| `#C9A326` | C, D (`NPC_GOLD`) |
| `#F59E0B` | A, B, C, D — amber |
| `#D97706` | E — a different amber |

The brand gold is **`#D9A520`** (`tokens.pure.ts:71`), and its on-paper type
colour is `#8E6C15`. None of the five implementations uses either. A also
carries two brown-golds (`#644114`, `#785A1E`) for text on tinted panels — hand-
darkened approximations of exactly what `brand.onPaper` already is.

Navy is the one thing they agree on: `#0D264D` in all five.

### F8 — 100% Helvetica

64 `setFont('helvetica', …)` calls in A, 72 in B, 40 in E. `pdffonts` on the
golden lists only base-14 Type 1 faces. There is no brand typeface anywhere in
the document — not on the cover plate (which is baked into the raster), not in
the headings, not in the figures.

Figures are also set in a proportional face, so columns of currency do not align
on the digit. The Phase 4 container ships Cinzel, Playfair Display, Inter and
IBM Plex Mono precisely so this stops being true.

### F9 — The same adapter, written three times

> **Corrected during Phase 1.** This finding was originally written as *"the
> three implementations disagree on field names"*, from a survey rather than
> from the source. They do not. All three read `component` first and treat
> `shadingRate` as a 0–1 fraction, which matches `calculateIncomeBreakdown`
> (`calculate-borrowing-capacity/index.ts:755`) — the only producer. The real
> finding is worse in a different way.

The normalisation exists **three times**, character-for-character:

```ts
label:        item.component  || item.label            || item.source_name        || 'Income',
grossAmount:  item.grossAmount || item.gross_annual_amount || 0,
shadingRate:  item.shadingRate || item.custom_shading_rate || item.default_shading_rate || 1,
shadedAmount: item.shadedAmount || (item.grossAmount || 0) * (item.shadingRate || 1),
```

— inline in A's draw loop (`:602–605`), and again in private adapters in B
(`:1171–1174`) and C (`:791–794`). The liability adapter is duplicated the same
way (A `:667–674`, B `:1198–1204`, C `:803–809`).

Three copies of one fallback chain means three copies of F10's bug, and any
future field the producer adds has to be remembered in three places. This is
what Phase 1 replaces: `normalise.pure.ts`, once, with `??`.

### F12 — The audit trail and the explanation never render in a shipping PDF

`calculate-borrowing-capacity` builds `auditTrail` and `explanation` and returns
them in its response (`index.ts:1935–1936`). Its `insert` into
`borrowing_capacity_assessments` (`:1948–1983`) does **not** write them, and
there is no column for either.

Every generator reads them off the stored row — A at `a.auditTrail` and
`a.explanation`, in camelCase, from a table whose columns are all snake_case.
`fetchLatestBorrowingCapacity` returns the row unchanged; the What-If override
builder (`StrategyScenarioModeling.tsx:1337`) does not supply them either. So
across all five call sites, both are always `undefined`.

**Pages 5 and 6 of the golden — around 230 lines of the generator — have never
appeared in a document a client received.** They are also the two pages that
would actually explain a lending decision. The data exists; it is computed on
every assessment and thrown away.

### F13 — The liability audit row subtracts a monthly repayment from a balance

```ts
audit.add('liability', action, l.type, l.balance || 0, l.monthlyServicing, `$${…}/mo servicing`)
```

`rawValue` is a **balance** ($412,000) and `assessedValue` is a **monthly
repayment** ($2,480). `AuditTrailBuilder.add` computes `delta = assessedValue -
rawValue` regardless, and the report prints the resulting −$409,520 in the Delta
column as though it were a quantity.

Both sides are money, which is why one currency formatter makes it look
plausible. They are not the same unit.

The same table mixes periods: `income` and `tax` entries are annual, `expense`
and `property` entries are monthly, and all four are printed in one column with
the same `$` and no period.

### F14 — An entry that carries no numbers is printed as `$0 → $0`

`audit.add('policy', 'lender_profile_selected', 'Lender Profile', 0, 0, activePolicy.name)`
records **which** lender policy was used. Its two zeroes mean "not applicable".
Rendered through the currency formatter they state a fact that is not true.

### F10 — `||` swallows legitimate zeros

`:604`: `const rate = item.shadingRate || item.custom_shading_rate || item.default_shading_rate || 1`

A genuine `shadingRate: 0` — income the lender does not count at all — falls all
the way through to `1` and is reported to the client as **fully assessed**. The
same pattern appears at `:1162` (`acq.maxPurchasePrice || 0`) and throughout.
`??` is the correct operator in every one of these positions.

### F11 — The closing page can vanish without a trace

`:1213–1218` wraps the disclaimer page in a `try` whose `catch` only
`console.warn`s. If the settings fetch fails, the document ships **without its
disclaimer** — and the footer arithmetic at `:1222–1233` still subtracts two
chrome pages, so the last content page silently loses its page number and the
denominator is one short.

A general-advice disclaimer is not decoration on a lending document.

---

## 5. What Phase 1–5 must preserve

The migration is free to change everything about how this document looks. It is
not free to change these:

1. **`{ blob, fileName }` when `returnBlob: true`.** `ClientReportsTab.tsx:559`
   uploads that blob to the client portal.
2. **The filename shape.** `Borrowing_Capacity_Snapshot_<SafeName>_<yyyy-MM-dd>.pdf`.
3. **Every section listed in §2**, under every one of its conditionals. The
   golden's page-count assertion is what catches a dropped audit trail.
4. **The four download call sites**, which pass `(clientId, clientName,
   scenarioPresets?, overrides?)` and expect a browser download.
5. **The numbers.** Phase 0 asserts no arithmetic; Phase 1 lifts the computation
   into a pure module and pins it, and the golden's figures are the reference.

## 6. The payload contract (Phase 1)

Canonical in `supabase/functions/_shared/reports/borrowingCapacity/`, bridged
into `src/lib/reports/borrowingCapacity/` by one-line `export *` files, and held
to that shape by `borrowingCapacitySourceOfTruth.spec.ts` — the same guard the
design system has, for the same reason. A format that already exists five times
does not need a sixth copy that started life as "the frontend's version".

| Module | What it settles |
|---|---|
| `measure.pure.ts` | `Measure = { value, unit }`. Nine units, each read off a real value. Formatting is per-unit, so an interest rate cannot render as money (F2, F14) |
| `audit.pure.ts` | The unit **and** the polarity of every `(category, action)` the engine emits (F2, F6, F13) |
| `payload.pure.ts` | `BorrowingCapacitySnapshot` — every figure a `Measure`, every absence a `null` |
| `normalise.pure.ts` | Row → payload, once, with `??` (F9, F10) |

### Three things worth knowing about it

**Nothing is a bare number.** `Measure` carries its unit to the page. The unit
list distinguishes `percent` (`8.65` → `8.65%`) from `rate` (`0.8` → `80%`),
because shading is stored as a fraction and interest rates are not; and
`aud` from `aud/month` from `aud/year`, because F13's delta is only nonsense
once you can see that its two sides are different units. `subtract` returns
`null` across units rather than a number, and a `null` delta renders as an em
dash.

**Direction is not the sign of the delta.** `auditDirection` reads a polarity
table keyed by action: *does a larger `assessedValue` help this client?* A HEM
floor has a positive delta and is `adverse`. Polarity flips **within** the tax
category — `tax_calculated` reports after-tax income, `medicare_levy_applied`
reports the levy charged — which is why the table is keyed by action and not by
category. Phase 2 maps `favourable`/`adverse`/`neutral` onto `PRINT_SEMANTIC`;
Phase 1 only decides which is which.

**The polarity table is checked against the engine.** A table of strings written
in one file and consumed in another goes stale silently, and the failure mode
here is a new audit entry rendering grey and unitless in a client's report.
`audit.spec.ts` parses `calculate-borrowing-capacity/index.ts` — balanced-paren
argument extraction, because the actions arrive as template literals and
ternaries — and asserts both directions: every pair the engine emits is known,
and every pair known here is still emitted. It found the 15 that exist.

87 tests across the four modules. The fixture they run on is shared with the
Phase 0 golden (`src/lib/reports/borrowingCapacity/__tests__/fixtures/`), so the
payload and the capture cannot drift apart.

## 7. The document (Phase 2)

`sections.pure.ts` decides the structure; `render.pure.ts` turns the payload
into HTML through the design system. Nothing else was added — every element on
the page is a design-system primitive, so the format has no stylesheet, no
colour and no geometry of its own.

**Structure is checkable before it is drawn.** `snapshotSpine` builds a
`borrowing-capacity` spine from the payload, and `validateSnapshotSpine`
reports a section with no title, a non-positive budget, a slot the archetype
does not permit, or a total outside its [4, 12] band. `renderBorrowingCapacityDocument`
throws on a bad spine rather than emitting a document — there is no fallback
renderer on this path, so an error whose message names the problem beats a PDF
a client opens.

**F3 and F4 stop being possible rather than being fixed.** They were both
consequences of drawing at hard-coded millimetre offsets. A table declares its
columns and the engine measures them; a test asserts the output contains no
`position:`, `left:` or `top:`.

**F5 likewise.** The body markup names no colour — asserted, with the one
permitted `style` attribute being the cover's background image.

**F6 is answered in words, not colour.** The audit table carries an **Effect**
column that reads "Reduces" or "Increases", under a sentence saying what that
means. Colour was carrying that meaning and carrying it wrong; words also
survive a monochrome printer and a reader who cannot separate red from green,
which on a document about someone's borrowing is not a small consideration. The
one table that still colours by sign is the capacity ledger, and a test asserts
the invariant that makes it safe there: every `adverse` line is also negative.

### What the first real render found

Rendered through WeasyPrint and read page by page — which is the only way most
of this surfaces.

1. **A direction bug in Phase 1's own module.** The audit page said a credit
   card *increases* borrowing capacity. `auditDirection` trusted the engine's
   `impact`, and for a liability row `impact` is the sign of a monthly repayment
   minus a balance (F13) — meaningless, and negative. Fixed: when the two sides
   are not comparable there is no movement to read, and the action's polarity
   answers on its own. A cost is adverse.
2. **A two-column grid tore across a page break.** `renderGrid12` lays out as a
   CSS table and a table cell cannot split, so the left column moved whole to
   the next page while the right column stayed. The assessment terms printed a
   page after the sidenote they were beside. The grid is gone from that section.
3. **Two contradictory rules in the shared stylesheet.** `table.data` carried
   `page-break-inside: avoid` *and* `thead { display: table-header-group }` —
   the second exists so a table can repeat its head when it breaks, which the
   first made impossible. Consequences: a table that did not fit moved whole and
   left a hole, and **a table longer than one page could not break at all**, so
   a client with thirty liabilities would lose rows off the bottom. Now tables
   break, rows do not split, and a caption never strands from its first row.
4. **Figures wrapped mid-number.** `-$10,600 pa` rendered as `-` on one line and
   `$10,600 pa` on the next: line-breaking treats the minus and the space before
   a period suffix as break opportunities. Numeric cells are now `nowrap`, and
   the space before `pa` is non-breaking.
5. **Five tables where one belonged.** One table per audit category repeated a
   six-column header five times in half a page, and each block broke
   independently. One table now, with the category in the item label.
6. **Repeating a period on every row.** A column of `$124,000 pa`, `$42,000 pa`
   … states the period forty times. `periodLabel` puts it in the header once and
   `formatAmount` leaves it off the cells — but only under a header that says
   it. The audit table mixes annual and monthly rows in one column, so there
   every value still carries its own.
7. **KPI labels that wrapped dropped their own values.** A two-line label pushes
   its value down while its neighbours stay put and the strip's baselines stop
   lining up. Labels are short now.
8. **`hem_benchmark` title-cased to "Hem Benchmark"**, which reads as a surname.
   `titleCase` knows the acronyms.
9. **The company name printed twice on the cover** — once as the masthead, once
   as "Prepared by". And the running head's eyebrow said `Section 01`, 150px
   above a chapter header saying `SECTION 01`.
10. **"over a 30 years loan term"** in the executive summary.

The full fixture renders **10 pages**, and the spine claims 10 — a test asserts
the claim, so the two can disagree loudly rather than silently.

### Deliberately not done here

- **No charts.** `charts.pure.ts` has the bullet, waterfall and donut this
  document wants — the utilisation bar, the capacity ledger, the income mix.
  They arrive in Phase 5 with the golden diff.
- **No brand snapshot.** The palette, the company block and the cover art are
  inputs. Phase 3 resolves them from a snapshot so a re-issued report reproduces
  the brand it was issued under.

## 8. The brand (Phase 3)

One input decides what the document looks like: a `ReportBrandSnapshot`.
`brand.pure.ts` turns it into the palette, the company block, the running-foot
masthead, the cover lockup and the confidentiality line;
`renderSnapshotFromBrand` is the entry point the render path uses.

**F1 is answered by construction.** The tenant is on the cover, in the running
foot of every page and on the closing page, from one resolution. There is no
branch where our name can appear — a test walks the whole document for "Naidu",
our tagline, and the first 120 characters of `NPC_HOUSE_COVER_ART` and
`NPC_HOUSE_MARK`.

The house cover art is deliberately unreachable. Its own doc comment in
`defaultAssets.generated.ts` says it must never be a white-label fallback: it is
not a photograph, it is a finished NPC cover with our company name, tagline and
monogram burned into the pixels. A tenant with no cover art gets the typographic
cover — a designed state, not a gap.

**F7 is closed for this format.** `#C9A55A` — the fallback cover's gold in
`BorrowingCapacityPDFReport.tsx`, one of three across the five implementations
and none of them the brand — now comes from `accentOnField`, the role the design
system contrast-checks for brand type on a dark ground. A test reads all four
generator files and fails on the literal. The same line also carried NPC's
tagline hard-coded under the tenant's name; that is gone too.

**A re-issued report reproduces the brand it was issued under.** That is the
reason a snapshot exists rather than a lookup: the same snapshot produces
byte-identical HTML, a changed one does not, and the fingerprint moves with it.

**Gaps are reported, not thrown.** `renderSnapshotFromBrand` returns
`{ html, gaps }`. A report with no ABN is a worse report, not an impossible one,
and refusing to render would turn a cosmetic gap into an outage. Phase 4 decides
where those lines are logged.

### What the tenant render found

The first tenant-branded render put a **22mm red block** on the cover. The
fixture mark was a 1×1 PNG, and it passed every check the asset policy had:
`data:` URI, allowed MIME, well-formed base64, under the byte cap. Nothing
looked at how big the picture was.

That is not a fixture problem. `logo_config` accepts whatever a tenant uploads,
and a favicon uploaded as a report mark prints at 22mm on the cover and 13mm on
paper. `assets.pure.ts` now reads the pixel dimensions out of the header — PNG
from its `IHDR`, JPEG by walking the marker chain past any EXIF or ICC block to
the first frame header — and rejects below a 96px floor with the measured size
in the reason, so the fallback chain walks on to the next mark the tenant did
upload. WebP returns "cannot measure" rather than a guess, and an unmeasurable
asset is accepted: refusing to print a logo whose header would not parse is
worse than printing one that might be small.

## 9. The render path (Phase 4)

`render-borrowing-capacity-pdf` generates the document server-side. The caller
sends a client id; everything the document says is read here.

That is the whole difference from `render-template-pdf`, which accepts HTML. For
a document that tells someone how much they can borrow, the contents are not the
browser's to decide — and a test asserts the route ignores a `clientName`, an
`html` or a `capacity` a caller tries to send.

| | |
|---|---|
| **Auth** | `verifyAuthOrNativeUser` establishes a human — the gateway JWT check is off across this project for the custom session flow, and the service-role identity is refused because it is not a person. Then `canAccessClient` establishes *this* human against *this* client. Authentication is not authorisation: every staff member is authenticated. |
| **Brand** | `buildReportBrandSnapshot` from the tenant's settings, then `upsert_report_brand_snapshot`, which dedupes by content fingerprint — a tenant rebrands a few times a year and renders thousands of reports. |
| **Resources** | `assertSafeRenderResources` runs on HTML this function built itself. The assets in it came from a tenant's settings form; the guard belongs on the boundary, not on the trust. |
| **Render** | `_shared/weasyprintClient.ts`. No fallback: if WeasyPrint fails, this fails. A silent downgrade ships a client a document nobody approved. |
| **Storage** | `client-files/borrowing-capacity/<clientId>/<day>/<uuid>-<file>.pdf`, `upsert: false`. The random segment is why: without it a second render on the same day overwrites a file someone may already hold a link to. |
| **Signing** | 24 hours — long enough to email, short enough to expire. |
| **Record** | Every attempt writes a `borrowing_capacity_renders` row, including failures with their reason. That is the difference between "the client says the PDF never arrived" and an answer. |

The filename is unchanged, byte for byte:
`Borrowing_Capacity_Snapshot_A____J__Sample_2026-08-01.pdf`. Four underscores,
one per non-alphanumeric — the existing rule, kept exactly, because five call
sites and a client's downloads folder depend on it.

### F12, decided: persist

`calculate-borrowing-capacity` now writes `audit_trail` and `explanation` to the
row it already inserts (migration `20260814000000`). The alternative was to
recompute them at render time, and that is worse: a recomputation runs against
today's policy and today's HEM benchmark, so the audit trail could disagree with
the headline figures printed beside it on the same page. **A report must explain
the numbers it is showing, not different ones.**

The write is a separate `UPDATE` rather than two more fields on the `INSERT`, so
deploy order does not matter — run the function against a project that has not
had the migration applied and it warns instead of failing every capacity
calculation.

### F8, closed and measured

`pdffonts` on the real document, rendered by the same code the route runs:

| Face | Embedded |
|---|---|
| Cinzel Bold | yes |
| Playfair Display · SemiBold · Italic | yes |
| Inter · Medium · SemiBold | yes |
| IBM Plex Mono · Medium · Bold | yes |

Ten faces, **zero base-14 substitutions**, every one embedded. The shipping
generator sets the entire document in Helvetica — 64 `setFont` calls in
generator A alone.

CI asserts it rather than trusting it: the `render-container` job now builds the
Snapshot, POSTs it to the container it just built, and fails if any of the four
families is missing from `pdffonts` — a substituted face still yields a valid
PDF, so the bytes prove nothing. The same step asserts the page count, because a
migration that drops the audit trail changes nothing a unit test sees.

### One thing that moved outside this format

`render-template-pdf` carried its own WeasyPrint call, its own timeout, its own
handling of the two environment variable names the token can live under, and its
own idea of what a non-200 means. A second render path needed all four.
`_shared/weasyprintClient.ts` is now the one place, and both paths use it.

### To deploy

1. Apply `20260814000000_borrowing_capacity_render_path.sql`.
2. Deploy `calculate-borrowing-capacity` (it starts storing the audit trail) and
   `render-borrowing-capacity-pdf`.
3. Nothing calls the new route yet. Phase 5 switches the call sites over, after
   the golden diff.

## 10. Charts, the diff, and what was deleted (Phase 5)

### Three charts, and two that were drawn and removed

| | Where | What it shows the table cannot |
|---|---|---|
| **Utilisation bullet** | Capacity at a glance | Position against a limit. The bar is the proposed loan, the marker is the capacity — so over-limit reads as the bar crossing the line. The shipping report draws a red bar at 97% directly above a sentence saying the loan falls *within* the limit (F6). |
| **Income donut** | Income and commitments | Proportion, after shading. A component the lender counts none of does not appear, because it carries none of the serviceability. |
| **Headroom bars** | How the capacity is built | Assessed capacity, stress-tested capacity and the proposed loan on one axis — a comparison the reader currently makes in their head across two pages. |

The two that were removed are the more useful half of this phase:

**A waterfall of the monthly build-up.** Assessed income $14,283/mo, less
expenses, less commitments — a total of about **$8,150** against the **$1,840**
surplus printed directly under it. The engine's surplus is after tax and after
property cashflow, and the payload does not carry those as monthly steps. There
is no version of that chart built from figures that reconcile, so there is no
chart. A picture that disagrees with the number beside it is worse than no
picture, and this one was drawn, rendered and read before that was obvious.

**Bars of the scenario capacities.** The scenario table already sorts and
compares exactly those three numbers. Bars of them beside it are decoration, and
they cost a page.

Captions are labels, not sentences — `figcaption` is uppercase mono micro, which
is a caption face. The first charted render set a two-line sentence in it.

### The colour assertion got stronger, not weaker

Charts carry colour in the markup: an SVG `fill` cannot be a class. So the F5
test is no longer "no colour" but the property that actually matters — **every
hex and every `rgba` in the document traces to a palette value**. A colour the
format chose for itself is exactly what put three golds and two ambers in the
shipping generators (F7), and that is what this catches.

### The golden diff

`goldenDiff.spec.ts` renders the replacement from the same fixture the Phase 0
capture used and asserts both halves of a migration:

- **Nothing was dropped.** Every section, every headline figure, and each
  subject the golden's byte stream contains.
- **The defects are gone.** Each assertion checks the golden *still exhibits*
  the defect before checking the replacement does not — so if the capture ever
  stops exhibiting one, the comparison fails loudly rather than becoming
  vacuous.

Skipped rather than failed when the golden is absent: a missing artefact on a
fresh clone is a missing artefact, not a regression, and failing on it trains
people to ignore the suite.

The full fixture is **11 pages**, and the spine claims 11. CI renders it inside
the container it just built and asserts both the page count and the embedded
faces.

### Deleted

`BorrowingCapacityPDFSection.tsx` — 401 lines, six exported functions, **zero
references** outside its own file. It was re-exported by the barrel, which is
what kept it looking alive. It was a copy of generator C that was never wired
up. Gone, with its barrel line.

Generators B and C stay: they are section packs inside the Formara and Portfolio
reports, and retiring them means migrating those formats, which is their own
work and not this one.

### Deliberately not done: the call sites still use the old generator

`requestBorrowingCapacitySnapshot` is built and tested — one call behind every
button, with a fallback that triggers **only** when the function is missing, and
says so.

The switch itself is not in this phase, and that is a deliberate call rather
than an omission: `render-borrowing-capacity-pdf` has to be deployed and
migration `20260814000000` applied before it can answer, and both are manual.
Merging the switch first would break every download button in the product until
those two steps happen.

The fallback's boundary is the part worth reading before switching. It fires on
a missing *function* and on nothing else — not on a bare 404, because the route
answers `404 not found` for a client the caller may not see, and a rule that
read "404 means not deployed" would hand that caller the legacy document for a
client they were just refused, generated in their own browser from data they
were refused.

**After deploying**, each call site becomes:

```ts
const { url, fileName, source } = await requestBorrowingCapacitySnapshot(
  { clientId, clientName, scenarioPresets },
  () => fetchAndGenerateBorrowingCapacityPDF(clientId, clientName, scenarioPresets, undefined, { returnBlob: true }),
);
```

and once every site is switched and the function is confirmed live, the fallback
argument comes out and generator A goes with it.

## 11. Phase map

| Phase | Delivers |
|---|---|
| **0** ✅ | This document, the golden capture, and the audit above |
| **1** ✅ | One payload contract — pure, typed, tested; units and direction carried on values (F2, F9, F10, F13, F14) |
| **2** ✅ | The document through the design system — structure, primitives, spine (F3, F4, F5, F6) |
| **3** ✅ | Driven from a brand snapshot; the cover stops being a raster (F1, F7) |
| **4** ✅ | The render path — route, auth, storage, signing; brand typefaces (F8); F12 decided (persist) |
| **5** ✅ | Charts, golden diff against this capture, generator D deleted, the client caller built |

---

## 12. Why it still had not rendered once

Phase 5 finished, the route was deployed and migration `20260814000000` applied —
and `borrowing_capacity_renders` was **empty**. Reproducing the route's own
pipeline against a real assessment row and the real `whitelabel_settings` found
three defects that no test and no type checker could see.

**F15 — `xmlns` read as a network reference.** `assertSafeRenderResources`
matched `xmlns="http://www.w3.org/2000/svg"` with its URL token pattern and threw
*"Remote render resources must be normalized into project storage"*, naming
nothing. Every chart this format added in Phase 5 opens with that declaration, so
the guard rejected the whole document on every request — before the render row was
written, which is why the table stayed empty. A namespace URI is an identifier;
WeasyPrint compares it as a string and never fetches it.

**F16 — `//` inside a base64 payload read as a scheme-relative URL.** The base64
alphabet contains `/`. A 240 KB inlined logo contains `//` essentially always, so
the shape `assets.pure.ts` *requires* — a `data:` URI, never a URL — was the one
shape that could not pass the guard. Only the opaque base64 form is skipped now; a
non-base64 `data:` URI still carries percent-encoded text that can name a host.

**F17 — `global_report_settings` read as though it had columns.** The route
selected `contact_details, disclaimer`; the table is `(setting_key, setting_value
jsonb)`. The select errored, the error was never read, and every Snapshot would
have carried no ABN, no phone, no address and the house disclaimer instead of the
firm's. `render-investment-report-pdf` has always read it correctly; the route now
reads it the same way.

**And the bytes behind the logo.** `assets.pure.ts` says "something else reads
them" and nothing did — `whitelabel_settings.logo_config` holds storage URLs, so
every asset arrived as `not-a-data-uri` and the document carried no company mark
at all. `reportDesign/fetchBrandAssets.ts` is that reader: project-storage
origins only, the same rule the render guard applies to finished HTML, one step
earlier, and a failure is a note rather than a thrown request.

With all four fixed the pipeline returns no brand gaps, passes the guard, and
renders an 8-page A4 PDF with the tenant's own mark on the cover.

### What this says about the phases

Every one of these is a runtime fact about production data. Phases 1–5 were
verified by rendering, but always against a fixture; the fixture had no tenant
logo, no key/value settings table and — until Phase 5 — no SVG. The lesson is the
one Phase 0 already recorded about `Rate NaN%` being a fixture artefact, pointed
the other way: a fixture that is easier than production hides defects as reliably
as one that is wrong invents them.

---

## 13. Both renderers ship

The Snapshot has two renderers and the product offers both. This section is the
contract for that, because it is the thing a future change is most likely to
break by accident.

### What went wrong the first time

Phases 1–5 built the server-side path, and the front-end wiring that followed
treated the in-browser generator as a **deployment fallback**: reached only when
`render-borrowing-capacity-pdf` was absent, and never otherwise
(`requestSnapshot.ts`, `looksUndeployed`). That was the right shape for landing
the new path — it meant merging could not break a button — and the wrong one to
leave in place. The moment the function was deployed, generator A became
unreachable from every surface in the app. Nobody decided to retire it. It would
simply have stopped happening, and the first anyone would have known is a client
asking why their report looks different.

### The shape now

`deliverSnapshot({ variant })` takes the choice as a parameter:

| Variant | What runs |
|---|---|
| `server` | `render-borrowing-capacity-pdf`, with the undeployed-function fallback still in place |
| `legacy` | Generator A, directly. No request, no fallback logic |

`SnapshotDownloadButton` is the one control that produces this document, and it
offers both — as a split button where there is room for one and as a compact
menu where there is not. It renders **one** `choices` block for both appearances,
so the legacy item cannot be present on the panel and missing from the card.

The narrow undeployed-function fallback stays on the `server` variant. It answers
a different question — "the route is not there yet" — and it is deliberately
strict: a 500 from a deployed route must surface as a failure, because falling
back on it would hide a broken render behind a document that looks fine.

### The one place the two documents genuinely differ

The scenario modeller exports with `buildPdfOverrideAssessment(scenarioInputs,
scenarioResult)` as the base — the adviser's **unsaved** what-if inputs. The
server route reads the assessment from the database and will not take a capacity
figure from a browser, which is the decision §1 of this document rests on and is
not one to reverse for one button.

So there, the two renderers answer different questions and the menu says so:

- **Export PDF** — the saved assessment, with the live what-if beside it in the
  scenarios table (the transient preset travels in `scenarioPresets`).
- **Export PDF (live what-if)** — generator A, drawing the unsaved inputs as the
  base.

Both are correct; neither is a fallback for the other. Picking for the adviser
would have meant picking wrong for half of them.

### What holds it in place

| Guard | Asserts |
|---|---|
| `legacyPathStays.spec.ts` | Generator A and the other three live implementations still exist; every one of the five surfaces routes through the shared control or helper and hands it a legacy generator; the control offers both choices in both appearances |
| `SnapshotDownloadButton.spec.tsx` | Picking an option runs *that* renderer; the fallback is announced rather than reported as success; a request function is evaluated at click and not at render |
| `deliverSnapshot.spec.ts` | `variant: 'legacy'` never reaches the server; a signed URL is fetched rather than followed; object URLs are revoked |

The first of those was verified by deleting a `legacy` prop and watching it fail
with the message a reader would need. A guard that has never failed is a guess.

### The three other live implementations

B (`borrowingCapacityPdfSections.ts`), C (`borrowingCapacityPdfLibSections.ts`)
and E (`StrategyRationalePDF.ts`) are untouched by any of this. Two are section
packs for other reports and one is the Strategy Rationale Brief; none is
superseded by the Snapshot's render route, and deleting one because "the Snapshot
moved" would take a different document down with it. `legacyPathStays.spec.ts`
asserts all three are still present, which is the cheapest possible protection
against exactly that mistake.

---

## 14. F18 — the 404 that was a typo

After §12's three fixes, the route was deployed and still returned
`{"error":"not found"}` on every attempt, and `borrowing_capacity_renders` was
still empty.

**The route selected columns that do not exist.**

```ts
supabase.from('clients').select('id, first_name, surname, company_name')
```

`clients` stores a primary and a secondary applicant — `primary_first_name`,
`primary_surname`, `secondary_first_name`, `secondary_surname` — and has no
company name at all. PostgREST answered `column clients.first_name does not
exist`, supabase-js returned `{ data: null, error }`, and this line turned that
into a 404:

```ts
if (!clientRes.data) return json({ error: 'not found' }, 404);
```

For every client in the database, on every request, before the render row was
written. Every other edge function in the repo reads `primary_first_name,
primary_surname`; the two report renderers were the only ones that did not.

### Why it looked like a permissions problem

"Not found" is what this route says when `canAccessClient` refuses, and that
check is genuinely fragile here: 759 of 766 clients have a null `created_by` and
all 766 have a null `assigned_team_user_id`, so access rests entirely on the
superadmin branch. Hours can go into that before anyone questions the read
underneath it. (It was fine — all four active staff are `super_admin` in
`custom_users` and `superadmin` in `user_roles`, and `canonicalizeRole` maps
both.)

### The three fixes

1. **`_shared/clientName.ts`** — one constant and one function for reading a
   client's name, so a third format cannot invent a fourth spelling. It also
   holds the `smartCapitalize` rule, which matters more than it sounds: names in
   this database are stored lower-case (`rugesh naidu`), and a cover should not
   print them that way or shout them back.

2. **A failed read is no longer a missing row.** Both reads are checked for
   `error` before `data`, and an error is thrown with the message the database
   gave. This is the third time in this function that a select naming the wrong
   thing has been silently converted into something else — the disclaimer (F17),
   the contact block (F17) and now the client. It cannot happen a fourth time
   without saying so.

3. **`render-cash-flow-pdf` had the identical select**, copied from this route.
   Non-fatal there — the cover simply lost its "prepared for" line — which is
   exactly why nobody would have found it.

### What holds it

`src/lib/reports/__tests__/clientName.spec.ts`: the constant names the four
columns the table has and none of the three it does not; the helper is tested
against the rows production actually holds, joint applicants included; both
routes must use the shared constant and may spell no client column themselves;
and the borrowing capacity route must check `error` before `data`. Verified by
putting the old select back and watching it fail.

Every column both routes name was then checked against
`information_schema.columns` — all present — and the `upsert_report_brand_snapshot`
RPC's six parameter names against `pg_get_function_identity_arguments`. String
keys into a database are exactly what the type checker cannot see, so they were
checked the only way that means anything.

## 15. The cover names the applicant

F1 said of the legacy cover that it "carries no client name, no report title and
no date. It is a brand plate, not a cover." The design-system cover fixed two of
those three. It carried the conclusion as its title (`{{capacity.bandLabel}}`)
and the date on the locations line, and its eyebrow read "Borrowing capacity
snapshot" — which the cover already says twice, in `wordmarkBottom` and in the
top-right `marker`. The one thing a cover is normally expected to carry, whose
assessment it is, was nowhere on the page.

### Why it had not been done

`borrowingCapacityProjection.pure.ts` recorded `client.*` as deliberately
absent: "the row carries `client_id`, not a name. Resolving it is a join the
caller can do; guessing is not." That was right, and the caller never did the
join — so nothing published a name and no template could bind one.

The catalogue spec then froze the consequence, asserting that only the Portfolio
Review may bind `{{client.name}}` because "the other three source tables have no
such column". True of the assessment row; incomplete as a statement about what
is reachable.

### What the record holds

| | |
| --- | --- |
| assessments | 143 |
| carrying a `client_id` | **143** |
| whose `client_id` resolves to a real `clients` row | **143** |
| carrying both a first name and a surname | **143** |
| naming a second applicant | 33 |

This is the opposite of the investment reports, where 2 of 1,182 link to a
client at all — which is why the same fix is right here and wrong there.

### What it does now

`applyBorrowingCapacityProjection` takes an optional client row and publishes
`client.name` **only when there is a name**, because an object published with an
empty string in it is truthy and would make a page conditional on `client` draw
blank instead of dropping out. The adapter does the join, asking for
`CLIENT_NAME_COLUMNS` rather than naming columns itself — that constant exists
because both legacy routes invented their own spelling of this table and one of
them selected three columns that do not exist, 404ing every client in the
database (§14).

The formatting is `clientName.ts`'s and not a second implementation, which means
the cover names the **primary** applicant, falling back to the secondary, and
title-cases a name someone typed in capitals. 33 assessments are joint; naming
both here would put a different name on the cover from the one the Snapshot's
filename is built from. Showing both would be a change to that shared helper, so
that every format moves together.

It is bound in the cover's **eyebrow**, as a whole slot with no literal beside
it — `{{client.name}}` and nothing else. An unresolved binding renders as the
empty string, so "Prepared for " next to an empty binding would print a
preposition with nothing after it, which is the defect this catalogue already
carried in its risk register and on its contents page. An assessment without a
resolvable client simply prints no eyebrow.

### What holds it

All 50 masters are asserted to bind it, and to bind it as a whole slot —
a family contributes five variants and an operator picks whichever they like, so
the reference variant passing means nothing on its own. The eyebrow was measured
in Chromium across the ten families with a name 24 characters longer than the
longest in production: one line, 8.3pt tall, 6pt clear of the heading beneath it.

## 16. Two production documents, read page by page (28 Sep 2026)

The owner sent two Snapshots issued that day and asked for every chink found and
the flow made premium. One client had **no income recorded**; the other was
**limited by the DTI with a healthy surplus**. No fixture had either shape, so
`__tests__/fixtures/productionShapes.ts` now carries both. It keeps
production's keys, engine strings and address cut, with invented figures.
Everything below was read off the two PDFs and traced to a cause before it was
changed.

**What was wrong.**

- **The working did not add up.** "How the capacity is built" printed income,
  living expenses, commitments and a surplus, and the lines did not reach the
  surplus: $192,378 of income less $2,511 and $2,800 a month, beside a surplus
  of $4,791. Two of the engine's own steps were missing.
  - **Tax.** The surplus is built from after-tax income, which the row stores
    only inside an assumption string ("After-Tax Income Used —
    $137,462.8/yr").
  - **Negative property cash flow.** The engine adds it to living expenses
    (`totalLivingExpenses = livingExpenses + negativePropertyCashFlows`) and
    stores only the base figure.
- **A ratio nobody could check.** 10.7x printed beside one $455,000 mortgage.
  The engine's DTI counts the loans on properties held too, which the
  liabilities table never lists.
- **"Limited" with no reason**, in red, beside a positive surplus and a loan
  inside the limit. The engine rates red when the surplus is nil or the DTI is
  past its threshold. With a positive surplus, the DTI is the reason.
- **An assessment of nothing.** With no income the engine still returns $0,
  0.0x and a band. The document presented them as a finding:
  - "Stress tested $0";
  - an income table holding only "Total $0 $0";
  - advice to "pay down high-interest debts" to a client with none.
- **The machine room on the page.** Seventeen engine assumption strings were
  printed verbatim, for example:
  - "After-Tax of SHADED (assessable) income";
  - "DTI Denominator (APS 220)";
  - "$192,378.24/yr";
  - "$1000/mo (zeroed below)" on a bank-mode assessment, where no floor
    applied.
  
  The buffer, rate and term printed twice, a table apart.
- **Advice as the engine wrote it.**
  - "Limited borrowing capacity - focus on strengthening financial position":
    an ASCII hyphen, and a restatement of the band above it.
  - "Consider accelerating portfolio growth while rates are favorable": a claim
    about the market the record does not hold.
- **"Positive Cash Flow (37 Fairview Street Gunnedah, 2...)".** The engine
  cuts the address to thirty characters and appends "..." whether or not it
  cut anything.
- **Eight pages for a two-page answer.** Every section opened a page. One page
  held only a liabilities total, another only a "Worth knowing" callout, and a
  third opened with a single row of a table torn from the page before.

**What it does now.**

- **A working that foots** (`buildLedger`). All lines are monthly:
  1. assessed income;
  2. less tax;
  3. after-tax income;
  4. less living expenses;
  5. less commitments;
  6. less property costs not covered by rent (in conservative mode, "the
     conservative policy's adjustments");
  7. the surplus;
  8. the capacity, labelled with the rate and term it was repaid at.
  
  After-tax income is **read** from the engine's own string
  (`afterTaxIncomeFrom`) and never recomputed against today's tax table. Where
  it was never recorded, or the difference runs the wrong way, the table falls
  back to the figures the record holds, and does not claim they add up.
- **The ratio with its working** (`DebtToIncome`). The ratio, the APS 220
  income it divides by, and the existing debt derived back from both. That
  debt is rounded to $10,000 and said "about", because the ratio is stored to
  two decimals. Where the debt clearly exceeds the listed liabilities, the note
  says it includes the loans on properties held. The narrative says when the
  ratio is what limited the band.
- **No income, said once.**
  - The narrative, the income callout and a single piece of advice ("Record the
    household's income and recalculate") replace the presentation of $0.
  - DTI and stress are `null`: a ratio over zero income is undefined, not 0.0x.
- **The basis, curated and moved last** (`basis.pure.ts`, "On what basis").
  - Every engine key has a reading and a rule for when it applies. Money is
    rounded and grouped by hand (no ICU).
  - A figure the document states elsewhere is not repeated.
  - An unknown key prints title-cased rather than being lost.
- **Advice in the report's words** (`advice.pure.ts`). Every engine string has
  a wording, and advice the record contradicts is dropped:
  - debt advice needs consumer debt, because a mortgage is not "high-interest
    debt";
  - with no income, nothing but recording it applies.
  
  `advice.spec.ts` reads the engine's source and fails on any `push` it does
  not know. The engine's strings are unchanged: they also feed the calculator
  screen.
- **The flow.**
  - Sections run on (`RUN_ON_CHAPTER_CLASS`).
  - The chart and its sentence are one block, as are short tables and each
    callout (`KEEP_TOGETHER_CLASS`).
  - The headroom bars moved to the answer and replaced the utilisation bullet,
    whose three shaded bands carried no labels.
  - The KPI foot reads "At 10.50%: $405,510", where it read "Stress tested".
- **The label.** `incomeLabel` reads "Property cash flow — 37 Fairview Street
  Gunnedah". It cuts back to the last comma only when the engine's ellipsis and
  exactly thirty characters show that it cut. From now on the engine writes the
  whole address, with no ellipsis. `startsWith('Positive Cash Flow')`, the one
  reader of the label, is unaffected.

**Measured.** Through WeasyPrint 69.0 over the standard design and all fifty
catalogue designs: no near-empty page and no overflowing text on any of the
three cases.

| Case | Pages |
| --- | --- |
| DTI-limited | 7 (6 in one of the 51 designs) |
| No income | 6 (5 in one of the 51 designs) |
| Full fixture | 10 (was 11), with the working and the basis added |

**Not changed, and why.**

- **The engine's rules, and what it stores.** Every figure and decision is
  its own.
- **Assessments made before 14 Aug 2026 carry no stored audit trail or
  explanation (F12).** The two documents reviewed were such assessments, which
  is why neither had "How this was calculated". Recalculating one produces
  both pages.
- **"Primary Pea Body"** on the second document is the income source's name as
  it was typed into the record, most likely a transcription of "PAYG". It is
  data, and the document prints it as recorded; the remedy is to correct the
  income source.

## 17. The Strategy Rationale Brief, typeset in the chosen template (28 Sep 2026)

The What-If tab's **Download PDF** (Borrowing Capacity → What-If → Strategy
Rationale) drew the brief in the browser with jsPDF
(`StrategyRationalePDF.ts`). A chosen template could reach it only as a
palette (`drawnDesignFor('strategy_rationale')`). The owner's instruction for
moving it was exact: the content "is predominantly just a transition of that
information into the new template structure". Nothing is added and nothing is
reworded.

- **One statement of what the brief prints.** `strategyRationale.pure.ts` turns
  the engine's report and the panel's context into the strings the jsPDF brief
  prints, string for string: the KPI boxes and their feet, the section titles
  with their counts, the empty-scenario lines, the severity and capacity
  labels, "Cash-flow:", the capital flow, the valuation lines and the
  cross-collateral method. It runs in the browser, because the scenario is
  being modelled there and is stored nowhere. `strategyRationale.spec.ts` reads
  the generator's source for its literals, and reproduces the Samuel Lavis
  baseline brief of 28 Sep 2026 line for line.
- **The route is the Snapshot's.** `render-borrowing-capacity-pdf` draws a
  second document when asked (`document: 'strategy_rationale'`):
  - The brief's words arrive in the request. `readStrategyRationale` keeps only
    the composer's shape, bounds every string, and refuses a brief with no
    headline.
  - Everything else is the Snapshot's: the same auth and client check, the
    client's name read from the record, the same brand snapshot, the design
    chosen for Borrowing Capacity, the same bucket and the same ledger. The
    ledger row carries no assessment, and the brief's file name tells the two
    apart.
  - A body naming no document is the Snapshot, exactly as before. A document
    the route does not draw is refused.
- **It is one memo.** The brief is a single chapter whose parts are subheads,
  each kept with its opening block. Drawn as chapters, a baseline scenario put
  "No levers applied" under a 30pt heading and ran a page longer than the jsPDF
  brief. Measured in WeasyPrint over the standard design and all 50 catalogue
  designs, with no overflow and no stub page:
  - the baseline brief is 3 pages in every design;
  - a four-lever brief with capital flow, a valuation and a pool is 5 or 6.
- **The echo is required.** The route answers `document`, and the browser
  saves the typeset file only when it says `strategy_rationale`: a deployment
  older than this ignores the field and draws a Snapshot. Either that answer or
  an absent route falls back to the jsPDF brief, and the person is told.
- **Both layouts stay.** "Download PDF" is the typeset brief. The caret beside
  it offers "Download (legacy layout)", and "Choose template" sets the
  Borrowing Capacity choice the brief is drawn in. The file keeps its name,
  `Strategy_Rationale_<Name>_<yyyy-MM-dd>.pdf`, dated in the adviser's own time
  zone, as is the "Generated" line.

## 18. The Strategy Advisor's reasoning travels with its scenario (28 Sep 2026)

The What-If tab's Strategy Advisor proposes three scenarios for the client's
own position, each with a paragraph of client-specific reasoning, an execution
risk, the evidence a lender will ask for and the levers it considered and set
aside. Its system prompt tells it to write that reasoning "as if it will be
quoted directly into a finance handoff (because it will)". Nothing quoted it.
"Apply Scenario" moved the card's levers into the modeller, and the Strategy
Rationale then described those levers lever by lever while saying nothing of
why this client should use them. The explanation stayed on the card.

Two faults sat in front of that. For a while the advisor answered nothing at
all: its request was addressed through a build-time variable no build sets, so
it went to the web app's own host and came back as the app's HTML under a 200.
Nothing parsed, and the prompt sat unanswered. Market Updates Q&A and the
source-feed copy button had the same fault, and all three now read the one
resolved project URL (`integrations/supabase/env.ts`). And the rationale had no
field to carry the reasoning in.

**The address fix exposed a second fault behind the first.** Once the request
reached `bc-scenario-agent`, the function refused both of the owner's
attempts (28 Sep 2026, 15:21 and 15:22 UTC) with 401 "Authentication
required". The advisor opened its own fetch with credentials omitted and the
access-token Bearer alone. That Bearer is the carrier a browser can no longer
reliably hold (`secureInvoke.ts`), while `verifyAuth` reads the session from
the HttpOnly cookie. The function was already wrapped in `withRequestOrigin`,
which answers the exact origin with credentials, so the cookie was all it
needed. The advisor now opens its stream through `openSecureStream`, the
transport `streamSecureFunction` uses: the cookie, the Bearer, and one refresh
and retry on an auth refusal. It still reads its own OpenAI-style deltas.
`bcScenarioAgentStream.test.ts` forbids a fetch of its own in the component.

Now, applying a card carries its reasoning with its levers:

- **One composer.** `composeAdvisorSection` (`strategyRationale.pure.ts`) words
  the section once. The panel, its "Copy brief" text, the typeset brief, the
  jsPDF brief, the typeset Snapshot and the jsPDF Snapshot all print what it
  returns, so they cannot word it differently.
- **Where it sits.** In the brief it comes under the capacity figures and
  before "What we propose & why". It is the WHY of the whole scenario; the
  levers below it are the engine's account of each part.
- **The model's own estimate is not carried.** A card's `estimatedImpact` is
  the model's guess at the uplift, and the brief already prints the engine's
  figure. Two capacity figures for one scenario is how a finance team comes to
  ask which one to believe.
- **It says who wrote it, always.** Every copy carries "Written by the Strategy
  Advisor (AI) for this client's position. Every figure elsewhere in this brief
  is the calculation engine's own." The server's read restores that line
  whatever the request sent.
- **It follows the levers.** Once an apply has settled, the modeller takes a
  signature of the levers. The settle matters because effects normalise the
  levers for a render or two afterwards. If the broker moves a lever after
  that, the section says the reasoning describes the scenario as the advisor
  proposed it. Reset clears it. Loading a saved scenario does not bring it
  back into the modeller, because a load restores the calculator inputs and
  not the card's lever set.
- **It is saved with the scenario.** `advisorRationale` rides inside the
  preset's payload (a JSONB column, so no migration). It reaches every
  scenario saved, applied to the calculator or sent to the Snapshot, and the
  Snapshot's scenario pages print it under that scenario's name.
- **Without an advisor, nothing changes.** A scenario built by hand prints
  exactly what it printed before. That is pinned by comparing the rendered
  brief with and without the field.

`strategyRationaleAdvisor.spec.ts` carries the rules.

## 19. The Strategy Advisor says what it is doing (28 Sep 2026)

A request to the advisor takes 20–90 seconds. It makes one model call, makes
a second when the borrowing engine rejects enough of the first set, and checks
every scenario against the engine. For all of that the chat drew one spinning
circle, so a broker could not tell a slow answer from a stalled one.

The advisor now reports each stage on the stream it already sends, as
`data: {"progress": {stage, detail, mode}}`:

1. **Reading** the client's position: capacity today and the constraint that
   limits it. The prompt uses the same classification, `bindingConstraintOf`,
   and keeps its own wording for each constraint.
2. **Drafting**, aimed at the purchase price where one was detected. A question
   about the cards already on screen is `mode: 'answer'` and reads "Writing
   the answer".
3. **Engine check** of the drafted scenarios.
4. **Revising**, only when the engine flagged two or more scenarios and there
   is budget for a second call.
5. **Finishing**, set by the browser as the answer arrives and the cards are
   re-checked against the live calculator.

The bubble (`AdvisorProgressBubble`) draws:

- the stage headline;
- the server's detail line;
- the time since sending;
- the steps, with the done ones ticked;
- while the model works, one line at a time from the brief, prefixed
  **In the brief**.

The words live in `_shared/advisorProgress.pure.ts`, which the server and the
browser both read. Three rules bite.

- **A stage is reported only when it is reached.** The clock ticks; the
  headline changes only on a report.
- **The rotating line is a fact the browser sent, never a thought.** Nothing
  says what the model is weighing at a given second, so the line reads
  "Money Me, $10,000 balance, $862/mo", never "Considering paying out Money
  Me". A test refuses verbs of deliberation in it.
- **Either end may be older.** An older browser reads only `error` and
  `choices`, so it passes over the event. A newer browser moves itself to
  "reading" when the stream opens, and to "drafting" if an older server
  reports nothing within 2.5 s. The stage never moves backwards.

Past 40 seconds, the bubble says a full set can take up to a minute and a
half. A revision says it adds up to 45 seconds. Both figures are the
function's own budgets (`FIRST_CALL_TIMEOUT_MS`, `REVISION_TIMEOUT_MS`).

## 20. Why every advisor scenario read as a loss, and what the brief says now (28 Sep 2026)

Masline Nyawo's What-If Strategy Rationale and Borrowing Capacity Snapshot were
read line by line. All three advisor scenarios read as losses of $300k–$590k,
for three separate reasons, each fixed at its cause.

**1. The Calculator assessed her living costs at $0.** On every calculation for
her, `calculate-borrowing-capacity` logged
`HEM=$3360, Declared=$0, Base=$0 (declared)`. The Calculator sends the living
costs its chosen method produces as an explicit override. The server then
stamped the saved assessment `expense_method: 'declared'`, whatever had been
chosen. The modal restored that stamp as if the adviser had chosen Declared,
and a client with no declared expenses on file is $0 on Declared. The next save
stamped it again, so it never corrected itself.

The scenario engine floors living costs at HEM, as lenders do, and landed on
the Snapshot's $856,932. The Calculator said $1,258,615. The difference is
exactly $3,360 a month repaid at 9.44% over 30 years. Every scenario was
measured against the inflated base.

`_shared/borrowingCapacityExpenseMethod.pure.ts` holds the rule:
- The browser sends the method it chose.
- The server records it in `assumptions.expenseMethod`, beside the lender
  settings already restored from there.
- The `expense_method` column records what was applied: `hem`, `declared` or
  `declared_higher`.
- Only a recorded choice is restored. A row without one opens on the default,
  the higher of HEM or declared.

An older browser sends no choice, and the column then says what it always did.

**2. The advisor switched a DTI cap ON to "clear the DTI constraint".**
`dtiCapOverride` turns the cap on at the stated multiple. For a client the
Calculator assesses with no cap, "10x non-bank" added a ceiling and cut
capacity to exactly 10.00x on two of the three cards.
`_shared/advisorDtiOverride.pure.ts` withholds a proposal that would tighten
the assessment:
- It does so on the server before the engine measures the scenario, and again
  in the browser for a card kept from an earlier session.
- It keeps the lender the proposal named, because re-shading income to that
  lender's policy is a separate lever.
- The card says why the cap was not applied.

The prompt now tells the model not to propose the lever where no cap is
enforced.

**3. Capacity and purchase power were printed side by side with no reading.**
A scenario that releases equity lowers capacity, because the released equity
is new debt the lender services, and raises purchase power. The brief now says
so under the figures (`rationaleReadingNote`), wherever capacity falls and
purchase power is reported. The equity sentence is added only where equity is
released.

The brief also sets the choice beside the alternatives. The agent carries
every card from the same answer with the one applied, and the advisor section
lists them with the engine's figures:
- capacity and purchase power;
- whether each clears the target or falls short, and by how much;
- the advisor's risk rating;
- which option was applied.

It also quotes the advisor's own guardrails ("DTI cap of 10x not applied…")
under *What the calculation engine flagged*. The engine's working figures
(`Honest DTI 10.60× … Numerator $…`) stay on the card. All of it goes through
`composeAdvisorSection`, so the panel, both briefs and both Snapshots say it
the same way.

**The jsPDF brief** printed every `→` as `!’`, because the built-in font carries
WinAnsi only (`src/lib/pdf/standardFontText.ts` now guards the brief and the
legacy Snapshot). It also printed "2 securityies" and cut an address to
"Innisfa"; lever labels now name a property by its whole street line. And the
brief wrapped a lever's text to full width under its CAUTION chip, so the two
overlapped.

Measured: Masline's brief on 29 Sep was the jsPDF fallback. The browser's
preflight to `render-borrowing-capacity-pdf` answered 200 and no POST
followed. The Snapshot's call two minutes later reached the function.

## 21. The audit: one answer, tables that foot, and every page used (1 Oct 2026)

The third audit of the owner's report programme: the formatting and layout
across every design ("smaller subheadings, continuous flow"), and anything else
a meticulous read finds. Every finding below was read off a rendered page and
traced to a cause before it was changed. The measurements are WeasyPrint 69.0
renders of the standard design and all fifty catalogue designs.

Production rows are not readable from this work, so the cases are fixtures:

- the Phase 0 fixture, with and without an advisor card;
- `productionShapes.ts`'s two shapes, the DTI-limited one also as a
  recalculated assessment carrying the trail and explanation the engine writes
  (`DTI_LIMITED_ENGINE_AUDIT_TRAIL`, ported from the engine's own calls);
- two new cases: a proposed property's rent, and totals changed in the
  calculator.

**What was wrong.**

- **The engine's explanation was a section.** "How this was calculated"
  restated the working step for step in a log's shorthand ("Surplus = $9,909 −
  $3,750 − $2,450 = $3,709/mo. At 9.50% over 30yr → max loan", "RED band").
  Its DTI line divided by gross income where the stored ratio divides by the
  APS 220 income, so its own arithmetic did not reach the ratio it printed.
- **The audit trail opened on two wrong totals.**
  - Its liability total summed `|servicing − balance|`, a monthly repayment
    minus a balance (F13): $417,550 on the recalculated case.
  - Its tax total added the Medicare levy to an after-tax difference that
    already contained it.
- **The audit trail said a property's shortfall increased capacity.**
  `negative_cf_layered` stores the shortfall as a positive cost
  (`Math.abs(netMonthlyCashflow)`), and the polarity read it as income. Every
  Snapshot with a negatively geared property said so.
- **It said the stress test "Reduces" capacity.** The stress test is a reading
  of the same surplus at a higher rate, and the capacity on every other page is
  the unstressed one.
- **The audit spoke the engine's words.** "Neg CF: 22 Example Road…",
  "$2450/mo servicing", "80% shading", "Manual override", "+1% above
  assessment", and "Method: Declared" on a client assessed on HEM.
- **Page one said things twice.**
  - The proposed loan was in the opening paragraph and in a sidenote under the
    chart.
  - The expense method was a row of the terms table and a KPI cell set in
    display type.
  - Table captions restated the section's standfirst.
- **The rent a client pays printed with the engine's cut address**: "Rent
  Expense (14 Wattle Grove Sampleton...)".
- **The scenarios.**
  - The purchase target the legacy document printed was dropped.
  - A rate lever was listed twice: "Changed: Rate +1.00%" over "Strategy
    actions: Interest rate (1.00%)".
  - "Rate +1.00%" sat beside "Income +10%": a change in percentage points and
    a relative change, in one notation.
- **Tables that did not foot.** The calculator sends its own income and
  commitment totals, and the engine stores them beside a breakdown it reads
  from the client's records. Three things put a difference between the two:
  - the calculator adds a proposed property's rent to the income it sends,
    and the breakdown never lists it;
  - the engine adds a capitalised premium's repayment to the commitments, and
    lists no liability for it;
  - a figure edited in the calculator, or a scenario active when Calculate is
    pressed, moves the totals and not the lines.

  So a Total row could print a figure its own rows did not reach. The Phase 0
  fixture did, by $9,000 a year of income, $10,600 of assessed income and
  $2,165 a month of commitments, on every document drawn from it.
- **Lenders Mortgage Insurance.**
  - It was labelled in the calculator's words: "LVR at trigger" and "Net for
    purchase".
  - It said a deducted premium "is taken from the deposit". The calculator's
    own account is that it is paid from the loan, leaving less of the capacity
    for the purchase.
  - The net figure printed whatever was stored.
  - The ratio's note counted a capitalised premium as debt "already owed".
- **No income still drew the band.** §16 named the red "Limited" among that
  document's faults and removed the ratio and the stress test beside it. The
  band stayed, a judgement nothing was assessed to reach. The remedy, "record
  the income and recalculate", was said three times.
- **A standfirst promised tables the page did not draw.** "Every income
  component with its shading, and every liability with its servicing." headed
  the income section on every document. With no income and no liabilities, the
  section is a callout and two figures.
- **A "Total" could total nothing.** An income the calculator sent, on a
  household with no income lines recorded, printed as a table whose one row
  was "Total".
- **The income chart was drawn at the wrong size.** A donut is drawn for the
  compact width (`ChartFigureWidth`), and the Snapshot stretched it across the
  measure. Three segments took a third of a page.
- **The flow.**
  - On the recalculated case, page 4 was 65% white.
  - Three of the four no-income body pages opened on a section title.
  - With the scenarios before the basis, the page under the audit trail was 37%
    empty on 40 of the 51 designs.
- **The export.** The template choice sat at the foot of a menu, beside a
  button labelled "Download snapshot". The file was named
  `Borrowing_Capacity_Snapshot_A____J__Sample_2026-08-01.pdf`.
- **The advisor's note** said "in this brief" inside the Snapshot.

**What it does now.**

- **Six sections, as memo sections** (`openChapter(…, { runOn, memo: true })`).
  - The explanation is not one. It is still read into the payload, because the
    template catalogue binds it.
  - Subheads are set at h3 (`SECTION_SUBHEAD_CLASS`).
  - Tables are kept by their estimated height, never their row count
    (`keptTable`, `{ widths: 'content', leadRows: 2 }`), so no page holds a
    single row of one.
  - The basis comes before the scenarios, beside the rest of the evidence, and
    the document ends on what could change the answer, as the legacy Snapshot
    did.
- **The audit trail in the report's words** (`AUDIT_LABEL`, `auditRule`).
  - It has no summary strip, and a test reads the engine's `Math.abs` to hold
    the shortfall's sign.
  - The stress test is neutral.
  - The rent label names the whole address (`liabilityKindLabel`).
- **A table foots, or says why not.**
  - The proposed rent is a line of the income table (`proposedRentRow`), read
    from the setting the calculator stores with the assessment and counted as
    the calculator counts it.
  - The capitalised premium's repayment is a line of the liabilities table
    (`capitalisedLmiRepayment`), amortised as the engine amortises it.
  - Where the lines still do not reach the totals, both are printed: "Total of
    the lines above", then "Used in this assessment". A note says which one
    the working uses (`incomeItemsTotal`, `commitmentItemsTotal`). Nothing is
    absorbed into a balancing line, and no cause is asserted.
  - An income with no lines is one row, "Used in this assessment".
  - The income donut is not drawn over segments that add up to something else.
- **Mortgage insurance.**
  - It reads "Loan-to-value ratio" and "Capacity left for the purchase".
  - The net figure is printed only where it is the capacity less the premium
    (`provenNetForPurchase`).
  - The deducted premium is paid from the loan.
  - The ratio's note names a capitalised premium apart from what is already
    owed.
- **No income.** No band, and the remedy once, in the advice.
- **The income section's standfirst says what the section draws**
  (`incomeSectionNote`). Each half is said only where its table is drawn, so a
  client with nothing recorded reads "The living expenses and commitments the
  assessment applied." The no-income callout no longer says it too.
- **Scenarios.**
  - A rate and a term are stated from and to: "Interest rate 6.15% → 7.15%".
  - Purchase power says whether it clears the target, or by how much it falls
    short.
- **The chart at its own size.** The donut is drawn compact, with its context
  narrowed by the same fraction so its labels keep their point size.
  - Drawn compact, its centre figure ran 22% past the hole and over the ring,
    because the hole is fixed in drawing units and the figure in points.
  - `donutFigurePt` (shared) steps a figure down until it fits, counting every
    mark full in a monospaced face. A percentage, which is what every other
    format's donut carries, is set exactly as before.
  - The Snapshot's figure drops its period into the line under it ("$171,400",
    "Per year").
- **The export** (`SnapshotDownloadButton`).
  - "Choose template" is a button of its own beside "Export PDF", as on the
    Intelligence Hub, the Portfolio Performance Review and both comparisons.
  - The file is named `Borrowing Capacity Snapshot - A. and J. Sample - 01 Aug
    2026.pdf` (`readableFileName`), and the storage key is that name in
    URL-safe characters.

**Measured**, standard design plus the fifty catalogue designs. Every body
page is counted except each document's last, which ends where the document
ends:

| Case | Pages, before → after | Pages more than a quarter empty | Emptiest body page |
| --- | --- | --- | --- |
| Phase 0 fixture with an advisor card | 548 → 459 | 89 → 4 | 46% → 35% |
| Recalculated DTI-limited client | 483 → 357 | 71 → 0 | 65% → 24% |
| DTI-limited client stored before 14 Aug | 356 → 306 | 55 → 0 | 65% → 24% |
| No income recorded | 305 → 259 | 104 → 15 | 52% → 53% |

On the recalculated case, sixteen tables split across pages before, eleven of
them leaving a single row alone; none do now. No table leaves a single row
alone in any case. No text overflows its measure and no running foot wraps, in
any case. The two new cases, a proposed rent and totals edited in the
calculator, print as the fixture without an advisor card does: 412 pages over
the 51 designs, no table split, and the same four designs leaving one page
about a third empty.

Page counts after the audit:

| Case | Standard design | Catalogue designs |
| --- | --- | --- |
| Phase 0 fixture with an advisor card | 9 | 9 in all 50 |
| Phase 0 fixture without one | 8 | 8 in 46, 9 in 4 |
| Recalculated DTI-limited client | 7 | 7 in all 50 |
| DTI-limited client stored before 14 Aug | 6 | 6 in all 50 |
| No income recorded | 5 | 5 in 46, 6 in 4 |

CI renders the fixture without an advisor card in the render container and
pins its page count (`ci.yml`, `render-container`): 10 before this audit, 8
now, with the reason recorded beside the pin. Its bookmarks fell from fifteen
to eleven, which is "How this was calculated" and its three steps.

The emptiest no-income page is a point emptier than before while the count of
part-empty pages fell. It is the same page in the four designs named below,
now with one line fewer above its gap.

**Not changed, and why.**

- **The engine.** Its rules, its strings and what it stores are unchanged.
- **The legacy in-browser Snapshot**, which stays a named choice in the menu.
- **The Strategy Rationale Brief's filename.** Its words are the jsPDF brief's
  by design (§17), and it is the next audit's subject.
- **Four designs of one family** (`wm-01`, `-03`, `-04`, `-05`) are the four
  in the page counts above. Their section headers are about 13 points taller
  than the other designs'.
  - On the Phase 0 fixture, that stops the basis's table following the audit
    trail onto its page, which is left about a third empty.
  - With no income recorded, the working misses page three by less than a
    quarter of a point. It moves whole to page four, page three is left about
    half empty, and four rows of the settings table take a page of their own.
  
  Shrinking a header every format shares, to win a fifth of a point on one
  fixture, would be fitting the design to the fixture.
- **The donut's legend rounds each share to a whole percent**, so 72, 18 and 9
  print beside a total of 100.
- **Other formats' donuts are still drawn across the full measure**: the
  Portfolio Performance Review, Client Details, the Cash Flow Comparison and
  the Property Comparison. Theirs carry percentages, which fit at any size, so
  they cost room rather than a figure. Each format's audit will take it.
- **How often production records disagree with themselves is unmeasured.** The
  three causes above were established by reading the calculator and the
  engine. No production assessment was read, because this work has no read
  access to that table. The document now states both totals wherever they
  differ, so a record that does not foot cannot print as one that does.

## 22. The audit of the Strategy Rationale Brief (1 Oct 2026)

The fourth audit of the owner's report programme: the What-If tab's Strategy
Rationale Brief, its legacy layout, and the panel that exports it. Three briefs
were drawn in WeasyPrint 69.0, in the standard design and all fifty catalogue
designs, and read page by page:

- the Samuel Lavis baseline brief of 28 Sep 2026 (`strategyRationale.spec.ts`);
- a multi-lever brief with capital flow, a valuation and a pool (the spec's own);
- an equity release applied from an advisor card, with the three options it
  put forward and its guardrail: the shape of Masline Nyawo's brief (§20), with
  invented figures.

§17's rule still holds: the typeset brief and the jsPDF brief print the same
words. Every word changed below changed in both, mostly through a constant the
jsPDF brief now imports.

**What was wrong.**

- **Page one repeated the cover.** The chapter header said "Strategy
  Rationale Brief" and "Borrowing Capacity Scenario — Finance Hand-off", the
  cover's eyebrow and subtitle, under a "SECTION 01" that numbered the only
  section. The running head said "Strategy Rationale Brief" on both sides of
  every page.
- **The subheads were a size above every other memo's.** They were bare `h2`s
  at the design's full subhead size.
- **A table moved whole with its heading.** A four-step sequence that did not
  fit the space left moved whole to the next page, leaving a quarter of a page
  white; on the advisor brief, 30 body pages were more than a quarter empty.
- **A baseline brief said "no levers applied" four times on one page**: its
  headline, then under "What we propose & why (0 levers)", "How the math
  reconciles" and "Recommended execution sequence (0 steps)". The empty
  sequence's line, "No execution steps required — baseline scenario.", called
  any scenario with no steps a baseline, levers or not.
- **Machine words and chip style in the body.**
  - "How the math reconciles".
  - "Cash-flow:" as a noun.
  - "Desktop val" and "Comp sales".
  - "Execution risk: MEDIUM", and "BROKER" in a table cell.
  - "POOL OVERCOMMITTED — sinks were clamped to available pool.", a "Source →
    sink" column, and "Routed" and "Residual".
- **A tick where the legacy brief printed a word.** "Target $950,000 ✓": the
  jsPDF brief's font has no ✓, and printed it as "met".
- **The export.** The button said "Download PDF" where every other format says
  "Export PDF". The file was `Strategy_Rationale_Samuel_Lavis_2026-09-28.pdf`,
  and the flattened copy `strategy-rationale.pdf`.

**What it does now.**

- **It opens on its finding.** The engine's headline is the memo's title and
  its sub-headline the standfirst, so the first thing under the running head is
  what the scenario does.
  - The header draws no number line (`renderChapterHeader({ unnumbered })`, a
    new opt-in that leaves every other caller byte for byte as it was).
  - The running head names the client, as the jsPDF brief's footer always has.
  - The cover still names the document.
- **Subheads are the memo's** (`SECTION_SUBHEAD_CLASS`), one step below that
  title.
- **Tables keep themselves** (`keptTable`), whole while short and by height
  when not. A part whose first block is a table keeps its heading with the
  table's first rows by the heading's own rule; it is no longer wrapped whole.
- **A part with nothing in it is left out**, in both briefs. A baseline brief
  is its finding, its figures and its caveats. `proposeEmpty` and
  `sequenceEmpty` are still composed, because a server older than this draws
  them.
- **The report's words, in both briefs.**
  - The constants: `RECONCILE_TITLE` ("How the maths reconciles"),
    `POOL_OVERCOMMITTED_NOTE`, `BASIS_LABEL` ("Desktop valuation", "Comparable
    sales") and `CAPITAL_FLOW_LABELS` (Available, Allocated, Unallocated).
  - "Cash flow:".
  - A target "Clears the $950,000 target" or "Short of the $950,000 target".
  - A "Source → use" column.
  - `RISK_LABEL` and `OWNER_LABEL` set a risk and an owner as words. The
    server reads an older browser's capitals as the word, and the jsPDF brief
    still draws its chips in capitals, uppercasing the word itself.
  - The panel and the valuation picker use the same constants.
- **The export.** "Export PDF" sits beside "Choose template". The typeset file
  is `Strategy Rationale Brief - Samuel Lavis - 28 Sep 2026.pdf`
  (`readableFileName`), and the flattened copy takes the same name. The jsPDF
  brief keeps its own name, as the in-browser Snapshot does (§21): the name
  says which layout a file is.

**Measured**, standard design plus the fifty catalogue designs, every body page
counted except each document's last:

| Brief | Pages, before → after | Body pages more than a quarter empty | Emptiest body page |
| --- | --- | --- | --- |
| Equity release from an advisor card | 352 → 306 | 30 → 0 | 27% → 21% |
| Four parts, capital flow, a valuation and a pool | 255 → 204 | 0 → 0 | 16% → 10% |
| Baseline | 153 → 153 | — | — |

The advisor brief is six pages in every design, where 46 drew seven. The
multi-lever brief is four in every design, where all drew five. No table splits
in any of them, nothing runs past its measure, and no running foot wraps.

**Not changed, and why.**

- **The engine's own sentences** (the headline, each lever's what and why, the
  reconciliation, the steps) are the scenario engine's, and are printed as
  written.
- **The advisor's reasoning** is the model's, printed as it wrote it, under the
  provenance note (§18).
- **The severity labels** (POSITIVE, CAUTION, CRITICAL, INFO) stay in capitals.
  They sit in a callout's label slot, which every design sets in capitals.
- **The baseline brief's one body page is mostly white.** It holds what a
  baseline has to say, and the next page is the closing page.

## 23. The Strategy Advisor draws its cards again (2 Oct 2026)

The owner reported that the What-If tab's Strategy Advisor no longer offered
cards: a brief came back as prose, with nothing to apply. The cards, each with
an **Apply Scenario** button that loads its levers into the strategy
modelling, arrive only when the model calls the `generate_scenarios` tool, and
three things stood between a brief and that call.

**What was wrong.**

- **Almost every brief was read as a clarification.** An April rule withheld
  the tool from any message containing "?" and none of nine action verbs, or
  containing a cue such as "is it" or "what is" anywhere. All three of the
  advisor's own suggested prompts end in "?" and use none of the verbs, so the
  built-in examples could never produce a card; "is it possible" and "what is
  the best way" tripped the cue list; and the rule ran with no cards on screen,
  when there is nothing to clarify. Measured on production on 2 Oct 2026: a
  dictated brief for a $750,000 new build logged `clarificationMode: true`.
- **The tool was offered, never required**, and the system prompt told the
  model to "ask clarifying questions if the request is vague", so a vague
  brief was answered with a question in place of cards.
- **The native Anthropic route dropped tools.** `callAnthropicNative` was
  handed neither `tools` nor `tool_choice` and kept only the answer's text, so
  an agent assigned a Claude model on the native route could never call a tool.

**What it does now.**

- **One rule decides the mode** (`_shared/advisorRequestMode.pure.ts`):
  - with no cards on screen, every message is a brief and gets cards;
  - a request to produce or rework options, a budget, or a strategy question
    gets cards even when cards are showing;
  - a prose answer is owed only to a message about the cards on screen — one
    that names a card, or a short follow-up question. A long message carrying a
    brief is a new brief even where it mentions the cards.

  The edge function reads it with the names of the cards on screen
  (`priorScenarios`); the browser no longer second-guesses it.
- **In scenario mode the tool is required.** `tool_choice` names
  `generate_scenarios`, and the router's `requiredToolName` and
  `requireValidToolArguments` treat an answer without a readable call as a
  failed attempt and ask the next model in the chain. When every model answered
  without cards, the broker is told that, not "AI service error". The prompt
  now says to state an assumption in `reasoning` and still call the tool.
- **The reply names each card with the engine's figures** when the model wrote
  no prose of its own (`scenarioSummaryProse`), instead of a fixed paragraph
  promising "3 scenarios" whatever arrived. A scenario call that cannot be read
  is said out loud.
- **The native Anthropic route carries tools** (`_shared/anthropicToolUse.pure.ts`),
  both ways: function tools and `tool_choice` in, `tool_use` blocks out as
  `tool_calls`, and a revision turn's call and result as `tool_use` and
  `tool_result`. It engages only when a call carries tools or a tool turn, so
  every other call is built exactly as before.

**Three rules bite.**

- **There is nothing to clarify with no cards on screen.**
- **When cards are owed, the call is required, not offered.** A model left to
  choose answered briefs in prose.
- **The browser and the server read one rule.** Two rules for one decision is
  how the April one came to be applied where it made no sense.

The fix reaches the advisor when `bc-scenario-agent` is deployed; the browser
change alone cannot restore the cards.
