# Investment Compass — design families and colourways

How the approved Claude Design catalogue reaches the Template Library, and what
to change when you want a different result.

---

## What was approved

Claude Design's **Investment Compass Template Catalogue** defines ten design
families, five structural variants each, ten curated colourways per family —
**fifty masters, five hundred visual combinations**. It lives in the Claude
Design project `5dbd1c71-8a23-45af-8616-989b2a36efa8`:

| File | What it holds |
| --- | --- |
| `Template Catalogue.dc.html` | `FAMILIES` (families and manifests), `COLOURWAYS` (ten per family), `CW_KEYS`, `AXES`, `USE_MATCH`, `ARCHETYPES` |
| `<Family> Archetypes.dc.html` × 10 | The drawn A4 pages for each family's reference variant |

All ten families are implemented.

## The one rule the whole architecture rests on

The catalogue states it in the selection panel:

> Tokens carry no layout meaning. Any colourway composes with any of the five
> layout variants.

That is why this is **50 master templates × 10 palette presets**, not 500
templates. A colourway is a `Partial<Tokens>` handed to the renderer; the
document is the same schema either way. `investmentCompassCatalogue.spec.ts`
asserts the invariant directly — every block's geometry is byte-identical
across a family's ten palettes.

## Only the reference variant is drawn

`Template Catalogue.dc.html` computes archetype coverage as `BUILT` when
`axisIndex === 0` and `MANIFEST` otherwise, and the selection panel says so:

> This is the family reference. The other four variants are expressed as
> overrides on it.

So each family has one drawn expression and four declarative ones. That is
reproduced exactly: `templates.ts` holds **one composition**, parameterised by
the resolved manifest. An eleventh family is a declaration in `source.json`; a
sixth variant is an override object.

---

## The ten families

| # | Family | Faces | Note | Colourways | Masters |
| --- | --- | --- | --- | --- | --- |
| 01 | **Private Banking** | Cinzel · Playfair · Inter · Plex Mono | Gold on obsidian, editorial ledger, restrained accent | 6L/4D | Chancery, Chancery Compact, Sovereign Folio, Bullion Rail, Discretion Ledger |
| 02 | **Institutional Research** | Noto Serif · IBM Plex Mono | Numbered exhibits, masthead, coverage-note discipline | 6L/4D | Exhibit, Exhibit Dense, Coverage Note, Analyst Folio, Committee Brief |
| 03 | **Luxury Editorial** | Noto Serif | Serif throughout, photographic plates, justified columns | 6L/4D | Atelier, Atelier Plate, Grand Folio, Frontispiece, Monograph |
| 04 | **Modern Fintech** | Inter | Dark data ribbon, chips and tabs, violet accent | 6L/4D | Signal, Signal Compact, Console, Ribbon, Pulse |
| 05 | **Architectural Property** | Lato | Lato light, monochrome, measured drawings and schedules | 6L/4D | Drawing Set, Schedule, Elevation, Site Plan, Datum |
| 06 | **Swiss Minimal** | Inter | Strict grid, flat blocks, single red accent, no ornament | 6L/4D | Grid, Grid Tight, Objective, Raster, Hairline |
| 07 | **Corporate Advisory** | Lato | Decimal numbering, letterhead band, signed notes | 6L/4D | Board Pack, Board Pack Brief, Engagement Note, Committee Memo, Advisory Letter |
| 08 | **Wealth Management** | Roboto | Obsidian bands, statement rules, capital framing | 6L/4D | Statement, Statement Compact, Portfolio Review, Client Pack, Fiduciary |
| 09 | **Data / Analyst** | IBM Plex Mono · Inter | Mono figures on cell gridlines, field keys printed beside values | 6L/4D | Model, Model Dense, Worksheet, Dictionary, Terminal |
| 10 | **Dark Executive** | IBM Plex Mono · Inter | Mono on obsidian, vertical rail, amber for the base case | **4L/6D** | Obsidian, Obsidian Brief, Night Desk, Signal Dark, Executive Rail |

Dark Executive is the only family that leads dark — six of its ten colourways
are dark grounds, and its default is `Amber Obsidian`. Every other family
defaults to a light ground, because the catalogue picks index 0 unless its
ground disagrees with the variant's declared mode.

---

## Where things live

