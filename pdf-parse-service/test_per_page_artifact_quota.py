"""Regression coverage for the per-job Storage object-write quota."""

import asyncio

import pytest

import app


def _payload(*page_numbers):
    pages = [{"page_no": page_no} for page_no in page_numbers]
    artifacts = {
        page_no: {
            "docling": {},
            "blocks": {},
            "tables": {},
            "ocr": {},
            "pictures": {},
            "vectors": {},
            "summary": {},
        }
        for page_no in page_numbers
    }
    return {
        "job_id": "job-1",
        "page_count": len(pages),
        "pages": pages,
        "artifacts_by_page": artifacts,
        "validation": {"ok": True, "problems": []},
    }


def test_upload_rejects_oversized_payload_before_storage_writes(monkeypatch):
    uploads = []

    async def fake_upload(*args):
        uploads.append(args)
        return args[1]

    monkeypatch.setattr(app, "MAX_PER_PAGE_ARTIFACT_PAGES", 1)
    monkeypatch.setattr(app, "_storage_upload", fake_upload)

    with pytest.raises(app.SidecarError) as exc:
        asyncio.run(app._upload_per_page_docling_artifacts(None, "job-1", _payload(1, 2)))

    assert exc.value.status_code == 413
    assert exc.value.error_code == "per_page_artifact_limit_exceeded"
    assert uploads == []


def test_builder_applies_quota_to_global_chunk_page_numbers(monkeypatch):
    monkeypatch.setattr(app, "MAX_PER_PAGE_ARTIFACT_PAGES", 2)

    with pytest.raises(app.SidecarError) as exc:
        app._build_per_page_docling_artifacts(
            {"pages": {"1": {}}},
            job_id="job-1",
            global_page_offset=2,
        )

    assert exc.value.error_code == "per_page_artifact_limit_exceeded"


def test_upload_preserves_all_artifacts_within_quota(monkeypatch):
    uploads = []

    async def fake_upload(_client, path, _body, _mime):
        uploads.append(path)
        return path

    monkeypatch.setattr(app, "MAX_PER_PAGE_ARTIFACT_PAGES", 1)
    monkeypatch.setattr(app, "_storage_upload", fake_upload)

    result = asyncio.run(app._upload_per_page_docling_artifacts(None, "job-1", _payload(1)))

    assert len(uploads) == 8
    assert uploads[-1] == "job-1/pages-manifest.json"
    assert result["per_page_docling_page_count"] == 1
    assert result["per_page_docling_validation"]["ok"] is True
