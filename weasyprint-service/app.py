"""
WeasyPrint PDF rendering microservice.

POST /render
  Headers:
    Authorization: Bearer <WEASYPRINT_SERVICE_TOKEN>
    Content-Type:  application/json
  Body:
    { "html": "<!doctype html>...", "base_url": "https://optional/",
      "pdf_variant": "pdf/a-2b", "tagged": true, "optimize_images": true,
      "strict": false }
  Returns:
    application/pdf bytes (200), with the engine's diagnostics in headers, or
    { "error": "...", "warnings": [...] } (4xx/5xx).

GET  /healthz       -> 200 "ok"
GET  /version       -> the installed engine, authenticated
GET|POST /capabilities -> what this engine actually does with a set of CSS
                          declarations, authenticated

## Why this service reports its own warnings

WeasyPrint does not fail on CSS it cannot implement. It logs a line — `Ignored
`box-shadow: ...`, unknown property` — and renders the document without it. Nine
constructs are dropped that way, and a missing `font-family` is not even
logged.

That log went to stderr and no caller ever saw it. So when the container ran
62.3 and the stylesheet was written against 69, `width: calc(210mm - 44mm)` was
dropped as an invalid value on every render, the cover's masthead row lost the
width its `table-layout: fixed` depended on, and the classification and the
document reference printed as one word. Every render "succeeded".

`/render` now returns what the engine said, and `strict` turns it into a
failure. `/capabilities` asks the same question without a document, so
`engineSupport.pure.ts`'s list of unsupported constructs can be checked against
the engine that is actually deployed rather than against a support table.
"""

import ipaddress
import json
import logging
import os
import socket
import subprocess
import time
from contextlib import contextmanager
from importlib import metadata
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from flask import Flask, Response, jsonify, request
from weasyprint import DEFAULT_OPTIONS, HTML, default_url_fetcher
from weasyprint.urls import HTTP_HEADERS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("weasyprint-service")

# fontTools narrates its subsetting at INFO: one line per table and one per
# glyph, for every face on every page. A single report buries its own render
# line under thousands of them, which is how the engine's warnings stayed
# invisible even to somebody reading the logs. Nothing in it is actionable.
logging.getLogger("fontTools").setLevel(logging.WARNING)

app = Flask(__name__)

EXPECTED_TOKEN = (os.environ.get("WEASYPRINT_SERVICE_TOKEN") or os.environ.get("WEASYPRINT_API_KEY") or "").strip().strip('"')
MAX_HTML_BYTES = int(os.environ.get("MAX_HTML_BYTES", str(25 * 1024 * 1024)))  # 25 MB

# Response headers are not a log: a header a proxy truncates or rejects is worse
# than a short one. The full set is always logged; this is what travels back.
MAX_WARNING_HEADER_CHARS = 3500
MAX_WARNINGS_RETURNED = 40

# The families the report stylesheet names. Checked at build time by the
# Dockerfile and again here, at runtime, as the unprivileged user that actually
# renders — a face root can see and uid 10001 cannot is a face that substitutes
# silently in production and nowhere else.
BRAND_FAMILIES = ("Cinzel", "Playfair Display", "Inter", "IBM Plex Mono")


def _validate_resource_url(url: str) -> None:
    """Allow embedded data or public HTTP(S) resources, never local networks."""
    parsed = urlsplit(url)
    if parsed.scheme == "data":
        return
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("resource URL scheme is not allowed")
    if parsed.username or parsed.password:
        raise ValueError("resource URL credentials are not allowed")

    try:
        addresses = {
            info[4][0]
            for info in socket.getaddrinfo(parsed.hostname, parsed.port, type=socket.SOCK_STREAM)
        }
    except socket.gaierror as exc:
        raise ValueError("resource URL host could not be resolved") from exc
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("resource URL host is not public")


class SafeRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_resource_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def safe_url_fetcher(url: str, timeout: int = 10, ssl_context=None):
    """Apply the network policy before WeasyPrint fetches a resource."""
    _validate_resource_url(url)
    if urlsplit(url).scheme == "data":
        return default_url_fetcher(url, timeout=timeout, ssl_context=ssl_context)

    opener = build_opener(SafeRedirectHandler(), HTTPSHandler(context=ssl_context))
    response = opener.open(Request(url, headers=HTTP_HEADERS), timeout=timeout)
    info = response.info()
    return {
        "file_obj": response,
        "redirected_url": response.geturl(),
        "mime_type": info.get_content_type(),
        "encoding": info.get_param("charset"),
        "filename": info.get_filename(),
    }


class _Collector(logging.Handler):
    """Keeps the engine's own diagnostics for the duration of one render."""

    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.messages: list[str] = []

    def emit(self, record):  # noqa: D102
        try:
            self.messages.append(record.getMessage())
        except Exception:  # noqa: BLE001 - a broken record must not fail a render
            pass


@contextmanager
def capture_engine_log():
    """Collect WeasyPrint's warnings for this render, and only this render.

    Attached to the `weasyprint` logger rather than the root, so `fontTools`'
    per-glyph DEBUG traffic — which is enormous — stays out of it.

    Not thread-safe by construction: gunicorn runs threads, and two concurrent
    renders would collect each other's warnings. That is accepted. The messages
    are advisory and identical documents produce identical warnings; the cost of
    a per-thread filter is not worth paying for a diagnostic.
    """
    collector = _Collector()
    engine_log = logging.getLogger("weasyprint")
    previous = engine_log.level
    engine_log.addHandler(collector)
    # WARNING is the engine's default, but an operator who set WEASYPRINT_LOG
    # higher would otherwise silence exactly the thing this exists to catch.
    if previous > logging.WARNING or previous == logging.NOTSET:
        engine_log.setLevel(logging.WARNING)
    try:
        yield collector
    finally:
        engine_log.removeHandler(collector)
        engine_log.setLevel(previous)


def _header_safe(messages: list[str]) -> str:
    """The warnings as one JSON string that is legal in an HTTP header.

    `json.dumps` with the default `ensure_ascii` escapes every control character
    and every non-ASCII byte, so the result cannot carry a CR or LF — which
    matters, because these strings contain CSS copied out of the request and a
    header value is not a place to trust input.
    """
    encoded = json.dumps(messages[:MAX_WARNINGS_RETURNED])
    if len(encoded) > MAX_WARNING_HEADER_CHARS:
        # Drop whole messages until it fits, rather than truncating into invalid
        # JSON that a caller cannot parse at all.
        kept = list(messages[:MAX_WARNINGS_RETURNED])
        while kept and len(json.dumps(kept)) > MAX_WARNING_HEADER_CHARS:
            kept.pop()
        kept.append(f"... {len(messages) - len(kept)} more, see the service log")
        encoded = json.dumps(kept)
    return encoded


def _supported_options(options: dict) -> dict:
    """Drop options this engine build does not know, loudly.

    The option that carries tagging has been spelled three ways across the
    versions this service has run. Passing an unknown one is not an error the
    engine raises — it is an option that quietly does nothing, which is how
    `tagged: true` was accepted by this service for months and never reached
    the engine at all.
    """
    known = {key: value for key, value in options.items() if key in DEFAULT_OPTIONS}
    unknown = sorted(set(options) - set(known))
    if unknown:
        log.warning(
            "render options not supported by weasyprint %s, ignored: %s",
            _package_version("weasyprint"),
            ", ".join(unknown),
        )
    return known


def _package_version(name: str) -> str:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return "unknown"


def _installed_families() -> dict:
    """Which brand faces this *process* can resolve.

    Asked of fontconfig rather than assumed from the Dockerfile: the build
    assertion runs as root during `docker build`, and the renders run as an
    unprivileged user with a different HOME. A face visible to one and not the
    other substitutes silently, and a substituted face is the one defect in this
    service that no test downstream of it can see.
    """
    try:
        listed = subprocess.run(
            ["fc-list", ":", "family"], check=True, capture_output=True, text=True, timeout=20,
        ).stdout.lower()
    except Exception as exc:  # noqa: BLE001
        log.warning("fc-list unavailable: %s", exc)
        return {family: None for family in BRAND_FAMILIES}
    return {family: family.lower() in listed for family in BRAND_FAMILIES}