| File | What it owns |
| --- | --- |
| [`investmentCompass/source.json`](../../scripts/template-library/investmentCompass/source.json) | **The approved source**, a verbatim evaluation of `FAMILIES` + `COLOURWAYS` |
| [`investmentCompass/generate.ts`](../../scripts/template-library/investmentCompass/generate.ts) | Emits the two generated modules from it |
| [`investmentCompass/families.generated.ts`](../../scripts/template-library/investmentCompass/families.generated.ts) | Ten families, fifty variants, every manifest — generated |
| [`_shared/templateColourways.generated.ts`](../../supabase/functions/_shared/templateColourways.generated.ts) | All one hundred colourways — generated |
| [`_shared/templateColourways.pure.ts`](../../supabase/functions/_shared/templateColourways.pure.ts) | The **derivations**: every colour role the six approved values do not cover |
| [`investmentCompass/family.ts`](../../scripts/template-library/investmentCompass/family.ts) | Typed model, plus the **measured** typography and geometry |
| [`investmentCompass/resolvers.ts`](../../scripts/template-library/investmentCompass/resolvers.ts) | Manifest vocabulary → renderer primitives |
| [`investmentCompass/blocks.ts`](../../scripts/template-library/investmentCompass/blocks.ts) | Manifest-driven block helpers |
| [`investmentCompass/templates.ts`](../../scripts/template-library/investmentCompass/templates.ts) | The one composition, compiled fifty times |
| [`investmentCompass/qa.ts`](../../scripts/template-library/investmentCompass/qa.ts) | Chromium render QA — measured overflow, screenshots, PDF |
| [`src/lib/templateLibrary/entryDesign.ts`](../../src/lib/templateLibrary/entryDesign.ts) | Reading a library entry's family facts in the UI |

### Generated, not hand-written

Ten families × five variants is ~250 manifest entries; ten × ten colourways is
500 colour values. That is not something anyone transcribes correctly by hand,
and a single mistyped hex is a design change nobody approved and nobody can see
in review. So `source.json` is a **verbatim evaluation** of the Design file's
own JavaScript, and the TypeScript is emitted from it.

`investmentCompassSource.spec.ts` re-derives the comparison every run: a
hand-edit to a generated file — the exact way a design decision gets quietly
changed by an engineer — fails the suite rather than shipping.

### Measured, not guessed

The catalogue names typography as a preset (`cinzel_playfair_inter`) and spacing
as a scale name (`generous`). The actual point sizes exist only in the ten drawn
archetype files, so `BASE_SCALES` in `family.ts` records what each family's
pages **actually set** — cover title from its `h1`, section heading from the
median `h2`, body from its paragraphs, cells from its tables. Institutional
Research's cover is 14pt because it is a masthead, not a title page; Swiss
Minimal's is 52pt, the largest in the catalogue, against 8.2pt body. That ratio
is the Swiss argument, and borrowing another family's would erase it.

---

## The resolver, and why it exists

The manifest vocabulary is wide: **31 `kpi_layout` values, 30 `chart_style`, 29
`cover_overlay`, 27 `section_header_style`, 26 `table_style`.**

Thirty-one KPI renderers would be absurd. Thirty-one silent fallbacks to one
renderer would be a lie. So `resolvers.ts` gives every value an **explicit**
entry saying which primitive draws it and with what parameters:

```ts
four_column_ruled: { variant: 'ruled', columns: 4, items: 4 },
console_twelve:    { variant: 'ruled', columns: 6, items: 12 },
grid_cells_six:    { variant: 'ruled', columns: 6, cellBorders: true, items: 6 },
ledger_rows:       { variant: 'rows',  columns: 1, items: 5 },
```

Two consequences, both wanted: a reviewer can read what `holdings_rows` becomes
and disagree with it, and **a value with no entry throws**. The spec walks every
value in `source.json` and asserts each resolves — a family added to Design and
not mapped here fails the build rather than quietly rendering as somebody else's
layout.

Where several values resolve alike, the comment says so. `ledger_rows`,
`statement_rows` and `schedule_rows` are all a ruled ledger of label/figure
rows; what the catalogue distinguishes between them is the *family's* typography
and rule weights, which the family layer already supplies.

One value that reads like a rail and is not: **`scroll_rail`**. The source
describes Signal Compact as *"tab strip becomes a scroll rail. Print stays
A4-correct"* — a screen affordance. `hasRail()` excludes it, and a test asserts
the printed page has no vertical rule.

---

## Colourways

Each family's ten are in the approved order; index 0 is the default. The six
values per colourway follow the catalogue's own
`CW_KEYS = ['colourway','paper','ink','accent','rule','muted','ground']`.

### Three things that bite

**The colourway's `ink` is the FIELD colour, not body copy.** The approved
Private Banking archetype sets `--field: #251F18` and `--ink: #312A21` — the NPC
design system's `--aurixa-obsidian` (34 20% 12%) and `--foreground`
(34 20% 16%), four points of lightness apart. `bodyInkFor()` derives body ink by
lifting the field by that measured delta, and a test pins it to the reference
pair. Setting body copy to the field colour is invisible on screen and wrong on
paper.

**A colourway id is only meaningful inside its family.** `findColourway()` takes
a family key, and `resolveRequestedColourway()` validates against the entry's own
stored list. With a hundred ids in play, a global lookup would let a request
paint a Private Banking master in a palette no designer ever paired it with.

