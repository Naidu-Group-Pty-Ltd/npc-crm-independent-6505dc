"""The render service, tested against the engine it actually installs.

Most of what matters here cannot be asserted on the returned bytes: a report set
in a substituted face, a stylesheet the engine silently dropped half of, and an
untagged PDF are all valid PDFs. So these tests read the *diagnostics* the
service now returns, and `CapabilitiesTests` asks the engine what it drops
rather than trusting a support table.
"""

import json
import re
import socket
import unittest
import zlib
from unittest.mock import patch

import app

AUTH = {"Authorization": "Bearer test-token"}
TWO_PAGES = (
    '<html lang="en"><head><title>T</title></head><body>'
    "<h1>One</h1><p>first page</p>"
    '<p style="break-before: page">second page</p>'
    "</body></html>"
)


def _searchable_pdf_bytes(pdf: bytes) -> bytes:
    """Return raw PDF data plus directly Flate-compressed stream contents."""
    chunks = [pdf]

    for match in re.finditer(
        rb"stream\r?\n(.*?)\r?\nendstream",
        pdf,
        flags=re.DOTALL,
    ):
        try:
            chunks.append(zlib.decompress(match.group(1)))
        except zlib.error:
            # Images, fonts and other streams may use a different encoding.
            pass

    return b"\n".join(chunks)


class VersionEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    @patch.object(app, "EXPECTED_TOKEN", "test-token")
    def test_rejects_unauthenticated_request(self):
        response = self.client.get("/version")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json(), {"error": "unauthorized"})

    @patch.object(app, "EXPECTED_TOKEN", "test-token")
    def test_returns_versions_to_authenticated_request(self):
        response = self.client.get("/version", headers=AUTH)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {
                "flask": app._package_version("flask"),
                "pydyf": app._package_version("pydyf"),
                "weasyprint": app._package_version("weasyprint"),
            },
        )