def _auth_ok(req) -> bool:
    if not EXPECTED_TOKEN:
        # If no token is set, refuse everything — fail closed.
        return False
    header = req.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    # Support both "Bearer <token>" and "Bearer "<token>""
    received_token = header.split(" ", 1)[1].strip().strip('"')
    return received_token == EXPECTED_TOKEN


@app.get("/")
def root():
    return jsonify(
        {
            "service": "weasyprint-service",
            "status": "ok",
            "endpoints": [
                "GET /healthz",
                "GET /health",
                "GET /version",
                "GET|POST /capabilities",
                "POST /render",
            ],
        }
    )


@app.get("/health")
@app.get("/healthz")
def healthz():
    return Response("ok", mimetype="text/plain")


@app.get("/version")
def version():
    if not _auth_ok(request):
        return jsonify({"error": "unauthorized"}), 401

    return jsonify(
        {
            "weasyprint": _package_version("weasyprint"),
            "pydyf": _package_version("pydyf"),
            "flask": _package_version("flask"),
        }
    )


# One declaration per construct the stylesheet must never emit, so the engine
# can be *asked* rather than assumed. Mirrors `UNSUPPORTED` in
# `supabase/functions/_shared/reportDesign/engineSupport.pure.ts`; a caller may
# POST its own set, which is how that list stays honest without a redeploy here.
DEFAULT_PROBES = {
    "box-shadow": "box-shadow: 0 1pt 2pt currentColor",
    "filter": "filter: blur(2px)",
    "backdrop-filter": "backdrop-filter: blur(2px)",
    "word-break-break-word": "word-break: break-word",
    "position-sticky": "position: sticky",
    "text-wrap-balance": "text-wrap: balance",
    "aspect-ratio": "aspect-ratio: 16 / 9",
    "mix-blend-mode": "mix-blend-mode: multiply",
    "writing-mode": "writing-mode: vertical-rl",
    # Both found by rendering a report and reading the engine's stderr, which
    # is the only place either announced itself. `font-synthesis` is the one
    # that matters: without it the engine emboldens or slants a face that has
    # no such cut, and the result is a smear nothing downstream can detect.
    "font-synthesis": "font-synthesis: none",
    # Its sibling `hyphenate-limit-chars` is accepted; this one is not.
    "hyphenate-limit-lines": "hyphenate-limit-lines: 2",
    # Load-bearing from here down in spirit, but probed as ordinary entries so
    # the answer is recorded rather than assumed: every report's outline.
    "hyphenate-limit-chars": "hyphenate-limit-chars: 6 3 3",
    "bookmark-level": "bookmark-level: 1",
    # Supported here, and dropped by the version this service ran until now.
    # Probed so the answer is recorded rather than remembered.
    "calc-width": "width: calc(210mm - 44mm)",
    # Load-bearing. If one of these ever reads as dropped, the design system's
    # layout primitives have stopped working and the report is not a report.
    "flex": "display: flex",
    "grid": "display: grid",
    "border-radius": "border-radius: 3pt",
    "linear-gradient": "background: linear-gradient(currentColor, transparent)",
    "hyphens": "hyphens: auto",
    "break-inside": "break-inside: avoid",
    "running-string": "content: string(chapter)",
}


def probe_engine(probes: dict) -> dict:
    """Render one declaration per probe and report which the engine dropped.

    Each probe gets its own class so the engine's warning names it: WeasyPrint
    echoes the declaration text it ignored, which is the only reliable way to
    attribute a warning to a probe.
    """
    rules = "\n".join(f".p{index} {{ {decl}; }}" for index, decl in enumerate(probes.values()))
    html = f"<html><head><style>{rules}</style></head><body><p>probe</p></body></html>"

    with capture_engine_log() as collector:
        HTML(string=html).render()
    ignored = "\n".join(collector.messages)

    dropped = {}
    for name, decl in probes.items():
        # The warning quotes the declaration without its semicolon. Match on the
        # property and value rather than the class, because the class name does
        # not appear in the message.
        dropped[name] = decl.rstrip(";").strip() in ignored
    return {"dropped": dropped, "warnings": collector.messages}