**Semantic colours do not follow the colourway.** `positive` / `caution` /
`negative` / `info` are Category B in the NPC design system — fixed by design, so
a tenant brand can never recolour a loss. They are lifted for dark grounds only,
where the print-weight values go muddy. All 100 colourways are asserted against
WCAG AA floors for body-on-paper, type-on-field and negative-on-paper.

---

## How a colourway reaches the page

Two paths, and the difference matters.

**Preview — a token override.** `renderTemplateToHtml` already accepted
`tokenOverrides`. Switching colourway re-renders the same schema with a
different colour map: no second template, no refetch, nothing written.

**Use template — a bake.** `buildWorkingCopyPayload` writes the chosen palette
into the copy's own `tokens.colors`. That is what makes the choice survive into
the Template Builder, the WeasyPrint PDF and live report generation without any
of them knowing colourways exist — the copy is an ordinary template that happens
to be that colour.

Referencing instead of baking would have meant teaching three pipelines to
resolve a colourway, and a saved copy whose appearance could change later —
which is what the library's snapshot rule exists to prevent.

There is one renderer. `render-template-pdf` takes **pre-compiled HTML** from
`renderTemplateToHtml`, so a change to a block renderer reaches the preview and
the PDF together.

---

## Database

One additive migration,
[`20260811110000_template_library_design_meta.sql`](../../supabase/migrations/20260811110000_template_library_design_meta.sql):
a `design_meta jsonb NOT NULL DEFAULT '{}'` column and a partial index. Nothing
existing is altered; every pre-existing row reads back as `{}`, which every
consumer treats as "not a family template".

### Why not `family_id` or `variant`

`family_id` is a **uuid meaning "the lineage this entry's versions share"**.
Every version of one template carries the same one, and the publish path
deprecates siblings by it:

```sql
UPDATE template_library_entries SET status = 'deprecated'
WHERE family_id = <new>.family_id AND status = 'published' AND id <> <new>.id
```

Overloading it with a *design* family would make five unrelated templates look
like five versions of each other — and publishing any one would deprecate the
other four.

`variant` is CHECK-constrained to `('composite','financial','due_diligence')`
and is copied onto `report_templates.variant`, where it feeds report routing.
Widening it would put design vocabulary in a routing column.

Both were left exactly as they are.

---

## Changing the design

1. **A design change** goes to Claude Design, then re-extract `source.json` and
   run `npm run templates:compass:generate`. Read the diff.
2. **A measurement or a mapping** is code: `family.ts` for type and geometry,
   `resolvers.ts` for the vocabulary.
3. `npm run templates:library:seed` — revalidates all 93 templates against the
   live Zod schema, the production renderer allow-list and the publish gate,
   checks each family's typography actually compiled and is loadable, and
   refuses to write a migration if any page overflows its footer.
4. `npm run templates:library:verify` — the catalogue suite, including all 500
   template × colourway renders and the no-layout-change invariant.
5. `npm run templates:compass:qa` — Chromium render QA into
   `audit-output/investment-compass/`.

### What the build refuses to write

On top of the existing gates, a family template must also:

- compile **and load** its family's four faces — a template that names Cinzel
  without a loadable face renders in the engine default and nothing says so;
- declare a density matching its resolved manifest, so a user filtering to
  "compact" cannot be handed a spacious page;
- offer only colourways registered for its family, with a default among them.

The voice system's **running-head rule does not apply to family templates**, and
that is deliberate. Under the approved catalogue a section eyebrow names the
*section* ("The verdict", "Projections") while the document is named by the
running head across the top of the page. Asserting the voice rule would reject
every one of these templates for following its own specification.

### Applying the migrations