class ResourceUrlPolicyTests(unittest.TestCase):
    def test_allows_embedded_data_without_dns(self):
        with patch.object(app.socket, "getaddrinfo") as resolve:
            app._validate_resource_url("data:image/png;base64,AAAA")
        resolve.assert_not_called()

    @patch.object(app.socket, "getaddrinfo")
    def test_allows_public_https_host(self, resolve):
        resolve.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        app._validate_resource_url("https://example.com/image.png")

    @patch.object(app.socket, "getaddrinfo")
    def test_rejects_host_if_any_address_is_private(self, resolve):
        resolve.return_value = [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", 443)),
        ]
        with self.assertRaisesRegex(ValueError, "not public"):
            app._validate_resource_url("https://example.com/image.png")

    def test_rejects_local_and_non_network_schemes(self):
        for url in ("http://127.0.0.1/", "http://[::1]/", "file:///etc/passwd", "ftp://example.com/a"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                app._validate_resource_url(url)

    def test_rejects_redirect_before_following_private_target(self):
        handler = app.SafeRedirectHandler()
        with self.assertRaisesRegex(ValueError, "not public"):
            handler.redirect_request(None, None, 302, "Found", {}, "http://169.254.169.254/latest/meta-data")


@patch.object(app, "EXPECTED_TOKEN", "test-token")
class RenderTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def render(self, **body):
        body.setdefault("html", TWO_PAGES)
        return self.client.post("/render", headers=AUTH, json=body)

    def test_requires_authentication(self):
        response = self.client.post("/render", json={"html": "<p>x</p>"})
        self.assertEqual(response.status_code, 401)

    def test_returns_a_pdf(self):
        response = self.render()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "application/pdf")
        self.assertTrue(response.data.startswith(b"%PDF-"))

    def test_reports_the_page_count_the_engine_knows(self):
        # Counted from the engine's own page list. The caller otherwise has to
        # inflate the PDF's compressed object streams to guess at it.
        self.assertEqual(self.render().headers["X-Pdf-Pages"], "2")

    def test_tags_the_pdf_by_default(self):
        # The regression this exists for: the service read `tagged` from the
        # body, defaulted it to true, and never passed it to the engine — so
        # every report it produced was untagged and no test noticed.
        self.assertEqual(self.render().headers["X-Pdf-Tagged"], "1")

    def test_honours_tagged_false(self):
        self.assertEqual(self.render(tagged=False).headers["X-Pdf-Tagged"], "0")

    def test_the_tagging_option_is_the_one_that_builds_a_structure_tree(self):
        # The header claims tagging; this is what tagging *is*. Rendered
        # uncompressed because a compressed PDF hides its catalogue inside an
        # object stream, which is why the absent structure tree was never
        # spotted in the bytes.
        def struct_tree(**options):
            return b"/StructTreeRoot" in app.HTML(string=TWO_PAGES).write_pdf(
                uncompressed_pdf=True, **options,
            )

        self.assertTrue(struct_tree(pdf_tags=True))
        self.assertFalse(struct_tree(pdf_tags=False))

    def test_passes_the_tagging_option_to_the_engine(self):
        for tagged in (True, False):
            with self.subTest(tagged=tagged), patch.object(
                app.HTML, "render", wraps=app.HTML.render, autospec=True,
            ) as rendered:
                self.render(tagged=tagged)
                self.assertIs(rendered.call_args.kwargs["pdf_tags"], tagged)

    def test_carries_the_documents_own_metadata_into_the_file(self):
        # What connects a delivered PDF back to the row that produced it. The
        # render routes put `npc-format` and `npc-render-id` in the head; this
        # is the switch that copies them into the file.
        #
        # The PDF Info dictionary is normally stored in a compressed object
        # stream. Expand directly Flate-compressed streams before inspecting
        # the normalized custom metadata keys.
        html = TWO_PAGES.replace(
            "<head>",
            '<head><meta name="npc-format" content="borrowing-capacity">'
            '<meta name="npc-render-id" content="row-42">',
        )
        self.assertIn("npc-render-id", html)

        response = self.client.post(
            "/render",
            headers=AUTH,
            json={"html": html},
        )

        self.assertEqual(response.status_code, 200)

        pdf = _searchable_pdf_bytes(response.data)

        self.assertIn(b"/npcformat", pdf)
        self.assertIn(b"borrowing-capacity", pdf)
        self.assertIn(b"/npcrenderid", pdf)
        self.assertIn(b"row-42", pdf)

    def test_honours_custom_metadata_false(self):
        html = TWO_PAGES.replace(
            "<head>",
            '<head><meta name="npc-render-id" content="row-42">',
        )

        response = self.client.post(
            "/render",
            headers=AUTH,
            json={
                "html": html,
                "custom_metadata": False,
            },
        )

        self.assertEqual(response.status_code, 200)

        pdf = _searchable_pdf_bytes(response.data)

        self.assertNotIn(b"/npcrenderid", pdf)
        self.assertNotIn(b"row-42", pdf)

    def test_asks_the_engine_for_the_colour_space_by_name(self):
        # `pdf/ua-1` does not add an output intent the way the PDF/A variants
        # do, so the switch to UA dropped the colour space from every report
        # until this was passed explicitly.
        with patch.object(
            app.HTML, "render", wraps=app.HTML.render, autospec=True,
        ) as rendered:
            self.render(pdf_variant="pdf/ua-1", output_intent="srgb")
            self.assertEqual(rendered.call_args.kwargs["output_intent"], "srgb")
            self.assertEqual(rendered.call_args.kwargs["pdf_variant"], "pdf/ua-1")

    def test_a_clean_document_reports_no_warnings(self):
        response = self.render()
        self.assertEqual(response.headers["X-WeasyPrint-Warning-Count"], "0")
        self.assertEqual(json.loads(response.headers["X-WeasyPrint-Warnings"]), [])

    def test_returns_the_declarations_the_engine_dropped(self):
        response = self.render(
            html='<html><head><style>.a { box-shadow: 0 1pt 2pt #000; }</style></head>'
                 '<body class="a">x</body></html>',
        )
        self.assertEqual(response.status_code, 200)
        warnings = json.loads(response.headers["X-WeasyPrint-Warnings"])
        self.assertTrue(any("box-shadow" in w for w in warnings), warnings)
        self.assertEqual(response.headers["X-WeasyPrint-Warning-Count"], str(len(warnings)))

    def test_strict_refuses_a_document_the_engine_could_not_render_whole(self):
        response = self.render(
            html='<html><head><style>.a { box-shadow: 0 1pt 2pt #000; }</style></head>'
                 '<body class="a">x</body></html>',
            strict=True,
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.get_json()["error"], "engine_warnings")
        self.assertGreater(response.get_json()["warning_count"], 0)

    def test_strict_passes_a_clean_document(self):
        self.assertEqual(self.render(strict=True).status_code, 200)

    def test_rejects_an_empty_document(self):
        for html in (None, "", "   ", 42):
            with self.subTest(html=html):
                response = self.client.post("/render", headers=AUTH, json={"html": html})
                self.assertEqual(response.status_code, 400)

    def test_reports_a_render_failure_rather_than_crashing(self):
        with patch.object(app.HTML, "render", side_effect=RuntimeError("boom")):
            response = self.render()
        self.assertEqual(response.status_code, 500)
        self.assertIn("render_failed", response.get_json()["error"])


