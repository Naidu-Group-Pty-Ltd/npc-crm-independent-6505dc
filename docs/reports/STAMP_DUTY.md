# Stamp duty

Read this before changing a rate, adding a jurisdiction, or touching anything
that puts an acquisition cost in front of a client.

## Where the numbers live

`supabase/functions/_shared/stampDuty/` — and nowhere else.

| Module | What it holds |
| --- | --- |
| `types.pure.ts` | The schedule shape. Bands, band modes, the five kinds of concession. |
| `schedules.pure.ts` | **Every rate for all eight jurisdictions.** The only file to edit for a rate change. |
| `engine.pure.ts` | Walks a scale, applies concessions and surcharges. Knows nothing about any particular state. |
| `validate.pure.ts` | Invariants, staleness, drift comparison. |
| `scheduleStore.ts` | The one module that touches the database. |
| `index.pure.ts` | Public surface — import from here. |

`src/utils/stampDutyCalculator.ts` and
`supabase/functions/_shared/stampDutyCalculator.ts` are one-line re-exports.
They contain no logic and must never regain any.

## Why it is built this way

In August 2026 this product had **four** stamp duty implementations that
disagreed with each other and with the revenue offices:

- `src/utils/stampDutyCalculator.ts` — its own bracket tables
- `supabase/functions/_shared/stampDutyCalculator.ts` — a hand-maintained
  "mirror" of that file which had drifted from it
- `financial-calculator-service/index.ts` — ~480 lines of a third set of
  brackets and concessions
- the seed of `stamp_duty_rates_cache` — a fourth set

Between them: NSW and the ACT a financial year or more behind, South Australia
missing its \$200,000–\$250,000 band entirely, Tasmania wrong in three bands,
Western Australia's base amounts and top rate wrong, and the Northern Territory
— which is **quadratic** below \$525,000 — modelled as straight-line brackets by
all four.

Alongside them, the reports page assessed duty by loading a third-party widget
from `calculatorsonline.com.au` in an iframe and reading the answer back out by
scraping the rendered DOM for the string "Stamp Duty" next to a dollar sign.
That vendor's tables were also a financial year stale, the vendor holds a remote
block-list that can replace the widget with an error message on any domain it
chooses (its 36 entries are almost entirely conveyancers, brokers and agencies),
every "Calculate" click posted the property value and the full report URL to the
vendor's server, and the state we detected from the property address never
reached the widget at all — it always assessed as NSW. All of that is gone.

The single-source design is the fix. A rate change is a data edit in
`schedules.pure.ts`; the validator and the golden tests both check it; the
browser and the Edge runtime read the same bytes.

## Things the tables really do that look like bugs

Do not "fix" these. Each is the published position and each is pinned by a test.

- **VIC steps up at \$960,000.** The \$960k–\$2m band is a flat 5.5% of the
  *entire* value, not a marginal rate, so duty jumps about \$130 at the boundary.
- **The ACT dips at \$1,455,000.** Its flat 4.54% band is calibrated to the
  investor scale, so an owner-occupier crossing the threshold sees duty fall by
  about \$13.
- **NSW dips 48c at \$103,000.** Revenue NSW rounds its band bases to whole
  dollars; the band beneath reaches \$1,662.50 against a declared \$1,662.
- **NT is a formula.** `D = (0.06571441 × V²) + 15V` for V (thousands) ≤ 525,
  then a flat rate on the *whole* value.
- **QLD's first home relief is a rebate, not a threshold.** \$17,350 deducted
  from home-concession duty, which is exactly the duty on a \$700,000 home —
  hence "no duty under \$700,000".
- **Tasmania currently has no first home concession.** The exemption to
  \$750,000 expired 30 June 2026. It is recorded as `kind: 'none'` with a note
  rather than deleted, because "there is no concession" is a fact a report
  should be able to state.

The monotonicity check therefore runs with a small tolerance
(`MONOTONIC_TOLERANCE_PCT`). It is an allowance for two known artefacts, not a
way of not looking — both are pinned by name in the tests, and a dip an order of
magnitude larger still fails.

## Changing a rate

1. Edit `schedules.pure.ts`. Update `year`, `effectiveFrom` and `sourceUrl`.
2. `npx tsx scripts/stampDuty/generate-seed.ts` and paste the output into a new
   migration (or regenerate the seed block in the existing one). **Never
   hand-write the seed** — that is how a fifth copy would start.
