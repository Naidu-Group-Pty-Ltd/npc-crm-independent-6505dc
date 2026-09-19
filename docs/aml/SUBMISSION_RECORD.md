# The submission record — one document, three presentations

Read this before touching `_shared/aml/submissionRecord.pure.ts`, the
`store_submission_record` operation, the reading view in
`SubmissionReviewPanel`, or the client portal's document listing/signing ops.

## What this is

Stage 7's review panel shows the submission as eight accordion sections with
coverage tracking (`STAGE_7_REVIEW_COVERAGE.md`). What it could not do was
hand anybody *the entirety of the submission as a thing*: one continuous
read, a file to download, a copy retained on the case. The submission record
is that thing, and it exists in exactly three presentations:

1. **Read in full** — a dialog rendering the record with app components.
2. **Download** — a PDF, saved directly, built in the browser from the data
   on screen by `submissionRecordPdf.ts` (jsPDF, drawn as selectable text —
   never `html2canvas`, which rasterises a compliance record into pixels).
   An `.html` download opened as a browser tab; what the reviewer keeps on
   file is the finished document. This is the repo's established
   client-download lane (`OverviewSnapshotPDF.ts` and kin) and touches none
   of the WeasyPrint report programme — the record is an internal
   compliance artefact, not a branded client report, so no template
   machinery, tenant branding, ledger row or container dependency applies.
3. **Print** — the reader's print button drives a hidden iframe carrying the
   self-contained HTML rendering (`renderSubmissionRecordHtml`), whose print
   stylesheet ships inside it.
4. **Store on case** — the `store_submission_record` operation renders the
   same record server-side, uploads it to `aml-documents`, and files an
   `aml.documents` row so it lives in Documents & Evidence under the
   platform's own retention. The stored artefact stays the inert HTML: the
   server holds no PDF engine, and the HTML is the hash-addressed archival
   form; the PDF is the human-reference form generated at the point of
   download.

All three are projections of the ONE structure built by
`buildSubmissionRecord` in `_shared/aml/submissionRecord.pure.ts`
(browser shim: `src/lib/aml/submissionRecord.ts`). The client and the edge
functions deploy separately; a record built twice is two opinions about what
the review contained.

## Two audiences, two documents

The record has a `RecordAudience`: `internal` (everything — the review
record) and `client` (the shareable copy for the client or a portal
partner). **The exclusion is structural, not a rendering choice**:
`buildSubmissionRecord` never builds the screening, risk & completeness,
service-gate, review-reason or reconciliation-workflow content into a
client record, so no renderer of one can leak it — a document that names
who was screened and what came back, in a client's hands, is a tipping-off
hazard. A test plants internal vocabulary in the internal-only fields and
asserts none of it appears anywhere in the client record or its HTML —
including the closing notice, which deliberately does not enumerate what
was excluded (naming the categories on a page a client reads is itself a
disclosure). The Download button is a menu of the two documents, named for
what they are; the filename says it too (`…-record.pdf` /
`…-client-copy.pdf`).

## The white-label identity

A record PDF is issued under the workspace's brand — company name, colour
ramp via `getBrandPdfPalette` (the same resolver every other white-labelled
PDF uses), report logo when a raster one loads — and under **Aurixa
Systems** when no brand is configured: never an empty masthead, never
another tenant's marks (`submissionRecordBrand.ts`). The brand dresses the
document (obsidian masthead band, accent strip and rules, wordmark or logo,
issuer in the running foot) and never touches content: body ink stays
neutral, and every string is the record's own. A logo that cannot be
fetched or is not PNG/JPEG degrades to the text wordmark rather than
failing the download — identity is required, a picture is not.

## The rules that carry it

**One composition serves the screen and the stored copy.**
`get_submission_review` and `store_submission_record` both call
`composeSubmissionReview` — the same queries, the same staleness reading,
the same first-submission rule. The stored record's whole value is that it
says what the screen said; a second composition is where they would start to
disagree. A source test counts the call sites.

