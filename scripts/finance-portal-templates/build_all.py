#!/usr/bin/env python3
"""Regenerate the generated Finance Portal templates.

    python3 scripts/finance-portal-templates/build_all.py
    python3 scripts/finance-portal-templates/build_all.py --out /some/dir

**The two referral agreements are no longer built here.** They used to be, and
that was one of three separate typesettings of the same two legal instruments
living in this repository at once. The documents their author maintains are now
shipped unchanged — ``public/templates/finance-portal/*_Agreement.docx``,
declared in ``_shared/agreements/templateFiles.pure.ts`` and checked clause by
clause by ``agreementTemplateFiles.spec.ts``.

Do not add an agreement builder back here. Writing one into this directory
would leave two documents claiming to be the same agreement, and the generated
one would be the stale copy — which is precisely the failure this removed.
``verify_templates.py`` fails if that happens.

Pass ``--brand`` with a JSON file to stamp a partner's details into the
generated pack instead of leaving merge tokens in place. Any subset of
``BrandProfile`` fields is accepted, for example::

    {
      "company_name": "Northbridge Finance Group",
      "primary": "10243F",
      "accent": "C9A227",
      "phone": "(02) 8000 1234",
      "platform_note": ""
    }
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import fields as dataclass_fields
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from aurixa_brand import DEFAULT_BRAND, BrandProfile

import build_client_fact_find

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "public" / "templates" / "finance-portal"

TARGETS = [
    (build_client_fact_find,
     "Aurixa_White_Label_Client_Fact_Find.xlsx"),
]


def load_brand(path: Path | None) -> BrandProfile:
    if path is None:
        return DEFAULT_BRAND
    payload = json.loads(path.read_text())
    # Keys prefixed with "_" are treated as comments, so brand files can be
    # self-documenting without tripping the unknown-field guard.
    payload = {k: v for k, v in payload.items() if not k.startswith("_")}
    known = {f.name for f in dataclass_fields(BrandProfile)}
    unknown = set(payload) - known
    if unknown:
        raise SystemExit(
            f"Unknown brand field(s): {', '.join(sorted(unknown))}. "
            f"Valid fields: {', '.join(sorted(known))}"
        )
    return DEFAULT_BRAND.branded(**payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT,
                        help="output directory (default: public/templates/finance-portal)")
    parser.add_argument("--brand", type=Path, default=None,
                        help="JSON file of BrandProfile overrides")
    args = parser.parse_args()

    brand = load_brand(args.brand)
    args.out.mkdir(parents=True, exist_ok=True)

    for module, filename in TARGETS:
        written = module.build(brand, args.out / filename)
        size_kb = written.stat().st_size / 1024
        print(f"  {written.relative_to(Path.cwd()) if written.is_relative_to(Path.cwd()) else written}"
              f"  ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
