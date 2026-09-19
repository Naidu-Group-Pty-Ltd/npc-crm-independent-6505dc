"""docling-vnext-adapter-v1 — conversion + document adapter (E2).

Pure + import-safe: operates on the JSON dict produced by the vNext
`DoclingDocument.model_dump(mode='json')`, so it is fully unit-testable without
docling installed. It contains the ONE place that adapts vNext (2.87+) API
differences back to the shape existing consumers (`mapDoclingToRawBlocks`, E0/E1
adapters) already expect — no version conditionals leak into app.py or TypeScript.

Adapted breaking changes vs Docling 2.14:
* Picture classification moved from `PictureItem.classification` into
  `PictureItem.annotations` (`PictureClassificationData.predicted_classes`).
  We back-fill a legacy-shaped `classification` field so existing code keeps
  working, AND surface it in a namespaced `vnext` section.
* Chart extraction output is first-class typed picture annotations
  (`PictureBarChartData` / `PictureLineChartData` / …). We normalize it as
  provider evidence — never as authoritative financial truth.

Source fidelity outranks editability: this adapter records provider evidence and
never removes a source crop, never invents chart data, never rearranges cells.
"""

from __future__ import annotations

from typing import Any, Optional

DOCLING_VNEXT_ADAPTER_VERSION = "docling-vnext-adapter-v1"

# Conversion-status taxonomy (mapped into the existing sidecar taxonomy).
STATUS_SUCCESS = "success"
STATUS_PARTIAL = "partial_success"
STATUS_FAILURE = "failure"
STATUS_TIMEOUT = "timeout"

_CHART_ANNOTATION_KINDS = {
    "bar_chart": "bar", "line_chart": "line", "pie_chart": "pie",
    "scatter_chart": "scatter", "stacked_bar_chart": "bar", "tabular_chart": "unknown",
    "chart": "unknown",
}


def normalize_conversion_status(raw_status: Any, *, pages_total: int, pages_failed: int,
                                timed_out: bool = False) -> str:
    """Map a docling ConversionStatus (str/enum-name) into the sidecar taxonomy.
    A partial conversion is NEVER silently promoted to success."""
    if timed_out:
        return STATUS_TIMEOUT
    s = str(raw_status or "").lower()
    if "timeout" in s:
        return STATUS_TIMEOUT
    if "partial" in s:
        return STATUS_PARTIAL
    if pages_failed > 0 and pages_total > 0 and pages_failed < pages_total:
        return STATUS_PARTIAL
    if pages_total > 0 and pages_failed >= pages_total:
        return STATUS_FAILURE
    if "success" in s or s in ("", "converted", "ok"):
        return STATUS_SUCCESS
    if "fail" in s or "error" in s:
        return STATUS_FAILURE
    return STATUS_PARTIAL


def normalize_picture_classification(picture: dict) -> Optional[dict]:
    """Return legacy-shaped {predicted_class, predicted_classes, confidence} from a
    vNext picture, reading `annotations` first (2.87) then the legacy field (2.14).
    None when no classification evidence exists."""
    # Legacy 2.14 shape.
    legacy = picture.get("classification")
    if isinstance(legacy, dict) and (legacy.get("predicted_class") or legacy.get("predicted_classes")):
        return _shape_classification(legacy.get("predicted_class"), legacy.get("predicted_classes"))

    for ann in picture.get("annotations") or []:
        if not isinstance(ann, dict):
            continue
        if ann.get("kind") == "classification" or "predicted_classes" in ann:
            classes = ann.get("predicted_classes") or []
            best = None
            best_conf = -1.0
            norm_classes = []
            for c in classes:
                if not isinstance(c, dict):
                    continue
                name = c.get("class_name") or c.get("label")
                conf = float(c.get("confidence") or 0.0)
                norm_classes.append({"class_name": name, "confidence": conf})
                if conf > best_conf:
                    best, best_conf = name, conf
            if best is not None:
                return {"predicted_class": best, "predicted_classes": norm_classes,
                        "confidence": best_conf if best_conf >= 0 else None}
    return None