**The artefact is inert by construction.** The rendered HTML is fully
self-contained: inline styles, system typefaces, no `<script>`, no `<img>`,
no `<a>`, no URL in any attribute, every interpolated string through one
escaper. A compliance record gets opened years later, from storage, possibly
outside this platform — it must carry nothing that runs and fetch nothing
from anywhere. (The report render boundary enforces this posture at a gate;
the record holds it at authoring time. Nothing here goes through WeasyPrint
or the template system.)

**Vocabulary is preserved, never paraphrased.** A simulation check reads
"Test simulation — not compliance evidence"; a provider error reads "attempt
not consumed"; screening states appear verbatim; and a first submission has
no differences *whatever the payload's `differences` array says* — the same
old-server defence as `differencesBadge`, applied a second time because the
record renders from the payload too. Nothing in the record may summarise a
state into "clear".

**The stored record never reaches the client.** It carries screening states
and risk readings — staff-only, and a tipping-off hazard in a client's
hands. The row is marked `metadata.kind = 'submission_review_record'`
(`SUBMISSION_RECORD_DOCUMENT_KIND`); the portal's `list_documents` filters
it out and `get_document_url` answers the same 404 it gives for "not yours"
— a distinct answer would confirm a staff-only document exists. Clients can
never write `metadata`, so the mark cannot be forged from that side. The
filter is applied **in code**: a PostgREST `.neq()` on `metadata->>kind`
would also drop every unmarked row, because in SQL `null <> 'x'` is null.

**Deploy order**: `aml-client-portal` (the refusal) before or with
`aml-cases` (the storing op). Until `aml-cases` deploys nothing can store a
record, so shipping the refusal first leaves no exposure window.

**An export OF the review is never evidence IN it.**
`composeSubmissionReview` excludes marked rows from the review's own
documents section — otherwise every stored record would appear in the next
record, and a staff export would count as client evidence. It still lists in
Documents & Evidence, which is the whole point of storing it.

**Each store is a point-in-time export, never an overwrite.** The object
name carries the content hash's prefix, the row carries the full SHA-256 in
`checksum` and `metadata.content_sha256`, and a case event records the store
with the hash and the review status at generation. Storing again after the
case moves produces a new document. The row is filed `status: 'accepted'`
deliberately: the uploaded→accepted/rejected cycle reviews *client*
evidence, and a platform-generated record would otherwise sit in a review
queue it can never leave.

**Reading in full counts as coverage, at the accordion's own standard.**
Opening the reader marks every content section as seen — it puts the whole
submission in front of the reviewer, exactly what opening every accordion
does. Coverage remains "had it in front of them", never "certified having
read it" (`STAGE_7_REVIEW_COVERAGE.md`).

**Timestamps are locale-independent and named UTC.** `formatUtc` has its own
month table — Deno and the browser carry different locale data, and the
stored and downloaded copies must format one instant one way, in a timezone
named on its face.

## Files

- `supabase/functions/_shared/aml/submissionRecord.pure.ts` — the structure,
  the HTML renderer, the filename rule, `SUBMISSION_RECORD_DOCUMENT_KIND`.
- `src/lib/aml/submissionRecord.ts` — browser shim.
- `src/lib/aml/submissionRecordPdf.ts` — the PDF presentation (browser only;
  jsPDF is lazily imported so the workspace pays nothing until a download).
- `supabase/functions/aml-cases/index.ts` — `composeSubmissionReview`,
  `get_submission_review`, `store_submission_record`.
- `supabase/functions/aml-client-portal/index.ts` — the two refusals.
- Tests: `src/lib/aml/submissionRecord.test.ts` (rules),
  `src/lib/aml/submissionRecordPdf.test.ts` (the PDF parsed back with
  pdf-lib: real A4 pages, pagination instead of clipping),
  `src/components/aml/__tests__/submissionRecordPanel.test.tsx` (screen +
  source pins).
