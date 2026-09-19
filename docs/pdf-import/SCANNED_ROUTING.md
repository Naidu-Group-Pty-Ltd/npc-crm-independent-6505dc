# Routing a scanned PDF to the engine that can read it

## The situation

Template Builder has two PDF engines and **only one of them can read a scan**:

| engine | reads |
|---|---|
| deterministic (Docling sidecar) | the text layer |
| Claude (`pdf_document` mode) | the page |

A scanned PDF has no text layer. The deterministic path therefore cannot produce
a word of text from it — it produces a picture of each page and reports success.
The user picks a file, waits, and gets a template they cannot edit, with nothing
anywhere saying why.

## OCR is not the answer, and saying so matters

Measured on the production ledger:

| | |
|---|---|
| sidecar jobs | 84 |
| distinct documents | 23 |
| pages | 1,164 |
| **pages OCR'd, ever** | **0** |

`GLOBAL_CAPABILITIES.ocr` is a hard ceiling (`lane_policy` rule 4) and defaults
false, so the `ocr_scanned` lane is inert even when the planner selects it. The
only document that ever triggered `ocr_hint` was a **false positive** — it yields
1,885 characters of perfectly good embedded text, because the planner's probe
reads only the pypdfium2 page textpage.

So the message this stage shows never mentions OCR. Pointing someone at a setting
that changes nothing is worse than saying nothing, and a test asserts the word
never appears.

## What was built

Nothing new has to be measured. Stage 1's grounding already walks the attached
PDF with PDF.js **in the browser, before anything is uploaded**, so the character
count per page is available for free — no upload, no sidecar, no cost.

```
file picked ─► probeTextLayer()      counts non-whitespace characters per page
                     │
                     ▼
              assessTextLayer()      native | partial | scanned | unknown
                     │
                     ▼
           describeScannedRouting()  what to do, and what to say
                     │
                     ▼
     import dialog: pre-select "read with Claude" and explain why
```

`probeTextLayer` is deliberately **not** `groundPdfDocument`: grounding merges
fragments into lines, ranks them and builds a prompt block, none of which a "does
this page have text" question needs. It walks 60 pages by default rather than
grounding's 12 — grounding bounds a *prompt*, this bounds a *verdict*, and a
60-page document whose first 12 pages happen to be a scanned cover letter is not
a scanned document.

Measured on the checked-in golden report: page 1 (a vector-only cover) yields
**0** characters, pages 2–8 yield **275–1,148**. One text-less cover out of eight
is correctly `native`, and the dialog says nothing.

## Rules that keep biting

**A failed probe is `unknown`, never `scanned`.** The probe fails on an encrypted
or malformed file, and those are not scans. Recommending a different engine off a
failed read is the worse error, so `unknown` notifies nobody and changes nothing.

**A stray character must not make a scanned page look native.** The threshold is
24 characters, not zero. A scan routinely carries a stamp, a form field or a
producer watermark, and calling such a page native on four characters is exactly
how a scanned document gets imported as a picture with nobody told.

**A page the probe never reached counts as having no text.** A page missing from
the walk is a page PDF.js found nothing on, so the assessment compares against
the document's real `totalPages` rather than against the pages it managed to
read.

**A mostly-readable document stays on the deterministic path.** `partial` names
the affected pages and does *not* pre-select Claude: the deterministic path
measures real glyph geometry wherever there is any, and no amount of reading a
picture matches that. The choice is offered, not made.

**Pre-select, never force.** The checkbox is ticked and the reason shown beside
it. A designer who wants the picture can untick it.

**Say what the other engine will do.** "The standard importer would produce a
picture of each page" is the fact the user needs, and it stays true whether or
not they take the recommendation.

## What this does not do

- It does not enable OCR, and does not suggest it.
- It does not change any import path's behaviour. A native document is imported
  exactly as before, and the probe on it costs one PDF.js text walk in the
  browser.
- It does not re-route automatically. Every import still runs the engine the
  dialog shows selected.
