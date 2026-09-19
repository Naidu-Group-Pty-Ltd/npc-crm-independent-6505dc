"""Infer a text item's alignment from the geometry of the lines inside it.

WHY THIS IS ITS OWN MODULE
--------------------------
It lived in `app.py`, which imports Docling, PyMuPDF and httpx and therefore
cannot be gated by `ci.yml` — only the dependency-free sidecar modules run
there. So this rule shipped untested, and it was wrong in a way no reviewer
would spot by reading it:

    if n >= 2 and sum(1 for f in fills if f >= 0.95) >= n - 1:
        return "justify"

The box IS the union of the lines, so the WIDEST line fills 100% of it by
construction. At two lines that test has exactly one line to look at — the
widest — and passes for free. **Every two-line block was reported as
justified.** On the BC Snapshot cover that meant a centred title
(`BORROWING CAPACITY` / `SNAPSHOT`, both lines sharing a centre at x=296.45)
came back justified, so the renderer stretched the first line to the measure
and left-aligned the second. The eyebrow labels (`SECTION 01` above
`Capacity at a glance`) got the same treatment on five more pages.

Justification is a claim that lines were stretched to a COMMON measure, which
needs two non-last lines to compare against each other. Below three lines the
gap tests decide instead, and they read the cover correctly: equal left and
right gaps means centred.

Pure: no I/O, no clock, no randomness, no third-party imports.
"""

from __future__ import annotations

Alignment = str  # 'left' | 'right' | 'center' | 'justify'

#: Fewest lines from which justification can be told apart from anything else.
MIN_JUSTIFY_LINES = 3

#: Share of the measure a line must fill to count as stretched to it.
JUSTIFY_FILL_RATIO = 0.95

#: Gap tolerance as a share of the measure, with an absolute floor in points.
#: Small enough to separate a centred block from a left-aligned one, large
#: enough to absorb sidebearing differences between glyphs at the line ends.
EDGE_TOLERANCE_RATIO = 0.02
MIN_EDGE_TOLERANCE_PT = 2.0


def infer_alignment(lines: list[dict], ix0: float, ix1: float) -> Alignment:
    """Alignment of `lines` within the horizontal span `ix0`..`ix1`.

    Each entry needs a `bbox` of `[x0, y0, x1, y1]`. Returns `left` for an
    empty list — the neutral answer, and the one every renderer defaults to.
    """
    width = max(1.0, ix1 - ix0)
    n = len(lines)
    if not n:
        return "left"
    left_gaps = [ln["bbox"][0] - ix0 for ln in lines]
    right_gaps = [ix1 - ln["bbox"][2] for ln in lines]
    fills = [(ln["bbox"][2] - ln["bbox"][0]) / width for ln in lines]
    avg_left = sum(left_gaps) / n
    avg_right = sum(right_gaps) / n
    tol = max(MIN_EDGE_TOLERANCE_PT, width * EDGE_TOLERANCE_RATIO)
    if n >= MIN_JUSTIFY_LINES and sum(1 for f in fills if f >= JUSTIFY_FILL_RATIO) >= n - 1:
        return "justify"
    if avg_left <= tol and avg_right > tol:
        return "left"
    if avg_right <= tol and avg_left > tol:
        return "right"
    if abs(avg_left - avg_right) <= tol and avg_left > tol:
        return "center"
    return "left"
