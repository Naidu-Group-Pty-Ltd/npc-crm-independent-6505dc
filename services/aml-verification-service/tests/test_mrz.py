"""
MRZ logic tests. No models or OCR required — these exercise the check-digit
arithmetic and line parsing, which is where a forgery is actually caught.

The expectations here are duplicated in
src/lib/aml/screeningMatch.test.ts on purpose: the two implementations must
agree, and a divergence should break a test rather than quietly produce
different verdicts on the two sides of the wire.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.mrz import check_digit, verify, parse_lines  # noqa: E402

# Canonical ICAO TD3 specimen.
L1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<"
L2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10"


def test_check_digit_weighting():
    assert check_digit("D23145890734") == 9
    assert check_digit("340712") == 7
    # Published as "L898902C36" — trailing 6 is the check digit.
    assert check_digit("L898902C3") == 6


def test_check_digit_rejects_invalid_characters():
    assert check_digit("ABC*DEF") is None


def test_verify_requires_numeric_expectation():
    assert verify("340712", "7") is True
    assert verify("340712", "8") is False
    assert verify("340712", "<") is False


def test_parses_valid_td3_specimen():
    r = parse_lines([L1, L2], "TD3")
    assert r.found is True
    assert r.valid is True
    assert r.errors == []
    assert r.fields["surname"] == "ERIKSSON"
    assert r.fields["given_names"] == "ANNA MARIA"
    assert r.fields["document_number"] == "L898902C3"
    assert r.fields["issuing_state"] == "UTO"
    assert r.fields["date_of_birth"] == "740812"
    assert r.fields["sex"] == "F"
    assert all(c["passed"] for c in r.checks)


def test_detects_tampered_document_number():
    tampered = "L898902C46UTO7408122F1204159ZE184226B<<<<<10"
    r = parse_lines([L1, tampered], "TD3")
    assert r.valid is False
    assert "check_digit_failed_document_number" in r.errors


def test_detects_tampered_date_of_birth():
    tampered = "L898902C36UTO7408123F1204159ZE184226B<<<<<10"
    r = parse_lines([L1, tampered], "TD3")
    assert r.valid is False
    assert "check_digit_failed_date_of_birth" in r.errors


def test_single_line_is_not_found_rather_than_guessed():
    r = parse_lines([L1], "TD3")
    assert r.found is False
    assert "mrz_not_found" in r.errors
