# The identified report set — and what supersedes what

A page count identifies nothing on its own. The same report, from the same
record, through the same template, drew **24 pages before one pagination fix
and 21 after it, with no word changed.** That is the version mismatch this
document resolves, and it is the reason every artefact below is stamped with
what produced it rather than described by its length.

`npx tsx scripts/reports/s5Manifest.mts` regenerates the table. It refuses a
dirty working tree, because a candidate that cannot be named is not a
candidate.

---

## 1 · The 24-page Financial and the 21-page Financial are the same document

**Resolved by execution, not by inference.** A worktree was created at commit
`1c30649`, the fixtures copied in, and `s5ForkReports.mts` run there
unmodified. It reproduced the supplied artefact exactly:

| | commit `1c30649` | commit `d9de993` (candidate) |
| --- | ---: | ---: |
| Kellyville · Financial | **24 pages** | **21 pages** |
| Maryborough · Financial | 22 pages | 20 pages |
| Kellyville · Due Diligence | 29 pages | 29 pages |
| Maryborough · Due Diligence | 19 pages | 19 pages |

The composition reported **13 sections and 23,838 characters** for the
Kellyville Financial on *both* runs. The content is the same; the pagination
is not.

### Where the three pages went

The ten-year section, page by page, with the running head and foot removed:

| commit `1c30649` | | commit `d9de993` | |
| --- | ---: | --- | ---: |
| p14 | **19 words** | p14 | 183 words |
| p15 | 45 words | p15 | 206 words |
| p16 | 46 words | | |
| p17 | 45 words | | |
| p18 | 203 words | | |

Before, `## 10-Year Cashflow, Equity & Growth Projection` and its standfirst
— *"The recorded ten-year modelling, shown at years 1, 3, 5, 7 and 10"* —
sat **alone on page 14, nineteen words on a sheet**, and each of the three
scenario tables took a page of its own at forty-odd words. Four pages
carrying 155 words between them. After, the heading, the standfirst and the
tables are together on one page at 183 words.

The cause and the fix are in
[`S5_CONDENSED_DOCUMENTS.md`](./S5_CONDENSED_DOCUMENTS.md) §3: a table wider
than the portrait measure was charged 38 lines for a landscape page break
that a template master cannot make, so it fitted in no bucket.

### Nothing else changed, and that was checked rather than assumed

The drawn text of all four documents was compared. Maryborough · Due
Diligence is **byte-identical**. The other three differ only in:

* **line-breaking inside table cells** — `Zone` / `R2 — Low Density
  Residential` on two lines became one, `Population and tenant-demand trend —
  Kellyville` stopped wrapping one word per line. That is the row-header
  weight fix (600 → 500) changing where cells break, not what they say;
* **the contents page's own page numbers** — `23 / 24` became `20 / 21`;
* **one repeated table head** (`Modelling assumption | Value`), which is a
  table meeting a page boundary and repeating its header, as it should.

No figure, sentence, heading or table row differs.

### Disposition

**The 24-page Kellyville Financial is SUPERSEDED.** So is every earlier
rendering of any of the ten documents. The authoritative set is the table in
§2, identified by file hash. An artefact that does not match a hash there is
not part of this candidate, whatever its page count.

---

## 2 · The identified set

Every document is drawn from the same approved assessment row, through the
same template, on the same print contract — the five reports for a property
are derived from **one** assessment and **one** financial output, which is the
requirement that makes cross-report figures reconcilable at all.

Candidate code state **`d9de993`** · template **Chancery**
(`investment-compass-pb-01-chancery`, schema sha256 `53f5fe7549a07387`) ·
planning answer version **`c2`** · WeasyPrint **69.0**, `pdf/ua-1`, tagged,
sRGB output intent, images optimised.

### 18 Annabelle Crescent, Kellyville NSW 2155

Assessment row `9bd41c05-7f9b-41e8-819a-a029f4121369`, updated
2026-09-17T09:10:30Z · `calculation_version` 1.0.0 · scoring v2.1.0 under
ME-8 · grade **F**, score **40** · parent content 66,625 chars, sha256
`fb6de2bbe05a4e00…`

| report | pages | bytes | file sha256 (first 32) |
| --- | ---: | ---: | --- |
| Investment Compass | 36 | 465,539 | `76af0e5735217db51a42fda4ff7180a7` |
| Financial Analysis | 21 | 377,854 | `90dddac260f6b98b17a3b9f465111bd5` |
| Due Diligence | 29 | 422,580 | `eb3efa522376779d0e125efe94194116` |
| Executive Briefing | 20 | 345,537 | `e1552224ba9afe09d42a724f1ffee3b7` |
| Snapshot | 11 | 292,264 | `5e9ee793f63949f4f9f1218754bc7558` |

### 262 Pallas Street, Maryborough QLD 4650

Assessment row `3a4a3d9b-4d2d-4296-9e39-3fab0c2ae753`, updated
2026-09-17T05:04:22Z · `calculation_version` 1.0.0 · scoring v2.1.0 under
ME-8 · grade **C**, score **63** · parent content 38,648 chars, sha256
`8816a4aa47717250…`

| report | pages | bytes | file sha256 (first 32) |
| --- | ---: | ---: | --- |
| Investment Compass | 22 | 368,547 | `95751e8286f6cd80e192076908114283` |
| Financial Analysis | 20 | 366,444 | `67ce23d758e40991f2a92df86a14f6ca` |
| Due Diligence | 19 | 352,159 | `b00a746d80ee935c1d61a2c01322ea6a` |
| Executive Briefing | 18 | 335,688 | `a84ce9fdefb03f4cc50588495f09ecf1` |
| Snapshot | 12 | 294,769 | `4e03adcf5e7cda00e615ab2898634888` |

### What is identified, and what is not

**Identified:** the candidate code state, the assessment row and its
versions, the template and its schema hash, the print contract, and each
file's own hash. All ten validate as PDF/UA-1.

**Not identified, and deliberately so:** these are rendered from
production-derived fixtures on the branch, not from rows the product wrote
during this run. The Briefing and the Snapshot additionally carry one named
stand-in for their model call
(`scripts/reports/_condenseStandIn.mts`). Both limitations are recorded in
[`S5_CONDENSED_DOCUMENTS.md`](./S5_CONDENSED_DOCUMENTS.md) §1 and §5 and are
what the R1–R12 journey work exists to close. **The page counts here are the
counts of THESE artefacts and are not a product specification** — a Briefing's
length is what its own content and the registry trim produce, and a run that
makes the real model call will produce its own.

---

## 3 · The rule this stage adds

**An artefact is identified by what produced it, never by what it looks
like.** A page count, a file name and a date identify nothing: the 24-page
Financial and the 21-page Financial have the same name, the same date, the
same property, the same assessment and the same words. Only the code state
told them apart, and only running the old code proved which was which.
