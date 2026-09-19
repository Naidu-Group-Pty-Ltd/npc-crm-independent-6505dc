"""
MRZ extraction and ICAO 9303 check-digit validation.

Deliberately conservative: when the MRZ cannot be read this returns
`found=False` rather than a guess. A guessed MRZ that happens to pass its own
check digits would be worse than no MRZ at all, because it would look like
evidence.

The authoritative check-digit logic is mirrored in
supabase/functions/_shared/aml/matching.ts, which is unit-tested. Keep the two
in step — the TS side is what the case record is written from.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Optional

# cv2/numpy/pytesseract are imported lazily inside the image path only. The
# check-digit and line-parsing logic below is pure, and keeping it importable
# without OpenCV means it can be unit-tested on its own — which matters,
# because that logic is what actually catches a forged document.
if TYPE_CHECKING:  # pragma: no cover
    import numpy as np

WEIGHTS = (7, 3, 1)
MRZ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"


def char_value(ch: str) -> int:
    if ch.isdigit():
        return int(ch)
    if "A" <= ch <= "Z":
        return ord(ch) - 55
    if ch == "<":
        return 0
    return -1


def check_digit(field_value: str) -> Optional[int]:
    total = 0
    for i, ch in enumerate(field_value):
        v = char_value(ch)
        if v < 0:
            return None
        total += v * WEIGHTS[i % 3]
    return total % 10


def verify(field_value: str, expected: str) -> bool:
    if not expected.isdigit():
        return False
    computed = check_digit(field_value)
    return computed is not None and computed == int(expected)


@dataclass
class MrzResult:
    found: bool = False
    valid: bool = False
    format: str = "unknown"
    lines: list[str] = field(default_factory=list)
    fields: dict = field(default_factory=dict)
    checks: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _preprocess(image: "Any") -> "Any":
    """Grey, upscale and threshold — the MRZ band is small and high-contrast."""
    import cv2  # local: keeps the pure check-digit logic importable without OpenCV

    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    h, w = grey.shape[:2]
    if w < 1000:
        scale = 1000 / max(w, 1)
        grey = cv2.resize(grey, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    grey = cv2.bilateralFilter(grey, 5, 60, 60)
    return cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]


def _candidate_lines(text: str) -> list[str]:
    out: list[str] = []
    for raw in text.upper().splitlines():
        line = re.sub(r"[^A-Z0-9<]", "", raw)
        # MRZ lines are 30, 36 or 44 characters; allow a little OCR slop.
        if len(line) >= 28 and line.count("<") >= 2:
            out.append(line)
    return out


def _pick_pair(lines: list[str]) -> tuple[list[str], str]:
    for target, fmt in ((44, "TD3"), (36, "TD2")):
        sized = [l for l in lines if abs(len(l) - target) <= 2]
        for i in range(len(sized) - 1):
            a, b = sized[i][:target].ljust(target, "<"), sized[i + 1][:target].ljust(target, "<")
            if a.startswith(("P", "I", "A", "C", "V")):
                return [a, b], fmt
        if len(sized) >= 2:
            return [sized[-2][:target].ljust(target, "<"), sized[-1][:target].ljust(target, "<")], fmt
    return [], "unknown"


def parse_lines(lines: list[str], fmt: str) -> MrzResult:
    res = MrzResult(found=True, format=fmt, lines=lines)
    if len(lines) < 2:
        res.errors.append("mrz_not_found")
        res.found = False
        return res

    l1, l2 = lines[0], lines[1]
    name_part = l1[5:]
    surname, _, given = name_part.partition("<<")

    document_number = l2[0:9]
    doc_check = l2[9:10]
    nationality = l2[10:13]
    dob = l2[13:19]
    dob_check = l2[19:20]
    sex = l2[20:21]
    expiry = l2[21:27]
    exp_check = l2[27:28]

    def add(name: str, value: str, expected: str) -> None:
        ok = verify(value, expected)
        res.checks.append({"field": name, "passed": ok})
        if not ok:
            res.errors.append(f"check_digit_failed_{name}")

    add("document_number", document_number, doc_check)
    add("date_of_birth", dob, dob_check)
    add("date_of_expiry", expiry, exp_check)

    if fmt == "TD3" and len(l2) >= 44:
        personal = l2[28:42]
        if personal.replace("<", ""):
            add("personal_number", personal, l2[42:43])
        composite = l2[0:10] + l2[13:20] + l2[21:43]
        add("composite", composite, l2[43:44])

    res.fields = {
        "document_type": l1[0:2].replace("<", ""),
        "issuing_state": l1[2:5].replace("<", ""),
        "document_number": document_number.replace("<", ""),
        "surname": surname.replace("<", " ").strip(),
        "given_names": given.replace("<", " ").strip(),
        "nationality": nationality.replace("<", ""),
        "date_of_birth": dob,
        "sex": "" if sex == "<" else sex,
        "date_of_expiry": expiry,
    }
    res.valid = not res.errors
    return res


def read_mrz(image: "Any") -> MrzResult:
    """Extract and validate an MRZ. Returns found=False when unreadable."""
    try:
        import pytesseract
    except Exception:  # pragma: no cover - environment dependent
        return MrzResult(found=False, errors=["ocr_unavailable"])

    processed = _preprocess(image)
    config = f"--psm 6 -c tessedit_char_whitelist={MRZ_CHARS}"
    try:
        text = pytesseract.image_to_string(processed, config=config)
    except Exception as exc:  # pragma: no cover - environment dependent
        return MrzResult(found=False, errors=[f"ocr_failed:{type(exc).__name__}"])

    lines, fmt = _pick_pair(_candidate_lines(text))
    if not lines:
        return MrzResult(found=False, errors=["mrz_not_found"])
    return parse_lines(lines, fmt)
