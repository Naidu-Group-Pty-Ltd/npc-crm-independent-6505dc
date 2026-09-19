"""OCR language resolution for the PDF-import sidecar.

Pure module — no Docling, no EasyOCR, no heavy imports — so the language
contract can be unit-tested without a model download, in the same spirit as
`lane_policy.py`. `app.py` imports `resolve_ocr_languages` and never parses
`DOCLING_OCR_LANGS` itself.

Why this module exists
----------------------
EasyOCR (the OCR backend Docling drives) rejects two things at *reader
construction* time, which surfaces as a failed conversion for the whole
document rather than a degraded OCR pass:

1. **Unknown language codes.** EasyOCR spells Chinese `ch_sim` / `ch_tra`, not
   `zh`. A `zh` in the list raises ``({'zh'}, 'is not supported')``.
2. **Incompatible script combinations.** Languages sharing a script can be
   combined; English can join any group; two different non-Latin scripts
   cannot. `ja` + `ko` + `ar` in one reader is not constructible.

The shipped default was `en,fr,de,es,zh,ja,ko,ar`, which trips both rules. In
production that accounted for 9 of 33 observed parse failures, every one of
them on documents whose measured `ocr_page_ratio` was 0.0 — i.e. the OCR that
crashed the job was never going to contribute a character.

Rather than fail a conversion over a *configuration* problem, this module
normalises the request into something EasyOCR can actually build, and reports
what it dropped so the caller can log it. A document parsed with English-only
OCR is a vastly better outcome than a document that does not parse at all.

The default is now `en` alone. This product ingests Australian property and
finance PDFs; a multi-script OCR default costs model-loading time and memory on
every converter variant to serve a case that has not occurred.
"""

from __future__ import annotations

from dataclasses import dataclass, field


OCR_LANGUAGE_CONTRACT_VERSION = "ocr-language-resolution-v1"

# Product default. English only — see module docstring.
DEFAULT_OCR_LANGS = "en"

# Fallback when a configuration resolves to nothing usable. Never empty: an
# empty language list is another EasyOCR construction error.
SAFE_FALLBACK = ("en",)

# Common spellings that are *not* EasyOCR codes but are what an operator will
# reach for. Aliasing these is strictly better than dropping them: it preserves
# the operator's evident intent instead of silently ignoring it.
LANGUAGE_ALIASES: dict[str, str] = {
    "zh": "ch_sim",
    "zh_cn": "ch_sim",
    "zh-cn": "ch_sim",
    "zh_hans": "ch_sim",
    "chinese": "ch_sim",
    "zh_tw": "ch_tra",
    "zh-tw": "ch_tra",
    "zh_hant": "ch_tra",
    "jp": "ja",
    "kr": "ko",
    "farsi": "fa",
    "persian": "fa",
}

# EasyOCR script groups. Languages within a group may be combined; `en` may join
# any group. Two different non-Latin groups may not be combined.
#
# Not exhaustive for every EasyOCR language, but covers the Latin set plus every
# non-Latin script an operator is likely to configure. An unlisted code is
# treated as unknown and dropped (with a reason) rather than passed through to
# fail the conversion.
SCRIPT_GROUPS: dict[str, tuple[str, ...]] = {
    "latin": (
        "en", "fr", "de", "es", "it", "pt", "nl", "sv", "da", "no", "fi",
        "pl", "cs", "sk", "hu", "ro", "tr", "id", "ms", "vi", "af", "sq",
        "et", "hr", "sl", "lt", "lv", "cy", "ga", "is", "mt", "ca", "gl",
        "eu", "tl", "sw", "oc", "rs_latin", "uz", "az", "mi", "la",
    ),
    "cyrillic": ("ru", "uk", "bg", "sr", "be", "mn", "rs_cyrillic", "tjk"),
    "arabic": ("ar", "fa", "ur", "ug"),
    "devanagari": ("hi", "mr", "ne", "sa", "bh", "mai", "bho", "ang", "gom"),
    "bengali": ("bn", "as"),
    "chinese_simplified": ("ch_sim",),
    "chinese_traditional": ("ch_tra",),
    "japanese": ("ja",),
    "korean": ("ko",),
    "thai": ("th",),
    "tamil": ("ta",),
    "telugu": ("te",),
    "kannada": ("kn",),
}

