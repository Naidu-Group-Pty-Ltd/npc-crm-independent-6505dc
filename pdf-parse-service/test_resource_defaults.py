"""Regression coverage for resource-safe PDF parsing defaults."""

import app


def test_expensive_pdf_processing_is_opt_in_by_default():
    assert app.MAX_PDF_BYTES == 50 * 1024 * 1024
    assert app.ENABLE_PICTURE_DESCRIPTION_DEFAULT is False
    assert app.ENABLE_OCR_FALLBACK is False
    assert app.FORCE_FULL_PAGE_OCR is False
    assert app.GLOBAL_CAPABILITIES.ocr is False
    assert app.DEFAULT_CONVERTER_PROFILE.do_ocr is False
    assert app.DEFAULT_CONVERTER_PROFILE.force_full_page_ocr is False
