#!/usr/bin/env python3
"""Build the Command Center template library.

    python3 scripts/aurixa-templates/build_library.py                 # all masters
    python3 scripts/aurixa-templates/build_library.py --sample        # + sample previews
    python3 scripts/aurixa-templates/build_library.py --only borrowing-capacity-report
    python3 scripts/aurixa-templates/build_library.py --brand partner.json --level 3

Two artefacts per implemented template:

* the **master** — binding tokens throughout, the file the platform injects into;
* the **sample** — the same builder with representative content, used for design
  review, admin content-injection testing and library thumbnails.

Building both from one builder is the point. A layout that passes review with
sample content and breaks with tokens (or the reverse) is a layout that would
have shipped broken.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import fields as dataclass_fields
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import components as C  # noqa: E402
from builders import BUILDERS  # noqa: E402
from catalogue import CATALOGUE  # noqa: E402
from content import SAMPLE, TOKENS  # noqa: E402
from registry import by_id  # noqa: E402
from theme import (  # noqa: E402
    AURIXA_BRAND, SAMPLE_BRAND_FIELDS, BrandConfig, build_theme,
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / "public" / "templates" / "command-center"


def load_brand(path: Path | None, level: int | None) -> BrandConfig:
    brand = AURIXA_BRAND if path is None else BrandConfig()
    if path is not None:
        payload = {k: v for k, v in json.loads(path.read_text()).items()
                   if not k.startswith("_")}
        known = {f.name for f in dataclass_fields(BrandConfig)}
        unknown = set(payload) - known
        if unknown:
            raise SystemExit(
                f"Unknown brand field(s): {', '.join(sorted(unknown))}. "
                f"Valid: {', '.join(sorted(known))}")
        brand = brand.branded(**payload)
    if level is not None:
        brand = brand.branded(level=level)
    return brand


def build_one(template_id: str, brand: BrandConfig, out_dir: Path,
              sample: bool = False) -> Path:
    spec = by_id(CATALOGUE, template_id)
    build_fn, stem = BUILDERS[template_id]

    effective = brand.branded(**SAMPLE_BRAND_FIELDS) if sample else brand
    # A template may not be de-branded further than its brief allows.
    if effective.level > spec.max_white_label_level:
        effective = effective.branded(level=spec.max_white_label_level)

    theme = build_theme(spec.family, effective)
    doc = C.base_document(theme, spec.name)
    build_fn(doc, theme, SAMPLE if sample else TOKENS)
    # Pagination is corrected once over the finished body rather than in every
    # builder: see `components.normalise_layout`.
    C.normalise_layout(doc)
    C.set_properties(
        doc, theme, title=spec.name, subject=spec.summary,
        keywords=", ".join((*spec.report_types, spec.category_label, "Aurixa")),
        category="Aurixa Command Center template")

    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{stem}{'_SAMPLE' if sample else ''}.docx"
    doc.save(target)
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--brand", type=Path, default=None,
                        help="JSON file of BrandConfig overrides")
    parser.add_argument("--level", type=int, choices=(1, 2, 3, 4), default=None,
                        help="white-label level to build at")
    parser.add_argument("--only", action="append", default=None,
                        help="build a single template id (repeatable)")
    parser.add_argument("--sample", action="store_true",
                        help="also build the sample-content preview of each template")
    args = parser.parse_args()

    brand = load_brand(args.brand, args.level)
    ids = args.only or list(BUILDERS)

    unknown = [i for i in ids if i not in BUILDERS]
    if unknown:
        print(f"No generator for: {', '.join(unknown)}")
        print(f"Available: {', '.join(sorted(BUILDERS))}")
        return 1

    written = 0
    for template_id in ids:
        for sample in ((False, True) if args.sample else (False,)):
            path = build_one(template_id, brand, args.out, sample=sample)
            size = path.stat().st_size / 1024
            print(f"  {path.relative_to(ROOT)}  ({size:.0f} KB)")
            written += 1

    not_built = [s.id for s in CATALOGUE if not s.built]
    print(f"\n{written} file(s). {len(BUILDERS)} of {len(CATALOGUE)} templates have "
          f"generators; {len(not_built)} remain specified but not built.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
