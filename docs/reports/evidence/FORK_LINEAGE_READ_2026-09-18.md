# One record, three documents — read as a suite, 18 September 2026

S5/S6 §5 asks for the five formats across two properties, every page read, with
**consistent facts across the suite**. That last check needs documents drawn
from the SAME record: the retained fixture set carries one Compass per property
and four children of a parent that was never retained, so nothing in it could
answer it.

`fork-investment-report` makes **no model call**. It loads the parent, runs
`loadSplitRegistry`, `readStrategyRecord`, `resolveVariantScore` and
`composeForkDocuments`, and writes what they return. Every one of those is a
module in this repository, so the two children can be composed here, spending
nothing, and rendered through the same journey the product runs.

**This is a replay.** The production modules ran; the deployed function did
not. Nothing was written to production, no credential was spent and no vendor
was called. §5's ten PDFs for 18 Annabelle Crescent and 262 Pallas Street still
need the authorised environment — the run package for them is §4 below.

## The lineage

Parent: **`09f8569e-21ca-48b9-a3b9-57f4793d0836` — 48 Redfern Street, Cowra NSW
2794**, a Compass with financials, 34 overrides and a withheld grade, all three
documents non-client (`client_property_id` null, `generated_by` null).

| document | sections | pages | bytes | front end |
| --- | --- | --- | --- | --- |
| Investment Compass (the parent) | 11 | 35 | — | 31/31 |
| Financial Analysis (`43fd62b9`) | 13 | 22 | 377 KB | **31/31** |
| Due Diligence (`63a5aa67`) | 7 | 25 | 389 KB | **31/31** |

The two child ids are minted per run — the pair above are the ones actually
rendered and measured, and `.verify/fork-replay.json` names whichever run wrote
it last.

Nine chapters composed from the record for the Financial report, two routed
sections replaced by them, and zero editorial blocks or placeholder rows
removed by hygiene on either child — the documents came out clean rather than
being cleaned.

Each journey did the whole thing: open, edit, persist, choose a template,
finalise, download, send. One finalisation, one render, the send reusing the
finalised document and the portal row naming it.

## Consistent facts across the suite

Six facts, read out of the three **rendered PDFs** rather than out of the
record:

| fact | Compass | Financial | Due Diligence |
| --- | --- | --- | --- |
| Purchase price | $555,000 | $555,000 | $555,000 |
| Weekly rent | $445 | $445 | $445 |
| Gross yield | — | 4.17% | — |
| Loan amount | — | $444,000 | — |
| Interest rate | — | 6.5% | — |
| LVR | — | 80% | — |

The three agree on every fact about the **asset** and only the Financial
Analysis carries the analysis of a **purchase** — which is §4's ownership
statement, confirmed in the documents rather than in the projection. The
Financial's other `$55x,xxx` figures are the ten-year value series at the
accepted growth assumption, and the `$400,000–$500,000` on the Compass and the
Financial is a market bracket inside the same routed sentence, not a price for
this property.

## Every page measured

`scripts/verify/report-pdf/measure.mjs` at 300 DPI against the text layer and
the rendered ink.

| document | pages | fonts | numbering | holes | issues |
| --- | --- | --- | --- | --- | --- |
| Financial Analysis | 22 | 12/12 embedded | 20 drawn, correct | none | **none** |
| Due Diligence | 25 | 12/12 embedded | 23 drawn, correct | none | **none** |

No clipping, no off-page text, no overlap, no mojibake, no blank page, no raw
token.

## Two measurement defects the read found

Both were the tool crying wolf, and both are fixed. A false caveat teaches
people to dismiss the warning, which is the rule the template-fit notice
already answers to.

### `not assessed` is a sanctioned value, not a placeholder

The sentinel family matched `not assessed`, and the single occurrence across
47 pages was the Investor Suitability Profile's own sentence:

> Whether a particular investor meets those requirements **is not assessed
> here** — no personal financial circumstances are supplied to this report, and
> none is assumed.