class WarningHeaderTests(unittest.TestCase):
    def test_a_warning_carrying_a_newline_cannot_split_the_header(self):
        # These strings contain CSS copied out of the request. A header value is
        # not a place to trust input.
        encoded = app._header_safe(["Ignored `content: \"a\r\nSet-Cookie: x=1\"`"])
        self.assertNotIn("\r", encoded)
        self.assertNotIn("\n", encoded)
        self.assertEqual(len(json.loads(encoded)), 1)

    def test_truncates_to_something_a_caller_can_still_parse(self):
        encoded = app._header_safe([f"warning number {i} " + "x" * 200 for i in range(200)])
        self.assertLessEqual(len(encoded), app.MAX_WARNING_HEADER_CHARS + 200)
        parsed = json.loads(encoded)  # still valid JSON, not a cut string
        self.assertIn("more, see the service log", parsed[-1])

    def test_keeps_every_warning_when_they_fit(self):
        self.assertEqual(json.loads(app._header_safe(["a", "b"])), ["a", "b"])


class OptionTests(unittest.TestCase):
    def test_drops_an_option_this_engine_does_not_know(self):
        with self.assertLogs(app.log, level="WARNING") as captured:
            kept = app._supported_options({"pdf_tags": True, "tagged": True, "nonsense": 1})
        self.assertEqual(kept, {"pdf_tags": True})
        self.assertIn("nonsense", "\n".join(captured.output))

    def test_says_nothing_when_every_option_is_known(self):
        self.assertEqual(
            app._supported_options({"pdf_tags": True, "optimize_images": False}),
            {"pdf_tags": True, "optimize_images": False},
        )


@patch.object(app, "EXPECTED_TOKEN", "test-token")
class CapabilitiesTests(unittest.TestCase):
    """The engine is asked, not assumed.

    `engineSupport.pure.ts` carries a list of constructs the stylesheet must
    never emit. A list like that rots the moment the engine moves. This endpoint
    is how it is checked against the engine that is actually deployed.
    """

    def setUp(self):
        self.client = app.app.test_client()

    def test_requires_authentication(self):
        self.assertEqual(self.client.get("/capabilities").status_code, 401)

    def test_reports_the_constructs_this_engine_drops(self):
        dropped = self.client.get("/capabilities", headers=AUTH).get_json()["dropped"]
        for name in (
            "box-shadow", "filter", "backdrop-filter", "word-break-break-word",
            "position-sticky", "text-wrap-balance", "aspect-ratio",
            "mix-blend-mode", "writing-mode",
        ):
            self.assertTrue(dropped[name], f"{name} is expected to be dropped and was not")

    def test_reports_the_constructs_the_design_system_depends_on(self):
        # If one of these ever reads as dropped, the layout primitives have
        # stopped working and the reports are not reports.
        dropped = self.client.get("/capabilities", headers=AUTH).get_json()["dropped"]
        for name in (
            "flex", "grid", "border-radius", "linear-gradient", "hyphens",
            "break-inside", "running-string", "calc-width",
        ):
            self.assertFalse(dropped[name], f"{name} is load-bearing and this engine drops it")

    def test_accepts_a_caller_supplied_probe_set(self):
        # So the repo's list can be checked without redeploying this service.
        response = self.client.post(
            "/capabilities", headers=AUTH,
            json={"probes": {"shadow": "box-shadow: 0 1pt 2pt #000", "pad": "padding: 4pt"}},
        )
        self.assertEqual(response.get_json()["dropped"], {"shadow": True, "pad": False})

    def test_rejects_a_probe_set_that_is_not_declarations(self):
        for probes in ({"a": 1}, [], "x", {str(i): "padding: 1pt" for i in range(201)}):
            with self.subTest(probes=probes):
                response = self.client.post("/capabilities", headers=AUTH, json={"probes": probes})
                self.assertEqual(response.status_code, 400)

    def test_names_the_brand_faces_it_can_resolve(self):
        # A font-family naming nothing installed produces no warning at all, so
        # this is the only runtime signal that the type is what was designed.
        fonts = self.client.get("/capabilities", headers=AUTH).get_json()["fonts"]
        self.assertEqual(sorted(fonts), sorted(app.BRAND_FAMILIES))


class WarmUpTests(unittest.TestCase):
    def test_a_failing_warm_up_does_not_stop_the_service(self):
        with patch.object(app.HTML, "write_pdf", side_effect=RuntimeError("no fonts")):
            with self.assertLogs(app.log, level="WARNING"):
                app.warm_up()  # must not raise


if __name__ == "__main__":
    unittest.main()
