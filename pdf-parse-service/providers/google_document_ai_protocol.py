"""E9 — Google Document AI injected-client protocol.

Requires NO live Google credentials to import or test. The adapter constructs NO
processor resource from client input — processor resource, location and endpoint
come from trusted server configuration only, and are never logged in ordinary
logs. The client is never called during unit tests.
"""
from __future__ import annotations

from typing import Any, Optional, Protocol, runtime_checkable


@runtime_checkable
class GoogleDocumentAiClientProtocol(Protocol):
    def process_document(
        self,
        *,
        processor_resource: str,
        content: bytes,
        mime_type: str,
        field_mask: Optional[str],
        timeout_seconds: float,
    ) -> Any: ...


@runtime_checkable
class GoogleDocumentAiBatchClientProtocol(Protocol):
    def batch_process_document(
        self,
        *,
        processor_resource: str,
        input_uris: list,
        output_uri: str,
        timeout_seconds: float,
    ) -> Any: ...


class GoogleProcessorConfig:
    """Trusted, server-only processor configuration. Never client-derived."""

    def __init__(self, *, processor_type: str, processor_version: Optional[str], location: str, resource_ref: str) -> None:
        self.processor_type = processor_type
        self.processor_version = processor_version
        self.location = location
        # `resource_ref` is a trusted opaque reference; never logged/persisted in diagnostics.
        self._resource_ref = resource_ref

    def resource(self) -> str:
        return self._resource_ref
