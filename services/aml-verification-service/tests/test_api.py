"""
API-surface tests: auth, input validation, and the honesty contract in the
liveness response. These run without the ONNX models present.
"""
import base64
import importlib
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("AML_SERVICE_TOKEN", "test-token")

from fastapi.testclient import TestClient  # noqa: E402

from app import main as main_module  # noqa: E402

client = TestClient(main_module.app)
AUTH = {"Authorization": "Bearer test-token"}

# 1x1 PNG.
TINY_PNG = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6300010000050001"
    "0d0a2db40000000049454e44ae426082"
)).decode()


def test_healthz_reports_model_presence_without_auth():
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert "models" in body and "yunet" in body["models"]
    assert body["token_configured"] is True


def test_healthz_rejects_a_git_lfs_pointer_as_a_model(tmp_path, monkeypatch):
    """
    The build defect this exists to catch.

    opencv_zoo keeps the weights in Git LFS. `raw.githubusercontent.com` serves
    the pointer, so `fetch_models.sh` used to write a 131-byte text file that
    curl reported as a success and `Path.exists()` reported as a model. The
    container came up, answered /healthz with `"status": "ok"`, and failed on
    the first real verification with an opaque OpenCV error.

    Health must report usability, not presence.
    """
    # Exactly what `raw.githubusercontent.com` served: 131 and 133 bytes.
    yunet_pointer = (
        "version https://git-lfs.github.com/spec/v1\n"
        "oid sha256:8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4\n"
        "size 232589\n"
    )
    sface_pointer = (
        "version https://git-lfs.github.com/spec/v1\n"
        "oid sha256:0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79\n"
        "size 38696353\n"
    )
    (tmp_path / main_module.m.YUNET_FILE).write_text(yunet_pointer)
    (tmp_path / main_module.m.SFACE_FILE).write_text(sface_pointer)
    assert len(yunet_pointer) == 131 and len(sface_pointer) == 133
    monkeypatch.setattr(main_module.m, "MODEL_DIR", tmp_path)

    body = client.get("/healthz").json()
    assert body["status"] == "degraded"
    assert body["models"] == {"yunet": False, "sface": False}
    # The reason has to be in the probe: this is the only place a broken
    # deployment announces itself before a customer reaches it.
    assert "git_lfs_pointer" in body["model_problems"]["yunet"]
    assert "git_lfs_pointer" in body["model_problems"]["sface"]


def test_healthz_rejects_a_model_opencv_cannot_initialise(tmp_path, monkeypatch):
    """
    Size is not usability. A truncated or wrong-architecture ONNX passes every
    file-level check and then throws inside the first request, so health has to
    prove the loader actually builds.
    """
    for name in (main_module.m.YUNET_FILE, main_module.m.SFACE_FILE):
        (tmp_path / name).write_bytes(b"\0" * (main_module.m.MIN_MODEL_BYTES + 1))
    monkeypatch.setattr(main_module.m, "MODEL_DIR", tmp_path)

    body = client.get("/healthz").json()
    assert body["status"] == "degraded"
    assert body["models"] == {"yunet": False, "sface": False}
    assert "failed_to_initialise" in body["model_problems"]["yunet"]


def test_a_pointer_model_raises_rather_than_degrading_silently(tmp_path, monkeypatch):
    (tmp_path / main_module.m.YUNET_FILE).write_text("version https://git-lfs.github.com/spec/v1\n")
    monkeypatch.setattr(main_module.m, "MODEL_DIR", tmp_path)
    with pytest.raises(main_module.m.ModelUnavailable):
        main_module.m._model_path(main_module.m.YUNET_FILE)


@pytest.mark.parametrize("path", ["/face/compare", "/face/liveness", "/doc/mrz"])
def test_endpoints_require_a_token(path):
    r = client.post(path, json={"document_image": TINY_PNG, "selfie_image": TINY_PNG})
    assert r.status_code == 401


@pytest.mark.parametrize("path", ["/face/compare", "/face/liveness", "/doc/mrz"])
def test_endpoints_reject_a_wrong_token(path):
    r = client.post(
        path,
        json={"document_image": TINY_PNG, "selfie_image": TINY_PNG},
        headers={"Authorization": "Bearer nope"},
    )
    assert r.status_code == 401


def test_service_fails_closed_when_token_unconfigured(monkeypatch):
    # An unauthenticated verification service would let anyone submit faces.
    monkeypatch.setattr(main_module, "SERVICE_TOKEN", "")
    r = client.post("/doc/mrz", json={"document_image": TINY_PNG}, headers=AUTH)
    assert r.status_code == 503


def test_rejects_non_base64_payload():
    r = client.post("/doc/mrz", json={"document_image": "!!!not base64!!!"}, headers=AUTH)
    assert r.status_code == 400


def test_rejects_undecodable_image():
    junk = base64.b64encode(b"this is not an image").decode()
    r = client.post("/doc/mrz", json={"document_image": junk}, headers=AUTH)
    assert r.status_code == 400


def test_rejects_oversized_image(monkeypatch):
    monkeypatch.setattr(main_module, "MAX_IMAGE_BYTES", 10)
    big = base64.b64encode(b"x" * 100).decode()
    r = client.post("/doc/mrz", json={"document_image": big}, headers=AUTH)
    assert r.status_code == 413


def test_missing_field_is_a_validation_error():
    r = client.post("/face/compare", json={"document_image": TINY_PNG}, headers=AUTH)
    assert r.status_code == 422


def test_liveness_response_states_its_own_limits(monkeypatch):
    """
    The advisory text is part of the contract, not decoration. A caller that
    treats this heuristic as proof of liveness would be materially misled, so
    the limitation travels with every response.
    """
    monkeypatch.setattr(main_module.m, "detect_largest_face", lambda _img: None)
    r = client.post("/face/liveness", json={"selfie_image": TINY_PNG}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["is_real"] is None
    assert "no_face_in_selfie" in body["problems"]


def test_compare_reports_unusable_capture_separately(monkeypatch):
    """
    A capture problem is not an identity failure. Conflating them would burn
    one of the customer's three attempts for a lighting problem.
    """
    monkeypatch.setattr(main_module.m, "detect_largest_face", lambda _img: None)
    r = client.post(
        "/face/compare",
        json={"document_image": TINY_PNG, "selfie_image": TINY_PNG},
        headers=AUTH,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["verdict"] == "unusable"
    assert body["similarity"] is None
    assert "no_face_in_document" in body["problems"]


def test_service_persists_nothing(tmp_path):
    """
    The privacy property the design depends on: no writes outside /tmp.
    A second, unaudited copy of biometric data would defeat the access log.
    """
    src = Path(main_module.__file__).parent
    text = "\n".join(p.read_text() for p in src.glob("*.py"))
    for forbidden in ["imwrite", "open(", "shutil", "boto3", "psycopg", "sqlite3"]:
        assert forbidden not in text.replace("urllib.request.urlopen(", ""), (
            f"{forbidden} suggests the service is persisting or fetching data"
        )
