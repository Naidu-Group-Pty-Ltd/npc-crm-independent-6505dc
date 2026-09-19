# Template Library — the NPC Services Design System layer

How the forty seeded templates get their look, and how to change it.

---

## The problem this solves

The catalogue has always carried a `style` axis — `corporate`, `editorial`,
`minimal`, `luxury`, `technical`. Until this change it was **metadata with no
visual consequence**. Every template compiled to:

- `Helvetica` for both heading and body, on every one of the forty
- 17pt headings, 9.5pt body, everywhere
- pure white paper
- one of six ad-hoc colourways (`navyGold`, `slateBlue`, `teal`, `ember`,
  `forest`, `plum`, `steel`, `monochrome`) that appeared nowhere else in the
  product
- a full-bleed 26pt slab of dark colour across the foot of every page
- `luxury`, declared in the taxonomy, used by **zero** templates — a filter chip
  that always returned nothing

So a user who filtered the library to "editorial" got back documents
indistinguishable from "technical", and none of the forty looked like the
dashboard that produced them.

## The fix, in one line

**`style` became structural, and the colours came home to the brand.**

Each style value is now a *voice*: a complete set of paper, display face, type
scale, rule treatment and rhythm. Every colour is the hex form of a token that
already exists in the NPC Services Design System's `tokens/colors.css`.

---

## Where things live

| File | What it owns |
| --- | --- |
| [`scripts/template-library/designSystem.ts`](../../scripts/template-library/designSystem.ts) | `BRAND` hexes, the five `VOICES`, the six `ACCENTS`, and `voiceTokens()` which compiles them into a template's `tokens` |
| [`scripts/template-library/blocks.ts`](../../scripts/template-library/blocks.ts) | Voice-aware block helpers. `beginTemplate(style, accent)` opens a template; every helper then sizes itself from the active voice |
| [`scripts/template-library/templates.ts`](../../scripts/template-library/templates.ts) | The 12 core templates |
| [`scripts/template-library/templatesExtended.ts`](../../scripts/template-library/templatesExtended.ts) | The other 28 |
| [`scripts/template-library/buildDesignSystemCards.ts`](../../scripts/template-library/buildDesignSystemCards.ts) | Generates the Design System pane cards **from** the module above, so the published swatches cannot drift from the compiled hexes |

---

## The five voices

Each is anchored to a real document from the property-advisory world rather than
to an adjective, which is what stops them collapsing back into the same page in
a different colour.

| Voice | `style` | Display / body | Paper | Section rule | Ships |
| --- | --- | --- | --- | --- | --- |
| **Chancery** | `corporate` | Playfair Display / Inter | porcelain | 1.5pt full accent | 8 |
| **Broadsheet** | `editorial` | Fraunces / Inter | warm ivory | 0.6pt beige hairline | 4 |
| **Slip** | `minimal` | Inter / Inter | white | 2.5pt short accent stub | 13 |
| **Marque** | `luxury` | Cinzel / Inter | warm ivory | 0.75pt double accent | 3 |
| **Cadastre** | `technical` | Public Sans / Public Sans + IBM Plex Mono | porcelain | 1pt hairline | 12 |

