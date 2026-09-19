# Open-data growth evidence — the zero-cost growth stack

*15 September 2026. Read this before touching `_shared/reports/market/openData/*`,
`openDataSalesEvidence.pure.ts`, `salesRegisterRead.ts`, the
`market-sales-ingest` Edge Function, the `market_sales_medians` table, or the
open-data block in `generate-investment-report`'s market-evidence section.*

## 1. The problem it answers

The Investment Grade requires a capital-growth reading before a letter is
printed (`SCORING_V2_ACTIVATION.requiredDimensions = ['growth']`), and the
only wired source of one was Domain's suburb-performance series. Measured
from production on 15 Sep 2026, Domain answers every request on that key with
HTTP 403 *"Operation not permitted on project"* — the project the key belongs
to has no API package attached (`docs/integrations/DOMAIN_ACTIVATION_REQUEST.md`).
Attaching one is the owner's action in Domain's portal, and whether it costs
anything is a question Domain's portal does not answer in public.

The owner's brief was a no-cost route that changes no infrastructure and no
key. The 8 September zero-cost inventory (`zeroCostSources.pure.ts`, ME-6)
had concluded that the corpus sat in the two states with the least usable
open data — QLD (50.8%) and WA (20.6%) — and that Queensland published
"none". That finding was wrong about Queensland, and the correction is what
this document records.

## 2. What was measured, and from where

Two egresses matter and they disagree. The **production egress** is the
Supabase project's own network (`pg_net`), which a scheduled or operator-run
load actually uses; the development container reaches none of these hosts.
A third, a **GitHub-hosted runner**, was used to read the workbooks, because
`pg_net` stores a response as text and a workbook comes back as five bytes.
The manual workflow `.github/workflows/evidence-source-inspect.yml` is that
reader; it writes nothing and holds no secret.

| source | production egress (`pg_net` request) | GitHub runner | what it holds |
| --- | --- | --- | --- |
| QGSO residential land development activity spreadsheet, all monitored regions | **200**, `application/vnd.openxmlformats…`, 617,018 bytes (240150); page 200 (240130) | read: 18 sheets; `SalesDetached_Price`, `SalesDetached_Number`, `SalesAttached_Price`, `SalesAttached_Number`, each 99 rows × 104 columns | median price and number of detached and attached dwelling sales, **quarterly from June 2008 to March 2026**, for every monitored LGA plus regional groupings, from the Queensland Valuation and Sales database |
| NSW DCJ Rent and Sales Report, sales tables (March 2026 quarter) | **200**, PK header (240181); report page 200 (240153); previous-reports page 200 listing 70 workbooks back to 2017 (240256) | read: `Explanatory Notes`, `LGA` (2,850 rows), `Postcode` (1,455 rows) | sale-price quartiles, **median** (thousands of dollars) and **count** by postcode and by LGA, for `Total`, `Non Strata` and `Strata`; `-` where thirty or fewer sold; one workbook per quarter |
| VIC Property Sales Report, median house by suburb | 403 Cloudflare interstitial (ME-6: 126902/126922; DataVic and data.gov.au catalogue entries 200 but point at the same host: 240126/240127) | **403 "Just a moment…"** | the finest open series in the country, unreachable by a scripted client on three networks |
| SA metro median house sales | CKAN `package_show` **403** (240128), `package_search` 403 (240151) | 200: 43 quarterly XLSX resources, CC BY | reachable from GitHub only |
| City of Melbourne house prices by small area | 200 CSV (240185) | 200 | one LGA; the growth shape exactly |
| NSW Valuer General bulk PSI | `valuergeneral.nsw.gov.au` 403 (240125); `valuation.property.nsw.gov.au` DNS failure (240184) | DNS failure | individual sales; and the portal's licence page reads CC BY-NC-ND, which forbids commercial reuse |
| data.qld.gov.au CKAN | 202 bot challenge (240129) | — | not needed: QGSO's own site answers |
| WA catalogue | 200 (240131): Landgate "Sales Evidence data" and "Perth Metro" under *Custom (Other)* | — | **no open median sale price series in WA** |

The two that decide the strategy are the first two rows: Queensland at LGA
grain and New South Wales at postcode grain, both reachable from the
production egress under an open licence.

## 3. Licences, in the publishers' words

