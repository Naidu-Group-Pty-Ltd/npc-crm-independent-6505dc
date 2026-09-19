# Per-section storage — the addressable projection of a stored report

*Phase 3, part C. Measured against all 1,199 stored reports on 2026-09-07.*

Read this before touching
`supabase/functions/_shared/reports/investment/sectionStorage.pure.ts`,
`detectSectionLevel` / `partitionByRegistry` in `sectionRegistry.pure.ts`, the
`report-sections-index` edge function, or the two derived tables
`investment_report_sections` / `investment_report_section_index`.

---

## What this is, and what it is not

`investment_reports.report_content` is the document a client received. It stays
the source of truth and nothing here writes to it.

This is a **derived index over it**: an ordered list of `(ordinal, section_id,
occurrence, heading, body)` rows, so a single section can be found, counted or
replaced without re-reading and re-writing the whole report. Phase 2 gave the
platform one constitution for report structure; Phase 3 makes a *stored*
document answer to it.

The index is a projection, never a replacement. A report whose index cannot be
proven lossless is left **unindexed**, and says so.

---

## The finding that redirected the build

`partitionByRegistry` shipped in part B reading `##` headings only. That was
measured — over 966 distinct H2 headings — and it was still wrong about most of
the corpus.

Running the real modules over all 1,199 stored reports:

| | reports | share |
|---|---|---|
| sections written at **H1** | **842** | **70.2%** |
| sections written at H2 | 357 | 29.8% |

The majority cohort is the legacy 36-section document — `# 1. Location
Overview` … `# 36. Demographic & Economic Data` — which carries at most a
`## 📞 CONTACT US` / `## ⚖️ PROFESSIONAL DISCLAIMER` pair at H2. **A partition
hard-coded to `##` finds zero sections in 842 documents and returns each whole
report as preamble** — which is indistinguishable from a report that genuinely
has no structure.

`detectSectionLevel` decides the level per document, and it decides by asking
which level's headings actually **resolve to registry sections** rather than by
counting headings: H3 sub-headings outnumber sections in the H2 cohort (36 a
document), so "most headings" picks the wrong level. A tie resolves to 2, which
preserves the behaviour every document verified before this relied on.

### The coverage fixture was measuring a quarter of the corpus

`fixtures/corpusHeadings.json` carried H2 headings only, for the same reason.
So the coverage guard measured **10,185 heading instances and missed 26,860**,
and reported a percentage about the rest of the corpus.

Ten headings the registry could not name sat above 400 reports each, and none
of them could ever have shown up:

| heading | reports | now resolves to |
|---|---|---|
| `12. Amenity Scores` | 578 | `amenityAccess` |
| `3. Historical Price Growth` | 577 | `marketPosition` |
| `4. Historical Rent Growth` | 575 | `marketPosition` |
| `36. Demographic & Economic Data` | 572 | `population` |
| `22. Principal & Interest Loan` | 574 | `loan` |
| `23. Interest-Only Loan (First 5 Years)` | 574 | `loan` |
| `28. Final Loan-to-Value Ratio (LVR)` | 574 | `loan` |
| `15. Crime Breakdown` | 446 | `environmentalRisk` |

Thirteen aliases were added from that measurement. Across all 575 fixture rows
they are **purely additive**: 30 headings gained a section, **0 changed section
and 0 lost one**. H1 instance resolution went **78.9% → 96.0%**, and the corpus
gained **4,692 addressable sections** (26,581 → 31,273; 22.2 → 26.1 a report).