@app.get("/capabilities")
@app.post("/capabilities")
def capabilities():
    if not _auth_ok(request):
        return jsonify({"error": "unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    probes = payload.get("probes")
    if probes is not None and (
        not isinstance(probes, dict)
        or not all(isinstance(k, str) and isinstance(v, str) for k, v in probes.items())
        or len(probes) > 200
    ):
        return jsonify({"error": "probes must be an object of at most 200 name -> declaration"}), 400

    result = probe_engine(probes or DEFAULT_PROBES)
    return jsonify(
        {
            "weasyprint": _package_version("weasyprint"),
            "pydyf": _package_version("pydyf"),
            "fonts": _installed_families(),
            "options": sorted(DEFAULT_OPTIONS),
            **result,
        }
    )


@app.post("/render")
def render():
    if not _auth_ok(request):
        return jsonify({"error": "unauthorized"}), 401

    if request.content_length and request.content_length > MAX_HTML_BYTES:
        return jsonify({"error": "html too large"}), 413

    payload = request.get_json(silent=True) or {}
    html = payload.get("html")
    base_url = payload.get("base_url") or None
    pdf_variant = payload.get("pdf_variant") or None  # e.g. "pdf/a-2b", "pdf/ua-1"
    tagged = bool(payload.get("tagged", True))         # accessible/tagged PDF by default
    optimize_images = bool(payload.get("optimize_images", True))
    # Refuse a document the engine could not render whole. Off by default: a
    # warning is usually cosmetic and a client waiting on a report is not served
    # by a 422. CI and the engine-check script turn it on.
    strict = bool(payload.get("strict", False))

    if not isinstance(html, str) or not html.strip():
        return jsonify({"error": "html is required"}), 400

    # The colour space the file declares it was prepared for.
    #
    # `pdf/a-*` sets this itself, which is why the reports carried one while
    # they claimed PDF/A. `pdf/ua-1` does not — accessibility says nothing about
    # colour — so switching the variant silently dropped the output intent from
    # every report. Asked for explicitly, it survives the switch: measured, a
    # `pdf/ua-1` file with `output_intent: "srgb"` carries a real ICC profile
    # (IEC 61966-2-1) and still validates as PDF/UA-1.
    #
    # `srgb` is a keyword the engine resolves to its own bundled `sRGB2014.icc`,
    # not a path. A path silently matches nothing and produces no intent at all,
    # which is what the first attempt here did.
    output_intent = payload.get("output_intent") or None

    # Copy the document's own `<meta name=…>` tags into the PDF.
    #
    # What this is for: nothing connected a delivered file back to the row that
    # produced it. The render routes now put `npc-format`, `npc-render-id` and
    # `npc-source-id` in the head, and this is the switch that carries them into
    # the file. Measured against the pinned engine — the key is lowercased and
    # stripped to letters and digits (`npc-render-id` → `/npcrenderid`), the
    # values land in the Info dictionary rather than the XMP packet, and the
    # tags the engine already understands (`author`, `description`) are not
    # duplicated. A `pdf/ua-1` file with all of them present validates clean.
    #
    # Default on: the option means "carry what the document declares", and a
    # document declaring nothing is unaffected by it.
    custom_metadata = bool(payload.get("custom_metadata", True))

    options = _supported_options(
        {
            "pdf_variant": pdf_variant,
            "output_intent": output_intent,
            "custom_metadata": custom_metadata,
            # The knob that actually produces /StructTreeRoot. This service read
            # `tagged` from the body and never passed it to the engine, so every
            # report it has produced has been untagged — valid, printable, and
            # unnavigable to a screen reader.
            "pdf_tags": tagged,
            # `dpi` and `jpeg_quality` are deliberately absent, and this is the
            # measurement rather than an opinion.
            #
            # Taken against a real document with the house cover art spliced in
            # — a 224 KB JPEG data URI, the only raster a report carries:
            #
            #     optimize_images off      320.1 KB
            #     optimize_images on       254.9 KB   ← what ships
            #     dpi 300                  254.9 KB
            #     dpi 150                  254.9 KB
            #     dpi 96                   247.9 KB
            #     dpi 72                   218.1 KB
            #     dpi 36                   181.4 KB
            #     jpeg_quality 85          286.7 KB
            #
            # So the cover art sits between 96 and 150 dpi on the page: a `dpi`
            # of 150 or 300 does nothing at all, and anything low enough to save
            # bytes visibly degrades a full-bleed cover. And `jpeg_quality`
            # makes the file *larger* — it forces a re-encode of an asset that
            # is already a JPEG, paying a generation of loss to grow by 31 KB.
            #
            # `optimize_images` is worth 65 KB and is on. The other two are
            # recorded here so they are not proposed again from first
            # principles, which is how they got onto the list.
            "optimize_images": optimize_images,
            "presentational_hints": False,
        }
    )
    # `pdf_variant: None` means "the engine's default", not "an unset variant".
    options = {key: value for key, value in options.items() if value is not None}

    started = time.monotonic()
    try:
        with capture_engine_log() as collector:
            document = HTML(
                string=html, base_url=base_url, url_fetcher=safe_url_fetcher,
            ).render(**options)
            pages = len(document.pages)
            pdf_bytes = document.write_pdf(**options)
    except Exception as exc:  # noqa: BLE001
        log.exception("weasyprint render failed")
        return jsonify({"error": f"render_failed: {exc}"}), 500

    elapsed_ms = int((time.monotonic() - started) * 1000)
    warnings = collector.messages
    for message in warnings:
        log.warning("engine: %s", message)

    if strict and warnings:
        return jsonify(
            {
                "error": "engine_warnings",
                "detail": (
                    "the engine did not render this document whole; every warning below "
                    "is a declaration it dropped"
                ),
                "warnings": warnings[:MAX_WARNINGS_RETURNED],
                "warning_count": len(warnings),
            }
        ), 422

    log.info(
        "rendered pdf bytes=%d html_bytes=%d pages=%d warnings=%d ms=%d tagged=%s",
        len(pdf_bytes), len(html), pages, len(warnings), elapsed_ms, options.get("pdf_tags"),
    )
    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": 'inline; filename="report.pdf"',
            "X-WeasyPrint-Version": _package_version("weasyprint"),
            # Counted from the engine's own page list rather than inferred from
            # the bytes. The caller's `countPdfPagesAsync` inflates compressed
            # object streams to guess at this; here it is simply known.
            "X-Pdf-Pages": str(pages),
            "X-Pdf-Tagged": "1" if options.get("pdf_tags") else "0",
            "X-Render-Ms": str(elapsed_ms),
            "X-WeasyPrint-Warning-Count": str(len(warnings)),
            "X-WeasyPrint-Warnings": _header_safe(warnings),
        },
    )