def _shape_classification(predicted_class, predicted_classes) -> dict:
    norm = []
    for c in predicted_classes or []:
        if isinstance(c, dict):
            norm.append({"class_name": c.get("class_name") or c.get("label"),
                         "confidence": float(c.get("confidence") or 0.0)})
    return {"predicted_class": predicted_class, "predicted_classes": norm, "confidence": None}


def normalize_picture_chart(picture: dict) -> Optional[dict]:
    """Provider chart evidence from typed picture annotations (2.87). Records the
    chart type + whether structured data is present — NEVER treated as
    authoritative values. None when there is no chart annotation."""
    for ann in picture.get("annotations") or []:
        if not isinstance(ann, dict):
            continue
        kind = str(ann.get("kind") or "")
        if "chart" in kind or ann.get("kind") in _CHART_ANNOTATION_KINDS:
            chart_type = _CHART_ANNOTATION_KINDS.get(kind, "unknown")
            has_data = any(k in ann for k in ("data", "bars", "lines", "slices", "points", "cells"))
            return {
                "chart_type": chart_type,
                "title": ann.get("title"),
                "has_structured_data": bool(has_data),
                "kind": kind,
                # The raw provider data lives in a private artifact, not inlined here.
                "structured_data_present": bool(has_data),
            }
    return None


def normalize_document(doc: dict) -> dict:
    """Return an ADDITIVE normalized document: every existing field is preserved
    (so `mapDoclingToRawBlocks` and the E0/E1 adapters keep working) and a
    namespaced `vnext` section carries the normalized classification/chart
    provider evidence. Never mutates the input."""
    if not isinstance(doc, dict):
        return {"vnext": {"adapter_version": DOCLING_VNEXT_ADAPTER_VERSION, "problems": ["doc_not_object"]}}

    out = dict(doc)
    pictures = list(doc.get("pictures") or [])
    normalized_pictures = []
    vnext_pictures = []
    for idx, pic in enumerate(pictures):
        if not isinstance(pic, dict):
            normalized_pictures.append(pic)
            continue
        classification = normalize_picture_classification(pic)
        chart = normalize_picture_chart(pic)
        p = dict(pic)
        # Back-fill the legacy `classification` field so existing consumers work
        # even though vNext puts it in annotations.
        if classification is not None and not p.get("classification"):
            p["classification"] = classification
        normalized_pictures.append(p)
        vnext_pictures.append({
            "index": idx,
            "self_ref": pic.get("self_ref"),
            "classification": classification,
            "chart": chart,
            "has_image": bool((pic.get("image") or {}).get("uri") if isinstance(pic.get("image"), dict) else False),
        })
    out["pictures"] = normalized_pictures
    out["vnext"] = {
        "adapter_version": DOCLING_VNEXT_ADAPTER_VERSION,
        "pictures": vnext_pictures,
        "picture_classification_source": "annotations" if any(vp["classification"] for vp in vnext_pictures) else "none",
        "chart_evidence_count": sum(1 for vp in vnext_pictures if vp["chart"]),
        "problems": [],
    }
    return out


def summarize_document(doc: dict) -> dict:
    """Small, deterministic comparison summary (used by the baseline-vs-vNext
    fixture harness). Counts only — never raw source text/values."""
    pictures = doc.get("pictures") or []
    return {
        "page_count": len(doc.get("pages") or {}),
        "text_count": len(doc.get("texts") or []),
        "table_count": len(doc.get("tables") or []),
        "picture_count": len(pictures),
        "classified_picture_count": sum(1 for p in pictures if isinstance(p, dict) and normalize_picture_classification(p)),
        "chart_evidence_count": sum(1 for p in pictures if isinstance(p, dict) and normalize_picture_chart(p)),
    }