That is a disclosure a client is entitled to. And `Not assessed` is now a
SANCTIONED value elsewhere:
`PLANNING_CONTROLS_IN_THE_REPORT.md` §9 made it the risk register's level for
an absence that may not be rated — *"never Low, Minimal, Limited, Negligible or
Favourable"* — so the detector was flagging the correct answer. It no longer
names the phrase; `N/A`, `unavailable`, `not provided` and the rest stay.

### A band that runs to the foot is a short page, not a hole

Three pages were flagged SPARSE and all three were correct:

| page | what is on it | band |
| --- | --- | --- |
| Financial p3 | the Verdict band: $555,000 · $445 · 4.17% · −$467 | 62% |
| Due Diligence p2 | the contents list | 48.4% |
| Due Diligence p24 | Due Diligence Actions and the Disclaimer | 46.6% |

A **hole** has drawn content on BOTH sides — that is `closeDroppedBlocks`'s own
definition of the fault it repairs, and what a reader sees as a broken page. A
band that runs to the foot of the body means the page ended, which is what a
four-tile dashboard, a contents list and a last content page all look like.
`measure.mjs` now records where the band ends: a hole is an issue, a short page
is counted and named. Both documents pass.

## The concrete run package for §5's ten PDFs

What is NOT reachable from this session: the `investment_reports` rows for
18 Annabelle Crescent and 262 Pallas Street. `execute_sql` is not exposed on
the Supabase connector here (see `SCORE_COMPRESSION_INVESTIGATION.md` §3.1a for
the classification), and the alternative database routes are out of scope by
instruction. Two of the five formats also need a model call:
`condense-investment-report` is the only path to a Briefing or a Snapshot.

| format | path | model call | cost |
| --- | --- | --- | --- |
| Investment Compass | the stored parent row | no | — |
| Financial Analysis | `fork-investment-report` | **no** | — |
| Due Diligence | `fork-investment-report` | **no** | — |
| Executive Briefing | `condense-investment-report` | yes, 16k max tokens | one call |
| Snapshot | `condense-investment-report` | yes, 6k max tokens | one call |

So the ten PDFs need **four model calls in total** (two per property), and
nothing else that spends anything. Against the A$25 test limit that is a
rounding error; A$0.00 has been spent to date.

The run, in an environment that can reach the project:

```bash
# 1. Export the two parents as journey fixtures (SELECT-only).
#    row_to_json(investment_reports) for each, into
#    .verify/fixtures/<id>/report.json — the shape the harness reads.

# 2. The two free forks per property, no credential:
FORK_REPLAY_PARENT=<annabelle-compass-id> \
  npx vitest run src/lib/reports/__tests__/forkLineageReplay.spec.ts
FORK_REPLAY_PARENT=<pallas-compass-id> \
  npx vitest run src/lib/reports/__tests__/forkLineageReplay.spec.ts
# Each run mints fresh child ids and rewrites `.verify/fork-replay.json`;
# take the ids from that manifest rather than from this document.

# 3. The two condensations per property — THIS is the paid step, four calls:
#    condense-investment-report, targetTier 'briefing' then 'snapshot',
#    against each parent. Isolated test records: client_property_id null,
#    generated_by null, no portal delivery, no client notification, retained
#    for audit. Not re-run to obtain a better outcome.

# 4. Ten journeys and ten measurements:
for id in <the ten ids>; do
  node scripts/verify/report-journey/run.mjs --report "$id" \
    --expect-renderer weasyprint
  node scripts/verify/report-pdf/measure.mjs \
    .verify/out/journey/${id:0:8}/*.pdf
done
```

Step 3 is the one action that needs approval, and it is four model calls on
isolated records. Steps 1, 2 and 4 spend nothing.

## What this does and does not establish

It establishes that one record produces three documents that agree on the
asset, divide the analysis the way §4 says they should, and render with no
clipping, no hole, no raw token and no unembedded font — measured page by page
on real renders through the pinned engine.

It does not establish anything about 18 Annabelle Crescent or 262 Pallas
Street, whose rows this session cannot read. Nothing here is offered as those
ten PDFs.
