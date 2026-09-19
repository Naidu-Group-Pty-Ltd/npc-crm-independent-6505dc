#!/usr/bin/env python3
"""Prove the engine, its native libraries and the brand faces work together.

Run at build time — the last layer of the runtime stage — and runnable at any
time afterwards against a deployed image:

    docker run --rm --entrypoint python weasyprint-service selfcheck.py

## Why a render and not an import

An import proves the wheels installed. It does not prove Pango is present, that
fontconfig can see `/usr/local/share/fonts/npc`, or that the faces the
stylesheet names resolve to anything — and each of those fails *silently*:
WeasyPrint substitutes a missing family without so much as a log line, so the
PDF renders, every test downstream passes, and the defect is visible only to
whoever opens the document.

This also caught its own first version. The check began life in the **builder**
stage, which installs a compiler and no Pango: WeasyPrint loads its native
libraries at import time, so `import weasyprint` failed there and the image
could not be built at all. The check belongs where the libraries are.

## What it asserts

1. The engine is the pinned version, and imports.
2. A render produces PDF bytes.
3. `pdf_tags` writes a structure tree — the option that produces `/StructTreeRoot`
   does not exist before WeasyPrint 63, and the service spent its life passing
   something the engine ignored, so every report it made was untagged.
4. Every brand family the stylesheet names is embedded in the output, read off
   the `/BaseFont` entries. Rendered uncompressed for this: a compressed PDF
   hides its font descriptors inside object streams, where a byte search finds
   nothing.

   The names are normalised before comparing, because the engine writes
   `LNXIQZ+IBM-Plex-Mono` — a subset tag, and the family with its spaces turned
   into hyphens. CI grepped the raw output for `IBMPlex`, which stopped matching
   and failed a job that was reporting a font problem that did not exist. And
   the first version of this file searched the whole file for `IBMPlexMono`,
   which *passed* — by matching the spaced name inside the embedded font program
   rather than the descriptor. Right answer, wrong reason, and no assertion at
   all about what the page was actually set in.
5. The engine still drops what `engineSupport.pure.ts` says it drops. A capability
   that quietly changes is a stylesheet that quietly stops being true.
6. **Every shipped file is reachable at the weight it claims.** Read below.

## The weight check, and why it reads the files

Shipping a font file is not the same as being able to use it. `font-family:
Cinzel; font-weight: 600` resolves through fontconfig, and a face whose family
name is `Cinzel SemiBold` only answers to `Cinzel` at 600 because it carries a
typographic-family record — which is a property of the binary, not of anything
this repo controls. When that resolution fails, fontconfig does not error: it
returns the nearest weight, the page is set in it, and the PDF is valid.

So this walks the font directory, reads each file's own family/weight/italic out
of its `name` and `OS/2` tables, asks the engine for exactly that, and checks
that the face which came back is the file it asked for. No manifest, nothing to
keep in step — the fonts are the source of truth about themselves.

This is the half `reportTypography.spec.ts` cannot do. That spec reads the
stylesheet and the Dockerfile and proves the *declarations* agree; only a render
proves the *resolution* does.
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import os
import re
import sys
from pathlib import Path

from weasyprint import HTML

# Where the Dockerfile COPYs the brand faces.
FONT_DIR = Path(os.environ.get("NPC_FONT_DIR", "/usr/local/share/fonts/npc"))

# `/BaseFont /LNXIQZ+IBM-Plex-Mono` — a six-letter subset tag, then the name.
BASE_FONT = re.compile(rb"/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9\-_.]+)")


def norm(name: str | bytes) -> str:
    """A font name with nothing in it but letters and digits, lowercased.

    `IBM Plex Mono`, `IBM-Plex-Mono` and `IBMPlexMono` are the same face written
    three ways — by the stylesheet, by the PDF descriptor and by the file on
    disk. Comparing any two of them literally is a check that fails on a naming
    change and says "the font is missing", which is exactly what CI did.
    """
    text = name.decode("latin-1") if isinstance(name, bytes) else name
    return re.sub(r"[^a-z0-9]", "", text.lower())

# Mirrors `BRAND_FAMILIES` in app.py and the `PRINT_STACK` roles it comes from.
BRAND_FAMILIES = ("Cinzel", "Playfair Display", "Inter", "IBM Plex Mono")

# One construct per class, so a warning names the declaration it came from.
# Mirrors the ids in `reportDesign/engineSupport.pure.ts`.
MUST_DROP = {
    "box-shadow": "box-shadow: 0 1pt 2pt currentColor",
    "position-sticky": "position: sticky",
}
MUST_RENDER = {
    "grid": "display: grid",
    "linear-gradient": "background: linear-gradient(currentColor, transparent)",
}


class ShippedFace:
    """One font file, described by itself."""

    def __init__(self, path: Path):
        from fontTools.ttLib import TTFont

        font = TTFont(str(path), lazy=True)
        names = {
            record.nameID: str(record)
            for record in font["name"].names
            if record.platformID == 3 and record.platEncID == 1
        }
        self.path = path
        # nameID 16 is the *typographic* family — the one a stylesheet names.
        # `Cinzel SemiBold` is nameID 1; nameID 16 says the family is `Cinzel`
        # and the weight tells the rest. Without it, no CSS request reaches this
        # file, so this is the name to ask for.
        self.family = names.get(16) or names.get(1) or path.stem
        self.postscript = names.get(6) or path.stem
        self.weight = font["OS/2"].usWeightClass
        self.italic = bool(font["OS/2"].fsSelection & 1)
        font.close()

    def request(self) -> str:
        style = "font-style: italic; " if self.italic else ""
        return f"font-family: '{self.family}'; font-weight: {self.weight}; {style}"

    def expected_names(self) -> set[str]:
        """What the PDF may legitimately call this face.

        The engine writes the PostScript name minus the implied `Regular`
        style — `Cinzel-Regular` embeds as `Cinzel`, `IBMPlexMono-Regular` as
        `IBM-Plex-Mono` — while every other style keeps its suffix. Both
        spellings are accepted and nothing else is, so asking for 400 and
        getting the SemiBold still fails: `cinzel` and `cinzelsemibold` are
        compared whole, never as substrings.
        """
        return {norm(self.postscript), norm(re.sub(r"-?Regular$", "", self.postscript))}

    def __str__(self) -> str:
        return f"{self.family} {self.weight}{' italic' if self.italic else ''}"


def shipped_faces() -> list[ShippedFace]:
    if not FONT_DIR.is_dir():
        return []
    return [ShippedFace(p) for p in sorted(FONT_DIR.glob("*.ttf"))]


def _specimen(faces: list[ShippedFace]) -> str:
    rules = "\n".join(
        f".d{i} {{ {decl}; }}" for i, decl in enumerate([*MUST_DROP.values(), *MUST_RENDER.values()])
    )
    body = "".join(
        f'<p style="font-family:\'{family}\'">{family} 0123</p>' for family in BRAND_FAMILIES
    )
    # One paragraph per shipped file, each asking for exactly what that file is.
    # Distinct text per face so the engine cannot merge two runs into one.
    body += "".join(
        f'<p style="{face.request()}">Weight probe {index} Aa Bb 0123</p>'
        for index, face in enumerate(faces)
    )
    return (
        f'<html lang="en"><head><title>self check</title><style>{rules}</style></head>'
        f"<body><h1>Self check</h1>{body}</body></html>"
    )


VERAPDF = os.environ.get("VERAPDF", "/opt/verapdf/verapdf")


def _validates_as_pdf_ua(pdf: bytes) -> list[str]:
    """The specimen, through the conformance validator that ships beside it.

    The reports claim PDF/UA-1. A claim that fails validation is worse than no
    claim — it tells a procurement officer, a screen-reader user and an
    accessibility auditor that the document is navigable, and none of them
    finds out otherwise until they try.

    The first run of this on a real report said FAIL: seven of the ten formats
    broke clause 7.4.2, a skipped heading level, because each had grown its own
    `h3` helper for a subhead while the design system's own `h2` went unused.
    That is the class of thing only a validator finds, and it had been shipping.

    A missing validator is a failure rather than a pass. The image installs one;
    if it is not there, the image is not the one this file was written for.
    """
    if not os.path.exists(VERAPDF):
        return [f"no validator at {VERAPDF} — the PDF/UA claim is unchecked"]

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
        handle.write(pdf)
        path = handle.name
    try:
        result = subprocess.run(
            [VERAPDF, "-f", "ua1", "--format", "text", path],
            capture_output=True,
            text=True,
            timeout=180,
        )
    except (OSError, subprocess.SubprocessError) as err:
        return [f"the validator could not be run: {err}"]
    finally:
        os.unlink(path)

    verdict = (result.stdout or "").strip().split()
    if verdict and verdict[0] == "PASS":
        print("the specimen validates as PDF/UA-1")
        return []
    return [
        "the specimen does not validate as PDF/UA-1, and the render routes "
        f"claim it: {(result.stdout or result.stderr or '').strip()[:400]}",
    ]


def main() -> int:
    import weasyprint

    print(f"weasyprint {weasyprint.__version__}")

    said: list[str] = []

    class Collect(logging.Handler):
        def emit(self, record):
            said.append(record.getMessage())

    engine_log = logging.getLogger("weasyprint")
    engine_log.addHandler(Collect())
    engine_log.setLevel(logging.WARNING)

    faces = shipped_faces()
    print(f"{len(faces)} shipped face(s) in {FONT_DIR}")
    # Rendered the way a report is rendered — the variant and the output intent
    # the render routes ask for — so the check below is a check of what ships
    # rather than of a plainer document that happens to be in the image.
    pdf = HTML(string=_specimen(faces)).write_pdf(
        pdf_tags=True,
        uncompressed_pdf=True,
        pdf_variant="pdf/ua-1",
        output_intent="srgb",
    )
    failures: list[str] = []
    failures.extend(_validates_as_pdf_ua(pdf))

    if not pdf.startswith(b"%PDF-"):
        failures.append("the render did not produce PDF bytes")
    if b"/StructTreeRoot" not in pdf:
        failures.append("pdf_tags produced no structure tree — this engine cannot tag output")

    # The descriptors, not the whole file: the embedded font *program* carries
    # the family's own name table, so a whole-file search says "embedded" for a
    # face that was never used to set anything.
    embedded = [norm(name) for name in BASE_FONT.findall(pdf)]
    for family in BRAND_FAMILIES:
        # A substituted face leaves a perfectly valid PDF with somebody else's
        # name in it, and the engine does not log that it happened.
        if not any(norm(family) in name for name in embedded):
            failures.append(
                f"{family} is not embedded — the engine substituted it silently. "
                f"Embedded: {', '.join(sorted(set(embedded))) or 'nothing'}",
            )

    # Every file we ship must be reachable by the request that names it. A
    # weight fontconfig cannot answer exactly is answered by its neighbour, in
    # silence — so the file is present, the page is set in the wrong cut, and
    # nothing anywhere says so.
    for face in faces:
        if not (face.expected_names() & set(embedded)):
            failures.append(
                f"{face.path.name} ships but '{face}' resolves to something else — "
                f"expected {face.postscript}, got {', '.join(sorted(set(embedded)))}",
            )

    ignored = "\n".join(said)
    for name, decl in MUST_DROP.items():
        if decl not in ignored:
            failures.append(f"{name} is no longer dropped — move it out of UNSUPPORTED")
    for name, decl in MUST_RENDER.items():
        if decl in ignored:
            failures.append(f"{name} is load-bearing and this engine drops it")

    if failures:
        print("\nFAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        if said:
            print("\nthe engine also said:", file=sys.stderr)
            for message in said:
                print(f"  {message}", file=sys.stderr)
        return 1

    print(
        f"ok — {len(pdf)} bytes, tagged, {len(BRAND_FAMILIES)} brand families and "
        f"{len(faces)} shipped weights each resolved to their own file"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
