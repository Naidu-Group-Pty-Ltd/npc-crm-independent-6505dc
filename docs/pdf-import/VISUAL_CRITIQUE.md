# Looking at the rendered page — and checking what the model says it saw

## The gap

The import quality gate already renders every reconstructed page and diffs it
against the source raster. It reports a **number**.

Those numbers were shown to be untrustworthy on their own:

| signal | value |
|---|---|
| visual gate `overallScore` | 0.507–0.817 across 14 imports |
| pages flagged `pagesNeedingReview` | **65 of 88 (74%)** |
| CDIR `textAccuracy == 1.0` | 89 of 117 imports |
| `repairPassesApplied` | **0 on every import** |

`BC Snapshot - Masline Nyawo.pdf` scores **1.0** on CDIR fidelity and **0.507**
on the visual gate, with 7 of 7 pages needing review. Same document, opposite
verdicts, and neither says *what is wrong with any page*. A reviewer gets a
score, opens the page, and has to find the defect themselves.

There was supposed to be a second channel — and it was dead.

## The dead endpoint

`template-design-agent` carries a mode called `layout_reconciliation_repair`,
documented as "page-scoped AI visual repair". It contains no model.

```ts
// server — the entire handler
const { patches, rejected } =
  sanitizeVisualDiffRepairPatches(body.candidatePatches ?? [], pageId, maxOps);
return json({ patches, rejected, pageId, allowlistVersion });
```

```ts
// client — aiClient.repairPage, the only caller
{ mode, pageId, diffReport, plan, maxOperations, instruction }
```

`candidatePatches` is **never sent**. `sanitize(undefined ?? [])` returns
`{ patches: [], rejected: [] }`, so the endpoint answered *"no changes, nothing
rejected"* to every request ever made of it — which the review UI reported as
**"AI repair produced no changes"**, indistinguishable from "the page was fine".
The `diffReport`, the `plan` and the `instruction` were all ignored.

It was dead twice over: `enableAiRepair` is a prop no caller ever set, so the
button that reaches it was disabled everywhere too.

## What was built

A **judge, not a fixer**. The model is shown the source page and the rendered
page and asked what differs. It returns typed, located findings. It never
proposes geometry and there is no path from its output to a template.

That split follows the rest of this programme. Grounding the PDF path exists
because a model is good at **noticing** and bad at **measuring**; asking one to
nudge boxes from two pictures would contradict the stage before it. So every
claim geometry can adjudicate, geometry adjudicates:

| the model says | what settles it |
|---|---|
| "the title is clipped" | measure the text against its box |
| "the logo is hidden" | do the boxes intersect, and what does `paintOrder` rank on top |
| "nothing is in this region" | is an overlay already covering it |
| "this row is duplicated" | same box, same words |
| "this colour is wrong" | **unverifiable** — only pixels can say, and it is labelled as such |

```
  source raster ─┐
                 ├─► visual_critique (Claude, forced tool) ─► findings
  rendered page ─┘                                              │
  element ids  ──┘                                              ▼
                                          parseCritiqueFindings — drop ids the page lacks
                                                                ▼
                                          corroborateFindings — measure every checkable claim
                                                                ▼
                                          confirmed / unverifiable / refuted, shown as such
```

- `_shared/visualCritique.pure.ts` — the closed vocabulary, the tool schema, the
  parser and the corroboration rules. Loaded by the edge runtime and the browser
  alike, exactly like the workflow modules; `pdfImport/visualCritique.ts` is the
  browser's shim onto it.
- `template-design-agent` mode `visual_critique` — two images in, findings out.
  Metered through `claudeReconstruct`, which Stage 0 made unconditional.
- `ingestion/reconciliation/runVisualCritique.ts` — look, drop, check.
- Review UI — a per-page **"Explain the difference"** action, and the findings
  rendered under the page's metrics with what measurement made of each.

## Rules that keep biting

**A finding naming an element the page does not contain is dropped.** It reaches
a reviewer looking exactly like a real defect, pointing at an id they cannot
find. This is the single most important rejection in the parser.

**The vocabulary is closed.** An open `kind` field means the model invents
categories, nothing downstream can corroborate them, and the review surface
fills with prose. Every kind either has a geometric check or is explicitly one
that only pixels can settle.

**Both images or nothing.** Judging a reconstruction with only one image in hand
produces a critique of the page rather than of the *difference* — a redesign
brief wearing a defect report's clothes. The client refuses before the call and
the endpoint refuses again.

**`unverifiable` is not a soft `confirmed`.** It means the evidence this module
holds cannot reach the claim. The review surface shows it as unchecked, and the
badge is a different colour from a measured one.

**A refuted finding stays in the list.** A reviewer is better served knowing the
model claimed something and measurement disagreed than by a list that quietly
lost it — and a pattern of refutations is itself a signal about the judge.

**The inventory withholds style.** The model gets ids, boxes and copy. Telling it
what colour something is *supposed* to be invites it to report the declaration
back as an observation.

**Images travel inline, not by URL.** A signed raster URL expires in 300s, and an
edge function that fetches one on the model's behalf is a fetch primitive
pointed at an attacker-influenceable string. The browser inlines them as data
URLs, which is where every other vision path in this codebase keeps the
boundary.

**Measurement noise is not a verdict.** A canvas measures a different
rasteriser's advance widths than WeasyPrint lays out with, so a fit claim is
confirmed only when it misses by more than `FIT_TOLERANCE_PT`, and the wrapped
estimate is allowed to confirm a bad overflow but never to clear a marginal one.

## Why the critique is on and repair is not

`enableAiRepair` gates an action that **writes to a client's document**;
`enableAiCritique` gates one that returns findings and cannot. So the critique is
enabled at both call sites and needs no confirmation step — the gate it needs is
an explicit click, which it has, because the call costs money and is metered.

The dead repair endpoint is not revived here. It now answers with a stated reason
when it is handed nothing to sanitise, so an operator can no longer mistake
"nothing was sent" for "nothing is wrong". Model-authored geometry remains
deliberately unshipped.

## What this does not do

- It does not change any document, and there is no code path by which it could.
- It does not run automatically during import. Every critique is one operator
  click on one page, so a large import cannot silently spend a model call per
  page.
- It does not settle colour, typeface, spurious elements or artifacts. Those are
  claims about what the SOURCE looks like, and nothing in the corroboration path
  holds the source's pixels. They are reported as unchecked.
- It does not feed the repair loop. Turning confirmed findings into deterministic
  patches is the obvious next step and is deliberately not taken here: a
  corroborated finding is evidence, and what to do about it is a separate
  decision with its own safety argument.
