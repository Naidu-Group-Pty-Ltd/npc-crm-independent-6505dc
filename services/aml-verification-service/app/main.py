"""
AML verification service — face match, liveness signal, MRZ.

Deliberately stateless and storage-free. It accepts images, returns numbers,
and keeps nothing. That is a privacy control, not an oversight: the biometric
record of truth is the Supabase `aml-biometrics` bucket, whose every read is
audited. If this service also persisted images it would become a second,
unaudited copy of the most sensitive data we hold.

It also makes NO decision. It returns scores and thresholds; the edge function
records the outcome and only a human moves the service gate.
"""
from __future__ import annotations

import base64
import binascii
import hmac
import logging
import os
import time
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import models as m
from .mrz import read_mrz

logging.basicConfig(level=os.environ.get("AML_LOG_LEVEL", "INFO"))
log = logging.getLogger("aml-verification")

SERVICE_TOKEN = os.environ.get("AML_SERVICE_TOKEN", "")
MAX_IMAGE_BYTES = int(os.environ.get("AML_MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))

app = FastAPI(
    title="AML verification service",
    version="1.0.0",
    description="Face match, liveness signal and MRZ validation. Stateless.",
)


# ─────────────────────────────── auth ────────────────────────────────────────

def require_token(authorization: Optional[str]) -> None:
    """
    Shared-secret auth.

    Fails CLOSED when unconfigured: a verification service reachable without a
    token would let anyone submit faces for comparison.
    """
    if not SERVICE_TOKEN:
        raise HTTPException(503, "AML_SERVICE_TOKEN is not configured")
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not supplied or not hmac.compare_digest(supplied, SERVICE_TOKEN):
        raise HTTPException(401, "Unauthorized")


# ─────────────────────────────── helpers ─────────────────────────────────────

def decode_image(data_b64: str, label: str) -> np.ndarray:
    if not data_b64:
        raise HTTPException(400, f"{label} is required")
    payload = data_b64.split(",", 1)[1] if data_b64.startswith("data:") else data_b64
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, f"{label} is not valid base64")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f"{label} exceeds {MAX_IMAGE_BYTES} bytes")

    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, f"{label} is not a decodable image")
    # Bound the working size: a 40 MP phone photo costs seconds and buys nothing.
    h, w = img.shape[:2]
    if max(h, w) > 2000:
        scale = 2000 / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img


# ─────────────────────────────── schemas ─────────────────────────────────────

class FaceCompareRequest(BaseModel):
    document_image: str = Field(..., description="base64 image of the ID document")
    selfie_image: str = Field(..., description="base64 selfie")
    reference: Optional[str] = Field(None, description="opaque correlation id, logged only")


class LivenessRequest(BaseModel):
    selfie_image: str
    reference: Optional[str] = None


class MrzRequest(BaseModel):
    document_image: str
    reference: Optional[str] = None


# ─────────────────────────────── routes ──────────────────────────────────────

@app.get("/healthz")
def healthz() -> dict:
    """
    Liveness probe. Reports model USABILITY without loading them.

    It used to report presence, which is a different question: a Git LFS
    pointer exists on disk and satisfies `Path.exists()`, so a container that
    could not verify anybody reported `"status": "ok"`. `model_problem` checks
    the properties a pointer fails, and the reason is named in the response so
    a bad deployment is diagnosable from the probe alone.
    """
    problems = {
        "yunet": m.model_problem(m.YUNET_FILE),
        "sface": m.model_problem(m.SFACE_FILE),
    }
    usable = {name: problem is None for name, problem in problems.items()}
    return {
        "status": "ok" if all(usable.values()) else "degraded",
        "models": usable,
        "model_problems": {n: p for n, p in problems.items() if p is not None},
        "model_dir": str(m.MODEL_DIR),
        "token_configured": bool(SERVICE_TOKEN),
    }


