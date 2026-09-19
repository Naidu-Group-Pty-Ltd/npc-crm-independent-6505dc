"""Regression tests for the vNext FastAPI entrypoint."""

import os

import app_vnext


def _route(path: str):
    return next(route for route in app_vnext.app.routes if getattr(route, "path", None) == path)


def test_vnext_entrypoint_forces_vnext_runtime_profile():
    assert os.environ["DOCLING_RUNTIME_PROFILE"] == "vnext"


def test_parse_routes_receive_fastapi_background_tasks():
    for path in ("/parse", "/parse-chunk"):
        assert _route(path).dependant.background_tasks_param_name == "background_tasks"
