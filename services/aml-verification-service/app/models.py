"""
Model loading and inference for the zero-cost verification stack.

Every model used here is Apache-2.0 **including its weights**. That is not
incidental — it is the whole reason this stack exists. See
docs/aml/kyc-zero-cost-solution.md and NOTICE.

Do NOT swap in InsightFace/ArcFace weights (including via CompreFace or
DeepFace defaults): those are licensed for non-commercial research only and
would make this deployment a licence breach.
"""
from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger(__name__)

MODEL_DIR = Path(os.environ.get("AML_MODEL_DIR", "/models"))

# Apache-2.0 weights, from opencv/opencv_zoo.
YUNET_FILE = "face_detection_yunet_2023mar.onnx"
SFACE_FILE = "face_recognition_sface_2021dec.onnx"

# SFace cosine similarity. OpenCV's reference threshold for this model is
# 0.363; we hold two thresholds so that "not a match" and "needs a human" are
# distinguishable outcomes rather than one bucket.
FACE_MATCH_THRESHOLD = float(os.environ.get("AML_FACE_MATCH_THRESHOLD", "0.363"))
FACE_REVIEW_THRESHOLD = float(os.environ.get("AML_FACE_REVIEW_THRESHOLD", "0.28"))

# Minimum detected face size in pixels. Below this the embedding is unreliable
# and a "match" would be noise dressed as evidence.
MIN_FACE_PX = int(os.environ.get("AML_MIN_FACE_PX", "60"))

_lock = threading.Lock()
_detector = None
_recogniser = None


class ModelUnavailable(RuntimeError):
    """Raised when a model file is missing. Never degrade silently."""


# The smallest of these models is 227 KB and the larger is 37 MB, so anything
# under this bound is not a model at all. In practice it is a Git LFS pointer:
# opencv_zoo stores the weights under LFS, and `raw.githubusercontent.com`
# serves the ~130-byte pointer text rather than the object. That produced a
# container whose models were text files while every existence check — this
# service's own /healthz included — reported it healthy, and the only symptom
# was an opaque OpenCV error inside the first real verification.
#
# Size alone separates the two cases unambiguously, and it costs one stat.
# Sniffing the file's first bytes would be marginally more specific and would
# mean reading inside the service, which `test_service_persists_nothing`
# rightly refuses to allow.
MIN_MODEL_BYTES = 64 * 1024

_LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/v1"

# Which loader proves each model actually initialises. Checking the file is not
# the same as checking OpenCV can build a net from it: a truncated or
# wrong-architecture ONNX passes every file-level test and then throws inside
# the first request.
_INITIALISERS = {
    YUNET_FILE: lambda path: cv2.FaceDetectorYN.create(path, "", (320, 320), 0.9, 0.3, 5000),
    SFACE_FILE: lambda path: cv2.FaceRecognizerSF.create(path, ""),
}

# Health is probed every few seconds; initialising a 37 MB recogniser each time
# would make the probe the most expensive thing the service does. The verdict
# is cached per (path, size, mtime), so a replaced model is re-checked and an
# unchanged one is checked once.
_health_cache: dict[str, tuple[tuple, Optional[str]]] = {}


def model_problem(name: str) -> Optional[str]:
    """
    Why `name` is unusable, or None if OpenCV can actually initialise it.

    Checks in increasing cost: present, not an LFS pointer, plausibly sized,
    and finally that the loader for this model builds without throwing. The
    first three exist so the common failure is named precisely rather than
    surfacing as an opaque OpenCV error.
    """
    p = MODEL_DIR / name
    if not p.exists():
        return "missing"

    stat = p.stat()
    size = stat.st_size

    if size < MIN_MODEL_BYTES:
        # `read_bytes` on a file this small is a few hundred bytes of I/O.
        if p.read_bytes()[:len(_LFS_POINTER_PREFIX)].startswith(_LFS_POINTER_PREFIX):
            return (
                "git_lfs_pointer — scripts/fetch_models.sh must fetch from "
                "media.githubusercontent.com/media, not raw"
            )
        return f"not_a_model ({size} bytes)"

    key = (str(p), size, stat.st_mtime_ns)
    cached = _health_cache.get(name)
    if cached is not None and cached[0] == key:
        return cached[1]

    initialiser = _INITIALISERS.get(name)
    problem: Optional[str] = None
    if initialiser is not None:
        try:
            initialiser(str(p))
        except Exception as exc:  # cv2 raises cv2.error, which is not an OSError
            problem = f"failed_to_initialise: {str(exc)[:200]}"

    _health_cache[name] = (key, problem)
    return problem


