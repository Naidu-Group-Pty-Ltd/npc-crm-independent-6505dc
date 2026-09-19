# Recorded crime — the sources, verified by execution

2026-09-06, extended 2026-09-07. Every figure below was produced by
downloading and parsing the real files, not by reading documentation. This is
the acquisition log for `_shared/crimeIngest.pure.ts` (NSW/QLD),
`_shared/crimeIngestSaNt.pure.ts` (SA/NT), the `crime-data-ingest` edge
function and the rewired `crime-statistics-service`.

## The four integrated registers

### NSW — BOCSAR, by POSTCODE

`https://bocsarblob.blob.core.windows.net/bocsar-open-data/PostcodeData.zip`
("Recorded criminal incidents by month – by postcode", one of BOCSAR's
published open datasets; quarterly releases).

Measured: a 4.2 MB zip holding one 60 MB CSV — **38,564 rows, 622
postcodes, 21 offence categories** (transcribed verbatim into
`NSW_OFFENCE_CATEGORIES`), wide format with one column per month,
**Jan 1995 → Dec 2025**. Postcode-keyed, which is the platform's own
geography (the ABS POA tables and the report pipeline key the same way).

BOCSAR also publishes suburb quarterly data, per-LGA workbooks and
pre-computed 2/10-year trend books (`LGA_trends.xlsx` — LGA × offence ×
ten Apr–Mar years); the postcode monthly dataset was chosen because it
matches the request geography exactly and needs no name matching.

### QLD — QPS, by LOCAL GOVERNMENT AREA

`https://open-crime-data.s3-ap-southeast-2.amazonaws.com/Crime%20Statistics/LGA_Reported_Offences_Number.csv`
(data.qld.gov.au dataset `lga_reported_offences_number`; monthly releases).

Measured: 5.7 MB, **23,946 rows, 78 LGAs, months JAN01 → JUL26**,
2,226,978 numeric cells with zero blanks. Long format, one row per
(LGA, month), one column per offence.

Three quirks, all load-bearing:

1. **The header is 94 columns; every data row carries 95 cells.** The
   95th is an unnamed running row counter (Aurukun JAN01 = 1, FEB01 = 2 …
   across all 23,946 rows). The parser validates it equals the row number
   and discards it — a mismatch means column alignment cannot be trusted
   and the load refuses.
2. **`Common Assault'` carries a stray apostrophe** — QPS's own header,
   transcribed exactly (`QLD_HEADER`); "fixing" it would be the invisible
   column-name drift the 42703 class taught.
3. **The columns mix rollups with details**, so summing columns
   double-counts. The hierarchy was MEASURED (400/400 sampled rows per
   identity): `Offences Against the Person` = Homicide (Murder) + Other
   Homicide + Assault + Sexual Offences + Robbery + Other Offences Against
   the Person; `Offences Against Property` = its 7 parts; `Other Offences`
   = its 11 parts; Assault/Robbery/Sexual Offences decompose likewise
   (`QLD_DIVISIONS`). The ingest re-checks a sample per load and the
   reading layer presents ONE level at a time.

### SA — SAPOL, by POSTCODE

`https://data.sa.gov.au/data/api/3/action/package_show?id=crime-statistics`
→ one CSV per financial year, sixteen of them (2010-11 → 2025-26).

Measured: seven years parsed in full, 83,304–98,687 usable rows each, columns
`Reported Date, Suburb - Incident, Postcode - Incident, Offence Level 1/2/3
Description, Offence count`. Long format, one row per (date, suburb, offence
leaf) — **0 rollup rows and 0 Level 3 values mapping to more than one (L1, L2)**,
so summing is exact. Postcode-keyed, which is the platform's own geography.

**Three quirks, all load-bearing.**

1. **The catalogue holds a trap beside the data.** Sixteen *Family & Domestic
   Abuse* files sit next to the sixteen crime files, and SAPOL's own note is
   explicit: the FDA file is a SUBSET of the crime file for the same year and
   *"the two files must not be added together"*. `saFinancialYearLabel`
   matches only the crime family; every FDA name returns null and cannot be
   picked up by a stage asking for a year.
2. **One postcode arrives under two spellings.** `0872` carries 699 offences
   and `872` carries 9 more — the same remote postal area split in two by an
   export that lost the leading zero. Padding to four digits is not a guess.
3. **SAPOL records incidents outside the state** — 27 to 55 rows a year on
   postcodes 2000, 3000-range, 4xxx, 6430, 7253 and others. They are excluded
   and counted: keeping them would put "2 recorded offences" against Sydney's
   postcode 2000 in a register that is not Sydney's.

