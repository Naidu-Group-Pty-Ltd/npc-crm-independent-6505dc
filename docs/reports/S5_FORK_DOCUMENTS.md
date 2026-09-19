# S5 — the Financial and Due Diligence reports, drawn for the first time

Two of the five client reports come out of `fork-investment-report`, and they
are the two that need no model call: the composite's own H2 sections routed
through the split registry, with the financial chapters typed from the
recorded calculation merged over them.

Until this stage neither had been produced outside a deployed Deno runtime,
because all 257 lines of that composition lived inside the function's
`index.ts`. Four specs reached it by reading its SOURCE as text. Nothing had
ever drawn either document and read it.

`forkSplit.pure.ts` is that code, moved. `npx tsx scripts/reports/s5ForkReports.mts`
produces both for both subjects and draws each through the supported template
path — `compileTemplateHtmlForPdf`, then WeasyPrint on the six options the
production route sends.

---

## What came out

Registry: the code defaults, which ARE production's — `report_engine_config`
holds no overlay for `split_routes`, `split_metadata`,
`split_section_order_fin` or `split_section_order_pldd` (measured 17 Sep 2026).

| | composite | sections | characters | pages | PDF/UA-1 |
| --- | ---: | ---: | ---: | ---: | --- |
| Kellyville · Financial | 15 | 13 | 23,838 | 21 | pass |
| Kellyville · Due Diligence | 15 | 10 | 51,403 | 29 | pass |
| Maryborough · Financial | 12 | 13 | 20,534 | 20 | pass |
| Maryborough · Due Diligence | 12 | 8 | 30,679 | 19 | pass |

The two Financial reports lost three and two pages respectively to the
landscape-table charge fixed in
[`S5_CONDENSED_DOCUMENTS.md`](./S5_CONDENSED_DOCUMENTS.md) §3 — they carry
the same ten-year projection, so they had the same near-blank page and the
same stranded heading. The content is unchanged; the pages it needed are
not.

Eight chapters composed from the record on each Financial report, with the
routed `Financial Risk Dashboard` replaced by the composed one and the
analysis's own risk entries carried under it. Hygiene removed nothing on any
of the four — no editorial labels, no placeholder rows, no empty stat cards,
no duplicate figures — which is what a Compass-40 parent should give it.

---

## Two defects, both found by drawing the document

### 1 · A figure the model asked for, printed in braces

The Due Diligence report for 18 Annabelle Crescent carried `{{stat block}}`
as body copy, between two paragraphs about schools.

`VIZ_DIRECTIVE_RE` requires `{{kind: args}}`. A payload-less token matches
nothing, so `directiveOnlyBlock` answered false and the line fell through to a
paragraph. Measured over the whole corpus: **12 occurrences across 5 reports**,
every one a bare kind — `timeline` ×3, `donut` ×2, `bars` ×2, `glance` ×2,
`stat block`, `tiles`, `gauge`.

There is nothing to draw, so there is nothing to print. It is the rule the
template renderer already holds — an unresolved `{{…}}` renders as the empty
string, never as a visible one — and it is COUNTED as a refusal, because a
silent drop looks exactly like a report the model chose not to illustrate. A
legend bullet that names the kinds in prose is untouched, because it is not a
directive-only line; a template binding (a dot in the name) and a numeric
token are left to the renderers that own them.

Measured after: **zero** `{{`/`}}` tokens across all five rendered documents.

### 2 · A page that is nothing but a heading — produced by the option that exists to prevent it

Pages 16 and 18 of the Kellyville Financial report carried `Base case` and
`Optimistic` and nothing else: a heading above a running foot, its scenario
table on the page after.

The sequence is the peel's own. `keepWithNext` lifts a trailing heading off a
full page so it opens the next one. The block that follows still does not fit
beside it, and the guard `current.length > 1` — which is there so a page is
never carried whole and the packer cannot loop — then refuses to peel it a
second time. The heading is stranded by the mechanism meant to save it.

A page made ENTIRELY of keep-with-next blocks is carried whole now. It cannot
loop, because whatever comes next is not peelable, so the page holding it has
a non-peelable block and is pushed. Measured: the Kellyville Financial report
went 26 → 24 pages and Maryborough's 25 → 22, and the heading-only pages are
gone from both.

---

## What was checked and is NOT a defect

**The Financial report carries a market-positioning section.** It opens with
the registry's own financial lens — *"Reading this through a financial lens —
focus on contribution, yield, repayments, serviceability and exit. The full
property and locality narrative lives in the Property & Location Due Diligence
Report."* — and its body is incomes, demand and supply. That is the
`financial_lens` route working, and it names where the other half is.

**The Financial report has a projection page AND a projection chapter.** Page
6 is the master's own dashboard — the equity chart and the assumptions. The
body chapter is the year-by-year modelling across three scenarios. A summary
and then the detail, not the same thing twice.

---

## Still open

**A heading and a lead-in sentence can still hold a page on their own.** Page
14 of the Kellyville Financial report is `10-Year Cashflow, Equity & Growth
Projection` plus one sentence, with the table overleaf. `leadsIn` recognises a
paragraph ending in a COLON, and this one ends in a full stop, so the pair is
not entirely peelable and the page is pushed. It is a much weaker version of
the defect above — the page says what is coming — and widening `leadsIn` to
any short paragraph would be a guess rather than a measurement.

**The Briefing and the Snapshot are not here.** They come from
`condense-investment-report`, which needs a model call for the condensed
location case; the composed half (financial chapters, score sections, SWOT,
the registry trim and the declared-order assembly) is deterministic and is
the next thing to exercise the same way.
