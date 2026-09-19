# Macro-economic sources — the RBA statistical tables

The acquisition log for the M-stream: where every macro figure in a report
comes from, how the store is loaded, and what was measured before any of it
was written. Read this before touching `_shared/rbaTables.pure.ts`,
`_shared/rbaReading.pure.ts`, `rba-tables-ingest`, `rba-data-service`, or
the CPI projection assumption the financial engine indexes against.

## What this replaced

`rba-data-service` used to ask a search model (Perplexity, via the LLM
router) for "exact current values" of the cash rate, CPI, unemployment, GDP
and a ten-year CPI forecast, cache whatever came back for 24 hours, and
validate almost none of it:

- absence was coerced with `|| 0` — a 0.0% unemployment rate is what an
  empty answer became;
- `lastUpdate: today` stamped retrieval time on every figure, which is the
  freshness-of-load-is-not-currency-of-data mistake;
- `previous: parsed.cashRate.previous || parsed.cashRate.current` invented
  a "no change" when the model omitted the prior rate;
- the ten-year CPI path was labelled "RBA SMP forecast / Treasury Budget
  forecast" whether or not any forecast had been read — and
  `financial-calculator-service` indexed real dollar arithmetic against it;
- the generator's Current Economic Context table hardcoded fallbacks under
  a "**VERIFIED ECONOMIC DATA**" heading — `|| '4.10'` on the cash rate,
  a year stale against the real 4.35% by the time it was removed.

## The sources (all measured 2026-09-06)

Three published RBA statistical tables, CSV form:

| table | url (`https://www.rba.gov.au/statistics/tables/csv/…`) | cadence | measured |
|---|---|---|---|
| F1.1 Interest Rates and Yields — Money Market | `f1.1-data.csv` | monthly (pub 01-Sep-2026) | 687 dated rows from 30/06/1969 |
| G1 Consumer Price Inflation | `g1-data.csv` | quarterly (pub 30-Jul-2026) | 420 dated rows from 30/06/1922 |
| F5 Indicator Lending Rates | `f5-data.csv` | monthly (pub 10-Aug-2026) | 811 dated rows from 31/01/1959 |

File layout (identical across the three): a title line naming the table;
metadata rows keyed by their first cell — `Title`, `Description`,
`Frequency`, `Type`, `Units`, `Source`, `Publication date`, `Series ID` —
whose remaining cells align with the data columns; then `DD/MM/YYYY` rows.
The files open with a UTF-8 BOM and titles carry quoted commas, so cells go
through the shared quote-aware splitter.

**The G1 quirk that shapes the whole parser**: the file pre-prints future
ABS reference periods with empty value cells — three of them at
transcription (30/09/2026, 31/12/2026, 31/03/2027). An empty cell is an
ABSENT observation, never zero; reading one as 0 would print a 100-point
CPI collapse (`GCPIAG` is an index, rebased **September 2025 = 100** per
its own Units cell). The same rule is why `FIRMMCRT` yields 433
observations from 687 rows — the cash-rate-target column's early decades
are genuinely empty.

The eleven series loaded, transcribed from each file's own `Series ID` row
(two guessed F5 ids — `FLRHOOVA`, `FLRHOOFA` — turned out not to exist,
which is why guessing is banned):

- **F1.1** — `FIRMMCRT` (Cash Rate Target; *monthly average* per its own
  Description — never a board decision date).
- **G1** — `GCPIAG` (index), `GCPIAGYP` (year-ended), `GCPIOCPMTMYP`
  (trimmed mean, year-ended), `GCPIAGSAQP` (quarterly, seasonally
  adjusted).
- **F5** — `FILRHLBVS` / `FILRHLBVD` / `FILRHL3YF` (owner-occupier
  standard variable / discounted variable / 3-year fixed) and
  `FILRHLBVSI` / `FILRHLBVDI` / `FILRHL3YFI` (the investor trio).

Reference readings at transcription: cash rate 4.35% (August 2026; the
monthly average last moved in June 2026, 4.31 → 4.35), year-ended CPI 3.9%
and trimmed mean 3.6% (June quarter 2026), owner-occupier standard
variable 8.77% and investor 9.35% (July 2026).

## Why the ingest does not fetch

**rba.gov.au refuses this Supabase project's egress**: all three CSV urls
answer an Akamai `403 Access Denied` in under 110 ms, measured from a probe
deployed to the project on 2026-09-06 — the same class of refusal as DFAT
(sanctions) and directory.gov.au (PEP). The same urls download fine from an
operator's environment.

So the load takes the sanctions-register shape, not the crime one:
`scripts/rba/load-rba-tables.mjs` downloads where egress works and POSTs
each file's text verbatim to `rba-tables-ingest`
(`{"table":"f1.1","csv":"…"}`); **all parsing is server-side** in
`_shared/rbaTables.pure.ts`, because a loader that parsed differently from
the reader writes rows no reader matches. The parser refuses the whole load
(nothing written) on: a title line that is not the expected table's, a
missing metadata row, a wanted series absent from `Series ID` (the 42703
lesson), fewer dated rows than the per-table floor (600/380/700 — under the
measured counts, far over an error page), an unparseable value, an
implausible one (per-cent series bounded at ±50 — the 1990 cash rate peaked
at 17.5 and 1951 inflation near 24; index series 0 < v < 10000), or units
the module has no bound for. Upserts never delete, so a truncated file that
somehow parsed can still never shrink the store.

Auth: `INTERNAL_EDGE_SECRET` as the bearer (sibling-ingest parity) or as
`X-Cron-Secret` — the channel that traverses the JWT-checking gateway,
since the gateway wants a project JWT in `Authorization` — with the
per-table self-sealing bootstrap arm for a table's very first load
(`rba_series_meta` empty for that `table_code`). Sealing was verified by
execution: the post-load re-POST without the secret answers 403.

## The store and the reading

`rba_series_meta` (units, description, publication date — the file's own
words — and `last_observation`, the data's vintage) plus `rba_observations`
(`series_id`, `obs_date`, `value`) and `rba_sync` bookkeeping. Loaded
2026-09-06 via the shipped loader: 11 series, 3,518 observations (the
count re-checked against the store after the load).

`rba-data-service` reads a four-year window (~394 rows — bounded explicitly
under PostgREST's 1,000-row cap) and `_shared/rbaReading.pure.ts` composes:

- **every figure with its own reference period**, named in words ("August
  2026", "June quarter 2026" — ABS wording);
- the cash rate's **last move dated by arithmetic on the series** (the
  month the monthly average changed), never asserted as a decision date;
- **no GDP, unemployment or participation fields at all** — these tables do
  not measure them, and a test asserts the vocabulary is absent rather than
  trusting it (the timeliness stream brings measured labour figures);
- the ten-year CPI path as `cpiProjectionsFromMeasured` — THE one
  implementation (the financial engine's silent local copy is deleted):
  convergence from the measured year-ended CPI toward the RBA target
  midpoint, every year's `source` beginning "Assumption —", and a test
  asserts no year can claim SMP/Treasury/forecast.

An empty store answers `sourceUnavailable('rba-economics',
'not_configured', …)` naming the loader — never a remembered figure.

## Refresh

F1.1 and F5 publish monthly, G1 quarterly. Refresh is re-running the loader
(exit non-zero if any table fails, so a scheduler can alert); rows upsert
idempotently. A missed refresh degrades honestly: every served figure
carries its own period, so an older figure reads as an older figure —
visibly dated in every report — never as a silently wrong current one. The
timeliness stream (Q4) owns the watchdog that names staleness proactively.
