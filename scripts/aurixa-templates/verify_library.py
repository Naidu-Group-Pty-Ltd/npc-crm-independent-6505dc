#!/usr/bin/env python3
"""Structural checks on the Command Center template library.

    python3 scripts/aurixa-templates/verify_library.py

Guards the invariants that are easy to break silently:

* the registry is internally consistent (ids, families, cross-references);
* every ``built=True`` template has a generator and vice versa;
* every generated document opens, carries its sections, and uses the layout
  guarantees the briefs promise (repeating table headers, non-splitting rows,
  no fixed-height rows that could clip injected content);
* the shipped index and detail payloads agree with the catalogue;
* every component named in a brief exists in ``components.py``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from docx import Document
from docx.oxml.ns import qn

import components as C  # noqa: E402
from builders import BUILDERS  # noqa: E402
from catalogue import CATALOGUE  # noqa: E402
from registry import validate  # noqa: E402
from theme import FAMILIES  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "templates" / "command-center"
TS = ROOT / "src" / "lib" / "command-center" / "templateLibrary.ts"
JSON_PAYLOAD = OUT / "template-library.json"

#: Components a brief may name that are not module-level functions — these are
#: rendered by other components or by the document assembler.
VIRTUAL_COMPONENTS = {"prose", "definition_grid"}

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def all_text(document: Document) -> str:
    return "\n".join(node.text or "" for node in document.element.body.iter(qn("w:t")))


def verify_registry() -> None:
    for problem in validate(CATALOGUE):
        failures.append(f"registry: {problem}")

    ids = {s.id for s in CATALOGUE}
    built = {s.id for s in CATALOGUE if s.built}
    check(built == set(BUILDERS),
          f"builders and catalogue disagree: catalogue-only {sorted(built - set(BUILDERS))}, "
          f"builder-only {sorted(set(BUILDERS) - built)}")
    check(set(BUILDERS) <= ids, "a builder targets an id that is not in the catalogue")

    # Every component named in a brief must exist.
    available = {name for name in dir(C) if not name.startswith("_")} | VIRTUAL_COMPONENTS
    for spec in CATALOGUE:
        for section in spec.sections:
            check(section.component in available,
                  f"{spec.id}: section '{section.title}' names unknown component "
                  f"'{section.component}'")
        for component in spec.components:
            check(component in available,
                  f"{spec.id}: unknown component '{component}'")

    # Every family must carry more than one template, or it is not a family.
    for key, family in FAMILIES.items():
        count = sum(1 for s in CATALOGUE if s.family == key)
        check(count >= 2, f"design family '{family.name}' has only {count} template(s)")

    print(f"  ✓ registry — {len(CATALOGUE)} templates, {len(BUILDERS)} generators, "
          f"{len(FAMILIES)} families")


def verify_exports() -> None:
    check(TS.exists(), "src/lib/command-center/templateLibrary.ts is missing — run export_registry.py")
    check(JSON_PAYLOAD.exists(), "template-library.json is missing — run export_registry.py")
    if not (TS.exists() and JSON_PAYLOAD.exists()):
        return

    payload = json.loads(JSON_PAYLOAD.read_text())
    detail_ids = set(payload["templates"])
    check(detail_ids == {s.id for s in CATALOGUE},
          "detail payload is out of step with the catalogue — run export_registry.py")

    ts_source = TS.read_text()
    for spec in CATALOGUE:
        check(f'"{spec.id}"' in ts_source,
              f"{spec.id}: missing from the generated TypeScript index")

    # The index must stay small enough to bundle. The long-form brief lives in
    # the fetched payload precisely so this stays true.
    size_kb = TS.stat().st_size / 1024
    check(size_kb < 160, f"templateLibrary.ts is {size_kb:.0f} KB — too large to bundle; "
                         f"move more fields into the detail payload")
    print(f"  ✓ exports — index {size_kb:.0f} KB, detail "
          f"{JSON_PAYLOAD.stat().st_size / 1024:.0f} KB, {len(detail_ids)} records")


def verify_documents() -> None:
    from builders import BUILDERS as _  # noqa: F401  (import guard)

    for spec in [s for s in CATALOGUE if s.built]:
        _, stem = BUILDERS[spec.id]
        path = OUT / f"{stem}.docx"
        check(path.exists(), f"{spec.id}: {path.name} not built")
        if not path.exists():
            continue

        document = Document(path)
        text = all_text(document)

        # Every section the brief says renders a visible heading must be in the
        # built document under exactly that title. This is the check that keeps
        # the published brief and the shipped artefact from drifting apart.
        skip = {"Cover", "Header", "Contents", "Back cover", "Important information"}
        for section in spec.required_sections:
            if section.title in skip or not section.headed:
                continue
            # Appendix sections are titled "Appendix — evidence" in the brief so
            # the inventory reads well, but render as an "APPENDIX A" eyebrow
            # above a plain "Evidence" heading. Compare against the part that is
            # actually set as the heading.
            needle = section.title
            if needle.startswith("Appendix") and "—" in needle:
                needle = needle.split("—", 1)[1].strip()
            check(needle.lower() in text.lower(),
                  f"{spec.id}: section '{section.title}' from the brief is not in the document")

        check(document.sections[0].different_first_page_header_footer,
              f"{spec.id}: cover page must suppress the running header")

        # Layout guarantees. These are what make injected content safe.
        tables = document.element.body.findall(f".//{qn('w:tbl')}")
        # One table per section is the floor: every component in the library is
        # table-based, so a document with fewer tables than sections has lost a
        # block somewhere.
        check(len(tables) >= len(spec.required_sections),
              f"{spec.id}: {len(tables)} tables for {len(spec.required_sections)} required "
              f"sections — a layout block is missing")

        exact_rows = 0
        split_rows = 0
        total_rows = 0
        for table in tables:
            for row in table.findall(qn("w:tr")):
                total_rows += 1
                tr_pr = row.find(qn("w:trPr"))
                if tr_pr is None:
                    split_rows += 1
                    continue
                if tr_pr.find(qn("w:cantSplit")) is None:
                    split_rows += 1
                height = tr_pr.find(qn("w:trHeight"))
                if height is not None and height.get(qn("w:hRule")) == "exact":
                    exact_rows += 1
        check(exact_rows == 0,
              f"{spec.id}: {exact_rows} row(s) use an exact height and would clip injected "
              f"content")
        check(split_rows == 0,
              f"{spec.id}: {split_rows} of {total_rows} rows may split across a page break")

        # Data tables — those carrying a w:tblCaption — must repeat their header
        # row. Layout grids (field grids, metric panels, cards) have no header
        # and are correctly excluded.
        data_tables = 0
        missing_headers = []
        for table in tables:
            tbl_pr = table.find(qn("w:tblPr"))
            if tbl_pr is None:
                continue
            caption = tbl_pr.find(qn("w:tblCaption"))
            if caption is None:
                continue
            data_tables += 1
            first_pr = table.findall(qn("w:tr"))[0].find(qn("w:trPr"))
            if first_pr is None or first_pr.find(qn("w:tblHeader")) is None:
                missing_headers.append(caption.get(qn("w:val")) or "untitled")
        check(not missing_headers,
              f"{spec.id}: data table(s) without a repeating header row: "
              f"{', '.join(missing_headers)}")

        print(f"  ✓ {path.name} — {len(tables)} tables ({data_tables} data), "
              f"{total_rows} rows")


def main() -> int:
    print("Verifying the Command Center template library…")
    verify_registry()
    verify_exports()
    verify_documents()
    if failures:
        print(f"\n{len(failures)} problem(s):")
        for failure in failures:
            print(f"  ✗ {failure}")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