def _model_path(name: str) -> Path:
    problem = model_problem(name)
    if problem is not None:
        raise ModelUnavailable(
            f"Model {name} in {MODEL_DIR} is unusable ({problem}). "
            "Run scripts/fetch_models.sh."
        )
    return MODEL_DIR / name


def get_detector(size: tuple[int, int] = (320, 320)):
    """YuNet face detector (Apache-2.0)."""
    global _detector
    with _lock:
        if _detector is None:
            _detector = cv2.FaceDetectorYN.create(
                str(_model_path(YUNET_FILE)), "", size, 0.9, 0.3, 5000
            )
        return _detector


def get_recogniser():
    """SFace recogniser (Apache-2.0 weights — see NOTICE)."""
    global _recogniser
    with _lock:
        if _recogniser is None:
            _recogniser = cv2.FaceRecognizerSF.create(str(_model_path(SFACE_FILE)), "")
        return _recogniser


@dataclass
class DetectedFace:
    box: tuple[int, int, int, int]
    confidence: float
    landmarks: np.ndarray  # raw detector row, needed by alignCrop


def detect_largest_face(image: np.ndarray) -> Optional[DetectedFace]:
    """
    Return the largest detected face, or None.

    Largest rather than highest-confidence: in a selfie or a document crop the
    subject is the dominant face, and confidence alone will sometimes prefer a
    small sharp background face.
    """
    h, w = image.shape[:2]
    detector = get_detector()
    detector.setInputSize((w, h))
    _, faces = detector.detect(image)
    if faces is None or len(faces) == 0:
        return None

    best = max(faces, key=lambda f: float(f[2]) * float(f[3]))
    x, y, fw, fh = (int(best[0]), int(best[1]), int(best[2]), int(best[3]))
    return DetectedFace(box=(x, y, fw, fh), confidence=float(best[-1]), landmarks=best)


def face_embedding(image: np.ndarray, face: DetectedFace) -> np.ndarray:
    """Align, crop and embed a detected face."""
    rec = get_recogniser()
    aligned = rec.alignCrop(image, face.landmarks)
    return rec.feature(aligned)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    rec = get_recogniser()
    return float(rec.match(a, b, cv2.FaceRecognizerSF_FR_COSINE))


def laplacian_sharpness(image: np.ndarray) -> float:
    """
    Variance of the Laplacian — a cheap blur measure.

    Used as a quality gate, not as an anti-spoofing signal. A blurred capture
    produces an unreliable embedding, and telling the customer to retake a
    photo is far better than recording a low-confidence result as a decision.
    """
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    return float(cv2.Laplacian(grey, cv2.CV_64F).var())


def moire_score(image: np.ndarray) -> float:
    """
    Screen-replay heuristic via high-frequency energy in the FFT.

    Photographing a screen introduces regular high-frequency structure (moiré)
    that a real face does not have. This is a WEAK signal and is reported as
    such — see the honesty note in liveness().
    """
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    grey = cv2.resize(grey, (256, 256))
    f = np.fft.fftshift(np.fft.fft2(grey.astype(np.float32)))
    mag = np.log1p(np.abs(f))

    h, w = mag.shape
    cy, cx = h // 2, w // 2
    yy, xx = np.ogrid[:h, :w]
    radius = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)

    high = mag[radius > (min(h, w) * 0.30)]
    total = mag.sum()
    if total <= 0:
        return 0.0
    return float(high.sum() / total)
