# Historical Data Impact Register

**No stored historical report has been changed.** No narrative regenerated, no
PDF replaced, no row rewritten. This is evidence and counts for owner, legal and
compliance review — **not** a disclosure decision, which is not an engineering
call to make.

Measured by execution against the live database on 2026-09-11 over all **1,207**
non-archived `investment_reports`.

## 1. What counts as affected

Two inaccurate inputs, both established in RF-7.2A:

| Fault | Marker | Reports carrying it |
| --- | --- | ---: |
| Generated demographics under an ABS Census attribution | `demographics.*.source ILIKE '%estimate%'` | 855 |
| A cash rate that is a hardcoded constant or an LLM search result | `cashRate.source` says `(estimated)` or `Perplexity` | 1,113 total unsafe |

**"Printed"** means the stored figure appears verbatim in `report_content`.
**"Attributed"** means the body also cites the authority (`ABS Census`, `RBA`,
`Reserve Bank`).
**"Delivery evidenced"** means the report has a `pdf_url` **or** a row in
`client_portal_reports`.

## 2. The segments

Exhaustive and mutually exclusive; they sum to 1,207.

| Segment | Reports | Demographics printed | Cash rate printed wrong | Delivery evidenced | Date range |
| --- | ---: | ---: | ---: | ---: | --- |
| **H1** — wrong value printed **and** attributed, delivered | **80** | 25 | 69 | 80 | 2025-11-04 → 2026-05-25 |
| **H2** — wrong value printed, no attribution, delivered | **18** | 17 | 1 | 18 | 2025-10-29 → 2025-12-30 |
| **H3** — unsafe value stored, **not** printed | **535** | 0 | 0 | 141 | 2025-09-16 → 2026-09-05 |
| **H4** — draft / incomplete | **19** | 0 | 6 | 5 | 2026-01-22 → 2026-08-04 |
| **H5** — superseded by a later report or a child | **37** | 2 | 19 | 32 | 2025-12-22 → 2026-09-04 |
| **H6** — wrong value printed, **delivery not evidenced** | **510** | 286 | 310 | 0 | 2025-10-07 → 2026-06-03 |
| **H0** — no unsafe value | **8** | — | — | 0 | 2026-09-08 |
| **Total** | **1,207** | | | | |

## 3. The segment that needs a decision most, and the honest caveat

**H6 is the largest exposed group and the least certain.** 510 reports printed a
generated demographic figure or a wrong cash rate, and carry **no `pdf_url` and
no portal publication**.

That does **not** mean they never reached a client. It means the database holds
no evidence that they did. A report can be read on screen in the dashboard, or
exported through the browser path — which does not write `pdf_url`. So H6 is
"printed, delivery unknown", and only the business knows which of those 510 were
shown to somebody.

**H1 (80) is the sharpest case**: the wrong figure and the authority's name are
both on a document the platform can prove it produced.

## 4. Magnitude

| Fault | Typical error | Worst |
| --- | --- | --- |
| Population | mean absolute error **18,519 people (197.1%)** | — |
| Median weekly rent | mean absolute error **$246 (78.4%)** | — |
| Median household income | mean absolute error **$34,768/yr** | — |
| Cash rate | **+0.75 percentage points** on 1,035 reports | 0.75pp |

The cash-rate error is **directional and time-bounded**: the constant 4.35
overstated a target of 3.60 through Oct 2025 – Jan 2026 (1,035 reports), and the
target has since risen back to 4.35, so reports from Jul 2026 onward are
accidentally correct.

## 5. Per-report evidence

The register is reproducible rather than pasted: the segmentation query is in
§7 below and returns, per report, its id, generation date, client property,
status, current version, which fault it carries, the stored value, whether the
attribution was printed, the authoritative comparison value, the magnitude, and
its segment. It is deliberately **not** committed with client identifiers —
those are read from the live database when the business needs them.

## 6. What is NOT decided here

- whether any client is told;
- whether any report is reissued;
- whether any disclosure is owed;
- which of H6's 510 were actually delivered.

All four are owner/legal/compliance decisions. §26 of the mandate designs the
*mechanism* for a correction should one be authorised — see
`RF72B_DATA_REMEDIATION_CLOSEOUT.md` §6 — and nothing executes it.

## 7. Reproducing the segmentation

The full query is recorded in `RF72B_DATA_REMEDIATION_CLOSEOUT.md` §7. It reads
only; it writes nothing.