Playfair Display and Cinzel are the two faces **the product already ships**
(see the design system's `assets/fonts/`), so a report cover matches the
certificate the same client was issued last month.

Cadastre is the only voice that sets a mono face. That is not decoration: a
ten-year projection is only readable if the columns line up, so figure columns
are set in IBM Plex Mono and right-aligned. Every other voice still gets
`font-variant-numeric: tabular-nums` on table cells and KPI values.

## The six accents

Voice sets the typography and the paper; **accent sets the colour**. Splitting
them is what lets forty documents stay coherent without becoming forty copies of
each other.

| Accent | Hex | Design-system source | Used by |
| --- | --- | --- | --- |
| gold | `#D9A521` | `--brand` | investment |
| amethyst | `#6128C3` | `--primary` (light) | suburb, postcode, statewide |
| info | `#0284C5` | `--info` | comparison |
| evergreen | `#188C42` | `--success` at 32% L | cash flow |
| orchid | `#8546CE` | `--accent` | client forms |
| bronze | `#4B390B` | `--brand-950` | compliance |

`--success` is darkened from its screen value (45% L) because the bright green
is illegible under 9pt type on paper.

## The signature

The **wide uppercase eyebrow** — `--tracking-eyebrow`, 0.18em — is already the
brand's strongest typographic signature; the design system's own
`guidelines/type-eyebrow.card.html` calls it "how every NPC surface announces
itself". In the report library it was used on covers only.

It now sits above every section heading. That is structure encoding something
true rather than decoration: a reader eleven pages into a dossier always knows
which section they are in.

---

## Changing the design

1. Edit a voice or accent in `designSystem.ts`.
2. `npm run templates:library:seed` — revalidates all forty against the live Zod
   schema and the production renderer allow-list, then writes a new migration.
3. `npm run templates:library:verify` — the catalogue test suite.
4. `npm run templates:library:cards`, then push `.design-system/report-templates/`
   to the **NPC Services Design System** project with the DesignSync tool so the
   published cards match the code.

### What the build refuses to write

`buildSeedCatalogue.ts` fails rather than emitting a migration when:

- a schema does not parse against `ReportTemplateSchema`
- a block type is outside the production renderer allow-list
- the publish gate rejects it, or a page has no blocks
- **a page's content runs past the footer.** `flow()` records every stack that
  ends below 774pt (`CONTENT_BOTTOM`). Added because a change to the shared type
  scale can push content under the footer on some subset of forty templates, and
  the only symptom would be a customer's report with a truncated table
- **the declared `style` is not the voice the template was built in.**
  `beginTemplate()` and the returned `style` are set in different places; if they
  drift, the library filters a user to "editorial" and hands back a technical
  layout. The build compares the compiled display face and stops

## The ten-year cash flow variations

Three catalogue entries derived from
[`src/components/reports/CashFlowAnalysisModal.tsx`](../../src/components/reports/CashFlowAnalysisModal.tsx),
the jsPDF generator that produces the report the business actually sends. That
generator is a fixed pipeline — one layout, no variants, nothing selectable
from the library. These bring its structure into the catalogue as editable
templates.

| Slug | Voice | Orientation | For |
| --- | --- | --- | --- |
| `cash-flow-ledger` | Cadastre | Portrait | The faithful successor. Inputs and costs, the banded matrix at milestone years, outcome cards, trends and yield |
| `cash-flow-matrix` | Cadastre | **Landscape** | The analyst's edition. All ten years across a full spread |
| `cash-flow-position` | Chancery | Portrait | The client read. Seven rows, the charts, and what it means |

Carried over from the legacy render: the section order, the four banded groups
(statistics / cash deductions / non-cash deductions / summary), red negatives,
the dark summary cards, the gold accent, and the written insight blocks.

Not carried over: the hardcoded `#2D3748` slate and `#CA8A04` gold. Those are
`token:bg` and `token:primary` under the NPC voices, so the white-label
pipeline can re-skin them and `isBrandSafe()` stays true. The legacy gold sits
inside the NPC brand-gold family, so the output reads as its predecessor.

**Why the accent is gold, not evergreen.** `CATEGORY_ACCENT` maps `cash_flow`
to evergreen; these three override it. They are the legacy report's successors
and the legacy report is gold. The accent argument to `beginTemplate()` exists
so a template can make that call.

**Why one is landscape.** The projection is twelve columns. That is 42pt per
column on a portrait page — which the legacy handled by dropping to 6pt type —
and 63pt across the long edge. `cash-flow-matrix` is the only landscape entry
in the catalogue, and it is landscape because the data shape demands it rather
than for variety. `useLandscape()` in `blocks.ts` switches the page size;
`deriveEntryFacts()` reads the orientation straight off it.

### Applying a new catalogue migration

There is no CI step that runs migrations — they are applied by hand. A
regenerated catalogue therefore does **not** reach the UI on merge, and the
symptom is a Template Library that still shows the previous design. To apply:

```bash
supabase db push --project-ref <ref>          # or
psql "$DATABASE_URL" -f supabase/migrations/<file>.sql
```

or paste the file into the Supabase dashboard SQL editor. The statement is
idempotent — it upserts on `(slug, version)` and touches only seeded slugs, so
re-running is safe and operator-promoted entries are never disturbed.

To check which catalogue a database is serving:

```sql
select style, count(*), max(updated_at)
from public.template_library_entries group by style;
```

Pre-design-system rows carry `fonts.heading = 'Helvetica'`; current ones carry
a voice face and a `line` colour token.

### Migration files are append-only

Supabase records a migration by its version prefix and never re-runs it, so
editing an applied file changes the repository and nothing else. The generated
SQL upserts the **whole** catalogue on `(slug, version)`, so a new file is a
complete replacement rather than a delta. Bump `MIGRATION` in
`buildSeedCatalogue.ts` when the current one may already have been applied.

---

## Renderer support added for this layer

All additive, all default-preserving — an existing template that sets none of
these renders exactly as before.

| Block | Prop | Effect |
| --- | --- | --- |
| `text-block` | `eyebrow`, `eyebrowSize`, `eyebrowColor` | The section eyebrow. HTML and jsPDF renderers both |
| `data-table` | `numericColumns` | Right-aligns figure columns |
| `data-table` | `numericFont` | `token:mono` → `var(--font-mono)`; sets figures in the voice's mono face |
| `data-table` | `borderColor` | Table border follows `token:line` instead of a hardcoded grey |
| `footer` | `ruleColor` | Hairline above the footer, so it sits on the paper instead of in a dark slab |
| `kpi-grid`, `callout` | `radius` | Print wants far less rounding than screen; the voice sets it |

`token:*` now addresses two maps — colours and fonts. A prop whose name ends in
`Font` resolves against `tokens.fonts`; everything else is a colour. The
catalogue test suite checks both.
