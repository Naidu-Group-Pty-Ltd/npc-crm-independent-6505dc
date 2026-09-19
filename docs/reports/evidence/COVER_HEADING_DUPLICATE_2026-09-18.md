# The cover carried its own title twice

Found 18 September 2026 by producing a real document and measuring it, not by
reading the renderer. **Retained-data replay**: the record is the production
row `c21ed1fa-115c-4e8e-8fc3-6b5a0982834f` (1/27D Mitchell Street) driven
through the journey harness with Supabase answered from fixtures and the final
render drawn by WeasyPrint 69.0 — the version production pins. No credential
was used and no vendor was called, so this is not a real end-to-end generation.

## What the document did

`measure.mjs` on the produced PDF, **before**:

```
=== S5 -- 19 pages, 384 KB ===
  3 issue(s):
    p 1  ILLEGIBLE 4 run(s): Financial | Analysis | —
    p 1  OVERLAP   Mitchell <-> F i n a n c i a l | Street <-> Y o u r
    p 2  SPARSE    largest empty band 67.7% of body
```

`pdftotext` on page 1 explains both of the page-1 findings at once:

```
Financial
Analysis
—
1/27D   N a i d u  P r o p e r t y  C o n s u l t i n g  S e r v i c e s     Financial Analysis
Mitchell
        Financial Analysis
Street
        Yo u r  d e d i c a t e d  p r o p e r t y  p a r t n e r
        FINANCIAL ANALYSIS
        1/27D Mitchell
        Street
```

The title appears **twice**. The second is the cover's display type, which is
what a reader sees. The first is a second copy at the top-left, broken one word
per line, drawn at no contrast, with its word boxes sitting on the letterhead's.

## Where it came from

`htmlRenderer.ts` emits a visually-hidden `<h1>` carrying the document title.
It exists for a good reason, recorded in its own comment: veraPDF 1.30.2 failed
a 36-page render on PDF/UA clause 7.4.2 test 1 — *"if any heading tags are
used, H1 shall be the first"* — because the masters set their cover title as
positioned display type, which carries no heading role. The document's title
IS its first-level heading, so it is emitted as one, out of the visual surface
because the cover already shows it.

The mechanism was the defect, and it was believed rather than measured:

```ts
// 0 x 0 and clipped: present in the structure tree, absent from the page.
<h1 style="position:absolute;top:0;left:0;width:0;height:0;overflow:hidden;margin:0;">
```

**`overflow: hidden` on a zero-size absolutely positioned box does not stop
WeasyPrint painting the text.** The box is zero-width, so every word wraps onto
its own line; the glyphs are drawn anyway, at the top-left, over the letterhead.

Three consequences, none visible on screen and all of them real: a client's PDF
carries its own title twice to copy-paste, to search and to a screen reader; the
document measures ILLEGIBLE and OVERLAP on its cover; and the second copy is
fragments rather than a sentence.

## The fix, and what settled it

`font-size: 0; line-height: 0` added to the same element. The element and its
heading role stay in the box tree — which is what the structure tree is built
from, and what 7.4.2 reads — while there is no glyph of any size to paint or
extract. The zero-size clipped box is kept, so nothing about the layout moves.

**After**, same record, same harness, same engine:

```
=== S5b -- 19 pages, 384 KB ===
  1 issue(s):
    p 2  SPARSE    largest empty band 67.7% of body
```

Page 1 is clean. Its text layer now begins at the letterhead, with the title
appearing once.

And the heading it was there for survives — the structure tree, read out of the
produced file:

```
{'Document': 1, 'Figure': 13, 'H1': 1, 'H2': 5, 'H3': 7, 'H4': 14,
 'Link': 10, 'P': 44, 'Span': 780, 'Table': 5}
```

Exactly one `H1`, still ahead of the `H2`s. The conformance the hidden heading
exists to keep is kept.

## Not fixed here, and why

**`p 2 SPARSE 67.7%`** is the Contents page, and a contents page with five
entries is genuinely airy rather than broken. But reading it as a document
surfaced a real §9 finding of a different kind, **which is now fixed** — see
§"The contents named one row for fifteen pages" below:

| | |
| --- | --- |
| 1. Cover | 1 |
| 2. Contents | 2 |
| 3. Executive dashboard | 3 |
| 4. Client Investment Feasibility & Financial Performance Report | 4 |
| 5. Important information | 19 |

**Five entries for nineteen pages, and entry 4 covers fifteen of them.** A
reader cannot find the loan schedule, the ten-year projection or the
sensitivity table from the contents — which is the navigation deficiency §9
names when it points at the legacy Lot 20427 report. Closing it means the
contents enumerating the sections inside that chapter, which is a change to the
master page sequences rather than to a renderer, and it is recorded here rather
than attempted alongside an unrelated fix.


---

## The contents named one row for fifteen pages

Same render, same reading, a different defect — and this one had already been
found once and fixed for a different document shape.