No CI step runs migrations. Apply in order — the seed writes `design_meta`:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260811110000_template_library_design_meta.sql
psql "$DATABASE_URL" -f supabase/migrations/20260811120000_seed_template_library_v4_investment_compass.sql
```

The seed is idempotent — it upserts on `(slug, version)` and touches only seeded
slugs, so re-running is safe and operator-promoted entries are never disturbed.

To check which catalogue a database is serving:

```sql
select design_meta->>'familyKey' as family, count(*)
from public.template_library_entries
where status = 'published'
group by 1 order by 1;
```

---

## Renderer support added for this layer

All additive, all default-preserving — a template that sets none of these
renders exactly as before, which the existing report-template suite asserts.

| Block | Props | Why |
| --- | --- | --- |
| `text-block` | `headingFont`, `bodyFont`, `eyebrowFont`, `eyebrowTracking`, `bodyTracking`, `headingWeight`, `headingLineHeight`, `bodyLineHeight`, `bodyStyle`, `bodyAlign` | Families run up to **four** faces with one job each; all three elements previously resolved to `--font-body`/`--font-heading`, and the eyebrow was pinned at 0.18em |
| `kpi-grid` | `variant` (`ruled`/`display`/`rows`/`stacked`), `cellBorders`, `valueFont`, `labelFont`, `noteFont`, `valueColor`, `ruleColor`, `emphasisColor`, `labelTracking`, `labelSize`, `noteSize`, `valueWeight`, `items[].note` | 31 declared KPI layouts; one filled-tile grid would have collapsed them |
| `data-table` | `headerStyle: 'rule'`, `gridLines`, `headerFont`, `headerSize`, `headerTracking`, `totalRows`, `rowRule`, `outerBorder`, `emphasisColor` | 26 table treatments — statements, worksheets, module grids, and one doubled-rule total |
| `callout` | `style` (`bar`/`margin`), `titleFont`, `titleColor`, `titleSize`, `titleTracking`, `bodyFont`, `bodySize`, `barWidth`, `ruleColor` | 21 callout styles across three genuinely different objects |
| `divider` | `orientation: 'vertical'`, `height`/`length` | The vertical rail and the drawing-set frame had no primitive |
| `hero` | `bg`, `eyebrow`, `eyebrowSize/Font/Tracking/Color`, `titleFont`, `subtitleFont`, `padding`, `tintFade` | It drew an image and nothing else, so a hero with no image rendered transparent — and a *band* is what eleven cover overlays and every Wealth Management page opens on. `tintFade` ramps the tint in, because a flat scrim across the foot of a photograph draws a hard edge through the picture |
| `image` | `placeholder`, `captionSize`, `captionFont`, `captionTracking`, `captionStyle`, `captionTransform`, `radius` | An unresolved `src` drew a bordered "No image" box — right in the editor, wrong on a client's PDF. See **Image plates** below |
| `risk-register` | `display: 'bars'`, plus every colour as a prop | `severity_bars` vs `rated_table`; and the block hardcoded its whole palette |
| `decision-box` | `bg`, `color`, `headingColor`, `radius`, `barWidth`, `headingFont`, `bodyFont`, `headingSize`, `bodySize`, `headingTracking`, `maxWords` | `obsidian_card` needs the field colour; the block hardcoded `#FCFAF6` and silently truncated at 60 words |
| `footer`, `page-number` | `inset`, `fontSize`/`size` | The footer rule was full-bleed while the content rule spanned the margins |

Three of these fixed **latent defects** rather than adding features:
`risk-register`, `decision-box` and `hero`. The first two hardcoded every
colour, so they passed `isBrandSafe()` — which only inspects the schema — while
being the one element on the page that ignored the template's palette. The third
could not paint a background at all.

## More than one report format

The ten designs are **format-agnostic by construction** — typography, density,
margins, KPI arrangement, table treatment and colourway carry no subject matter
— so they serve any report. Seven formats have taken them up, at 50 masters
each: the same ten families × five variants × ten colourways. Six are
production-ready; the seventh is preview-only, and the reason is worth reading
before assuming an adapter was forgotten.

| | Investment Compass | Borrowing Capacity | Portfolio Review | Comparison | 10 Year Cash Flow | Client Details | Cash Flow Comparison |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Masters | 50 | 50 | 50 | 50 | 50 | 50 | 50 |
| `report_type` | `investment_compass` | `borrowing_capacity` | `portfolio` | `comparison` | `cashflow` | `client_details` | `cash_flow_comparison` |
| `category` | `investment` | `finance` | `portfolio` | `comparison` | `cash_flow` | `client_details` | `comparison` |
| Slug prefix | `investment-compass-` | `borrowing-capacity-` | `portfolio-review-` | `comparison-analysis-` | `cash-flow-ten-year-` | `client-details-form-` | `cash-flow-comparison-` |
| Composer | `templates.ts` | `borrowingCapacity.ts` | `portfolio.ts` | `comparison.ts` | `cashFlow.ts` | `clientDetails.ts` | `cashFlowComparison.ts` |
| Adapter | `investmentReportAdapter` | `borrowingCapacityAdapter` | `portfolioAdapter` | `comparisonAdapter` | `cashFlowAdapter` | `clientDetailsAdapter` | **none possible** |
| Source | `investment_reports` | `borrowing_capacity_assessments` | `portfolio_analysis_reports` | `property_comparisons` | `investment_reports` | nine `client_*` tables | nothing persisted |
| Production-ready | yes | yes | yes | yes | yes, for 162 of 1,182 | yes | **no — nothing is persisted** |

Adding an eighth is a `ReportFormat` descriptor and a page sequence — plus the
adapter and projection that make it production-ready — not a second design
system.

### Report Q&A is the format the families cannot draw at all

Worth recording beside the seven, because it is the one that looks like an
omission and is not. Its payload is Markdown a model wrote, and the block
vocabulary has **no Markdown renderer and no block that accepts HTML** —
`text-block` escapes its body, which is what stops model-authored content
injecting markup into a client's document. So an answer bound to one prints
`## Yield analysis`, `**gross yield**` and `| Metric | Value |` as body copy, on
70% and 23% of the corpus respectively.

