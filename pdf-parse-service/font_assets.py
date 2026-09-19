"""font-asset-manifest-v1 — PDF Extraction V3 · Package E5 (pure, deterministic).

Safe, bounded validation of a source font PROGRAM (never executed) and assembly
of a private `font-asset-manifest-v1`. A font asset is retained privately under
the job prefix; its bytes never enter template JSON, never become a data/signed
URL, and are never committed or exposed as a downloadable user asset.

DESIGN CONTRACT
- Pure + deterministic. No network, no filesystem, no font-program execution.
  Reuses `source_scene_graph` for the FNV-1a hash + path safety only.
- Bounded, defensive sfnt/WOFF parsing: magic bytes, size caps, table-directory
  sanity, table count and offset bounds. Malformed/oversized/unsupported fonts
  are REJECTED, never trusted.
- Never fabricates a legal font licence. Technical embeddability is not a
  licence; unknown licence stays `unknown`. Project policy may still disallow
  rendering (`policy_disallowed` → visual fallback).
- Glyph coverage is EVIDENCE supplied by the (impure) extractor via fontTools;
  this module records + validates it but never guesses coverage.
"""

from __future__ import annotations

import hashlib
import struct
from typing import Any, Optional

import source_scene_graph as ssg

FONT_ASSET_MANIFEST_VERSION = "font-asset-manifest-v1"

# ── Bounded safety limits (Phase 6/38) ──────────────────────────────────────

MAX_FONT_BYTES = 8 * 1024 * 1024      # a subset/full face over 8 MB is rejected
MIN_FONT_BYTES = 64
MAX_TABLE_COUNT = 64                   # sfnt tables; a directory beyond this is suspect
MAX_GLYPH_COUNT = 65536

# sfnt / web-font magic → format.
_SFNT_MAGICS = {
    b"\x00\x01\x00\x00": ("ttf", "truetype"),
    b"true": ("ttf", "truetype"),
    b"ttcf": ("ttf", "truetype-collection"),
    b"OTTO": ("otf", "opentype-cff"),
    b"wOFF": ("woff", "woff"),
    b"wOF2": ("woff2", "woff2"),
    b"typ1": ("type1", "type1"),
}


def detect_font_format(data: bytes) -> tuple[str, str]:
    """Return (format, fontType) from the leading magic bytes, or ('unknown','unknown')."""
    if not isinstance(data, (bytes, bytearray)) or len(data) < 4:
        return "unknown", "unknown"
    magic = bytes(data[:4])
    if magic in _SFNT_MAGICS:
        return _SFNT_MAGICS[magic]
    return "unknown", "unknown"


def validate_font_bytes(data: Any) -> dict:
    """Bounded, non-executing validation. Returns {state, format, fontType,
    byteSize, numTables, problems}. state ∈ valid|invalid|unsupported|missing."""
    problems: list[str] = []
    if not isinstance(data, (bytes, bytearray)):
        return {"state": "missing", "format": "unknown", "fontType": "unknown",
                "byteSize": None, "numTables": None, "problems": ["font_bytes_absent"]}
    size = len(data)
    if size < MIN_FONT_BYTES:
        return {"state": "invalid", "format": "unknown", "fontType": "unknown",
                "byteSize": size, "numTables": None, "problems": ["font_too_small"]}
    if size > MAX_FONT_BYTES:
        return {"state": "invalid", "format": "unknown", "fontType": "unknown",
                "byteSize": size, "numTables": None, "problems": ["font_too_large"]}

    fmt, font_type = detect_font_format(data)
    if fmt == "unknown":
        return {"state": "invalid", "format": "unknown", "fontType": "unknown",
                "byteSize": size, "numTables": None, "problems": ["font_bad_magic"]}
    if fmt in ("woff", "woff2", "type1", "truetype-collection"):
        # Structurally recognised but the deterministic table-directory check below
        # only covers bare sfnt; treat these as unsupported for native embedding
        # unless the extractor converts them (recorded honestly, never trusted).
        return {"state": "unsupported", "format": fmt, "fontType": font_type,
                "byteSize": size, "numTables": None, "problems": [f"font_format_unsupported_for_native:{fmt}"]}

    # Bare sfnt (ttf/otf): parse the table directory defensively.
    try:
        num_tables = struct.unpack(">H", data[4:6])[0]
    except struct.error:
        return {"state": "invalid", "format": fmt, "fontType": font_type,
                "byteSize": size, "numTables": None, "problems": ["font_header_truncated"]}
    if num_tables == 0 or num_tables > MAX_TABLE_COUNT:
        problems.append("font_table_count_out_of_range")
    # Directory: 12-byte header + 16 bytes per table record.
    dir_end = 12 + num_tables * 16
    if dir_end > size:
        return {"state": "invalid", "format": fmt, "fontType": font_type,
                "byteSize": size, "numTables": num_tables, "problems": ["font_directory_truncated"]}
    tags: set[str] = set()
    for i in range(num_tables):
        off = 12 + i * 16
        try:
            tag = bytes(data[off:off + 4]).decode("latin-1")
            _checksum, t_off, t_len = struct.unpack(">III", data[off + 4:off + 16])
        except (struct.error, UnicodeDecodeError):
            problems.append("font_table_record_malformed")
            continue
        tags.add(tag.strip())
        if t_off + t_len > size or t_off < dir_end - 16:
            problems.append("font_table_offset_out_of_bounds")
    # Require the minimal glyph/metric tables for a usable face.
    has_glyphs = "glyf" in tags or "CFF " in tags or "CFF2" in tags
    if not has_glyphs:
        problems.append("font_missing_glyph_table")
    if "cmap" not in tags:
        problems.append("font_missing_cmap")

    state = "valid" if not problems else "invalid"
    return {"state": state, "format": fmt, "fontType": font_type,
            "byteSize": size, "numTables": num_tables, "problems": sorted(set(problems))}


