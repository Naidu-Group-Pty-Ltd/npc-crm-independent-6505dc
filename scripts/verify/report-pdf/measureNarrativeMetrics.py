#!/usr/bin/env python3
"""
Measure, with the pinned engine, what the narrative charge model has to know.

The markdown block packs a report's prose into page buckets by ESTIMATED
lines (`markdownPaging.pure.ts`). The estimate is only as good as the charge
model behind it, and the model was calibrated once, on one family's face over
one measure. Every other family sets a different face at a different size over
a different measure, and the block's own inline styles — heading scale, list
indent, cell padding, figure width — decide what each kind of block really
costs. This script asks WeasyPrint directly, for each active structure:

  * how many characters of ordinary prose fit one rendered line (cpl);
  * what a heading, a list item, a table row, a figure and a callout cost, in
    body lines, against the formulas `markdown.pure.ts` charges.

Every probe is set with the SAME inline styles `markdownBlock.html.ts` emits
(`styleTags`), so a measured height is the height the document gets. A
`ratio` near 1.0 means the model charges what the engine draws; a ratio above
1.0 means the model UNDER-charges and a page packed to its budget overflows.

Usage: python3 scripts/verify/report-pdf/measureNarrativeMetrics.py [--json]
Requires the pinned WeasyPrint (`weasyprint-service/requirements.txt`) and the
container's faces installed locally — `fc-list` should show them.
"""
import base64
import json
import sys

from weasyprint import HTML

PROSE = (
    "Riverbank settlements along the estuary widened steadily as ferries, market gardens and "
    "timber mills drew workers whose cottages later became the tightly held streets buyers now "
    "compare against newer estates further inland, and the pattern repeats in every coastal town "
    "with a working harbour, a school and one road out. The property sits within an established "
    "residential pocket rather than in the immediate town centre, giving it a balanced blend of "
    "convenience and traditional house-and-yard living, with mature streetscapes and a mix of older "
    "weatherboard or brick homes and selectively renovated dwellings that hold their value across "
    "cycles because the land component is large and the housing stock is finite. Buyers weighing "
    "the trade-off between a newer build on a smaller lot and an older home on a larger one tend to "
    "find that the second holds its ground through the cycle, provided the structure is sound."
)

# (label, body family, heading family, size pt, line-height, measure pt) — the active structures.
CASES = [
    ("midnight", "Noto Serif", "Noto Serif", 9.5, 1.55, 459),
    ("chancery", "Inter", "Playfair Display", 9.5, 1.55, 481),
    ("dictionary", "Inter", "IBM Plex Mono", 8.75, 1.55, 509),
]


def block_styles(size, body, heading, lh):
    """The inline styles `markdownBlock.html.ts` puts on each tag, as CSS."""
    return f"""
      .m {{ font-family: '{body}'; font-size: {size}pt; line-height: {lh}; }}
      .m h2 {{ font-family: '{heading}'; font-size: {size * 1.5:.1f}pt; font-weight: 600; margin: 0 0 6pt; line-height: 1.25; }}
      .m h3 {{ font-family: '{heading}'; font-size: {size * 1.2:.1f}pt; font-weight: 600; margin: 8pt 0 4pt; line-height: 1.3; }}
      .m h4 {{ font-size: {size:.1f}pt; font-weight: 700; margin: 8pt 0 3pt; line-height: 1.3; }}
      .m p {{ margin: 0 0 6pt; }}
      .m ul, .m ol {{ margin: 0 0 6pt; padding-left: 12pt; }}
      .m li {{ margin: 0 0 2pt; }}
      .m table {{ width: 100%; border-collapse: collapse; margin: 0 0 8pt; font-size: {size * 0.92:.1f}pt; }}
      .m th {{ text-align: left; padding: 3pt 4pt; border-bottom: 0.75pt solid #999; font-weight: 600; }}
      .m td {{ padding: 3pt 4pt; border-bottom: 0.5pt solid #999; vertical-align: top; }}
      .m figure {{ margin: 6pt 0 8pt; }}
      .m figure.chart-compact {{ width: 60.5%; }}
      .m figure img {{ display: block; width: 100%; height: auto; }}
      .m figcaption {{ margin-top: 4pt; font-size: {size * 0.8:.1f}pt; letter-spacing: 0.06em; text-transform: uppercase; }}
      .m .callout {{ margin: 0 0 8pt; padding: 6pt 8pt; border-left: 1.5pt solid #999; }}
      .m .callout-label {{ display: block; font-size: {size * 0.8:.1f}pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 3pt; }}
      .m .callout ul {{ margin: 0; }}
    """


PX_PER_PT = 96 / 72  # the box tree is in CSS pixels; every figure here is in points


def render_height(html, width, css):
    """
    Content height in PT of the `.m` box on a single, very tall page.

    `overflow: hidden` makes the box a formatting context of its own, so a
    child's trailing margin stays inside it rather than collapsing through
    the bottom edge — a lone heading's 6pt bottom margin is part of what it
    costs the page and must be measured, not lost.
    """
    doc = HTML(string=f"<style>@page {{ size: 595pt 4000pt; margin: 0 }} body {{ margin: 0 }} "
                      f".m {{ width: {width}pt; overflow: hidden }} {css}</style><body><div class='m'>{html}</div></body>").render()
    for box in doc.pages[0]._page_box.descendants():
        el = getattr(box, 'element', None)
        if el is not None and getattr(box, 'element_tag', '') == 'div' and 'm' in (el.get('class') or '').split():
            return float(box.height) / PX_PER_PT
    raise RuntimeError('no .m box found')