The second reason is this system's own: a master declares every block's height
at build time, and an answer runs 2,188 characters at the median and **33,359**
at the maximum, with a conversation reaching 354,406 across 70 turns and a spine
that is discovered rather than declared.

`docs/reports/QA.md` §12 has the measurements and the two things that would have
to change. `reportQaNotOnTheFamilies.spec.ts` enforces it, and sweeps seven block
types with a hostile payload while it is there.

### The Cash Flow Comparison has nothing to read, and says so

The seventh format, and the first preview-only one. Every other format on this
system reads a stored artefact; this one has none. Its projections are the
browser's and are never persisted, its analysis table holds **0 rows and
structurally cannot hold any** (its INSERT policy refuses this application's own
sign-in), and its render ledger holds 0 rows, stores neither the projections nor
the analysis, and is superadmin-only.

The obvious substitute — the stored `financial_calculations.projections` the 10
Year Cash Flow format uses — fails for a reason that is not about scope: every
headline measure in this document is built on `afterTaxAnnual`, and that series
models no tax at all. Filling the field to make the shape fit would put an
invented after-tax position on a client's page.

So the projection is written and tested, the masters bind what it publishes, and
the registry entry says *why* rather than the default "not configured yet". An
adapter is the whole of the remaining work, on the day a comparison is persisted
somewhere a template can reach.

Its other difficulty is one the Property Comparison introduced and this format
has five times over: **the tables change shape with the property count**. A
comparison holds 2 to 5 properties and the central tables put one column per
property, so every property-wide table is drawn four times, once per count, under
mutually exclusive conditionals at one position — `byPropertyCount()`.

**One renderer defect came out of it.** `data-table` never resolved bindings in
its column headers: every body cell went through `resolveBindable` and the
headers did not, so a bound header printed a literal
`{{cashFlowComparison.properties.0.shortAddress}}` across the top of the table.
No format bound a header until the seventh — the other six all name their columns
statically — and it is the only binding defect in this programme that is
*visible* rather than silent, since an unresolved binding elsewhere renders as
the empty string.

### The Client Details format is built for the record that is empty

96% of them are. Measured across all 775 clients: **742 have no property, no
employment, no asset, no liability and no expense.** The shipping generator
opens on a Properties Overview and follows it with per-property blocks, which
for those 742 is a cover and several pages of empty tables.

So every financial page here carries `conditional: clientDetails.hasFinancials`
— and a conditional *page* costs nothing when it does not render, unlike a
conditional block, because `visiblePages` filters it before anything is laid
out. The same fifty masters produce a 5-page document for the 742 and up to 13
for the other 33.

The closing page draws **two blocks at one position** under opposite
conditionals: a summary of where the client stands, or the sentence that says
the record holds contact details and nothing else. Exactly one renders.

Its other problem is the opposite of the Cash Flow format's. Nothing here is a
fixed ten-year series; the collections are unbounded — one client records **100
expense rows**, another 18 assets — on a page model that cannot paginate. Every
collection is therefore capped and every cap is measured, and expenses are
**grouped by category rather than listed** (the worst case grouped is 14 rows,
and a category total is what a broker reads anyway). Where a cap bites, the page
says so with the record's own count beside it.

It is also the only one of the six that may bind `{{client.name}}`: `clients` is
its source table, so the document is genuinely about a named person.

### The Cash Flow format is the one with no prose in it

The other four bind paragraphs a model wrote, and every height on their pages is
a `textHeight(chars)` measured against production. This one binds nothing but
numbers, and the risk moves to the other end: **five ten-row tables** on a page
model that cannot paginate, across ten spacing scales that put the same ten rows
anywhere between 154pt and 244pt. Each series table gets a page of its own, and
the collision measure is what proves it.

It is also the only format whose adapter **declines** reports. Its source is
`financial_calculations.projections`, present on 162 of the 1,182 investment
reports; `buildBindingContext` returns null for the other 1,020 rather than
rendering a document whose entire subject is missing, so the legacy generator
keeps them.

Most of what its projection does is **refuse**. Four stored figures contradict
the series they would be printed beside — a year-one cash flow that disagrees
with the series' own year one by a median of $24,793, two totals that do not
equal the components listed under them (on 132 of 161 and 141 of 162
respectively), and a purchase price of $3 on one report whose series says
$780,000 — so none is published and the cost pages carry **no total row**. The
growth rates the pages state are derived from the series rather than read from
`assumptions`, which records a different rate on 66 of the 69 reports that carry
one. `docs/reports/CASH_FLOW.md` §8 has the measurements.

### The cover title that rendered as nothing

Building the fifth format meant auditing every path all 250 masters bind against
a row taken verbatim from production, and that found a defect in two formats that
had already shipped.

