# Regional trends — measured population, and the unemployment gate

The acquisition log for the timeliness layer (T-stream): where a report's
population level and growth figures come from, how the property's
statistical area is resolved, and exactly why the unemployment half waits
on one operator action. Read this before touching
`_shared/absRegional.pure.ts`, `abs-regional-ingest`,
`abs-regional-service`, or `_shared/reports/regionalPromptBlocks.pure.ts`.

## What this replaced

Nothing measured. The Census demographics tables (R-stream) carry real 2021
levels and no trend, and the prompts asked for "population growth" prose
anyway — so every growth figure in every report was whatever the model
recalled. The Demand Drivers skeleton went further: it instructed the model
to print an annual job-growth percentage, a participation rate and an
unemployment rate, none of which any source in the product measured.

## The population source (measured 2026-09-06)

**ABS Regional population** (cat. 3218.0), 2024-25 release, datacube
`32180DS0003_2001-25.xlsx` — estimated resident population at 30 June per
SA2, 2001–2025. Measured shape: Table 1 holds 2,454 SA2 rows (9-digit
codes) with the full geography hierarchy per row; the 2025 column sums to
**27,613,654**, which the parser keeps as a plausibility anchor (a parse
outside 20–40M read the wrong cells); the file's `..` marker (".. not
applicable", its own footnote) appears on exactly one SA2 — Norfolk
Island's pre-inclusion years — and is an **absent observation, never
zero**, while a measured 0 is a real value (industrial SA2s hold nobody).

**abs.gov.au answers this project's egress directly** (probe deployed and
measured), so `abs-regional-ingest` fetches the cube itself — the
abs-poa-ingest pattern, SheetJS 0.18.5 (the pin that ingest verified) —
and parses through `_shared/absRegional.pure.ts` with refusal-shaped
bounds. Loaded in production 2026-09-06: 2,454 SA2s, 61,335 observations
(61,350 minus Norfolk's 15 absent years — the count is the rule working).

Refreshing after the next annual release (typically March) is one
invocation with the new release/file names, both shape-validated so the
fetch can never leave the pinned ABS path.

## The property's own area

The reading is served for the **SA2 containing the property coordinate** —
the ABS's own unit for regional population, resolved by a point query
against the ABS ASGS2021 geoserver
(`geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA2/MapServer`), measured
reachable from this project's egress (the Parramatta test coordinate
resolves to 125041717 "Parramatta - North", whose measured reading is
14,904 residents at 30 June 2025, +3.31% in a year, +74.21% over ten).
Resolutions cache per ~110 m cell (`sa2_point_cache` — SA2s are small
enough that a coarser cell spans boundaries); a transport failure is never
cached, and a point in no SA2 answers honestly.

This is deliberately NOT a postcode aggregation: the ABS publishes no
SA2→POA correspondence for this edition (the correspondences page carries
only edition transitions), and aggregating estimates onto a geography the
source never published would manufacture precision. The prompt block names
the SA2 and says "the surrounding area" where it differs from the suburb.

Growth windows (1/5/10-year) render only where **both endpoints were
measured** — a hole is dropped, never bridged — and never against a zero
base. Law 2 throughout: a labelled row promises a figure.

## The unemployment half — one action from done

**Small Area Labour Markets** (SALM, DEWR) publishes quarterly smoothed
SA2 unemployment — the right register, and the March quarter 2026 file
exists. It is not loaded, for a measured reason with no engineering
workaround from here:

- `www.dewr.gov.au` and `www.jobsandskills.gov.au` refuse every vantage
  this programme holds: the Supabase project's egress (connection error),
  the build sandbox's proxy (tunnel reset at TLS), a real Chromium through
  that proxy (same), and the hosted fetcher (503). This is IP-level, not
  fingerprint-level.
- The current file lives nowhere reachable: data.gov.au and data.sa.gov.au
  carry 2017–2021-era stale pointers; archive access is egress-blocked.
- The parser doctrine (column names transcribed from the real file, drift
  refuses) therefore cannot be satisfied yet: **there is no real SALM file
  in reach to transcribe**, and a parser written against a guessed layout
  is the 42703 class this programme exists to prevent.

**What unblocks it**: an operator downloads "SALM Smoothed SA2 Datafiles
(ASGS 2021)" (CSV, ~2.3 MB) from the DEWR Small Area Labour Markets page —
an ordinary browser on an ordinary connection reaches it — and provides it
to the build. The follow-up then transcribes the layout, adds the
`salm` stage to `abs-regional-ingest` (body-POST, the RBA pattern), the
`salm_sa2_unemployment` table, the loader script, and the reading's
unemployment component, end to end against the real file.

Until then the service returns `unemployment: null` with the reason in its
source, and every prompt block **forbids** stating an unemployment rate —
absent is absent, and the skeleton that used to demand an invented one is
rewritten to draw only on measured tables.
