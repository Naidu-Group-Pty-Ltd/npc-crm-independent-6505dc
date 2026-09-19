# Third-party licensing notice — pdf-parse-service

This service bundles **PyMuPDF** (`fitz`), which is licensed under the
**GNU AGPL-3.0** (with a commercial license available from Artifex).

PyMuPDF is used in `app.py` (`_extract_fitz_layers`) for the Phase 2 PDF import
fidelity work: extracting vector graphics (`page.get_drawings()`) and per-span
typography (`page.get_text("dict")`), and — in later phases — embedded font
programs.

Implications to be aware of:

- AGPL is copyleft. Running PyMuPDF inside this network service can trigger the
  AGPL's "remote interaction" source-availability obligations for the combined
  work unless a commercial PyMuPDF license is held.
- This is the **only** copyleft dependency in the stack; the rest
  (Docling — MIT, pypdfium2/PDFium — BSD, Pillow — HPND, FastAPI — MIT) are
  permissive.

If AGPL obligations are undesirable, the vector/typography extraction is isolated
in `_extract_fitz_layers` and can be reimplemented against a permissive library
(e.g. `pdfplumber`/`pdfminer.six` — MIT, or the already-vendored `pypdfium2`)
without changing the artifact contract consumed by the frontend.
