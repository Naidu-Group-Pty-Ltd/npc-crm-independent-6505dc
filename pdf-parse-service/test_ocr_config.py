"""Regression coverage for the Docling/EasyOCR language contract.

Previously this test imported `app` in a subprocess, which requires Docling to
be installed. Nothing in CI installs Docling, so the test never ran — and the
default it guards drifted from a compatible Latin group to
`en,fr,de,es,zh,ja,ko,ar`, which EasyOCR cannot construct. That accounted for 9
of 33 observed production parse failures (`({'zh'}, 'is not supported')`).

The contract now lives in the pure `ocr_languages` module, so this file tests it
with stdlib unittest and no model download — the same pattern as
`test_lane_policy.py`. Run with:

    python3 -m unittest test_ocr_config      (from pdf-parse-service/)
"""

import unittest

from ocr_languages import (
    DEFAULT_OCR_LANGS,
    OCR_LANGUAGE_CONTRACT_VERSION,
    SCRIPT_GROUPS,
    parse_language_list,
    resolve_ocr_languages,
)


class DefaultLanguageTests(unittest.TestCase):
    def test_default_is_english_only(self):
        """The product ingests Australian property/finance PDFs. A multi-script
        default costs model load time on every converter variant for a case that
        has not occurred in production."""
        self.assertEqual(DEFAULT_OCR_LANGS, "en")
        self.assertEqual(resolve_ocr_languages(None).languages, ("en",))

    def test_default_resolves_cleanly(self):
        resolution = resolve_ocr_languages(None)
        self.assertFalse(resolution.changed)
        self.assertEqual(resolution.dropped, {})
        self.assertEqual(resolution.primary_group, "latin")

    def test_contract_version_is_reported(self):
        self.assertEqual(
            resolve_ocr_languages(None).contract_version,
            OCR_LANGUAGE_CONTRACT_VERSION,
        )


class RegressionTests(unittest.TestCase):
    """The exact configuration that broke production."""

    SHIPPED_BAD_DEFAULT = "en,fr,de,es,zh,ja,ko,ar"

    def test_shipped_bad_default_is_made_constructible(self):
        resolution = resolve_ocr_languages(self.SHIPPED_BAD_DEFAULT)
        # `zh` is not an EasyOCR code; it aliases to ch_sim, which then becomes
        # the primary group. Everything outside that group except `en` is dropped.
        self.assertEqual(resolution.primary_group, "chinese_simplified")
        self.assertEqual(set(resolution.languages), {"en", "ch_sim"})
        self.assertTrue(resolution.changed)

    def test_never_returns_an_unconstructible_mix(self):
        """No input may yield two different non-Latin scripts."""
        for raw in (
            self.SHIPPED_BAD_DEFAULT,
            "ja,ko,ar",
            "ru,ja,th,ta",
            "ch_sim,ch_tra",
            "hi,bn,te,kn",
        ):
            with self.subTest(raw=raw):
                langs = resolve_ocr_languages(raw).languages
                groups = {
                    group
                    for group, members in SCRIPT_GROUPS.items()
                    for lang in langs
                    if lang in members and lang != "en"
                }
                self.assertLessEqual(len(groups), 1, f"{raw} -> {langs}")

    def test_unknown_code_is_dropped_with_a_reason(self):
        resolution = resolve_ocr_languages("en,klingon")
        self.assertEqual(resolution.languages, ("en",))
        self.assertEqual(resolution.dropped.get("klingon"), "unknown_easyocr_code")


class AliasTests(unittest.TestCase):
    def test_common_misspellings_alias_rather_than_drop(self):
        for raw, expected in (
            ("zh", "ch_sim"),
            ("zh-TW", "ch_tra"),
            ("jp", "ja"),
            ("kr", "ko"),
        ):
            with self.subTest(raw=raw):
                self.assertIn(expected, resolve_ocr_languages(raw).languages)

    def test_alias_is_recorded_as_a_change(self):
        resolution = resolve_ocr_languages("zh")
        self.assertEqual(resolution.dropped.get("zh"), "aliased_to:ch_sim")


class CompatibilityTests(unittest.TestCase):
    def test_latin_group_combines_freely(self):
        resolution = resolve_ocr_languages("en,fr,de,es,it,pt")
        self.assertEqual(resolution.languages, ("en", "fr", "de", "es", "it", "pt"))
        self.assertFalse(resolution.changed)

    def test_english_joins_any_script(self):
        for raw in ("en,ja", "en,ko", "en,ar", "en,ru", "en,th"):
            with self.subTest(raw=raw):
                self.assertIn("en", resolve_ocr_languages(raw).languages)

    def test_first_non_latin_group_wins(self):
        resolution = resolve_ocr_languages("fr,ja,ko")
        self.assertEqual(resolution.primary_group, "japanese")
        self.assertIn("ja", resolution.languages)
        self.assertNotIn("ko", resolution.languages)
        self.assertEqual(resolution.dropped.get("ko"), "incompatible_with_japanese")

    def test_non_english_latin_dropped_from_non_latin_group(self):
        resolution = resolve_ocr_languages("ja,fr")
        self.assertNotIn("fr", resolution.languages)
        self.assertEqual(resolution.dropped.get("fr"), "incompatible_with_japanese")


class RobustnessTests(unittest.TestCase):
    def test_never_returns_empty(self):
        for raw in ("", "   ", ",,,", "klingon,elvish", None):
            with self.subTest(raw=raw):
                self.assertTrue(resolve_ocr_languages(raw).languages)

    def test_normalizes_case_whitespace_and_separators(self):
        self.assertEqual(
            resolve_ocr_languages("  EN , Fr,  DE ").languages,
            ("en", "fr", "de"),
        )

    def test_deduplicates_preserving_order(self):
        self.assertEqual(parse_language_list("en,fr,en,fr,de"), ["en", "fr", "de"])

    def test_resolution_never_raises(self):
        for raw in (None, "", "!!!", "zh,zh,zh", "a" * 500, "en," * 200):
            with self.subTest(raw=raw[:20] if raw else raw):
                resolve_ocr_languages(raw)


if __name__ == "__main__":
    unittest.main()
