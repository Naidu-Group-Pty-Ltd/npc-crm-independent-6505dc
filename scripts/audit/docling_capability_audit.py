import importlib
import inspect
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from importlib import metadata

PACKAGE_NAMES = [
    "docling",
    "docling_core",
    "docling_ibm_models",
    "docling_parse",
    "pypdfium2",
    "pypdf",
    "PIL",
    "pillow",
    "numpy",
    "pandas",
    "torch",
    "torchvision",
    "onnxruntime",
    "rapidocr_onnxruntime",
    "rapidocr",
    "easyocr",
    "pytesseract",
    "tesserocr",
    "cv2",
    "opencv_python",
    "transformers",
    "huggingface_hub",
    "sentence_transformers",
    "layoutparser",
    "pdfminer",
    "pdfplumber",
    "camelot",
    "tabula",
]

SENSITIVE_KEYWORDS = ("TOKEN", "KEY", "SECRET", "PASSWORD", "SUPABASE_SERVICE_ROLE")


def dist_version(name: str):
    candidates = [name]
    if name == "PIL":
        candidates.append("Pillow")
    if name == "cv2":
        candidates.append("opencv-python")
    for candidate in candidates:
        try:
            return metadata.version(candidate)
        except Exception:
            pass
    return None


def import_status(name: str):
    item = {
        "import": name,
        "available": False,
        "module_version": None,
        "dist_version": dist_version(name),
        "error": None,
        "file": None,
    }
    try:
        mod = importlib.import_module(name)
        item["available"] = True
        item["module_version"] = getattr(mod, "__version__", None)
        item["file"] = getattr(mod, "__file__", None)
    except Exception as e:
        item["error"] = f"{type(e).__name__}: {e}"
    return item


def run_cmd(cmd):
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        return {
            "cmd": cmd,
            "returncode": proc.returncode,
            "stdout": proc.stdout[:4000],
            "stderr": proc.stderr[:4000],
        }
    except Exception as e:
        return {
            "cmd": cmd,
            "error": f"{type(e).__name__}: {e}",
        }


def class_fields(obj):
    fields = getattr(obj, "model_fields", None)
    if isinstance(fields, dict):
        out = {}
        for key, value in fields.items():
            out[key] = {
                "annotation": str(getattr(value, "annotation", "")),
                "default": repr(getattr(value, "default", None)),
            }
        return out
    return None


def inspect_docling_pipeline_options():
    result = {
        "available": False,
        "classes": {},
        "errors": [],
    }
    try:
        po = importlib.import_module("docling.datamodel.pipeline_options")
        result["available"] = True
        for name in sorted(dir(po)):
            obj = getattr(po, name)
            if not inspect.isclass(obj):
                continue
            interesting = any(token in name.lower() for token in [
                "option",
                "ocr",
                "table",
                "picture",
                "accelerator",
                "pipeline",
                "layout",
                "enrichment",
            ])
            if not interesting:
                continue
            result["classes"][name] = {
                "module": getattr(obj, "__module__", None),
                "fields": class_fields(obj),
                "repr": repr(obj),
            }
    except Exception as e:
        result["errors"].append(f"{type(e).__name__}: {e}")
    return result


def inspect_docling_converter():
    result = {
        "available": False,
        "objects": {},
        "errors": [],
    }
    try:
        dc = importlib.import_module("docling.document_converter")
        result["available"] = True
        for name in ["DocumentConverter", "PdfFormatOption", "InputFormat"]:
            obj = getattr(dc, name, None)
            if obj is None:
                continue
            result["objects"][name] = {
                "repr": repr(obj),
                "module": getattr(obj, "__module__", None),
                "signature": None,
            }
            try:
                result["objects"][name]["signature"] = str(inspect.signature(obj))
            except Exception:
                pass
    except Exception as e:
        result["errors"].append(f"{type(e).__name__}: {e}")
    return result


def inspect_docling_modules():
    result = []
    try:
        docling = importlib.import_module("docling")
        path = getattr(docling, "__path__", None)
        if path:
            import pkgutil
            for module in pkgutil.iter_modules(path):
                result.append(module.name)
    except Exception as e:
        result.append(f"ERROR: {type(e).__name__}: {e}")
    return sorted(result)


def inspect_torch():
    result = {
        "available": False,
        "version": None,
        "cuda_available": None,
        "cuda_device_count": None,
        "mps_available": None,
        "error": None,
    }
    try:
        torch = importlib.import_module("torch")
        result["available"] = True
        result["version"] = getattr(torch, "__version__", None)
        result["cuda_available"] = bool(torch.cuda.is_available())
        result["cuda_device_count"] = int(torch.cuda.device_count()) if hasattr(torch, "cuda") else None
        result["mps_available"] = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
    return result


def redact_env():
    out = {}
    for key, value in sorted(os.environ.items()):
        if any(token in key.upper() for token in SENSITIVE_KEYWORDS):
            out[key] = "<redacted>"
        elif key.startswith(("DOCLING", "ENABLE", "RASTER", "PDF", "PYTHON", "PORT")):
            out[key] = value
    return out


audit = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "python": {
        "version": sys.version,
        "executable": sys.executable,
        "platform": platform.platform(),
    },
    "environment": redact_env(),
    "packages": {name: import_status(name) for name in PACKAGE_NAMES},
    "binaries": {
        "tesseract": run_cmd(["tesseract", "--version"]),
        "python_version": run_cmd([sys.executable, "--version"]),
    },
    "torch": inspect_torch(),
    "docling": {
        "modules": inspect_docling_modules(),
        "converter": inspect_docling_converter(),
        "pipeline_options": inspect_docling_pipeline_options(),
    },
}

print(json.dumps(audit, indent=2, sort_keys=True))

out_path = "/audit-output/docling-capability-audit.json"
try:
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(audit, f, indent=2, sort_keys=True)
    print(f"\nWROTE_JSON={out_path}")
except Exception as e:
    print(f"\nWROTE_JSON_FAILED={type(e).__name__}: {e}")
