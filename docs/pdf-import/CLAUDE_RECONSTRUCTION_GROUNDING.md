# Grounding the Claude PDF reconstruction path

Template Builder has **two** PDF import engines, and the choice is a checkbox in
`ReferenceImportDialog` ("read with Claude"):

| | route | reconstruction |
|---|---|---|
| unticked | `providers/dispatch` → `pdf-parse-dispatch` → the Docling sidecar | deterministic TypeScript, no model in the path |
| ticked | `reconstructPdfWithClaude` → `template-design-agent` → Anthropic Messages | the model reads the document and emits template ops |

This document is about the second one.

## The gap

Every reference kind the importer accepts grounds the model against measured
evidence before asking it to rebuild anything — except one:

| reference | grounding |
|---|---|
| image / screenshot | `groundOcrWords` → `GroundedReference` |
| code / URL | `groundDomBoxTree` → box tree |
| Figma | `figmaNodesToBoxTree` → box tree |
| **PDF** | **— nothing —** |

The PDF branch of `template-design-agent` said, verbatim:

> A PDF is attached. Reconstruct it on the active page… Read the PDF directly:
> transcribe text EXACTLY at its real positions

with no measurements to transcribe *from*. The screenshot branch, three hundred
lines above it, built a `MEASURED TEXT ELEMENTS` block from OCR and told the
model those were authoritative.

So the path with the **worst** evidence (a recognition guess off a raster) was
grounded, and the path with the **best** (a file that states each run's baseline
and advance width exactly) was not.

## What was built

`groundPdfDocument()` walks the attached PDF with PDF.js in the browser, before
the file is sent, and produces per-source-page measurements that travel
alongside it.

```
attached PDF ─┬─► groundPdfDocument()          (browser, PDF.js)
              │     placeTextFragment()        pure — content-stream geometry
              │     mergeFragmentsIntoLines()  pure — runs → rendered lines
              │     buildGroundedReferenceFromLines()  pure — selection + cap
              │        └─► { groundedReference, groundedPages, groundingCoverage }
              └─► pdfBase64 ──────────────────────────► template-design-agent
```

- `pdfjsTextGeometry.pure.ts` — the geometry. No PDF.js import, no DOM.
- `groundedReferenceFromPdf.pure.ts` — element shaping, ranking and the cap.
- `groundPdfDocument.ts` — the page walk. The only impure part.

### Verified against an independent parser

Checked on `reports/golden/borrowing-capacity-snapshot.pdf` p2 against PyMuPDF,
which reads the file with a completely separate implementation:

| | PDF.js path | PyMuPDF |
|---|---|---|
| x | 56.69 | 56.69 |
| baseline y | 85.04 | 85.04 |
| advance width | 125.046 | 125.05 |
| box top | 72.12 | 65.78 |

Baseline and advance agree exactly — those numbers are *in the file*. The box
tops disagree because PyMuPDF inflates the ascender for the base-14 substitutes
(1.07 em) while PDF.js reports the font's own (Helvetica AFM, 0.718 em). That is
why `y` is derived **from the baseline** and not from any parser's bounding box.

`groundPdfDocument.spec.ts` runs the whole pass against that checked-in PDF and
asserts these numbers, so the wiring is covered and not just the pure parts.

## Rules that keep biting

**Ground from the attached bytes, never from the open template.** The obvious
cheap route is to read the active page's overlays — when it came from a
deterministic import, those *are* the source's geometry. But nothing links the
open template to the file the user just picked. Import PDF B into a template
built from PDF A and the agent, which treats grounding as authoritative, asserts
text the attached document does not contain. Measurements from the wrong
document are worse than none.

**Absent grounding ≠ empty grounding.** A page with no text layer produces *no
entry*, and a document with none produces no grounding keys at all. An empty
element list satisfies the agent's guard and then tells the model "this page has
no text" — on a scanned page, a lie it reproduces. Absent correctly means "no
measurements, read the document yourself", which is exactly the behaviour that
shipped before this existed. Every failure inside `groundPdfDocument` degrades
to that: it never throws.

**PDF.js synthesises whitespace fragments with a width spanning the whole gap.**
A single `" "` between the two halves of the report header carries `width:
219.05`. Treating it as text places a 219pt blank overlay across the page.
Whitespace-only and empty fragments are dropped; the geometry gap is what
separates lines anyway.

**Fragments are not lines, and neither are table rows.** A rendered line arrives
as several show-text operators, and so does a table row. The only difference is
the horizontal gap, so `MAX_INTRA_LINE_GAP_EM = 4` — the same threshold
`splitBaselineColumns.pure.ts` uses, so the two agree about where a line ends.
On the golden report's page 3 that keeps `"Source"` and `"Gross Amount"` (206pt
apart at 8pt type) as separate cells instead of one invented sentence.

**Never pass on a CSS generic as the typeface.** PDF.js reports `sans-serif` as
`style.fontFamily` when it has no real name — and it usually has no real name.
The agent treats a supplied family as authoritative, so forwarding it would set
every overlay to the literal string `"sans-serif"` instead of letting the model
read the typeface off the page it can see. Generics are filtered out;
typeface, weight and italic stay the model's job.

**The cap selects; it does not truncate.** Lines arrive in reading order, so
`.slice(0, cap)` drops the footer and the page furniture. When the cap bites,
elements are ranked by characters × type size, the survivors are put **back into
reading order**, and the count that was dropped is reported into the prompt —
a bound nobody is told about reads as full coverage.

## The known residual

`y` is the ink top: `baseline − ascent × fontSize`. That is the convention the
schema's overlays and `imageGrounding`'s OCR boxes already use, but it is *not*
the box top that would make a CSS line box put the baseline back exactly where
the source has it:

```
boxTop = baseline − ((lineHeight − (hheaAsc + hheaDesc)) / 2 + hheaAsc) × size
```

(`firstBaseline.pure.ts`). That needs the hhea metrics of the **substituted**
font and the line-height the model picks, neither of which exists at grounding
time. The residual is about 0.2 em with a default line-height. Correcting it
belongs downstream, where the resolved font is known.

## Caps

| bound | value | why |
|---|---|---|
| pages measured | 12 (`DEFAULT_MAX_GROUNDED_PAGES`) | a long document would otherwise put tens of thousands of lines in one prompt |
| elements per page | 160 (`DEFAULT_GROUNDED_ELEMENT_CAP`) | matches the agent's own slice, so selection happens against real evidence rather than by array position |
| wall clock | 20 s | a grounding pass must never be why an import hangs |

Measured cost on real documents: the 8-page borrowing-capacity report yields
**16.9 KB** of prompt across 7 measured pages with nothing dropped (the cover is
vector-only and correctly produces no entry). A 4-page landscape agency
agreement yields 24.1 KB across 187 lines.

## Multi-page

Measurements are per **source** page, and the prompt now says so: source page 1
goes on the active page, each further source page gets an `add_page`. Without
that instruction a multi-page document collapses onto the active page —
grounding page 1 while the model guesses pages 2..n is the same gap one page
down.

Transport keeps `groundedReference` populated with the first measured page, so
the single-page key the agent already reads still grounds something for any
caller that knows nothing about `groundedPages`.