def warm_up() -> None:
    """Render a throwaway page at boot so the first real one is not the slowest.

    WeasyPrint's import, Pango's initialisation and fontconfig's first scan cost
    seconds, and under `--preload` this runs once in the gunicorn parent — every
    worker forks from a process that has already paid it.

    Failure is logged and swallowed: a warm-up that raises must not stop a
    service that would otherwise render perfectly well cold.
    """
    started = time.monotonic()
    try:
        with capture_engine_log():
            HTML(
                string=(
                    '<html><body style="font-family:Inter">'
                    '<h1 style="font-family:Cinzel">warm</h1>'
                    '<p style="font-family:\'Playfair Display\'">up</p>'
                    '<code style="font-family:\'IBM Plex Mono\'">0.00</code>'
                    "</body></html>"
                )
            ).write_pdf()
    except Exception as exc:  # noqa: BLE001
        log.warning("warm-up render failed, serving cold: %s", exc)
        return
    log.info(
        "warm-up render in %dms, fonts=%s",
        int((time.monotonic() - started) * 1000), _installed_families(),
    )


# Env-gated rather than unconditional: `test_app.py` imports this module, and a
# module that renders a PDF on import makes the test suite pay for it.
if os.environ.get("WEASYPRINT_WARMUP", "").strip() not in ("", "0", "false", "no"):
    warm_up()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
