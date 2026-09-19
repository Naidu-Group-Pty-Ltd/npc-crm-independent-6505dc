"""Deterministic chart series extraction from source vector geometry.

Pure module — stdlib only, no Docling, no PyMuPDF, no I/O — so the whole
contract is unit-testable without a model download, in the same spirit as
`lane_policy.py` and `ocr_languages.py`. `app.py` and `source_scene_graph.py`
supply already-extracted geometry; nothing here reads a PDF.

WHAT THIS IS FOR
----------------
A chart detected in an imported PDF used to become a picture, because the
engine could not read its numbers — `source_scene_graph` hardcodes
``extractionState: "crop_only"`` and says so. But the raw material for reading
them already crosses the wire: `_page_vectors` emits one item per PyMuPDF
drawing with its own rect in points, fill colour, stroke and path, and
`assign_chart_relationships` already sorts the surrounding text into axis
labels, legend entries and numeric tokens. Nobody was reading it for chart
semantics.

WHAT MAKES IT SAFE
------------------
Every value here is arithmetic on measured geometry — a rect's height, a
wedge's subtended angle — never a guess and never a model. The scale that turns
a position into a number is FITTED from the axis tick labels, not assumed, and
a fit that is not almost exact is reported as such so the caller can refuse it.

That refusal is the point. These documents are borrowing-capacity snapshots and
valuation reports; a chart rebuilt with a misread bar is worse than a picture of
the correct chart, because it looks authoritative and is editable. So this
module's job is to extract *and to say honestly how well it managed*, and
`chartArbitration` decides. Where evidence is insufficient the answer is None or
an empty list — never a fabricated number.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional, Sequence

CHART_CANDIDATE_CONTRACT_VERSION = "chart-candidate-contract-v1"

# An axis is linear by construction, so a correct tick pairing fits almost
# exactly. Below this the labels were paired with the wrong positions, or the
# axis is not linear — a log axis fits a straight line badly, and silently
# linearising one produces plausible, wrong numbers.
AXIS_FIT_MIN_R2 = 0.999

# Two points always fit a line perfectly, which tells us nothing.
AXIS_FIT_MIN_TICKS = 3

# Fills closer than this in RGB are treated as the same series. Anti-aliasing
# and colour-space round-trips move a fill by a hair; a palette does not.
FILL_MATCH_TOLERANCE = 0.02

# A "bar" must be meaningfully rectangular. Gridlines and axis rules are thin
# enough to fall out here without needing a separate classifier.
MIN_BAR_THICKNESS_PT = 2.0


@dataclass(frozen=True)
class AxisTick:
    """One axis tick: a measured position and the number printed beside it."""

    position: float
    value: float


@dataclass(frozen=True)
class AxisScale:
    """A fitted position -> value mapping."""

    slope: float
    intercept: float
    r2: float
    tick_count: int

    def value_at(self, position: float) -> float:
        return self.slope * position + self.intercept

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": "linear",
            "slope": self.slope,
            "intercept": self.intercept,
            "r2": self.r2,
            "tickCount": self.tick_count,
        }


@dataclass(frozen=True)
class SeriesPoint:
    label: str
    value: float
    color: Optional[str] = None

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"label": self.label, "value": self.value}
        if self.color:
            out["color"] = self.color
        return out


@dataclass(frozen=True)
class ChartCandidate:
    """What was extracted, plus an honest account of how well it went."""

    contract_version: str = CHART_CANDIDATE_CONTRACT_VERSION
    chart_type: Optional[str] = None
    series: tuple[SeriesPoint, ...] = ()
    axis_scale: Optional[AxisScale] = None
    value_label_pairs: tuple[tuple[float, float], ...] = ()
    smallest_tick_interval: Optional[float] = None
    unaccounted_numeric_tokens: tuple[str, ...] = ()
    notes: tuple[str, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict[str, Any]:
        return {
            "contractVersion": self.contract_version,
            "chartType": self.chart_type,
            "series": [s.as_dict() for s in self.series],
            "axisScale": self.axis_scale.as_dict() if self.axis_scale else None,
            "valueLabelPairs": [
                {"derived": d, "printed": p} for d, p in self.value_label_pairs
            ],
            "smallestTickInterval": self.smallest_tick_interval,
            "unaccountedNumericTokens": list(self.unaccounted_numeric_tokens),
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# Axis calibration
# ---------------------------------------------------------------------------

def fit_axis_scale(ticks: Sequence[AxisTick]) -> Optional[AxisScale]:
    """Least-squares fit of position -> value over the axis ticks.

    Returns None when there are too few ticks, when every tick sits at the same
    position (no gradient to fit), or when the values are constant. A poor fit is
    NOT suppressed — it is returned with its real r2 so the arbitration layer can
    veto on it, because "the fit was bad" is information the caller needs rather
    than something to hide.
    """
    pts = [t for t in ticks if math.isfinite(t.position) and math.isfinite(t.value)]
    if len(pts) < AXIS_FIT_MIN_TICKS:
        return None

    n = float(len(pts))
    mean_x = sum(p.position for p in pts) / n
    mean_y = sum(p.value for p in pts) / n

    sxx = sum((p.position - mean_x) ** 2 for p in pts)
    sxy = sum((p.position - mean_x) * (p.value - mean_y) for p in pts)
    if sxx <= 0:
        return None  # every tick at the same position

    slope = sxy / sxx
    intercept = mean_y - slope * mean_x

    syy = sum((p.value - mean_y) ** 2 for p in pts)
    if syy <= 0:
        # Constant values: a horizontal line fits perfectly but carries no
        # scale, so calling it r2 = 1 would be a lie of omission.
        return None
    residual = sum((p.value - (slope * p.position + intercept)) ** 2 for p in pts)
    r2 = 1.0 - (residual / syy)

    return AxisScale(
        slope=slope,
        intercept=intercept,
        r2=max(0.0, min(1.0, r2)),
        tick_count=len(pts),
    )


def smallest_tick_interval(ticks: Sequence[AxisTick]) -> Optional[float]:
    """Smallest gap between consecutive tick VALUES, used to floor tolerances."""
    values = sorted({t.value for t in ticks if math.isfinite(t.value)})
    if len(values) < 2:
        return None
    gaps = [b - a for a, b in zip(values, values[1:]) if b > a]
    return min(gaps) if gaps else None


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _rect(v: dict) -> Optional[tuple[float, float, float, float]]:
    """(left, top, right, bottom) from a vector item's bbox, if usable."""
    bbox = v.get("bbox") or {}
    try:
        l, t = float(bbox["l"]), float(bbox["t"])
        r, b = float(bbox["r"]), float(bbox["b"])
    except (KeyError, TypeError, ValueError):
        return None
    if not all(math.isfinite(x) for x in (l, t, r, b)):
        return None
    return (min(l, r), min(t, b), max(l, r), max(t, b))