**And one finding that shaped the whole design: SAPOL reclassified its
offence categories from 2025-07, and it is a reclassification rather than a
rename.** Eight of nine Level 2 categories changed name — `ACTS INTENDED TO
CAUSE INJURY` → `ASSAULT`, `THEFT AND RELATED OFFENCES` → `THEFT`, and so on
— but so did their Level 3 leaves: `THEFT` carries `Theft from retail
premises` and `Theft from a person` where the old category carried `Theft
from shop` and `Theft from motor vehicle`, and `HARM OR ENDANGER PERSONS`
corresponds to no single old category at all. Any crosswalk would be this
programme's own invention, and a "change on the same window a year earlier"
computed across it would be a confident figure that is not a like-for-like
comparison.

So SA is stored at **two grains**:

| grain | span | prior year |
|---|---|---|
| Level 1 (`OFFENCES AGAINST PROPERTY` / `AGAINST THE PERSON`) | 2019-07 → 2026-06 | yes |
| Level 2 (the nine current categories) | 2025-07 → 2026-06 | **null**, with the reason stored beside it |

Level 1 is stable in every file AND measured continuous across the boundary —
the monthly series shows no step at 2025-07 (property ~6,900–8,000 a month
either side, person ~2,100–2,700) — which is why it carries the comparison and
the six-year history. An absent comparison that names its reason is worth more
than a present one that is wrong.

### NT — NT Police, by REPORTING REGION

`https://data.nt.gov.au/api/3/action/package_search?q=crime+statistics` →
one package per month; the latest carries the whole series.

Measured (June 2026 release): 910 KB, **9,723 rows, 31 months (2023-12 →
2026-06), 84,862 offences, 8 reporting regions, 21 Statistical Areas 2**.
Columns `As At, Year, Month number, Offence category, Offence type ,
Alcohol involvement, DV involvement, Reporting Region, Statistical Area 2,
Number of offences` — note the **trailing space in `Offence type `**, which is
the file's own and is transcribed exactly, for the reason QPS's `Common
Assault'` apostrophe is.

Two things measured rather than assumed:

1. **The rows are a cross-tabulation, not a hierarchy** — the opposite of
   QLD's trap. Across 7,256 distinct (period, offence, area) keys, **0 carry a
   repeated (alcohol, DV) cell and 0 mix the `-` marker with Yes/No**, so
   summing the cells is exact arithmetic. `assertNtCellsDisjoint` re-checks it
   on every load, because the day that stops being true is the day summing
   starts double-counting silently. Only `02 Assault` carries the cross-tab;
   every other category uses `-`.
2. **SA2 is populated for `NT Balance` only** — the 3,759 rows with a blank
   SA2 are exactly the six named urban regions' rows. Both grains are stored:
   the region is what a locality resolves to, and the SA2 is resolvable from a
   coordinate because the T-stream already built that lookup.

NT publishes no postcode and no population on this geography, so its reading
carries counts and their change and **no per-capita rate at all**.

## What is stored

`crime_reference`: one compact row per (state, area_kind, area, offence) —
last-12-month and prior-12-month counts plus the last six complete
calendar-year totals, with `latest_month`/`series_from` read from the
data itself (freshness of a load is not currency of the data). Each state
also writes `state_total` rows (plain addition over every area in the same
file) and a `crime_state_benchmarks` row.

**`prior12` is nullable, and `series_note` says why when it is null.** SA's
Level 2 rows are the case that forced it: 1,836 of SA's 2,527 postcode rows
carry a null prior and all 1,836 carry the note. A labelled row promises a
figure; this is the column admitting when there is not one, in words the
reader gets rather than a blank cell.

`crime_month_counts` stages per-month counts for SA and NT. NSW and QLD each
publish ONE file holding the whole series and write their windows in a single
pass; SAPOL publishes one file per financial year, seven of them at ~10 MB,
and no edge invocation holds 70 MB. So SA loads a year per call and a finalise
pass derives the windows — which also makes a corrected window a query rather
than a re-ingest.

**The NSW benchmark's denominator is named**: the 2021 Census
usual-resident population of exactly the postcodes in the BOCSAR file,
joined on the file's own keys — never a typed-in state figure. On the
first production load all **622 of 622** postcodes matched
`abs_census_poa`, giving 617,838 recorded offences (Jan–Dec 2025) over
8.13 M residents ≈ **7,598 per 100k**. QLD's benchmark carries counts
only (no LGA population source is integrated yet; the T-stream's ERP work
is where that lands), so QLD readings offer state count-change context and
never a rate with an unnamed denominator.

