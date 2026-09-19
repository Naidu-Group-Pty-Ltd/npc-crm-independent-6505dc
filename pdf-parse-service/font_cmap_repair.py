"""Make a PDF subset's glyphs reachable by Unicode, so the web font can use them.

THE DEFECT
----------
Page 7 of the BC Snapshot render sets its footer page number as `07 / 07` with
the **7s in a different typeface from the 0s**. Two spans in a seven-page
document, and they are the only fallback in it.

The cause is a wrong assumption about what a font's `cmap` table means inside a
PDF. `SegoeUI-Semibold` is embedded as a subset with:

    glyphs in the program        2467
    codepoints in its cmap         47
    codepoints named by ToUnicode  57
    '7' (U+0037)                 CID 2464 — present, with outlines

The glyph is right there. The `cmap` simply does not point at it, and it does
not have to: the PDF draws this font with `/Encoding /Identity-H`, which selects
glyphs by CID, not by Unicode. A producer subsetting for print has no reason to
maintain the Unicode table, so Chrome/Skia leaves it partial.

A web font is the opposite. `@font-face` is looked up BY Unicode, through the
program's own `cmap`. So a codepoint the cmap omits is unreachable however the
face is declared:

  - Leave it out of `unicode-range` (what we did) → the renderer falls to the
    stack fallback and draws a correct `7` in the wrong typeface.
  - Put it in `unicode-range` → the renderer picks our face, finds nothing, and
    draws **tofu**. Verified against WeasyPrint: `□`.

Neither is the source's `7`. The table has to be repaired.

WHAT AUTHORISES THE REPAIR
--------------------------
The PDF's `ToUnicode` CMap is the producer's own statement of what each CID
means — it is what makes the text extractable at all. With `/CIDToGIDMap
/Identity`, CID is the glyph index, so `ToUnicode` inverts into exactly the
Unicode→glyph mapping the `cmap` is missing.

WHY THIS MODULE IS PURE AND TESTED
----------------------------------
A wrong entry here does not fail; it draws a **different letter**, in the right
typeface, on a client's page. The first version of this analysis parsed
`ToUnicode` with one regex over `<hex> <hex>` pairs and reported 20 unreachable
codepoints across this document — including `\\r`, `U+FFFF`, and a stray `c` and
`U`. Every one was an artifact of reading `bfrange` triplets as `bfchar` pairs.
Parsed properly, the true count is **one**. That gap between 20 and 1 is the
whole reason the parser lives in a CI-gated module with fixtures.

Pure: no I/O, no clock, no randomness, no third-party imports. The font-file
surgery itself needs fontTools and stays in `app.py`; everything that decides
WHAT to write is here.
"""

from __future__ import annotations

import re

#: Most Unicode→glyph entries one font may gain. A subset needs a handful; a
#: number far above that means the ToUnicode CMap is describing something other
#: than this program, and the safe reading is to stop rather than rewrite it.
MAX_REPAIRED_MAPPINGS = 256

#: Largest CMap stream worth parsing, in characters. Bounded because the input
#: is attacker-influenced and this runs per font per document.
MAX_CMAP_TEXT_CHARS = 2_000_000

#: Largest span a single `bfrange` may cover. A legitimate range maps a script
#: or a block; one covering the whole plane is a malformed or hostile stream.
MAX_BFRANGE_SPAN = 65_535

_BFCHAR_BLOCK = re.compile(r"beginbfchar(.*?)endbfchar", re.S)
_BFRANGE_BLOCK = re.compile(r"beginbfrange(.*?)endbfrange", re.S)
_BFCHAR_PAIR = re.compile(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>")
_BFRANGE_ENTRY = re.compile(
    r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:\[(.*?)\]|<([0-9A-Fa-f]*)>)", re.S
)
_HEX_STRING = re.compile(r"<([0-9A-Fa-f]*)>")


def _utf16be(hex_string: str) -> str:
    """Decode a CMap destination hex string (UTF-16BE) to text."""
    if not hex_string:
        return ""
    padded = hex_string if len(hex_string) % 2 == 0 else "0" + hex_string
    try:
        return bytes.fromhex(padded).decode("utf-16-be", errors="ignore")
    except ValueError:
        return ""


