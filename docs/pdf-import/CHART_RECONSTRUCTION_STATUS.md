# Chart reconstruction: what is actually running

## The measurement

Across production — 245 imports, 84 sidecar jobs, 76 stored templates:

```
text overlays          18,148
vector overlays         5,741
image overlays          1,226      1,111 of them named "[image]"
table overlays            610
chart overlays              0
```

**Not one chart, ever.** And nothing anywhere said so: an import reported "no
charts" identically whether the document had none or the pipeline never looked.

## Four independent reasons, any one sufficient

**1. The source scene graph never runs.** 0 of 84 jobs produced a
`source_scene*` artifact. `chart_candidates.py` — the sidecar module that does
the chart arithmetic — is imported only by `source_scene_graph.py`, so it has
never executed on a production document.

**2. `loadSourceChartsByPage` therefore always returns `{}`.** No manifest, no
`chart_region_count`, no regions. `promotePicturesToCharts` no-ops on every
import. Confirmed independently: no job's `result_payload` mentions a chart at
all.

**3. Docling's picture classifier runs on one lane.** Only `design_heavy` sets
`do_picture_classification: True`, and design_heavy is **2 of 84 jobs (2.4%)**.

| lane | jobs |
|---|---|
| (no lane recorded) | 52 |
| `accurate_table` | 15 |
| `fast_native` | 13 |
| `pixel_raster_only` | 2 |
| **`design_heavy`** | **2** |

The downstream fingerprint is exact: `pictureItemToBlock` falls back to
`[image]` only when there is no alt text, no caption **and** no picture class —
and that is 1,111 of 1,226 image overlays. It is also why **0 of 1,226 carry
alternative text**, so Stage 2's fallback to a picture class could never fire.

**4. `chartNativeEnabled` is false** unless `VITE_PDF_IMPORT_CHART_NATIVE_ENABLED`
says otherwise, so containment would crop a chart even if one arrived.

## What this stage does about it

Reasons 1, 3 and 4 are deploy and cost decisions — turning on the scene graph or
an extra Docling enrichment changes Cloud Run time and money, and the sidecar
ships on its own manually-promoted revision (`CONTAINER_RELEASE.md`). They are
not code changes and are not made here.

What **is** recoverable in code is the detection signal itself. The evidence the
scene graph would have supplied is already in every import: **5,741 vector
overlays** carry the page's real geometry, and every axis tick and value label is
a measured text block. So `chartCandidate.pure.ts` classifies a picture as
chart-like from the page's own overlays — no sidecar change, no model, no extra
cost.

It produces three things:

- **alternative text for a figure that had none.** 0 of 1,226 imported images
  carry `alt` today; a detected kind gives "Bar chart", which is a true
  description and a real PDF/UA improvement on the Stage 2 work.
- **a layer name a designer can find**, instead of the 1,111th `[image]`.
- **a per-page warning** — `docling.chart_kept_as_picture` — that says the chart
  was detected, kept as a picture, and is neither editable nor extracted. That is
  what turns silence into a decision.

## What it will never do

**It never reads a value off a chart.** A misread number silently entering a
client's financial report is this programme's stated top risk, and a
classification cannot misstate a figure because it never states one. The alt text
says `"Bar chart"`, not `"Bar chart showing income rising to $186,000"` — and a
test asserts that no figure printed on the page appears in the description.

It also refuses rather than guesses. A picture wrongly labelled "Bar chart" puts
a false description into a tagged PDF, which is worse than the honest absence it
replaces. The gates:

| gate | value | why |
|---|---|---|
| minimum area | 4,000 pt² | an icon and a rule are not charts; this removes most of a page before any shape analysis |
| minimum marks | 3 | fewer than three plotted marks is not a plot |
| shared baseline | ±1.5 pt | bars in a chart stand on one baseline; rectangles at unrelated heights are a diagram |
| axis aspect | 12:1 across ≥60% of the span | separates an axis from a mark |
| confidence floor | 0.5 | below it, nothing is reported |

Geometry outside the picture's own box is ignored, so another figure's bars
cannot make this one a chart.

## The defect this found on the way

A test fixture whose axis ticks were labelled `caption` produced a bar chart
whose **alternative text was `"186,000"`**.

`pairCaption` falls back to the nearest `caption`-labelled block within 36 pt,
and a chart's tick labels sit exactly there. Stage 2 sends a paired caption to
`/Alt` in a tagged PDF, where a screen reader would read that number out as the
entire content of the figure.

`figureAltText` now refuses a caption that is only a number — a bare figure,
currency amount, percentage or year is a datum, not a description — and falls
through to the next candidate. Found by a test, not in production.

## What a native chart would still need

The detector is the gate input, not the answer. Before a chart overlay can carry
numbers a client will read:

1. the scene graph (or an equivalent) running, so series geometry exists;
2. value-label pairing, so each series value has a printed number to be checked
   against — the corroboration pattern Stage 3 established;
3. `chartNativeEnabled` flipped, which the original plan deliberately deferred
   "once a native chart exists for it to gate".

Until then a chart stays a source crop, which is always a correct outcome — and
now it is a *stated* one.