## What the reading refuses to say

No `safetyScore`, no `overallRating`, no trend adjective, no per-capita
rate without its denominator: the fabricated predecessor (§24) invented
all four, and a spec now bans the vocabulary from the reading, the
service and the prompt block. What a report gets is counts, their
arithmetic (change on the same window a year earlier, six-year totals),
the postcode's per-100k rate beside the state's where the denominator
exists, and the register's own reference period and name.

## Production load (2026-09-06)

Two lessons were paid for during the first load and are now in the code:

- **A whole-table bootstrap seals after stage one.** Both stages write
  `crime_reference`, so after QLD loaded, the NSW stage answered
  `forbidden`. The bootstrap arm is per STATE now: each state's first
  load opens without the secret and seals itself.
- **A 60 MB string does not fit the edge worker.** The first NSW attempt
  died at `WORKER_RESOURCE_LIMIT` inflating the zip via jszip. The stage
  now locates the single deflate entry from the zip's central directory
  (`zipSingleDeflateSpan`) and STREAMS it through
  `DecompressionStream('deflate-raw')` into the incremental accumulator —
  verified byte-identical to the whole-string parse against the real
  archive before deploying.

Loaded and spot-checked in production, byte-identical to the local parse:
NSW 13,062 + 21 rows (latest 2025-12; POA 2150 Theft 2,968 last 12 months
vs 2,830 prior); QLD 7,176 + 92 rows (latest **2026-07**; Brisbane
Unlawful Entry 2023 total 12,963).

## Production load (2026-09-07) — SA and NT

Every figure the deployed function reported matched the local parse to the
digit, which is what makes the deployed parser the same parser:

| | rows | offences | months | areas |
|---|---|---|---|---|
| NT (one call) | 9,723 | 84,862 | 2023-12 → 2026-06 | 8 regions, 21 SA2 |
| SA FY2025-26 | 93,447 | 116,151 | 2025-07 → 2026-06 | 333 postcodes |
| SA FY2019-20 … FY2024-25 | 83,304–98,687 each | 99,062–121,416 | seven years to 2019-07 | 336–341 |

Finalised: **2,527 SA postcode rows** (691 Level 1 + 1,836 Level 2) and 10
state totals; **67 NT region rows**, 181 SA2 rows and 9 state totals. SA's
benchmark: 116,151 offences over **1,790,479** 2021 Census usual residents of
the 342 matched postal areas (of 350 in the file) = 6,487 per 100k, the
denominator named the way NSW's is. NT keeps `population` null and offers
count-change context only.

Spot-checked against the source: Adelaide's postcode 5000 reads 6,051 property
and 2,091 person offences in the last 12 months (−3.6% and −5.9%), with THEFT
4,130 and no prior; Darwin reads 2,769 thefts against 3,329 (−16.8%).

## The states that are still honestly absent

VIC's Crime Statistics Agency refuses scripted clients from every vantage this
project holds (403 from the sandbox AND from Supabase egress — the DFAT
class). WA, TAS and ACT publish LGA or suburb tables in varying shapes, none
verified by execution yet. `crime-statistics-service` answers
`no_data_for_location` for them, naming the real register — a state without a
loaded register has no figures, not borrowed ones.

## Refresh

Re-invoke the stages with the internal edge secret:

| stage | cadence |
|---|---|
| `{"stage":"nsw"}` | quarterly |
| `{"stage":"qld"}` | monthly |
| `{"stage":"sa","fy":"2026-27"}` then `{"stage":"sa","finalise":true}` | per financial year, plus a re-run of the current year as SAPOL republishes it |
| `{"stage":"nt"}` | monthly |

Both new stages discover their file through the portal's own catalogue rather
than a pinned URL, because SAPOL's resource ids change with every release and
NT publishes a new package each month — a pinned URL would go stale silently,
since a 404 on a refresh looks like a network problem. A wanted release that
is not in the catalogue is a 404 naming what IS there.

Rows carry the data's own months, and every parse re-runs the full refusal
battery, so a drifted or truncated file refuses instead of loading. The two
tolerances are deliberately different: a row the register declines to place
(`NOT DISCLOSED`, 1.18–1.90% of every SAPOL file) is the register being
careful and is counted and reported; a row of the wrong SHAPE is a defect and
is capped at 0.1%, the measured worst case being one row in 84,949.
