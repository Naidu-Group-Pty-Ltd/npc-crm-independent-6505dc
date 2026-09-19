# Docling vNext candidate — isolated dependency profile (E2)

This directory is the **isolated** dependency profile + build inputs for the
Docling vNext sidecar candidate. It does **not** affect production: the production
sidecar still builds from `../requirements.txt` (docling==2.14.0) and `../Dockerfile`
(entrypoint `app:app`, runtime profile `legacy`). Nothing here is installed into
the production image.

## Contents

| File | Role |
|---|---|
| `pyproject.toml` | vNext dependency spec — `docling[easyocr]==2.113.0` + PyMuPDF, FastAPI, uvicorn. Groups: default/standard (CPU), `rapidocr`, `vlm`, dev. Python `>=3.11,<3.13`. |
| `uv.lock` | Deterministic resolution (173 packages, hashed). Regenerate with `uv lock`. |
| `model-manifest.json` | Per-build-profile model list (identities/revisions resolved at image build; never model binaries). |
| `capability-baseline.json` | Version research + real docling-core 2.87.1 schema introspection + feature capability baseline. |
| `tests/generate_fixtures.py` | Dependency-free deterministic PDF fixture generator (20 categories). Generator committed; PDFs never committed. |
| `tests/compat_harness.py` | Baseline-vs-vNext conversion harness (conversion runs only when docling is installed). |
| `tests/fixtures/vnext_to_v3_example.json` | Generated example of vNext output → E1 Source Scene Graph V2 / Region V2. |

## Deterministic setup (isolated)

```bash
cd pdf-parse-service/vnext
uv lock                              # regenerate lock (resolution only)
uv sync --locked --no-dev --extra standard   # CPU-standard runtime into .venv
uv run python -c "import docling; from importlib.metadata import version; print(version('docling'))"
```

The container never resolves dependencies at runtime — see `../Dockerfile.vnext`.

## Selected version

- **docling 2.113.0** (latest official stable at execution; requires-python `>=3.10,<4`).
- vNext delegates to `docling-slim[standard]`; the lock pins `docling-core 2.87.1`,
  `docling-parse 7.8.1` (major bump from 3.4.0), `docling-ibm-models 3.13.3`,
  `pypdfium2 5.12.1`, torch/transformers/easyocr. `uv.lock` sha256 recorded in
  `capability-baseline.json`.

## Build targets (do NOT deploy in E2)

```bash
docker build -f ../Dockerfile.vnext --target vnext-cpu-standard -t pdf-parse-vnext:cpu ..
docker build -f ../Dockerfile.vnext --target vnext-cpu-threaded -t pdf-parse-vnext:thr ..
docker build -f ../Dockerfile.vnext --target vnext-vlm          -t pdf-parse-vnext:vlm ..
```

`vnext-cpu-standard` is the default candidate. The VLM target is local-only
(Transformers/GraniteDocling); it installs **no vLLM** and **no remote serving**.

## Guarantees

- Runtime profile is explicit (`DOCLING_RUNTIME_PROFILE`); default absent → `legacy`.
- A failed vNext init raises — never a silent legacy fallback misreported as vNext.
- `enable_remote_services`, `allow_external_plugins`, `trust_remote_code` are hard-off
  and cannot be raised by a parse request.
- Source PDF crops (E1) remain authoritative; vNext provider images/charts are evidence.