- **QGSO**: *"The Residential land development activity profiles are licensed
  under a Creative Commons Attribution 4.0 International licence. You are
  free to copy, communicate and adapt the work, as long as you attribute the
  authors."* (statistics.qgso.qld.gov.au/rlda-profiles). The site's general
  copyright notice says specific licence terms prevail over it.
- **DCJ**: *"Unless otherwise stated, material on this website is licensed
  under a Creative Commons Attribution 4.0 License (CC BY 4.0)."*
  (dcj.nsw.gov.au copyright and disclaimer).

Attribution travels on every row (`source`, `source_url`, `licence`) and on
every evidence point's `sourceNote`, and each point is stamped
`licensingStatus: 'open'`, `acquisition: 'open_public'` — the footing that
makes a figure both production evidence (`mayEnterProductionEvidence`) and
printable to a client (`mayReachClientReport`). Domain's series is neither
until its rights follow-up is answered.

Two sources were **refused on licence**, not reachability: SQM Research's
asking-price series ("for personal reference only … for commercial purposes
please reach out to us") and the NSW Valuer General's bulk sales (CC BY-NC-ND).
They would have been the easiest to fetch.

## 4. The register

`market_sales_medians` (migration `20261125090000`), one row shape for both
publishers:

| column | meaning |
| --- | --- |
| `state` | `QLD` or `NSW` |
| `area_kind` | `lga`, `postcode`, or `region` (a publisher grouping such as *South East Queensland*, and the state total — context and benchmark, never subject evidence) |
| `area` | the publisher's own label: `Moreton Bay (C)`, `2155`, `Total (all monitored regions)`, `New South Wales` |
| `area_token` | the lookup token (`salesAreaToken`): a postcode's digits, or the council name with its dressing stripped — `Moreton Bay (C)` and the cadastre's `MORETON BAY REGIONAL` both become `BAY MORETON` |
| `dwelling_type` | `house`, `attached`, or `any` (DCJ's *Total* — a real answer, never read as `house`) |
| `period` | the quarter the sales settled in, as its END month (`2026-03`) — the data's own vintage |
| `median_price`, `sales_count` | dollars and settled sales; **null where the publisher suppressed**, never zero |
| `source`, `source_url`, `licence` | attribution, on every row |

Three rules. **The period is the quarter, never the load date** — `asOf`
on every point is derived from it, and the growth confidence's freshness
factor ages it honestly. **An area is stored under the publisher's label and
found by token**, so one indexed read answers a cadastre council name or a
boundary-service postcode. **A suppressed figure is null**: DCJ prints `-`
where thirty or fewer sold; a zero median would be a real number about
nothing.

### The loader — `market-sales-ingest`

Stages, one per publisher, re-invoked to refresh:

- `qld` — fetches the QGSO residential development page, **discovers** the
  dated all-regions link (never a pinned URL: the file name carries its
  date), downloads the workbook, parses the four sales sheets
  (`qgsoRldaSales.pure.ts`) and upserts every LGA and regional quarter.
- `nsw` — lists the sales tables on the current and previous-reports pages
  (`dcjSalesLinks`), loads the newest quarter and the same quarter one,
  three, five and ten years earlier (`chooseDcjSalesFiles`; a horizon the
  publisher never issued is recorded as absent, never substituted), or the
  quarters named in `periods`. A workbook that refuses is recorded and the
  others still load; a run that loads nothing answers 422.
- `probe` — asks whether both pages answer from production, writes nothing.

The parsers refuse rather than store: a moved header (`Region / LGA`,
`Quarter`, `Median Sales Price`), a month that ends no quarter, a dwelling
label outside `Total / Non Strata / Strata`, a workbook whose own *Reporting
period* line disagrees with the quarter its link named, too few areas or
quarters, and a median outside the measured dollar bounds all throw before a
row is written. Every run writes a `market_sales_sync` row with the file,
its own vintage and the counts — or the refusal.

Run it from the production database (the same route the probes use; the
gateway JWT is on, and `verifyAuth` inside accepts the service role):

```sql
select net.http_post(
  url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url'), '/')
         || '/functions/v1/market-sales-ingest',
  headers := public.cron_service_role_headers(),
  body := '{"stage": "qld"}'::jsonb,
  timeout_milliseconds := 120000);
-- then '{"stage": "nsw"}', and read net._http_response for the detail.
```

Refresh cadence: QGSO publishes about ten weeks after a quarter ends; DCJ
about three months. Re-running a stage is idempotent (an upsert on the
primary key). No pg_cron job is scheduled by this change — the caller gate
(`check-cron-caller-names.mjs`) wants the signed route, and that is a
separate, small piece of work — so a load is an operator act, quarterly.

## 5. The adapter — `openDataSalesEvidence.pure.ts`

`openDataSalesPoints` turns one area's rows into the points the Growth
scorer reads: `medianPrice`, `priceSeries`, `growth1Year`,
`growth3YearCagr`, `growth5YearCagr`, `growth10YearCagr`, `salesCount`, and
from the state-wide row the `benchmark*` counterparts. The arithmetic is the
Domain adapter's (`compoundAnnualGrowth`), and a horizon is computed only
where the same quarter exists that many years earlier — never a nearer
quarter called a five-year figure.

**The grain is the publisher's, and the scorer prices it.** Every point
carries `level: 'lga'` (QLD) or `'postcode'` (NSW) and the area under the
publisher's own label; `growthScoring.pure.ts` scores the geography factor
at 55 for an LGA and 80 for a postcode against 100 for a suburb. A council
median is therefore a lower-confidence measurement of growth, never a
substitute claiming to be the suburb — and never absent. The zero-cost
inventory's grain rule was narrowed to match (`zeroCostEvidence.spec.ts`):
a state or capital-city price is context; a council or postcode median is
Growth at its own grain.

**The dwelling type is matched or said to be unmatched.** The engine's
`house` asks for the `house` series, then `any`; `attached` for `attached`,
then `any`; a fallback is stamped `dwellingTypeMatched: false` and noted,
and the dwelling-type confidence factor prices it. Land is refused: the
register holds dwelling sales.

## 6. Where the generator asks

In the market-evidence block of `generate-investment-report`, **after Domain
and before the population driver**. Queensland's register is keyed by local
government area, which the cadastre names for the verified coordinate
(`planningData.parcel.lga`); New South Wales's by postcode, which the
boundary service resolved (`marketPostcode`), with the cadastre's council as
a second ask where a postcode's rows are suppressed. Nothing is asked for a
typed suburb or a parsed four-digit token — the rule Domain and the crime
evidence answer to (`openDataGrowthWiring.spec.ts` pins it).

Where Domain also answered, `mergeEvidence` decides per measure: a
dwelling-matched point beats an unmatched one, then the finer geography
wins, so a suburb series outranks a council one the day Domain's package is
attached, with no code change. The provider is pushed to
`providersConsulted`, and an area the register does not hold is pushed to
`providersUnavailable` with the reason *"the register holds no rows for lga
X (load it with market-sales-ingest)"*, which the growth gap prints. The
gap's remedy now names the loader beside Domain's portal.

A second provider also lifts the scorer's `sourceIndependence` factor from
55 to 85 once Domain answers too — corroboration is scored as its own claim.

## 7. What a client sees

An open point prints its provenance: *"Moreton Bay (C) local government
area, QLD — houses, 1,873 sales, 2026-03-31"* (`describePoint`), and the
`sourceNote` names the Statistician's Office and the Queensland Valuation
and Sales database. Nothing here is withheld under licensing, which is the
difference from a Domain figure today.

## 8. What remains, honestly

- **Western Australia (20.6% of the Growth-ready corpus)** publishes no open
  median sale price series; Landgate's products are *Custom (Other)*. A WA
  report still withholds its grade for growth, and the gap says so.
- **Victoria** is walled to scripted clients on every egress tried. The
  licence permits the file; only a browser can fetch it. The route that
  would work — an operator downloads the CC BY workbook and the platform
  ingests the upload — is not wired: `evidenceIngestion.pure.ts` validates
  and projects but nothing on the generation path reads what it produces.
  A `vic` stage that takes an uploaded workbook is the next step.
- **South Australia** (2.9%) is refused from the production egress and open
  from GitHub; a runner-hosted loader posting to `market-sales-ingest` would
  reach it. Not built.
- **Tasmania, the ACT and the Northern Territory** were not measured for
  sale prices.
- **Domain stays first-class.** Attaching the package makes suburb-grain
  points, which win the merge; nothing here replaces that.
- **The first real grade under this stack is a production event**: the
  loader has not run against production and no report has been regenerated
  with the register populated. §9 lists the proof to take.

## 9. Verification

Verified here: 45 new specs across `openDataSalesRegister`, `qgsoRldaSales`,
`nswDcjSales`, `openDataSalesEvidence` and `openDataGrowthWiring`, plus the
updated `zeroCostEvidence` spec; the QGSO parser against the workbook's
transcribed header rows and the DCJ parser against transcribed postcode and
LGA rows; Deno type-checks of every new module and the loader; the generator
at its frozen 14 baseline errors with none from the wiring; the verify-jwt,
column-name, registry, static-auth, mass-assignment, error-disclosure and
cron-caller gates; eslint on every changed file.

Not verified here, and the order to take it in: (1) apply the migration;
(2) run `{"stage":"probe"}` and read the answer; (3) run `qld` and `nsw` and
read `market_sales_sync`; (4) invoke `investment-scoring-service` for a QLD
subject with a register-backed `marketEvidence` (or regenerate a QLD
report) and confirm `measuredDimensions` includes `growth` and the record
carries a grade; (5) the same for a NSW postcode.

## 10. The second reading, 16 September 2026: every state, and the archive

§8 recorded what remained after the first stack: Victoria walled, South
Australia refusing this project's egress, Western Australia with no open
series at all. The owner asked for the same answer for those states "with
the tools we currently have and at no extra cost". Three things closed it.

### 10.1 The Internet Archive is a delivery route

The Victorian Valuer-General publishes the finest open growth series in the
country — median house and unit prices by SUBURB, calendar years since
2015 and the latest five quarters — under CC BY 3.0 AU, and
land.vic.gov.au answers every scripted client with a Cloudflare challenge.
A browser User-Agent from production changed nothing (pg_net 245207,
"Just a moment…"). But the Wayback Machine has crawled that host for
years, its CDX index answers the production egress (pg_net 245236), and
the `id_` flag returns the ORIGINAL bytes of a capture (pg_net 245237:
200, `application/vnd.openxmlformats…`, PK header). The newest captures
were three weeks after publication:

| File | Captured | What it holds |
|---|---|---|
| `houses-by-suburb-2015-2025.xlsx` | 2026-08-03 | 796 localities × 11 calendar-year medians |
| `units-by-suburb-2015-2025.xlsx` | 2026-08-03 | 462 localities × 11 calendar-year medians |
| `median-house-q4-2025.xls` | 2026-08-03 | 772 localities × Dec 2024–Dec 2025 quarters, sales count |
| `median-unit-q4-2025.xls` | 2026-08-03 | 444 localities × the same |

South Australia's quarterly suburb workbooks (`lsg_stats_YYYY_qN.xlsx`,
the Land Services Group's metro median house sales) are in the archive
likewise: forty-two files from 2015 Q1 to 2025 Q1 (pg_net 245280), each
holding the quarter and its year-earlier comparison for ~480 suburbs under
their councils.

The licence permits redistribution, the archive serves the publisher's
own bytes, and every row loaded this way carries `captured_at` so a reader
can see that the figure is as the archive held it on a stated day. The
route is a fact about the archive, never a guess: `waybackMirror.pure.ts`
reads the index, ranks files by what their NAMES say they describe
(`houses-by-suburb-2015-2025` outranks `…2014-2024`; `lsg_stats_2025_q1`
outranks `_2024_q4`), and takes the newest capture of the winner. A file
the index does not list is not fetched by pattern.

### 10.2 The ABS state series is the floor under every state

`RES_DWELL_ST` — the mean price of residential dwellings by state and
territory and for Australia, quarterly since 2011-Q3, CC BY 4.0 — answers
the production egress as SDMX-CSV (pg_net 245217, 658,289 bytes, 60
quarters to 2026-Q2). Western Australia publishes no open sub-state series
(Landgate's residential attributes are `fees_apply`, SLIP subscription
only — measured 16 Sep, pg_net 245239), so this is WA's reading, and it is
the fallback for every other state where nothing finer answers. Two rules
keep it honest. **A mean is filed as a mean** (`price_measure = 'mean'`):
the adapter reads growth and a series from it and never offers it as a
median sale price or a sales count. **It is read only where nothing finer
answered**, and the scorer prices `state` at the bottom of its geography
ladder (10 of 100), so a WA grade carries a low-confidence growth reading
rather than none — the ceiling rules in `gradeEligibility` still withhold
A and A+ from it.

### 10.3 The register widened (me9.sales.2)

`20261126090000_market_sales_medians_national.sql`: every jurisdiction
plus `AU`; `area_kind` gains `suburb`, `state`, `national`; `price_measure`
(median | mean), `period_span` (quarter | year — the Victorian series is
annual, stored under the year's December quarter), `captured_at`; and the
span joins the primary key, because a calendar-year median and the
December quarter's median are different figures for the same `YYYY-12`.

The loader gains three stages — `abs`, `vic` (one file a call: `which` =
`houses_ts` | `units_ts` | `quarter_house` | `quarter_unit`) and `sa` (the
newest quarter and the 3/5/10-year horizon files, or `periods`) — and the
NSW stage loads ONE workbook a call, because five in one invocation
exhausted the edge worker's compute allowance (546
`WORKER_RESOURCE_LIMIT`, 15 Sep 23:39Z). The QLD and NSW loads ran that
night: 7,056 QLD rows (41 LGAs, 72 quarters to March 2026) and four NSW
quarters (March 2021/2023/2025/2026 — DCJ's archive begins 2017, so the
ten-year horizon is unavailable there).

The adapter (`openDataSalesEvidence.pure.ts` 2.0.0) reads suburb and state
grains, chooses ONE span where a suburb carries both (the longest series
that is as current as any; a horizon it cannot reach is taken from the
other and labelled as such), and benchmarks a state-level reading against
the nation. The generator asks every source the state has, finest first
(`salesRegisterSourcesFor`), and stops at the first that answers — so a
Queensland or New South Wales report reads exactly as it did.

### 10.4 Estimate CGR

The Financials tab's `Growth` field seeds every year of the ten-year cash
flow and defaulted to 5, with a per-state table of round numbers as its
"smart default". The button beside the label now asks
`estimate-capital-growth` for the address typed at the top of the form:
the geocoder names the suburb, postal area, state and council for the
point it matched (an answer no finer than a state, or the centre of the
continent, is refused — `geocodeGranularity` — and the typed text is
parsed instead, said on the reading); the register is asked every source
finest first; and `capitalGrowthEstimate.pure.ts` chooses the estimate:
**the finest area that carries a horizon of at least five years**, else
three, else one — because a ten-year projection wants a long-run rate and
the swing of one cycle is not one. Every coarsening is a caveat under the
field: a council-, postcode- or state-wide series; a mean rather than a
median; a dwelling type that did not match; an archive capture date; a
short horizon; a figure outside the 0–8% most projections assume. The
button writes the same `capitalGrowth` override the cash flow already
reads, so the estimate flows into the projection unchanged; where no
series reaches the address the field is left as it was and the toast says
so. One geocode request a click.

**That one request is billed only when Google served it, and it draws on
the product-wide allowance.** Google answers HTTP 200 for everything with
the verdict in the body, and the first deployed version of the function
passed no `judgeBody` — so its first refused geocode (00:43Z on the day it
shipped) was logged `status: 'success'` with one billable request, the
exact trap `meteredFetch` documents from 12 September. The judge is now
one shared module, `_shared/googleMapsBody.pure.ts`, imported by this
function and by `location-intelligence-service` rather than declared in
each; and the call consumes `consumeGoogleDailyCap(…, 'geocoding')` first,
because Google bills every geocode in this deployment together and a click
that bypassed the ceiling would make it no ceiling at all.

The same ledger shows **the geocoder has refused every server-side call
since 12 September 2026** (`REQUEST_DENIED`: 25 that day after 15
successes, 22 on the 14th, 139 on the 15th), which is a property of the
Google Maps key rather than of any caller — the Geocoding API is
disabled for it, or its application restriction (an HTTP-referrer
restriction is browser-only) refuses a server. The button still resolves
the address from its text — `291 Stone Mason Drive, Kellyville NSW 2155`
read 6.2% from postcode 2155's series with the geocoder refused — because
`parseAddressText` reads the suburb, state and postcode the form's address
already carries; what the geocoder adds is the council (Queensland's
series is by council) and a suburb the text does not name. The remedy is
in the Google Cloud console for that key, and the reading says on its
face when the text was used instead.

### 10.5 Currency — the register refreshes itself every day

The owner's requirement (16 Sep 2026) is that a reading is **the newest
publication its source has released as of the day it is asked for**, and
that the reading says so. Until then every stage ran by hand. Migration
`20261127090000` schedules **one pg_cron job per stage** — ABS, QLD, NSW,
the four Victorian files and SA — at staggered minutes from 17:00 UTC
(03:00 AEST), through `public.market_sales_refresh(jsonb)`, a SECURITY
DEFINER wrapper that reads the project URL from the vault and posts with
`cron_service_role_headers()` so the job body carries no secret and no
project literal. Three rules carry it. **Staggered, one workbook a call**:
five index queries in one second made the Wayback CDX shed load (503, 503,
504) and five workbooks in one call hit the edge worker's compute limit.
**An upsert on a quiet day changes nothing**, so asking every source every
day costs a few megabytes of egress and no data. And **it is asserted by
effect**: `cron.job` holds the eight rows after the migration applies, and
the day's `market_sales_sync` rows are the proof a run delivered — pg_cron
reports on the SQL that queued the request, never on the request.

The reading carries its own currency. `estimate-capital-growth` hands the
estimate `latestPeriodLabel` (the publisher's own words for the latest
period — `March 2026 quarter`, `calendar year 2025`) and `loadedAt` (when
the register last took that series from its source), and the Financials
tab prints both under the field: *Series to March 2026 quarter; register
refreshed 16 September 2026*. For Victoria and South Australia the
currency is bounded by the archive's capture, which the reading already
names as a caveat; the daily job takes a newer capture the day the
archive has one.

Why the signed cron invoker is not used here: `market-sales-ingest`
authorises through `verifyAuth`, which reads the internal edge secret and
a service-role bearer and not the signed-internal headers
(`verifySignedInternal`); moving the loader onto that scheme is a change to
its auth, recorded as follow-up work rather than folded into a schedule.

### 10.6 The first production run, 16 September 2026

Everything below was found by running the loads against production, and
each was invisible to every fixture. The ABS load wrote 540 rows (60
quarters, nine jurisdictions, to 2026-Q2); the Victorian quarterly files
772 and 444 localities (3,860 and 2,220 rows, captured 3 Aug 2026); the
Victorian house time series 797 localities over 2015–2025 (8,767 rows).

- **A publisher's typo refused a whole series.** The Victorian units time
  series prices `TAYLORS LAKES 2018` at $7,000 and the parser refused the
  file — 444 localities over eleven years — for one cell. An implausible
  cell is now nulled on its row and named (`implausible` on the parse, the
  loader's `implausible_cells`), and a sheet is refused only past **ten**
  such cells, because ten typos is a file and eleven is a units problem.
- **The archive's index sheds load.** The South Australian query answered
  503, 503 and 504 on three of four asks while the Victorian ones passed.
  The wide `dataset/<id>/*` pattern swept every capture of the dataset's
  own page since 2016; the loader asks for `dataset/<id>/resource/*` (the
  files alone, 18 KB against 72 KB) and retries one 5xx once. Later that
  night the archive went "Temporarily Offline" and came back shedding load:
  the Victorian query (floored at 2024) was served in the same minute the
  unfloored South Australian one was refused twice, so that query is
  floored at **2023** — the crawl of 5 April 2023 re-captured all 41 named
  workbooks, measured from the one full answer — and the floor is a fixed
  year, because a rolling one would one day drop every file the publisher
  has not touched since.
- **An indexed capture the store cannot serve.** The newest SA workbook's
  only capture (`lsg_stats_2025_q1.xlsx`, 16 May 2025) answers 404 to its
  `id_` fetch. `rankedFiles` keeps every 200 capture of a file newest
  first; the stage falls back through a file's captures, and anchors its
  three-, five- and ten-year horizons on the newest file that **loads**,
  never on the newest the index claims.
- **A suburb that straddles a council boundary is listed twice**, once per
  council, and both parts in one upsert made Postgres refuse every SA file
  ("ON CONFLICT DO UPDATE command cannot affect row a second time"). The
  register's key is the suburb, so `parseSaLsgStats` keeps the part with
  the most sales in the latest quarter — a published figure describing
  most of the suburb's sales, never an average or a sum — and names the
  choice in `splitSuburbs`.
- **The first refused geocode was billed as a success** (§10.4).

### 10.7 What remains

- **Western Australia, Tasmania, the territories**: state grain only, and
  said so on every reading.
- **Victoria's and South Australia's currency is the archive's**: the
  daily job takes a newer capture the day one exists, and the Wayback
  Machine's Save Page Now could be asked for one — a follow-up to measure,
  since the archive's own crawler is what the two publishers admit.
- **The loader's move onto the signed cron invoker** (§10.5).
- **Every load and reading is a production event**, recorded in §11 as it
  happens.