3. `npx vitest run src/utils/__tests__/stampDuty` — the golden tests check the
   figures against each revenue office's own worked examples, and the parity
   test checks the seed still matches the code.

Add a golden test for any new figure. The worked examples published by the
revenue offices are the best available oracle: QRO's \$6,555 on a \$730,000
first home, the SRO's \$21,970 for a Victorian PPR buyer at \$500,000, and WA's
FHOR meeting the general scale at exactly \$20,140 on \$550,000 vacant land each
independently confirm a whole chunk of a table.

## The dutiable value is not always the purchase price

On a house-and-land package the land and the build are separate contracts and
duty is assessed on the **land transfer alone**. That is ordinary practice on
every new build NPC reports on, so the calculator defaults a `new_build` or
`land_only` report to its recorded land price rather than the package price, and
offers both as one-click bases. The field is free-typed either way — a report
whose split is not recorded still needs the figure to be enterable.

`src/components/reports/dutiableValueBasis.ts` holds that decision for both call
sites (the pre-generation overrides tab and the manual override modal), so the
two cannot drift.

**The category moves with the amount.** A land transfer is a vacant land
transfer, and vacant land carries different first-home thresholds from a home —
NSW exempts a home to \$800,000 but land only to \$350,000; WA \$600,000 against
\$450,000. Assessing a land price under "new home" would silently test the wrong
ones, so choosing a basis sets the category it implies, the defaults are paired,
and the panel warns with a one-click correction if they ever disagree. The
category select stays editable for anything unusual.

Duty is reported against the dutiable value **and** against the purchase price
when they differ, because the client is budgeting against the package.

## The cache

`stamp_duty_rates_cache` holds one row per jurisdiction with the full schedule
in `schedule` (the old `brackets` column is deprecated — it could not express a
flat band, a formula, an owner-occupier scale, a premium scale, or any
concession).

| `data_quality` | Served? | Meaning |
| --- | --- | --- |
| `built_in` | yes | Identical to the schedule shipped in code. |
| `override` | yes, after validation | A human-published correction, so a rate fix can ship without a deploy. |
| `needs_review` | **no** | A verification sweep found something it could not confirm. |

`resolveSchedule()` validates every row it reads and falls back to the built-in
schedule on any doubt — wrong quality, expired, malformed, failed validation, or
the database being unreachable. A cache outage must never become a calculator
outage.

## The verification sweep

`update-stamp-duty-rates` runs weekly (`verify-stamp-duty-schedules-weekly`) and
**never writes a rate**.

This is the deliberate part. The function used to scrape eight revenue office
pages, pull numbers out of the markdown with a regex that took "the first dollar
amount and the first percentage on any line containing both", and upsert the
result as authoritative. Two accidents kept that from causing harm: the parser
never produced a usable bracket, and nothing read the table. Both are now fixed,
which would have made the old design dangerous rather than merely inert — a
half-successful parse would silently change what a client is told their
acquisition costs are, with no record of which number they were quoted.

So the sweep flags and reports; a person decides. It does two things:

- **Staleness** (no network needed): NSW and the ACT re-index every 1 July, so
  once the financial year rolls over their schedules are known to be wrong.
  This is the check that would have caught the year-stale figures this product
  was quoting.
- **Source consistency** (best-effort): if several threshold-sized amounts on
  the revenue office page do not appear anywhere in our schedule, the table has
  probably been reissued and someone should look. Treated as a weak signal,
  because that is what it is.

Reading a rate table out of arbitrary HTML reliably enough to bill a client on
is not a problem a regex solves. The previous attempt is the evidence.

## What is deliberately not modelled

- **Cash grants.** FHOG, the NT HomeGrown Territory grants, SA's grant — these
  are payments, not duty concessions, and netting them off duty would misstate
  the acquisition cost line.
- **Land tax and its foreign surcharges.** Annual, not at acquisition.
- **Commercial and industrial duty.** SA has exempted it since 2018 and the ACT
  changed its treatment on 1 July 2026; the schedules here are residential.
- **Eligibility.** The engine assesses what a buyer in a stated position pays.
  It does not decide whether they are a first home buyer, a foreign person, or
  an owner-occupier — occupancy periods, prior-ownership rules and residency
  tests are a conveyancer's call, and the UI says so on the panel.
