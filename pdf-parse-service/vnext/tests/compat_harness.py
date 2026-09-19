"""Baseline-vs-vNext compatibility harness (E2).

Generates the artificial fixtures and — WHEN docling is installed (the vnext
image) — converts each with the vNext runtime and records a deterministic,
counts-only comparison. In a planning/CI environment without docling, it still
generates + validates the fixtures and marks conversion `not_executed` (it never
claims a conversion passed that did not run).

Run inside the vnext image:
    python vnext/tests/compat_harness.py /tmp/e2-fixtures
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))  # sidecar root

from vnext.tests.generate_fixtures import FIXTURES, write_fixture  # noqa: E402


def _docling_available() -> bool:
    try:
        import docling.datamodel.pipeline_options  # noqa: F401
        return True
    except Exception:
        return False


def run(out_dir: str) -> dict:
    report: dict = {
        "version": "docling-vnext-compat-report-v1",
        "docling_available": _docling_available(),
        "fixtures": [],
    }
    # Import here so the harness runs without docling for fixture generation.
    from docling_runtime_legacy import select_docling_runtime
    from docling_vnext_profiles import resolve_vnext_converter_profile, VNextBuildOptions
    from docling_vnext_adapter import summarize_document

    runtime = None
    if report["docling_available"]:
        runtime = select_docling_runtime({"DOCLING_RUNTIME_PROFILE": "vnext"}, options=VNextBuildOptions())

    for fx in FIXTURES:
        path = write_fixture(fx, out_dir)
        entry = {"name": fx.name, "path": os.path.basename(path), "expected_pages": fx.pages,
                 "bytes": os.path.getsize(path)}
        if runtime is None:
            entry["conversion"] = "not_executed_no_docling"
        else:  # pragma: no cover - requires docling image
            profile = resolve_vnext_converter_profile(
                {"lane": "fast_native"}, runtime.capabilities(), VNextBuildOptions())
            result = runtime.convert(path, profile)
            entry["conversion"] = result.status
            entry["engine_identity"] = result.engine_identity
            entry["summary"] = summarize_document(result.document or {})
            entry["problems"] = list(result.problems)
        report["fixtures"].append(entry)
    return report


if __name__ == "__main__":
    out = run(sys.argv[1] if len(sys.argv) > 1 else "/tmp/e2-fixtures")
    print(json.dumps(out, indent=2)[:4000])