An unresolved binding renders as the **empty string**, not as a visible `{{…}}`.
The Borrowing Capacity and Comparison masters titled their cover `{{client.name}}`
— and `borrowing_capacity_assessments` carries `client_id` rather than a name,
while a comparison is stored against `report_ids` pointing at a table that has no
client-name column either. Both shipped a cover with no title at all and a running
foot beginning " · ". The Comparison adapter's `resolveClientName` had been
querying a column that does not exist, so PostgREST answered `42703` and the
error branch returned undefined every time.

The covers now name what each document is about: the Snapshot leads on its
serviceability band, the Comparison on how many properties it compares, and the
Cash Flow on the property. `cashFlowCatalogue.spec.ts` asserts which of the five
formats may bind a client at all — only the Portfolio Review, whose
`portfolio_analysis_reports.client_name` is populated on all 21 rows.

### Every generated document had a blank letterhead

`disclaimerPage()` is the last page of all 293 seeded templates and the family
covers set `{{org.name}}` as their wordmark. **Nothing published `org`** — not
one adapter, not the edge mirror, not the render route. So the contact block at
the foot of every report printed its labels with nothing beside them, and the
cover wordmark was blank, on every document this product has ever generated.

The preview never showed it: `SAMPLE_REPORT_DATA.org` is fully populated. That
is the trap `reportBindingProjection.pure.ts` was written for, in a second
place — a fixture in the catalogue's vocabulary passes while production is
empty.

`reportBindingProjection.spec.ts` had listed the six `org.*` paths under
"organisation, adviser and client identity live outside this row" since it was
written. True of the *row*, and read for four months as though it meant no
source existed. One does: `whitelabel_settings`, the single row the Branding
page writes. Four of the six now resolve —

| Binding | Column |
| --- | --- |
| `org.name` | `company_name` |
| `org.phone` | `email_signature_phone` |
| `org.email` | `email_signature_email` |
| `org.website` | `email_signature_website` |

— and `org.abn` and `org.address` stay absent, because there is no ABN column
and the stored address is an empty string. The disclaimer block omits a row
whose value is empty, so neither prints. An ABN is a legal identifier and a
plausible-looking wrong one is worse than a missing line.

`organisationProjection.pure.ts` reads those four columns and nothing else. Not
`email_signature_banner` — that is the image `REPORT_RULES.md` warns about — and
not `email_signature_disclaimer`, which is written for the foot of an email
rather than for print.

### 49 of the Investment Compass's 80 bindings resolved to nothing

Auditing every path the masters bind against a row taken verbatim from
production is what found the blank cover titles, and it found much more in the
oldest format on the system. Measured, then fixed by re-pointing the masters
rather than widening the projection — because the paths below genuinely have no
source, and inventing one is the worse outcome:

| What it bound | Why it could not resolve | Now |
| --- | --- | --- |
| A four-paragraph narrative page: `market.conclusion.headline`, `market.narrative`, `market.conclusion.body`, `property.rationale` | No adapter publishes `market`; `location_intelligence` carries amenities, commute, schools and transport, not prose | **The assessment page** — `investment_score.breakdown`, five weighted dimensions with a score and a `details` sentence each |
| A three-row risk register bound to `risks.0..2`, each with `.why` and `.action` | `investment_score.risks` is an array of plain **strings** whose length runs **0 to 1** across all 1,182 reports | One conditional row, its reasoning taken from the risk dimension's own `details` |
| `{{client.name}}` in the footer and cover, `{{author.name}}`/`{{author.title}}` on the method page | No client-name column; `client_property_id` on 2 of 1,182; **no `profiles` table at all** | Removed; the method page names the organisation and the property |
| `recommendation.rationale`, `financials.narrative`, `financials.fundingNote`, `financials.breakEvenRent`, `financials.loanFees`, `summary.narrative`, `assumptions.rentalGrowth`/`taxRate`/`sellingCosts`, `property.condition`/`tenancy`/`rationale` | No column for any of them | Removed, or replaced with a stored figure |
| `strengthsWatch` drawing two marks a column | `strengths` holds two on **47** of 985 scored reports and `weaknesses` on **15** | One each |
| `scenarioChart` bound to `tenYear.equitySeries` | Nothing published `tenYear`, so the format's one chart drew an empty plot | `financial_calculations.projections.moderate`, on 162 reports; absent on the rest rather than flat at zero |

That leaves 8 unresolved of 74, and every one is deliberate: the six
`property.images.*` (no adapter emits photographs, and the plates are
page-conditional so an unfilled one costs no page) plus `org.abn` and
`org.address`.

Two things the exercise recorded without fixing. **The grade is 55%
placeholder**: `breakdown.growthScore` and `demandScore` are weighted 40 and 15
and scored a flat 50 with no details on 919 of the 985 scored reports. And
`investment_score` is absent entirely on 197 of the 1,182.

### Two chart primitives could not draw what this format needed

Both were found by giving the Cash Flow masters a chart, and both were silent.