The fixture now carries `level` and both halves. Its H1 half has a floor of ten
reports rather than two, because below ten the H1 inventory is dominated by
document title blocks naming a client's property (`Investment Report: 68
Craigmore Drive, …`, on 2–9 reports each). A coverage instrument is not a corpus
dump, and those are neither sections nor ours to keep in a repository.

---

## The rules

### A repeat is an occurrence, never a merge

The primary key is `(report_id, ordinal)` — document order — and `occurrence`
numbers the repeats of one `section_id` within a report. Production briefing
`89b451f6` carries 29 headings resolving to 21 sections, with `marketPosition`
four times and `tenYear` three: the legacy document spreads one section across
several headings. Keying on `(report_id, section_id)` would have silently
collapsed a client's document, merging bodies that were written apart.

`occurrencesOf` returns **every** appearance in order, because a caller that
quietly took the first would be reintroducing the merge.

### An index is written only where it proves lossless

`conservesNonWhitespace` compares the re-assembled document against the original
ignoring whitespace only — whitespace because the partition trims section
bodies, which collapses blank-line runs at boundaries and changes nothing a
reader sees. Anything else (a dropped table row, a swallowed heading, a
reordered section) fails.

A report that does not conserve gets an index row recording `conserves = false`
and **no section rows**. Half an index is worse than none: a caller reading
`investment_report_sections` would silently serve a truncated document.

Measured: **1,199 of 1,199 stored reports conserve.** Nothing was refused.

And the proof was taken twice, the second time against the **stored rows**
rather than against the function's own report of them. The whole corpus is
indexed in production; re-assembling each document **in SQL** — `preamble ||
string_agg(marker || heading || body order by ordinal)` — and comparing it
whitespace-stripped against `investment_reports.report_content` gives
**1,199 of 1,199 exact, 0 mismatched**. That is a different implementation from
the one that wrote the rows, so it catches what an in-memory check cannot:
truncation at the column, a lost row, a wrong ordinal.

| | |
|---|---|
| reports with content | 1,199 |
| indexed | 1,199 |
| `conserves = true` | 1,199 (0 refused) |
| re-assemble exactly, in SQL | 1,199 / 1,199 |
| section rows | 31,273 |
| distinct section ids in use | 37 |
| deepest repeat of one id in one report | 10 |
| H1-sectioned documents | 842 |
| preamble-only documents | 9 |

Ten occurrences of one section id in a single report is the corpus's answer to
why repeats are never merged. It is not a pathology to be normalised away — it
is what the legacy generator wrote, and the index has to be able to say so.

### The stored counts describe what is stored

A refused report stores zero sections and its counts read zero. A labelled row
promises a figure, and `total_sections = 21` beside no rows at all is exactly
the shape this programme removes. What the partition *saw* stays visible in
`absorbed` and in the function's own response.

### An unstructured report is a real answer

9 of 1,199 reports (0.8%) yield no section. They are indexed as preamble-only,
which is a truthful description of them rather than a failure. `toSectionIndex`
never throws — on an empty document, on `#` alone, on prose under a title.

### An unrecognised heading is still never a section, and never a deletion

Part B's rule is unchanged and is what makes all of the above safe. The
absorbed headings are stored per report, so a genuinely new section heading
appearing in production is visible instead of silently swallowed. Two section
headings are deliberately **not** named, frozen in `UNNAMED_SECTIONS` with the
reason:

- `37. Methodology Notes` — `normaliseHeading` strips a trailing colon, so one
  alias covers both forms, and the corpus writes `Methodology Notes:` as a
  sub-heading on 31 reports against 22 that write it as a section. The alias
  would promote a sub-heading more often than it named a section.
- `6. Investment Insights` — a real section on 17 reports, sitting where either
  the verdict or the recommendation could live. The corpus does not settle
  which, and a registry that guesses is what this design exists to prevent.

---

## The indexing function

`report-sections-index` walks the corpus in batches and has two modes.

- **`measure`** does everything except write. It is how the round trip was
  proven across the whole corpus rather than a sample — 1,199 documents at up
  to 52 KB will not fit through a review, and a conservation claim about four
  of them is not a claim about the corpus. The sample is precisely what got
  part B wrong.
- **`index`** is the same walk with the writes attached.

Ordering is `.order('id')` because paging by offset over an unordered read
revisits and skips documents. A batch reads `id, report_content` and nothing
else.

### Auth, and why the arm is per report

The internal edge secret (bearer or `X-Cron-Secret`) — or, **per report**, the
self-sealing arm: a report with no index row may be indexed once without it.
The arm is per REPORT rather than per store because a whole-store emptiness gate
seals on the first batch and locks the remaining 1,100 documents out; that is
the crime ingest's per-state lesson. Re-indexing a report that already carries
an index row, and `force`, both require the secret.

### `sample` — how a deployment is checked against this repository

`{"sample": "<markdown>"}` partitions the text it is handed and reads nothing.
It exists so a deployed copy can be **shown** to be the module in this
repository rather than assumed to match it: the same text through the same
modules must produce the same index in both places. Beside it, every response
carries `registry: { headings, digest }` — a SHA-256 over every normalised alias
and the section it owns, sorted. Which vocabulary resolved a document's headings
is a fact about its index, and the digest is what makes it checkable.

Both were used on the 2026-09-07 deployment: digest
`976341c1da090975bf1c8af42392fa0da64061c4cba2cda7f57c85bf0e84cc3e`, 226
headings, and a fixture index identical field for field with the local run.

### The absorbed-heading floor

The response reports an absorbed heading only when at least **three distinct
reports** in the batch carry it. A heading three different clients' documents
share is a template heading; one that appears once may be a property address,
and a diagnostic response is not the place for it.

---

## What this does not do yet

Nothing reads the index. `sectionIdForHeading` and `partitionByRegistry` still
have no consumer in a shipped document path — Phase 2 deliberately adopted the
registry only where it could not change a document, and that is still true, so
these aliases changed the index and no client's report. Assembling a tier's
document *from* stored sections, which is what removes the fork's dependency on
re-reading a sibling document, is the next part.