@app.post("/face/compare")
def face_compare(req: FaceCompareRequest, authorization: str = Header(None)) -> dict:
    """
    Compare the document portrait with the selfie.

    Returns a similarity and a verdict of match / no_match / review. `review`
    is a first-class outcome, not a rounding of `no_match` — a borderline
    score is exactly the case a human should see.
    """
    require_token(authorization)
    started = time.time()

    doc = decode_image(req.document_image, "document_image")
    selfie = decode_image(req.selfie_image, "selfie_image")

    doc_face = m.detect_largest_face(doc)
    selfie_face = m.detect_largest_face(selfie)

    problems: list[str] = []
    if doc_face is None:
        problems.append("no_face_in_document")
    if selfie_face is None:
        problems.append("no_face_in_selfie")

    for face, label in ((doc_face, "document"), (selfie_face, "selfie")):
        if face is not None and min(face.box[2], face.box[3]) < m.MIN_FACE_PX:
            problems.append(f"face_too_small_{label}")

    if problems:
        # Not a failed identity check — a failed capture. The distinction
        # matters: this must not consume one of the customer's three attempts
        # for the wrong reason, so it is reported separately.
        return {
            "verdict": "unusable",
            "similarity": None,
            "problems": problems,
            "thresholds": {"match": m.FACE_MATCH_THRESHOLD, "review": m.FACE_REVIEW_THRESHOLD},
            "duration_ms": int((time.time() - started) * 1000),
        }

    emb_doc = m.face_embedding(doc, doc_face)
    emb_selfie = m.face_embedding(selfie, selfie_face)
    similarity = m.cosine_similarity(emb_doc, emb_selfie)

    if similarity >= m.FACE_MATCH_THRESHOLD:
        verdict = "match"
    elif similarity >= m.FACE_REVIEW_THRESHOLD:
        verdict = "review"
    else:
        verdict = "no_match"

    return {
        "verdict": verdict,
        "similarity": round(similarity, 4),
        "thresholds": {"match": m.FACE_MATCH_THRESHOLD, "review": m.FACE_REVIEW_THRESHOLD},
        "quality": {
            "document_sharpness": round(m.laplacian_sharpness(doc), 2),
            "selfie_sharpness": round(m.laplacian_sharpness(selfie), 2),
            "document_face_confidence": round(doc_face.confidence, 4),
            "selfie_face_confidence": round(selfie_face.confidence, 4),
        },
        "model": {"recogniser": m.SFACE_FILE, "detector": m.YUNET_FILE, "licence": "Apache-2.0"},
        "problems": [],
        "duration_ms": int((time.time() - started) * 1000),
    }


@app.post("/face/liveness")
def face_liveness(req: LivenessRequest, authorization: str = Header(None)) -> dict:
    """
    Presentation-attack SIGNAL. Not a verdict.

    Honesty note, carried in the response itself: this uses sharpness and
    screen-replay heuristics, not a trained anti-spoofing model. It will catch
    a photo of a screen or an obviously flat print. It will NOT reliably catch
    a high-quality print attack, a mask, or an injected deepfake. Callers must
    treat `is_real: true` as "nothing obviously wrong", never as proof.
    """
    require_token(authorization)
    started = time.time()

    selfie = decode_image(req.selfie_image, "selfie_image")
    face = m.detect_largest_face(selfie)
    if face is None:
        return {
            "is_real": None,
            "score": None,
            "problems": ["no_face_in_selfie"],
            "confidence": "none",
            "advisory": "No face detected; ask the customer to retake the photo.",
            "duration_ms": int((time.time() - started) * 1000),
        }

    x, y, w, h = face.box
    crop = selfie[max(0, y): y + h, max(0, x): x + w]
    sharpness = m.laplacian_sharpness(crop) if crop.size else 0.0
    moire = m.moire_score(crop) if crop.size else 0.0

    # Blur below this is usually a photo-of-a-photo or a bad capture.
    sharp_ok = sharpness >= float(os.environ.get("AML_MIN_SHARPNESS", "45"))
    moire_ok = moire <= float(os.environ.get("AML_MAX_MOIRE", "0.55"))

    signals = {"sharpness": round(sharpness, 2), "moire_ratio": round(moire, 4)}
    problems = []
    if not sharp_ok:
        problems.append("image_too_blurred")
    if not moire_ok:
        problems.append("possible_screen_replay")

    return {
        "is_real": bool(sharp_ok and moire_ok),
        "score": round(min(1.0, (sharpness / 200.0)) * (1.0 if moire_ok else 0.4), 4),
        "signals": signals,
        "problems": problems,
        "confidence": "low",
        "advisory": (
            "Heuristic signal only — sharpness and screen-replay detection. "
            "Does not detect high-quality print attacks, masks or injected "
            "deepfakes. Must not be used as the sole basis for a pass."
        ),
        "duration_ms": int((time.time() - started) * 1000),
    }


@app.post("/doc/mrz")
def doc_mrz(req: MrzRequest, authorization: str = Header(None)) -> dict:
    """
    Read and validate the machine-readable zone.

    A failed check digit is the single strongest free forgery signal we have.
    An unreadable MRZ returns found=false and is NOT treated as a failure —
    most Australian driver licences carry no ICAO MRZ at all.
    """
    require_token(authorization)
    started = time.time()

    image = decode_image(req.document_image, "document_image")
    result = read_mrz(image)

    return {
        "found": result.found,
        "valid": result.valid,
        "format": result.format,
        "fields": result.fields,
        "checks": result.checks,
        "errors": result.errors,
        "duration_ms": int((time.time() - started) * 1000),
    }


@app.exception_handler(m.ModelUnavailable)
def _model_unavailable(_: Request, exc: m.ModelUnavailable) -> JSONResponse:
    # 503, not 500: the deployment is incomplete, and the caller should retry
    # rather than record a failed verification against the customer.
    log.error("model unavailable: %s", exc)
    return JSONResponse(status_code=503, content={"error": str(exc), "code": "model_unavailable"})