- **`chart-bar` could not draw a negative value.** It scaled every bar as
  `value / Math.max(1, ...values)` of the plot height, so an all-negative series
  — which is what a cash-flow projection is — asked for a rect of negative
  height, which is invalid SVG and renders as nothing. The domain now always
  contains zero and bars are measured from it, which leaves every all-positive
  chart identical to the pixel.
- **`sparkline` accepted only a literal `values` array** — the one input a
  template cannot supply, since a template is authored before the report exists.
  Three of the catalogue's chart styles resolve to `sparkline`, so those masters
  emitted a `dataPath` the block never read and drew an empty frame. It now
  accepts `dataPath`/`data`/`valueKey` like every other chart, with `values`
  still winning where it is given.

The masters chart **equity** regardless: it is positive on all 4,860 stored
elements, so every one of the four chart primitives a family might resolve to can
draw it.

### The Comparison format draws a thing whose size it does not know

Every other format draws a fixed document. A comparison ranks **2 to 5
properties** — 7 of the 50 stored rows compare two, 17 compare three, 9 compare
four and 17 compare five — and neither answer a fixed table can give is right: a
five-row table prints three empty rows on the two-property comparisons, and a
two-row table silently drops three properties.

So the ranking is drawn **four times, once per count, each under a conditional,
all at the same `y`**. One renders and the rest do not exist. `FlowItem.block`
may return several blocks for exactly this; the item's height is the tallest
variant's, so whatever follows clears all of them.

It is also the only format whose projection **normalises nothing**. The format
already had a normaliser for its own WeasyPrint route, so the projection
restates that model rather than re-reading the row — one reader, two renderers,
one answer to the 27 truncated records, the two score scales and the winner
pointers that name nobody.

**What is shared and what is not.** `master.ts` holds the shell — tokens
compiled from the family's colourway and measured type scale, the Google Fonts
faces, the `design_meta`, the slug and the tags. What is *not* shared is the
document: an Investment Compass report argues about a property and ends on a
ten-year projection; a Snapshot argues about a household's income and ends on
what a lender would advance against it. Bending one page sequence to cover both
with conditionals would produce a template that is neither, so each format
contributes its own composer and both compile through one shell.

That shell was extracted when the second format arrived. The alternative was a
second copy of sixty lines of token and `design_meta` assembly, which stays in
step for exactly as long as nobody edits it — the first colourway or font-axis
change would have repainted one catalogue and left the other on the old palette,
with nothing to say so.

### Two pages the Snapshot deliberately does not have

`docs/reports/BORROWING_CAPACITY.md` describes an eight-page document. Two of
those pages are absent here, and both absences are measured rather than lazy:

- **"How this was calculated"** — `explanation` is **null on all 143** stored
  assessments. The page would render empty on every report.
- **Audit trail** — a raw-versus-assessed ledger whose row count is unbounded.
  This page model is fixed-position with no reflow, so a twelve-entry trail runs
  off the paper. It belongs in the format's own generator, which can paginate.

### The Portfolio Review's bounded inventory

`docs/reports/PORTFOLIO.md` opens on four findings against the shipping
generator, and two of them are this page model failing to hold a portfolio: a
contents page whose numbers go out of true the moment a table spills (**F1**),
and an inventory that silently drops rows because the continuation index is
computed at a row height of 20 while the table was drawn at 22 — "a portfolio
needing a third page loses everything past the second, with nothing on the page
saying so" (**F4**).

These masters cannot paginate at all, so they must not pretend to. The
inventory is a **fixed four rows** — the observed maximum, `total_properties`
running 1–4 across all 21 stored reports — and a conditional block on the same
page says so whenever the portfolio holds more:

> The portfolio holds 6 properties and the table above draws 4.

That block costs its height whether or not it renders, because a conditional in
a layout that cannot reflow has to. It is worth paying: F4 is not that the
generator truncates, it is that it truncates silently.

### Prose whose name lies about its shape

`analysis.executiveSummary` on a stored portfolio report is an **object**, not a
paragraph. Within `riskAssessment`, three fields are single sentences and two —
`marketRisks` and `mitigationStrategies` — are **arrays**; all four fields of
`strategicRecommendations` are arrays, the three horizons included, despite
reading like single statements. `portfolioProjection.pure.ts` publishes a leaf
only where it is genuinely the shape claimed, so nothing can reach a page as
`[object Object]`.

The safe direction is not free either. The first draft of the projection took
all five arrays for prose and refused them, which would have blanked two fields
of the risk page and three of the actions page on **every** report — the same
outcome as binding a namespace nothing publishes, arrived at from the opposite
side. Both failures are silent; only reading the table distinguishes them.

The same file keeps the portfolio's *risk assessment* under the stored key
names rather than shortening them, because `risk.vacancy` already means
"reaction to three months vacancy" to the voice catalogue — a client tolerance,
not a portfolio exposure. One key cannot carry both senses, and the collision
would only have shown up in whichever surface holds both vocabularies at once.

