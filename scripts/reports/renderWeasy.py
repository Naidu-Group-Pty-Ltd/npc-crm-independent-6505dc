"""Render HTML to PDF on the SAME engine options `render-template-pdf` sends.

The CLI's defaults are not the production print contract. The route defaults to
`pdf_variant: 'pdf/ua-1'`, `tagged: true` (which is what produces
`/StructTreeRoot`), `optimize_images: true`, `custom_metadata: true` and
`output_intent: 'srgb'` — so a review document rendered with a bare
`weasyprint in.html out.pdf` is a different file from the one the product would
produce, untagged and with no output intent. This mirrors the call in
`weasyprint-service/app.py`, including its `_supported_options` filter, so the
engine VERSION and the engine OPTIONS both match what ships.

Every engine warning is printed. The service's own comment is the reason:
a warning is a declaration the engine dropped, so a silent render is not a
clean one.

    python3 scripts/reports/renderWeasy.py in.html out.pdf
"""
import inspect
import logging
import sys

from weasyprint import HTML
from weasyprint.document import Document

# What the route sends, defaults included.
OPTIONS = {
    "pdf_variant": "pdf/ua-1",
    "output_intent": "srgb",
    "custom_metadata": True,
    "pdf_tags": True,
    "optimize_images": True,
    "presentational_hints": False,
}


def supported(options: dict) -> dict:
    """The service's own filter: drop anything this engine build does not take."""
    accepted = set()
    for fn in (HTML.render, Document.write_pdf):
        params = inspect.signature(fn).parameters
        if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
            return dict(options)
        accepted |= set(params)
    return {k: v for k, v in options.items() if k in accepted}


class Collect(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


def main() -> int:
    src, out = sys.argv[1], sys.argv[2]
    collector = Collect()
    log = logging.getLogger("weasyprint")
    log.addHandler(collector)
    log.setLevel(logging.WARNING)

    options = {k: v for k, v in supported(OPTIONS).items() if v is not None}
    document = HTML(filename=src).render(**options)
    pdf = document.write_pdf(**options)
    with open(out, "wb") as fh:
        fh.write(pdf)

    for message in collector.messages:
        # Elided in the middle: an image warning quotes the whole data URI,
        # and what the warning SAYS is at the end of it.
        m = message if len(message) <= 260 else f"{message[:120]} […] {message[-120:]}"
        print(f"warning\t{m}")
    print(f"pages\t{len(document.pages)}")
    print(f"options\t{sorted(options)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