def _inside(inner: tuple[float, float, float, float],
            outer: tuple[float, float, float, float]) -> bool:
    return (inner[0] >= outer[0] - 0.5 and inner[1] >= outer[1] - 0.5
            and inner[2] <= outer[2] + 0.5 and inner[3] <= outer[3] + 0.5)


def _parse_fill(value: Any) -> Optional[tuple[float, float, float]]:
    """Normalise a fill to an RGB triple in 0..1, or None when unfilled."""
    if value is None:
        return None
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        try:
            c = tuple(float(x) for x in value[:3])
        except (TypeError, ValueError):
            return None
        if not all(math.isfinite(x) for x in c):
            return None
        return c if max(c) <= 1.0 else tuple(x / 255.0 for x in c)
    if isinstance(value, str):
        s = value.strip().lstrip("#")
        if len(s) == 6:
            try:
                return tuple(int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
            except ValueError:
                return None
    return None


def _fill_key(rgb: Optional[tuple[float, float, float]]) -> str:
    """Quantise a fill so near-identical colours group as one series."""
    if rgb is None:
        return "none"
    step = FILL_MATCH_TOLERANCE
    return "-".join(str(int(round(c / step))) for c in rgb)


def _fill_hex(rgb: Optional[tuple[float, float, float]]) -> Optional[str]:
    if rgb is None:
        return None
    return "#" + "".join(f"{max(0, min(255, int(round(c * 255)))):02x}" for c in rgb)


# ---------------------------------------------------------------------------
# Series extraction
# ---------------------------------------------------------------------------

def extract_bar_series(
    vectors: Iterable[dict],
    region: tuple[float, float, float, float],
    scale: AxisScale,
    *,
    labels: Optional[Sequence[str]] = None,
    horizontal: bool = False,
) -> list[SeriesPoint]:
    """Bars -> values, by mapping each bar's value-end through the fitted scale.

    Applying the scale to the bar's *end position* rather than multiplying its
    height by a unit works for any axis direction and any non-zero baseline
    — PDF y grows downward, charts sometimes start at a value other than zero,
    and both fall out of the fit for free.

    Ordering is positional (left-to-right, or top-to-bottom when horizontal),
    which is the order a reader sees and the order the category labels come in.
    """
    bars: list[tuple[float, float, Optional[tuple[float, float, float]]]] = []
    for v in vectors:
        rect = _rect(v)
        if rect is None or not _inside(rect, region):
            continue
        fill = _parse_fill(v.get("fill"))
        if fill is None:
            continue  # unfilled: a gridline, axis rule or outline, not a bar
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if width < MIN_BAR_THICKNESS_PT or height < MIN_BAR_THICKNESS_PT:
            continue  # too thin to be a bar
        if horizontal:
            bars.append((rect[1], rect[2], fill))   # sort by top, value at right
        else:
            bars.append((rect[0], rect[1], fill))   # sort by left, value at top

    bars.sort(key=lambda b: b[0])

    out: list[SeriesPoint] = []
    for i, (_, value_edge, fill) in enumerate(bars):
        label = labels[i] if labels and i < len(labels) else str(i + 1)
        out.append(SeriesPoint(
            label=label,
            value=scale.value_at(value_edge),
            color=_fill_hex(fill),
        ))
    return out


def extract_pie_series(
    wedges: Iterable[dict],
    *,
    labels: Optional[Sequence[str]] = None,
    total: Optional[float] = None,
) -> list[SeriesPoint]:
    """Wedges -> values, proportional to subtended angle.

    A pie needs no axis: the angle IS the measurement. Values are shares of
    `total` when the chart states one, otherwise percentages, which is what an
    unlabelled pie actually communicates.
    """
    angles: list[tuple[float, Optional[tuple[float, float, float]]]] = []
    for w in wedges:
        try:
            sweep = float(w.get("sweep_angle"))
        except (TypeError, ValueError):
            continue
        if not math.isfinite(sweep) or sweep <= 0:
            continue
        angles.append((sweep, _parse_fill(w.get("fill"))))

    total_sweep = sum(a for a, _ in angles)
    if total_sweep <= 0:
        return []

    scale_to = total if (total is not None and math.isfinite(total) and total > 0) else 100.0
    out: list[SeriesPoint] = []
    for i, (sweep, fill) in enumerate(angles):
        label = labels[i] if labels and i < len(labels) else str(i + 1)
        out.append(SeriesPoint(
            label=label,
            value=(sweep / total_sweep) * scale_to,
            color=_fill_hex(fill),
        ))
    return out


def extract_line_series(
    vertices: Sequence[tuple[float, float]],
    scale: AxisScale,
    *,
    labels: Optional[Sequence[str]] = None,
) -> list[SeriesPoint]:
    """Polyline vertices -> values, one point per vertex, ordered by x."""
    pts = [
        (x, y) for x, y in vertices
        if math.isfinite(x) and math.isfinite(y)
    ]
    pts.sort(key=lambda p: p[0])
    out: list[SeriesPoint] = []
    for i, (_, y) in enumerate(pts):
        label = labels[i] if labels and i < len(labels) else str(i + 1)
        out.append(SeriesPoint(label=label, value=scale.value_at(y)))
    return out


# ---------------------------------------------------------------------------
# Numeric-token accounting
# ---------------------------------------------------------------------------

def account_numeric_tokens(
    tokens: Iterable[str],
    accounted: Iterable[str],
) -> list[str]:
    """Numbers inside the chart region that nothing explained.

    Every numeric token should be an axis tick, a data label, a legend entry or
    part of the caption. One that is none of those means the extractor did not
    understand the chart, and a chart that was not understood must not be
    rebuilt from it. Comparison is on normalised numeric VALUE, so "1,250" and
    "1250" and "1250.0" are the same number written three ways.
    """
    def norm(tok: str) -> Optional[float]:
        cleaned = str(tok).strip().replace(",", "").replace("$", "").replace("%", "")
        try:
            return float(cleaned)
        except ValueError:
            return None

    known: set[float] = set()
    for tok in accounted:
        v = norm(tok)
        if v is not None:
            known.add(round(v, 6))

    out: list[str] = []
    for tok in tokens:
        v = norm(tok)
        if v is None:
            continue  # not a number after all
        if round(v, 6) not in known:
            out.append(str(tok))
    return out
