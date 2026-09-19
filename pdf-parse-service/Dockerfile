# Docling-powered PDF parsing sidecar.
# Mirrors the weasyprint-service / render-source sidecar pattern.
#
# Build:  docker build -t pdf-parse-service .
# Run:    docker run -p 8080:8080 -e PDF_PARSE_SERVICE_TOKEN=dev pdf-parse-service
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    DOCLING_ARTIFACTS_PATH=/app/.docling-models \
    OMP_NUM_THREADS=4 \
    PORT=8080

WORKDIR /app

# System deps Docling/pdfium/Pillow need at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libgl1 \
        libglib2.0-0 \
        libjpeg62-turbo \
        zlib1g \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Pre-download Docling models at build time so cold start ≈ container start (no first-request 30s download).
RUN python -c "import importlib.util; spec=importlib.util.find_spec('docling.utils.model_downloader'); print('Docling model predownload skipped: downloader module unavailable') if spec is None else __import__('docling.utils.model_downloader', fromlist=['download_models']).download_models()"

# Runtime application. Copy every top-level Python module so app.py and its
# lazy legacy-runtime imports are present in the production image.
COPY *.py ./

# Fail the image build if the application cannot import inside the container.
RUN python -m py_compile *.py \
    && python -c "import app, docling_runtime_legacy, docling_runtime_protocol; print('runtime imports OK')"

# Cloud Run expects the container to listen on $PORT.
EXPOSE 8080

# 1 worker — Docling pipelines hold large models in memory; scale horizontally instead.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1 --timeout-keep-alive 75"]