### `design_meta.reportFormat`

Every family master now records which format it documents. It is what the QA
harness names artifacts by — both catalogues use the same variant codes, so
`pb-01` exists twice, and an artifact named by code alone had one format
silently overwrite the other's. The first run after Borrowing Capacity landed
reported 20 PDFs and left 10 on disk.

## Image plates

Two of the ten families carry photographs — **Luxury Editorial** and
**Architectural Property**. Nine of their fifty templates declare plates; the
tenth declares that it has none, which is the more interesting half.

| Template | `image_slots` | Plates | Cover |
| --- | --- | --- | --- |
| `le-01` Atelier | `four_briefed` | 3 interior | photographic |
| `le-02` Atelier Plate | `six_with_bleed` | 3 interior + 2 standalone | photographic |
| `le-03` Grand Folio | `four_briefed` | 3 interior | photographic |
| `le-04` Frontispiece | `three_interior` | 3 interior | typographic |
| `le-05` Monograph | `none` | — | typographic |
| `ap-03` Elevation | `four_measured` | 4 figures | typographic |

### A plate is a page

Every plate is a whole page of its own, and that is the design decision worth
knowing before changing anything here. The archetype runs its narrative plate
across the top of a content page with the heading reversed out of it. That is
the better picture and it does not survive contact with a fixed-position
renderer:

- **The pages are already full.** Inline plates were built first and cost eight
  of the ten plated variants their page — "Investment thesis" ran **123pt** past
  the content bottom on `le-03`, which is a page and a half of prose pushed off
  the paper. The seed build refuses to write a migration while the overflow log
  is non-empty, so this was caught rather than shipped.
- **Most reports have no photographs.** An inline slot reserves its height
  whether or not anything fills it, so the common case would be a hole in the
  middle of the argument.

A page solves both: it is measured against nothing, so it always fits, and it
carries its `conditional` on the *page*. `visiblePages` filters it out before
anything is laid out, so an unfilled plate costs **no page** rather than an
empty one.

The archetype's stated plate heights (74mm, 90mm, 60mm) are therefore recorded
in `resolvers.ts` comments and carried nowhere — a plate that fills the page has
no height to declare.

### Empty plates never print as holes

That phrase is the catalogue's own. Monograph is described as *"editorial
typography without image slots. Empty plates never print as holes because there
are none."* The design's answer to the failure mode was to remove the slots.

A family that keeps its slots needs the other half of that answer, and it is two
things working together:

1. `image` gained a `placeholder` prop. It **defaults to true**, so every
   pre-existing template is unchanged; the plates set it false, and an
   unresolved `src` then draws nothing at all rather than a grey bordered box
   announcing a missing photograph on a document somebody is paying for.
2. Every plate carries `conditional: property && property.images && property.images[n]`.
   Three failure modes collapse into one expression — `property` absent
   entirely (`evalConditional` rejects an expression naming an unbound
   identifier), `property.images` absent, and `images[n]` present but empty.

The cover is the one exception to "the page vanishes": there the plate is a
ground *behind* a composition, so the conditional sits on the two blocks rather
than the page. Losing an entire cover because a photograph is missing would be a
defect. Absent, the cover falls back to its field colour — which is exactly the
typographic cover `three_interior` and `none` use, so the two are one
composition rather than two.

### Bleed or measure

`bleed` is a property of the **family**, not of a plate:

- **Luxury Editorial** is a monograph. Plates run to the trim, with the asset's
  name reversed out of a scrim at the foot and the page ground set to the field
  colour so an unfilled edge is never white.
- **Architectural Property** measures. The plate is inset to the page margin and
  captioned `FIGURE N ·` in tracked mono, which is what a plate in a drawing set
  is. Symmetric on `margin` rather than the content measure: a plate page draws
  no running head and no rail, so there is no lane to align to.

### Nothing emits `property.images` yet

No report adapter emits that path today. That is forward-looking rather than
broken: a plate is a designed hole an operator fills in the Builder for a
specific report — the archetype's briefs say "Drop the hero photograph" — and
binding it now means the day an adapter carries photographs, every plate in two
families fills itself with no template change. Until then the binding resolves
empty and the plate prints nothing, which is the behaviour above.

`SAMPLE_REPORT_DATA` carries six base64 SVG **tonal studies** so previews, the
catalogue spec and the QA harness exercise the filled path. They are studies,
not photographs, and they are not stand-ins for stock imagery.

### jsPDF divergence

These props were added to the **HTML renderer only**. The library's entries all
declare `engine: 'weasyprint'`, and `render-template-pdf` compiles HTML, so the
production path is covered. The legacy jsPDF renderer ignores unknown props and
draws its existing defaults — a family template exported through it gets the
right content in the wrong typography. That is a known, bounded gap; it is not a
regression, because these templates did not previously exist.
