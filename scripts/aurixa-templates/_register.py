#!/usr/bin/env python3
"""Dev helper: wire a newly written builder into the registry.

    python3 scripts/aurixa-templates/_register.py <template-id> <module> <function> <FileStem>

Adds the import and BUILDERS entry in builders/__init__.py and flips
``built=True`` on the catalogue entry. Idempotent.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> int:
    template_id, module, function, stem = sys.argv[1:5]

    init = HERE / "builders" / "__init__.py"
    s = init.read_text()
    if function not in s:
        pattern = re.compile(rf"(from {module} import \()(.*?)(\n\))", re.S)
        match = pattern.search(s)
        if not match:
            print(f"could not find the import block for {module}")
            return 1
        names = sorted({n.strip().rstrip(",") for n in match.group(2).split(",")
                        if n.strip()} | {function})
        body = "\n    " + ", ".join(names)
        # re-wrap at 76 columns
        wrapped, line = [], "   "
        for name in names:
            piece = f" {name},"
            if len(line) + len(piece) > 76:
                wrapped.append(line)
                line = "   "
            line += piece
        wrapped.append(line)
        body = "\n" + "\n".join(wrapped).rstrip(",")
        s = s[:match.start(2)] + body + s[match.end(2):]
    if f'"{template_id}":' not in s:
        s = s.replace("}\n\n__all__",
                      f'    "{template_id}":\n        ({function}, "{stem}"),\n'
                      "}\n\n__all__")
    init.write_text(s)

    catalogue = HERE / "catalogue.py"
    s = catalogue.read_text()
    marker = f'id="{template_id}", name='
    idx = s.index(marker)
    seg_end = s.index("summary=", idx)
    seg = s[idx:seg_end]
    if "built=" not in seg:
        head, last = seg.rstrip().rsplit("\n", 1)
        s = s[:idx] + head + "\n" + last.rstrip() + " built=True,\n        " + s[seg_end:]
        catalogue.write_text(s)
    print(f"registered {template_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
