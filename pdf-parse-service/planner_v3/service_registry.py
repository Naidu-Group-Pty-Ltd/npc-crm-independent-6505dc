"""PDF Extraction V3 · E10 — logical service-class registry.

The registry describes WHAT each logical service class can do (capabilities,
region, remote/gpu risk) — never WHERE it runs. Physical URLs and credentials
are resolved separately at run time (see ``routing.resolve_execution_target``),
so the same immutable registry id can back different concrete hosts without
changing any plan identity.

The default registry is fail-closed friendly: it merely DESCRIBES capabilities;
the routing policy (``routing.py``) decides what is actually allowed.
"""
from __future__ import annotations

from .contracts import (
    PDF_SERVICE_CLASS_REGISTRY_VERSION,
    SERVICE_CLASS_DOCAI_AU,
    SERVICE_CLASS_FAST_CPU,
    SERVICE_CLASS_HEAVY_CPU_AU,
    SERVICE_CLASS_RASTER_ONLY,
    SERVICE_CLASS_VLM_GPU_SG,
    SERVICE_CLASS_REGION,
    ServiceClassCapabilityV1,
    ServiceClassRegistryV1,
    stable_hash,
)


def default_service_class_registry() -> ServiceClassRegistryV1:
    """The canonical capability description of the five logical service classes.

    The registry id is a deterministic hash of the capability rows, so any
    capability change partitions plan identity and cache fingerprints.
    """
    classes = (
        ServiceClassCapabilityV1(
            service_class=SERVICE_CLASS_FAST_CPU,
            region=SERVICE_CLASS_REGION[SERVICE_CLASS_FAST_CPU],
            remote=False,
            gpu=False,
            supports_native=True,
            supports_ocr=False,
            supports_tables=True,
            supports_vlm=False,
            supports_raster=True,
        ),
        ServiceClassCapabilityV1(
            service_class=SERVICE_CLASS_HEAVY_CPU_AU,
            region=SERVICE_CLASS_REGION[SERVICE_CLASS_HEAVY_CPU_AU],
            remote=False,
            gpu=False,
            supports_native=True,
            supports_ocr=True,
            supports_tables=True,
            supports_vlm=False,
            supports_raster=True,
        ),
        ServiceClassCapabilityV1(
            service_class=SERVICE_CLASS_DOCAI_AU,
            region=SERVICE_CLASS_REGION[SERVICE_CLASS_DOCAI_AU],
            remote=True,
            gpu=False,
            supports_native=True,
            supports_ocr=True,
            supports_tables=True,
            supports_vlm=False,
            supports_raster=False,
        ),
        ServiceClassCapabilityV1(
            service_class=SERVICE_CLASS_VLM_GPU_SG,
            region=SERVICE_CLASS_REGION[SERVICE_CLASS_VLM_GPU_SG],
            remote=True,
            gpu=True,
            supports_native=True,
            supports_ocr=True,
            supports_tables=True,
            supports_vlm=True,
            supports_raster=True,
        ),
        ServiceClassCapabilityV1(
            service_class=SERVICE_CLASS_RASTER_ONLY,
            region=SERVICE_CLASS_REGION[SERVICE_CLASS_RASTER_ONLY],
            remote=False,
            gpu=False,
            supports_native=False,
            supports_ocr=False,
            supports_tables=False,
            supports_vlm=False,
            supports_raster=True,
        ),
    )
    registry_id = stable_hash(
        "svcreg",
        {
            "version": PDF_SERVICE_CLASS_REGISTRY_VERSION,
            "classes": [c.to_dict() for c in classes],
        },
    )
    return ServiceClassRegistryV1(
        version=PDF_SERVICE_CLASS_REGISTRY_VERSION,
        registry_id=registry_id,
        classes=classes,
    )
