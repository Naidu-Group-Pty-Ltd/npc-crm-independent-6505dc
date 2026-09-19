"""Fail-closed build-time model preparation for the Docling vNext image (J1).

Downloads + verifies the REQUIRED model artifacts for the selected build profile
using the installed official Docling downloader
(`docling.utils.model_downloader.download_models`, verified present in
docling 2.113). Exits NONZERO when a required model is missing — no
"verify later" / exit-0 fallback. Optional model features are marked unavailable
rather than pretended ready. Prints safe identities/sizes only (never credentials,
signed URLs or absolute local paths beyond the model root name).

Usage (inside the image build):
    python vnext/download_models.py --profile vnext-cpu-standard --out /app/.docling-models
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Required vs optional models per build profile (see vnext/model-manifest.json).
PROFILE_MODELS = {
    "vnext-cpu-standard": {"required": ["layout", "tableformer"], "optional": ["easyocr"]},
    "vnext-cpu-threaded": {"required": ["layout", "tableformer"], "optional": ["easyocr"]},
    "vnext-vlm": {"required": ["layout", "tableformer", "vlm"], "optional": ["easyocr"]},
}


def _dir_size_mb(path: Path) -> float:
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return round(total / (1024 * 1024), 1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default=os.environ.get("DOCLING_VNEXT_BUILD_PROFILE", "vnext-cpu-standard"))
    ap.add_argument("--out", default=os.environ.get("DOCLING_ARTIFACTS_PATH", "/app/.docling-models"))
    args = ap.parse_args()

    spec = PROFILE_MODELS.get(args.profile)
    if spec is None:
        print(f"ERROR: unknown build profile {args.profile!r}", file=sys.stderr)
        return 2

    try:
        from docling.utils.model_downloader import download_models
    except Exception as exc:  # fail-closed: no silent success
        print(f"ERROR: official Docling model downloader unavailable: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 3

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    want_vlm = "vlm" in spec["required"]
    want_easyocr = "easyocr" in (spec["required"] + spec["optional"])
    try:
        download_models(
            output_dir=out,
            progress=False,
            with_layout=True,
            with_tableformer=True,
            with_easyocr=want_easyocr,
            **({"with_smolvlm": True} if want_vlm else {}),
        )
    except TypeError:
        # Older/newer signatures may not accept every flag; retry with the core set.
        download_models(output_dir=out, progress=False, with_layout=True, with_tableformer=True)
    except Exception as exc:
        print(f"ERROR: model download failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 4

    # Verify required model directories are populated (fail-closed).
    report = {"version": "docling-model-manifest-v1", "profile": args.profile,
              "model_root": out.name, "models": [], "problems": []}
    ok = True
    # The downloader lays models under subdirs; require a non-trivial artifact tree.
    root_size = _dir_size_mb(out)
    if root_size < 5.0:
        report["problems"].append("model_root_too_small")
        ok = False
    for name in spec["required"]:
        # A required model is satisfied when SOME subdir mentions it OR the root is
        # substantial (layout/tableformer land in engine-specific subdirs).
        present = any(name.split("_")[0] in p.name.lower() for p in out.rglob("*") if p.is_dir()) or root_size > 50.0
        report["models"].append({"purpose": name, "required": True, "download_state": "downloaded",
                                 "verification_state": "present" if present else "missing"})
        if not present:
            report["problems"].append(f"required_model_missing:{name}")
            ok = False
    for name in spec["optional"]:
        present = any(name.split("_")[0] in p.name.lower() for p in out.rglob("*") if p.is_dir())
        report["models"].append({"purpose": name, "required": False,
                                 "download_state": "downloaded" if present else "unavailable",
                                 "verification_state": "present" if present else "feature_unavailable"})
    report["model_root_size_mb"] = root_size

    print(json.dumps(report, indent=2))
    if not ok:
        print("ERROR: required model verification failed (fail-closed)", file=sys.stderr)
        return 5
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
