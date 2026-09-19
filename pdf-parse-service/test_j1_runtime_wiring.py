"""J1 runtime-wiring proof (invocation-spy + poisoned-legacy).

Proves the highest-priority J1 invariant: under DOCLING_RUNTIME_PROFILE=vnext the
shared conversion boundary `_do_parse` routes through the vNext runtime's
`convert(...)` and NEVER through the legacy `_get_converter`; and that the default
(legacy) profile does the opposite. Uses injected fake runtimes + a poisoned
legacy converter, so no models are required. Requires docling to import app.
"""

import io

import pytest

import app
from docling_runtime_protocol import RuntimeConversionResult
from lane_policy import resolve_execution_policy


def _policy():
    # A lane policy with no doctags/markdown/fitz so the spy path is minimal.
    return resolve_execution_policy("fast_native", "semantic", request_overrides={})


class _SpyVNextRuntime:
    """A fake vNext runtime that records convert() calls and returns a controllable
    result WITHOUT touching docling models."""
    def __init__(self, result):
        self.calls = 0
        self._result = result

    def profile_name(self):
        return "vnext"

    def capabilities(self):
        # Minimal stand-in; resolve_vnext_converter_profile only reads .features.
        return {"features": {}}

    def convert(self, source, profile, page_range=None):
        self.calls += 1
        return self._result


class _SpyLegacyRuntime:
    def __init__(self):
        self.convert_calls = 0

    def profile_name(self):
        return "legacy"

    def convert(self, *a, **k):
        self.convert_calls += 1
        raise AssertionError("legacy runtime.convert should not be called by _do_parse")


@pytest.fixture(autouse=True)
def _restore_runtime():
    saved = app._RUNTIME_OVERRIDE
    saved_get = app._get_converter
    yield
    app._RUNTIME_OVERRIDE = saved
    app._get_converter = saved_get


def test_vnext_routes_to_runtime_not_legacy():
    # vNext runtime returns a failure result → _do_parse must raise the vNext error
    # AFTER calling runtime.convert, and must NOT touch the legacy converter.
    spy = _SpyVNextRuntime(RuntimeConversionResult(
        status="failure", document=None, pages_processed=0, pages_failed=0,
        errors=("simulated",), raw_document=None))
    app._RUNTIME_OVERRIDE = spy

    def _poisoned_get_converter(profile):
        raise AssertionError("legacy path reached")
    app._get_converter = _poisoned_get_converter

    with pytest.raises(app.SidecarError) as exc:
        app._do_parse(b"%PDF-1.4 fake", policy=_policy(), redact_pii=False)
    assert exc.value.error_code == "docling_vnext_convert_failed"
    assert spy.calls == 1                       # vNext convert WAS called
    # (poisoned legacy never raised its AssertionError → legacy path not reached)


@pytest.mark.parametrize("status", ["partial_success", "timeout"])
def test_vnext_non_success_with_document_is_contained(status):
    """Usable partial output must not reach either caller's success path."""
    spy = _SpyVNextRuntime(RuntimeConversionResult(
        status=status,
        document={"pages": {1: {}}, "texts": [], "tables": [], "pictures": []},
        pages_processed=1,
        pages_failed=1,
        errors=("page conversion incomplete",),
        raw_document=object(),
    ))
    app._RUNTIME_OVERRIDE = spy

    with pytest.raises(app.SidecarError) as exc:
        app._do_parse(b"%PDF-1.4 fake", policy=_policy(), redact_pii=False)

    assert exc.value.error_code == "docling_vnext_convert_failed"
    assert status in exc.value.message
    assert spy.calls == 1


def test_poisoned_legacy_not_reached_on_vnext_success_shape():
    # A vNext result with a raw_document proceeds past the runtime call; the legacy
    # converter must never be constructed regardless.
    class _Doc:
        pages = {}
    spy = _SpyVNextRuntime(RuntimeConversionResult(
        status="success", document={"pages": {}, "texts": [], "tables": [], "pictures": []},
        pages_processed=0, pages_failed=0, raw_document=_Doc(),
        engine_identity={"runtime_profile": "vnext", "docling_version": "2.113.0", "adapter_version": "docling-vnext-adapter-v1"}))
    app._RUNTIME_OVERRIDE = spy

    def _poisoned_get_converter(profile):
        raise AssertionError("legacy path reached")
    app._get_converter = _poisoned_get_converter

    out = app._do_parse(b"%PDF-1.4 fake", policy=_policy(), redact_pii=False)
    assert spy.calls == 1
    assert out["engine_identity"]["runtime_profile"] == "vnext"
    assert "docling-2.113.0" in out["engine_version"]


def test_default_profile_uses_legacy_not_vnext():
    # A legacy runtime must send _do_parse to the legacy converter path (spied via a
    # sentinel), never to runtime.convert.
    legacy = _SpyLegacyRuntime()
    app._RUNTIME_OVERRIDE = legacy

    class _Sentinel(Exception):
        pass

    def _sentinel_get_converter(profile):
        raise _Sentinel("legacy converter constructed")
    app._get_converter = _sentinel_get_converter

    with pytest.raises(_Sentinel):
        app._do_parse(b"%PDF-1.4 fake", policy=_policy(), redact_pii=False)
    assert legacy.convert_calls == 0            # vNext runtime.convert NOT called