`toc.html.ts` lists the report's own headings rather than its page archetypes,
and its own comment records why: a Compass contents used to read *Cover ·
Contents · Executive dashboard · The assessment · Risk and recommendation · The
report · Sources and methodology · Important information* — eight rows for a
36-page report whose body is twenty-one sections. The renderer publishes which
of the narrative's headings landed on which page, and the list names those.

**It lists one level, and it chose the wrong one here.** The rule was "the run's
own TOP level", which is right for the Compass — no `h1`, eighteen `h2`
sections, twenty-six `h3` subsections, so listing the top level lists the
eighteen. The Financial Analysis body is shaped differently: **one `h1` over six
`h2` sections and fourteen `h3`s.** Its top level therefore held exactly one
section — the document's own title — and the contents read:

```
1. Cover                                                            1
2. Contents                                                         2
3. Executive dashboard                                              3
4. Client Investment Feasibility & Financial Performance Report     4
5. Important information                                           19
```

Five rows for nineteen pages, one covering fifteen. The yield positioning, the
risk dashboard and the recommendation were all inside row 4, reachable only by
turning pages.

**The first rule tried was too narrow, and checking it against the other
fixtures rather than assuming it generalised is what found that.** It read:
a level holding a SINGLE section is a title, so descend past it. That fixed
the Financial Analysis and left three of the seven fixtures untouched — because
their narratives open with **two** `h1`s:

```
# NAIDU PROPERTY CONSULTING SERVICES
# Investment Report: 48 Redfern Street, Cowra NSW 2794
```

The issuer's name and the document's title, sitting together at the top of the
body. Level 1 held two sections, so the narrow rule left it alone, and a
35-page Investment Compass listed **two** contents rows — one of them the
company name — while eleven real sections stayed unreachable.

**The rule that ships, in `listedSectionLevel`: a level is a section tier only
if its sections open more than one PAGE.** A contents entry exists to send a
reader somewhere; a tier whose entries all point at the same page sends them
nowhere, whether it holds one heading or five. The list takes the shallowest
level whose sections open at least two distinct pages; where no level does, the
shallowest stands, because a document that never turns a page has one entry and
that is correct. A level shallower than the listed one is then excluded, so the
title is not printed beside the sections it introduces.

This subsumes the narrow rule — a level with one section opens one page, so it
is skipped either way — and catches masthead, which the narrow rule did not.

Measured across all seven retained fixtures, three narrative shapes and what
each now lists:

| shape | level 1 | level 2 | listed before | listed now |
| --- | ---: | ---: | ---: | ---: |
| Compass (`h2` top) | — | 17–29 | level 2 | level 2 — **unchanged** |
| Financial Analysis | 1 (title) | 7–8 | level 1 → 1 row | level 2 → 7–8 rows |
| Investment Report | 2 (masthead) | 11 | level 1 → 2 rows | level 2 → 11 rows |

**After**, same record, same harness, same engine:

```
1. Cover                                                    1
2. Contents                                                 2
3. Executive dashboard                                      3
4. Client Investment Decision Summary                       4
5. Financial Input Snapshot                                 5
6. Price, Rent & Yield Market Positioning                   7
7. Financial Risk Dashboard                                10
8. Financial Recommendation & Portfolio Fit                12
9. Assumptions, Verification Items & Adviser Disclaimer    13
10. Disclaimer                                             18
11. Important information                                  19
```

Eleven entries across nineteen pages, each naming the page it opens on, each
linking to the heading's own id rather than the top of the sheet. The contents
page's largest empty band falls from **67.7% to 51.2%** as a side effect — still
airy, which is what a contents page should be.


### Verified on a second document, a different shape

`09f8569e` — 48 Redfern Street, Cowra NSW 2794, a 35-page Investment Compass
whose body opens with the two `h1`s above. Its contents listed the company name
and the document title. After:

```
 1. Cover                                      1      9. Market Positioning              16
 2. Contents                                   2     10. Property Fit Within the Suburb  17
 3. Executive dashboard                        3     11. Risk Dashboard                  20
 4. Executive Verdict                          4     12. Due Diligence Checklist         26
 5. Property & Locality Snapshot               6     13. Final Recommendation            29
 6. Why This Location Matters                  9     14. Appendix, Source Notes …        29
 7. Demand Drivers                            12     15. Sources and methodology         34
 8. Amenity & Access                          12     16. Important information           35
```

Sixteen entries across thirty-five pages. Its cover measures clean as well — no
ILLEGIBLE and no OVERLAP, so the heading fix holds on this shape too.

**Two SPARSE pages remain on it and are recorded rather than fixed here**:
page 3 (the executive dashboard) at 68.3% and page 33 at 77.9%. Neither is the
contents, so neither is explained by an airy-by-design list; they are
master-geometry findings of their own and belong with the page-level work
rather than alongside a navigation change.