def parse_tounicode_cmap(text: str) -> dict[int, str]:
    """CID → text, from a PDF `ToUnicode` CMap stream.

    Handles both operators, and both `bfrange` destination forms:

        beginbfchar   <src> <dst>                    endbfchar
        beginbfrange  <lo> <hi> <dstStart>           endbfrange
        beginbfrange  <lo> <hi> [<d0> <d1> ...]      endbfrange

    Reading the second form as a `bfchar` pair — which one flat regex over
    `<hex> <hex>` does — maps `lo → chr(hi)`, inventing mappings wholesale. That
    is not a hypothetical: see the module header.

    Malformed entries are skipped, never guessed at. Returns {} for anything
    unparseable.
    """
    if not isinstance(text, str) or not text or len(text) > MAX_CMAP_TEXT_CHARS:
        return {}
    out: dict[int, str] = {}

    for block in _BFCHAR_BLOCK.findall(text):
        for src, dst in _BFCHAR_PAIR.findall(block):
            value = _utf16be(dst)
            if value:
                out[int(src, 16)] = value

    for block in _BFRANGE_BLOCK.findall(text):
        for lo, hi, array, dst in _BFRANGE_ENTRY.findall(block):
            start, end = int(lo, 16), int(hi, 16)
            if end < start or end - start > MAX_BFRANGE_SPAN:
                continue
            if array:
                for offset, item in enumerate(_HEX_STRING.findall(array)):
                    if start + offset > end:
                        break
                    value = _utf16be(item)
                    if value:
                        out[start + offset] = value
                continue
            base = _utf16be(dst)
            # An incrementing range is only meaningful for single characters;
            # a multi-character destination cannot be stepped.
            if len(base) != 1:
                continue
            first = ord(base)
            for offset in range(end - start + 1):
                codepoint = first + offset
                if codepoint > 0x10FFFF:
                    break
                out[start + offset] = chr(codepoint)
    return out


def is_repairable_codepoint(codepoint: int) -> bool:
    """Is this a codepoint a document could legitimately draw?

    Controls, surrogates and noncharacters appear in real ToUnicode streams as
    filler for CIDs the producer did not describe. Mapping one is at best inert
    and at worst claims a codepoint the fallback would have handled.
    """
    if not isinstance(codepoint, int) or codepoint < 0x20 or codepoint > 0x10FFFF:
        return False
    if 0x7F <= codepoint <= 0x9F:          # C1 controls, and DEL
        return False
    if 0xD800 <= codepoint <= 0xDFFF:      # surrogate halves
        return False
    if 0xFDD0 <= codepoint <= 0xFDEF:      # noncharacters
        return False
    if codepoint & 0xFFFE == 0xFFFE:       # U+xFFFE / U+xFFFF in every plane
        return False
    return True


def plan_cmap_repair(
    tounicode: dict[int, str],
    existing_codepoints: set[int],
    num_glyphs: int,
    blank_glyph_ids: set[int],
    cid_to_gid_identity: bool,
) -> dict[int, int]:
    """Unicode → glyph id entries to ADD to a font's cmap.

    Every rule here exists to keep a repair from being worse than the fallback
    it replaces:

      - **Identity only.** Without `/CIDToGIDMap /Identity` a CID is not a glyph
        index, and mapping through it would draw an unrelated glyph.
      - **Never overrides.** A codepoint the cmap already maps is left alone;
        this only fills holes.
      - **Single characters only.** A ligature CID names two or more characters
        and has no place in a cmap, which is one codepoint to one glyph.
      - **No blank glyphs.** A subsetter strips outlines from glyphs it does not
        need — 2409 of this font's 2467 — and pointing a codepoint at one draws
        NOTHING where the fallback drew a character. Silence is worse than a
        wrong typeface.
      - **No ambiguity.** If two CIDs claim one codepoint, there is no evidence
        which glyph the document meant; neither is used.
      - **Bounded.** Past `MAX_REPAIRED_MAPPINGS` this stops being a repair.
    """
    if not cid_to_gid_identity or not tounicode:
        return {}
    if not isinstance(num_glyphs, int) or num_glyphs <= 0:
        return {}

    claims: dict[int, set[int]] = {}
    for cid, value in tounicode.items():
        if not isinstance(cid, int) or cid < 0 or cid >= num_glyphs:
            continue
        if not isinstance(value, str) or len(value) != 1:
            continue
        codepoint = ord(value)
        if codepoint in existing_codepoints or not is_repairable_codepoint(codepoint):
            continue
        if cid in blank_glyph_ids:
            continue
        claims.setdefault(codepoint, set()).add(cid)

    planned = {cp: next(iter(cids)) for cp, cids in claims.items() if len(cids) == 1}
    if len(planned) > MAX_REPAIRED_MAPPINGS:
        return {}
    return planned


def coverage_ranges(codepoints, max_ranges: int) -> list[str] | None:
    """CSS `unicode-range` segments for `codepoints`, coalesced.

    Returns None for an empty or unreadable set. The caller treats that as
    "coverage unknown" and refuses to embed a SUBSET on it: a face declared
    without a range claims every codepoint, and a subset that claims codepoints
    it lacks is the gibberish-glyph failure this exists to prevent.

    Beyond `max_ranges` segments the largest win and the tail is dropped — an
    unlisted codepoint merely falls to the stack fallback.
    """
    try:
        ordered = sorted({int(c) for c in codepoints if 0 < int(c) <= 0x10FFFF})
    except (TypeError, ValueError):
        return None
    if not ordered:
        return None

    segments: list[tuple[int, int]] = []
    start = previous = ordered[0]
    for codepoint in ordered[1:]:
        if codepoint == previous + 1:
            previous = codepoint
            continue
        segments.append((start, previous))
        start = previous = codepoint
    segments.append((start, previous))

    if isinstance(max_ranges, int) and 0 < max_ranges < len(segments):
        largest = sorted(segments, key=lambda s: s[1] - s[0], reverse=True)
        segments = sorted(largest[:max_ranges])

    return [
        f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}"
        for a, b in segments
    ]