def svg(w, h):
    s = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="100%"><rect width="{w}" height="{h}" fill="#ccc"/></svg>'
    return 'data:image/svg+xml;base64,' + base64.b64encode(s.encode()).decode()


def probe(label, body, heading, size, lh, width):
    css = block_styles(size, body, heading, lh)
    pitch = size * lh
    H = lambda html: render_height(html, width, css)  # noqa: E731
    lines = lambda h: h / pitch  # noqa: E731

    out = {"body": body, "heading": heading, "size": size, "lineHeight": lh, "measurePt": width,
           "pitchPt": round(pitch, 3), "probes": {}}

    # Prose: characters per line, from a margin-less paragraph.
    para_h = H(f"<p style='margin:0'>{PROSE}</p>")
    n_lines = round(lines(para_h))
    cpl = len(PROSE) / n_lines
    out["charsPerLine"] = round(cpl, 1)
    out["advanceEm"] = round(width / (cpl * size), 4)

    def rec(name, measured_pt, model_lines):
        m = lines(measured_pt)
        out["probes"][name] = {"measuredLines": round(m, 2), "modelLines": round(model_lines, 2),
                               "ratio": round(m / model_lines, 3) if model_lines else None}

    # A paragraph with its margin.
    rec("paragraph", H(f"<p>{PROSE}</p>"), max(1, len(PROSE) / cpl) + 6 / pitch)
    # Headings.
    rec("h2", H("<h2>Location and market context</h2>"), (1.5 * 1.25 * size + 6) / pitch)
    rec("h3", H("<h3>Employment and income base</h3>"), (1.2 * 1.3 * size + 12) / pitch)
    rec("h4", H("<h4>What this means</h4>"), (1.3 * size + 11) / pitch)
    # A list of three one-line items, and one whose items wrap to two lines.
    one = "Item one of a list set at the template's size and face."
    rec("list3", H(f"<ul><li>{one}</li><li>{one}</li><li>{one}</li></ul>"), 3 * (1 + 2 / pitch) + 6 / pitch)
    two = PROSE[:int(cpl * 1.6)]
    rec("list2x2", H(f"<ul><li>{two}</li><li>{two}</li></ul>"),
        2 * (max(1, len(two) / (cpl - 6)) + 2 / pitch) + 6 / pitch)
    # A table: head plus three one-line rows; then a row whose cell wraps.
    row = "<tr><td>Flood</td><td>Low</td><td>One line of reason, kept short.</td></tr>"
    tbl = f"<table><tr><th>Risk</th><th>Level</th><th>Why it matters</th></tr>{row}{row}{row}</table>"
    rec("table3", H(tbl), (0.92 + 6.75 / pitch) + 3 * (0.92 + 6.5 / pitch) + 8 / pitch)
    long_cell = PROSE[:int(cpl * 0.92 * 1.5)]
    wrap = f"<table><tr><th>Risk</th><th>Why it matters</th></tr><tr><td>Flood</td><td>{long_cell}</td></tr></table>"
    rec("tableWrapRow", H(wrap), (0.92 + 6.75 / pitch) + (2 * 0.92 + 6.5 / pitch) + 8 / pitch)
    # Figures: compact (60.5% of the measure) and full width, each 460x300 / 760x300 units.
    rec("figureCompact", H(f"<figure class='chart-figure chart-compact'><img src='{svg(460, 300)}'></figure>"),
        (0.605 * width * 300 / 460 + 14) / pitch)
    rec("figureFull", H(f"<figure class='chart-figure'><img src='{svg(760, 300)}'></figure>"),
        (width * 300 / 760 + 14) / pitch)
    rec("figureCaptioned", H(f"<figure class='chart-figure'><img src='{svg(760, 300)}'><figcaption>Share of dwellings by type</figcaption></figure>"),
        (width * 300 / 760 + 14 + 4 + 0.8 * size * lh) / pitch)
    # A glance callout of three items.
    rec("callout3", H(f"<div class='callout'><span class='callout-label'>At a glance</span><ul class='marked'><li>{one}</li><li>{one}</li><li>{one}</li></ul></div>"),
        (12 + 0.8 * size * lh + 3) / pitch + 3 * (1 + 2 / pitch) + 8 / pitch)
    return out


results = {}
for label, body, heading, size, lh, width in CASES:
    results[label] = probe(label, body, heading, size, lh, width)
    r = results[label]
    print(f"== {label}: {body} {size}pt/{lh} over {width}pt  cpl={r['charsPerLine']}  advance={r['advanceEm']}em  pitch={r['pitchPt']}pt")
    for name, p in r["probes"].items():
        print(f"   {name:16s} measured {p['measuredLines']:6.2f}  model {p['modelLines']:6.2f}  ratio {p['ratio']}")
if "--json" in sys.argv:
    json.dump(results, sys.stdout, indent=1)