# ── Deterministic asset identity (Phase 3) ──────────────────────────────────


def font_asset_id(source_object_ref: Optional[str], sha256: Optional[str],
                  normalized_family: Optional[str]) -> str:
    """Deterministic font asset ID from the source font object reference, the
    font-byte SHA-256 (when available) and the normalized source identity — never
    a UUID/timestamp/signed URL/upload order. Stable across chunk/cache replay."""
    key = "|".join([str(source_object_ref or ""), str(sha256 or ""), str(normalized_family or "")])
    return f"fontasset-{ssg.fnv1a32(key)}"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ── Font asset manifest (Phase 6/7) ─────────────────────────────────────────

_MIME_BY_FORMAT = {
    "ttf": "font/ttf", "otf": "font/otf", "woff": "font/woff", "woff2": "font/woff2",
    "type1": "application/octet-stream", "unknown": None,
}


def build_font_asset_manifest(
    *,
    source_font: dict,
    durable_path: Optional[str],
    sha256: Optional[str],
    validation: dict,
    glyph_coverage: Optional[list[int]] = None,
    subset_coverage_complete_for_run_ids: Optional[list[str]] = None,
    embedding_policy: str = "private-job-only",
    licence_state: str = "unknown",
) -> dict:
    """Assemble a `font-asset-manifest-v1`. `durable_path` must be a job-scoped
    private path (never a signed URL). Licence stays `unknown` unless policy is
    known; technical embeddability is NOT a licence."""
    fmt = validation.get("format") or "unknown"
    problems = list(validation.get("problems") or [])
    if durable_path is not None and not ssg.is_safe_artifact_path(durable_path):
        problems.append("font_path_unsafe")
        durable_path = None
    v_state = validation.get("state") or "missing"
    if embedding_policy == "rendering-disallowed":
        v_state = "policy_disallowed"
    ep = embedding_policy if embedding_policy in ("private-job-only", "rendering-disallowed", "unknown") else "unknown"
    ls = licence_state if licence_state in ("known-permitted", "known-restricted", "unknown") else "unknown"
    asset_id = source_font.get("assetId") or font_asset_id(
        source_font.get("sourceObjectRef"), sha256, source_font.get("normalizedFamily"))
    return {
        "version": FONT_ASSET_MANIFEST_VERSION,
        "assetId": asset_id,
        "sourceFont": source_font,
        "durablePath": durable_path,
        "sha256": sha256 if (isinstance(sha256, str) and len(sha256) == 64) else None,
        "mime": _MIME_BY_FORMAT.get(fmt),
        "format": fmt if fmt in ("ttf", "otf", "woff", "woff2", "type1") else "unknown",
        "byteSize": validation.get("byteSize"),
        "glyphCoverage": sorted(set(int(c) for c in (glyph_coverage or []) if isinstance(c, int)))[:MAX_GLYPH_COUNT],
        "subsetCoverageCompleteForRunIds": list(subset_coverage_complete_for_run_ids or []),
        "validationState": v_state if v_state in ("valid", "invalid", "unsupported", "missing", "policy_disallowed") else "invalid",
        "embeddingPolicy": ep,
        "licenceState": ls,
        "problems": sorted(set(problems)),
    }


def subset_covers_run(manifest: dict, required_code_points: list[int]) -> bool:
    """True only when the asset's glyph coverage includes EVERY code point a run
    needs. A subset is never treated as a complete family."""
    coverage = set(manifest.get("glyphCoverage") or [])
    if not coverage:
        return False
    return all(int(cp) in coverage for cp in required_code_points if isinstance(cp, int))
