#!/usr/bin/env sh
# Fetch the Apache-2.0 licensed models from opencv/opencv_zoo.
#
# These two files are the entire reason this stack is free AND lawful. Do not
# replace them with InsightFace/ArcFace weights (including indirectly, via
# CompreFace or DeepFace defaults) — those are non-commercial research only.
#
# ## Why the media endpoint, and why the hashes
#
# The models are stored in opencv_zoo under **Git LFS**. `raw.githubusercontent.com`
# serves the LFS *pointer* for those paths, not the object: a 131-byte text file
# beginning `version https://git-lfs.github.com/spec/v1`. curl reports success,
# the file lands at the expected path, and every existence check downstream
# passes — including this service's own `/healthz`, which used to stat the path
# and report `"status": "ok"`.
#
# The failure only surfaced at the first real verification, as an opaque
# `cv2.FaceDetectorYN.create` error inside a request. So: fetch from the LFS
# media endpoint, and verify each object against the sha256 the upstream
# pointer declares. A wrong or truncated model now fails the build, loudly,
# rather than becoming a container that looks healthy and cannot verify anyone.
set -eu

MODEL_DIR="${AML_MODEL_DIR:-/models}"

# Pinned upstream revision: opencv_zoo tag 4.10.0, matching the
# opencv-python-headless==4.10.0.84 pin in requirements.txt. A moving `main`
# would let the weights change under a rebuild without the image changing.
ZOO_REV="f88e9b2bafd21f1cad242fb5af6d78f2bcba16a3"

# LFS objects. The `raw.` host returns pointers for these paths — see above.
ZOO="https://media.githubusercontent.com/media/opencv/opencv_zoo/${ZOO_REV}/models"
# Licences are ordinary files, so they come from the ordinary host.
ZOO_RAW="https://raw.githubusercontent.com/opencv/opencv_zoo/${ZOO_REV}/models"

# sha256 of the LFS objects, as declared by the upstream pointers.
YUNET_SHA256="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
SFACE_SHA256="0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"

mkdir -p "$MODEL_DIR"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Reject the specific failure that shipped: LFS pointer text where a model
# should be. Named explicitly so the build says what went wrong rather than
# only that a hash did not match.
is_lfs_pointer() {
  head -c 41 "$1" 2>/dev/null | grep -q "^version https://git-lfs.github.com/spec/v1"
}

# An ONNX protobuf for either of these models is at least 227 KB.
MIN_MODEL_BYTES=65536

size_of() {
  wc -c < "$1" | tr -d ' '
}

# Fetch and verify. Any mismatch removes the file — leaving a bad model on disk
# is what let a broken build masquerade as a working one.
fetch_model() {
  url="$1"; out="$2"; want="$3"
  if [ -f "$out" ] && [ "$(sha256_of "$out")" = "$want" ]; then
    echo "present: $out"
    return
  fi
  echo "fetching: $out"
  curl -fsSL "$url" -o "$out"

  if is_lfs_pointer "$out"; then
    rm -f "$out"
    echo "FATAL: $out is a Git LFS pointer, not a model." >&2
    echo "  The URL must use media.githubusercontent.com/media, not raw." >&2
    exit 1
  fi

  got_size="$(size_of "$out")"
  if [ "$got_size" -lt "$MIN_MODEL_BYTES" ]; then
    rm -f "$out"
    echo "FATAL: $out is $got_size bytes — too small to be a model." >&2
    exit 1
  fi

  got="$(sha256_of "$out")"
  if [ "$got" != "$want" ]; then
    rm -f "$out"
    echo "FATAL: $out failed verification." >&2
    echo "  expected sha256 $want" >&2
    echo "  received sha256 $got" >&2
    exit 1
  fi
  echo "verified: $out ($got_size bytes, sha256 $got)"
}

fetch_licence() {
  url="$1"; out="$2"
  [ -f "$out" ] && return 0
  curl -fsSL "$url" -o "$out" || echo "warning: could not fetch $out" >&2
}

fetch_model "$ZOO/face_detection_yunet/face_detection_yunet_2023mar.onnx" \
            "$MODEL_DIR/face_detection_yunet_2023mar.onnx" "$YUNET_SHA256"
fetch_model "$ZOO/face_recognition_sface/face_recognition_sface_2021dec.onnx" \
            "$MODEL_DIR/face_recognition_sface_2021dec.onnx" "$SFACE_SHA256"

# Apache-2.0 requires the licence and attribution travel with the model.
fetch_licence "$ZOO_RAW/face_recognition_sface/LICENSE" "$MODEL_DIR/LICENSE.sface"
fetch_licence "$ZOO_RAW/face_detection_yunet/LICENSE"   "$MODEL_DIR/LICENSE.yunet"

echo "done. models in $MODEL_DIR"