# Reverse index: language code -> script group.
_LANG_TO_GROUP: dict[str, str] = {
    lang: group for group, langs in SCRIPT_GROUPS.items() for lang in langs
}

# English is the universal joiner: EasyOCR permits `en` alongside any script.
UNIVERSAL_LANGUAGE = "en"


@dataclass(frozen=True)
class OcrLanguageResolution:
    """The resolved, EasyOCR-constructible language list plus what was dropped.

    `languages` is always non-empty and always safe to hand to EasyOCR.
    `dropped` maps a rejected code to the reason, so `app.py` can log a single
    structured warning instead of discovering the problem at conversion time.
    """

    languages: tuple[str, ...]
    dropped: dict[str, str] = field(default_factory=dict)
    primary_group: str = "latin"
    contract_version: str = OCR_LANGUAGE_CONTRACT_VERSION

    @property
    def changed(self) -> bool:
        """True when the resolution altered the requested list in any way."""
        return bool(self.dropped)

    def as_dict(self) -> dict:
        return {
            "languages": list(self.languages),
            "dropped": dict(self.dropped),
            "primary_group": self.primary_group,
            "contract_version": self.contract_version,
        }


def _normalize_code(raw: str) -> str:
    return raw.strip().lower().replace("-", "_")


def parse_language_list(raw: str | None) -> list[str]:
    """Split a comma-separated env value into normalized codes, de-duplicated
    while preserving order. Order matters: the first entry decides which script
    group wins when the request mixes incompatible scripts."""
    if raw is None:
        raw = DEFAULT_OCR_LANGS
    seen: set[str] = set()
    out: list[str] = []
    for chunk in raw.split(","):
        code = _normalize_code(chunk)
        if not code or code in seen:
            continue
        seen.add(code)
        out.append(code)
    return out


def resolve_ocr_languages(raw: str | None) -> OcrLanguageResolution:
    """Resolve `DOCLING_OCR_LANGS` into a list EasyOCR can actually construct.

    Resolution order:

    1. Parse + normalize (case, hyphens, duplicates).
    2. Alias known non-EasyOCR spellings (`zh` -> `ch_sim`).
    3. Drop codes belonging to no known script group.
    4. Pick the primary script group — the first non-Latin group requested, else
       Latin — and drop anything outside it, keeping `en` as the universal
       joiner.
    5. Fall back to English if nothing survives.

    Never raises, and never returns an empty list.
    """
    requested = parse_language_list(raw)
    dropped: dict[str, str] = {}

    # 2. Alias.
    aliased: list[str] = []
    for code in requested:
        resolved = LANGUAGE_ALIASES.get(code, code)
        if resolved != code:
            dropped[code] = f"aliased_to:{resolved}"
        if resolved not in aliased:
            aliased.append(resolved)

    # 3. Drop unknown codes.
    known: list[str] = []
    for code in aliased:
        if code in _LANG_TO_GROUP:
            known.append(code)
        else:
            dropped[code] = "unknown_easyocr_code"

    if not known:
        return OcrLanguageResolution(
            languages=SAFE_FALLBACK,
            dropped=dropped or {"(none)": "no_languages_configured"},
            primary_group="latin",
        )

    # 4. Choose the primary group: the first requested non-Latin group wins,
    #    otherwise Latin. English is never the reason a group is chosen.
    primary_group = "latin"
    for code in known:
        group = _LANG_TO_GROUP[code]
        if group != "latin":
            primary_group = group
            break

    kept: list[str] = []
    for code in known:
        group = _LANG_TO_GROUP[code]
        if group == primary_group or code == UNIVERSAL_LANGUAGE:
            kept.append(code)
        else:
            dropped[code] = f"incompatible_with_{primary_group}"

    if not kept:
        kept = list(SAFE_FALLBACK)

    return OcrLanguageResolution(
        languages=tuple(kept),
        dropped=dropped,
        primary_group=primary_group,
    )
