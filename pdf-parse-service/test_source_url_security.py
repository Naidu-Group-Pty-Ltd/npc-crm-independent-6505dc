"""Regression tests for PDF source URL SSRF protections."""

import socket
import unittest

import httpx

from source_url_security import (
    UnsafeSourceUrl,
    fetch_public_url,
    validate_public_http_url,
)


def public_resolver(host: str, port: int, **_kwargs) -> list[tuple]:
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]


class SourceUrlValidationTests(unittest.TestCase):
    def test_accepts_public_https_url(self) -> None:
        validate_public_http_url(
            "https://documents.example/report.pdf", resolver=public_resolver
        )

    def test_rejects_non_http_scheme_and_credentials(self) -> None:
        for url in (
            "file:///etc/passwd",
            "https://user:secret@documents.example/report.pdf",
        ):
            with self.subTest(url=url), self.assertRaises(UnsafeSourceUrl):
                validate_public_http_url(url, resolver=public_resolver)

    def test_rejects_private_or_special_addresses(self) -> None:
        for address in (
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "224.0.0.1",
            "::1",
            "2001:db8::1",
            "2002:0808:0808::1",
        ):
            with self.subTest(address=address), self.assertRaises(UnsafeSourceUrl):
                validate_public_http_url(
                    f"http://[{address}]/file.pdf"
                    if ":" in address
                    else f"http://{address}/file.pdf"
                )

    def test_rejects_hostname_if_any_resolution_is_not_public(self) -> None:
        def mixed_resolver(_host: str, port: int, **_kwargs) -> list[tuple]:
            return [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", port)),
            ]

        with self.assertRaises(UnsafeSourceUrl):
            validate_public_http_url(
                "https://documents.example/report.pdf", resolver=mixed_resolver
            )


class RedirectValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_private_redirect_before_requesting_it(self) -> None:
        requested_hosts: list[str] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            requested_hosts.append(request.headers["host"])
            return httpx.Response(
                302, headers={"location": "http://169.254.169.254/latest/meta-data"}
            )

        with self.assertRaises(UnsafeSourceUrl):
            await fetch_public_url(
                "https://documents.example/report.pdf",
                resolver=public_resolver,
                transport=httpx.MockTransport(handler),
            )

        self.assertEqual(requested_hosts, ["documents.example"])

    async def test_allows_redirects_between_public_hosts(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            if request.headers["host"] == "documents.example":
                return httpx.Response(
                    302, headers={"location": "https://cdn.example/report.pdf"}
                )
            return httpx.Response(200, content=b"%PDF-1.4")

        response = await fetch_public_url(
            "https://documents.example/report.pdf",
            resolver=public_resolver,
            transport=httpx.MockTransport(handler),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"%PDF-1.4")

    async def test_connects_to_the_address_returned_by_validation(self) -> None:
        requests: list[tuple[str, str, str | None]] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            requests.append(
                (
                    request.url.host,
                    request.headers["host"],
                    request.extensions.get("sni_hostname"),
                )
            )
            return httpx.Response(200, content=b"%PDF-1.4")

        response = await fetch_public_url(
            "https://rebind.example/report.pdf",
            resolver=public_resolver,
            transport=httpx.MockTransport(handler),
        )

        self.assertEqual(
            requests, [("93.184.216.34", "rebind.example", "rebind.example")]
        )
        self.assertEqual(response.url, httpx.URL("https://rebind.example/report.pdf"))


if __name__ == "__main__":
    unittest.main()
