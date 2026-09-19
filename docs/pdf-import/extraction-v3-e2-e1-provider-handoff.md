# E2 → E1 provider handoff (Docling vNext → Source Scene Graph V2)

**PDF Extraction V3 · Package E2 — provider-neutral handoff to E1.**

E1 (Source Scene Graph V2 / Page Artifact Contract V3) may be developed on a
parallel branch (`claude/pdf-extraction-v3-e1-source-scene-graph`). E2 does **not**
depend on E1 being merged and does **not** cherry-pick E1 code. This document +
the generated fixture `pdf-parse-service/vnext/tests/fixtures/vnext_to_v3_example.json`
define exactly what the vNext runtime emits so the E1/E2 joint gate can wire them.

## Three distinct layers (never conflated)

1. **vNext provider output** — the normalized Docling 2.113 document
   (`docling_vnext_adapter.normalize_document`): additive over the existing shape,
   with picture classification back-filled from annotations and typed chart
   annotations surfaced as provider evidence.
2. **Authoritative source crop** — E1's own 300-DPI crop rendered from the
   original PDF. The vNext `picture.image` is **evidence only** and never
   overrides the E1 source crop.
3. **Candidate template output** — downstream reconstruction; not part of source
   truth.

## What vNext emits for each E1 contract field

| E1 field (source-region-v2 / …) | vNext source |
|---|---|
| page geometry (`widthPt/heightPt/rotation`) | `DoclingDocument.pages[n].size` |
| source spans (raw + NFC + font + tokens) | `DoclingDocument.texts[]` (`text/orig`, `prov[].bbox`, `formatting`) |
| table topology (`source-table-topology-v2`) | `TableItem.data` (`num_rows/num_cols`, `table_cells[].{start_*_offset_idx, row_span, col_span, column_header, row_header, text, bbox}`) — field names verified present in docling-core 2.87.1 |
| picture / logo region | `PictureItem` (`prov`, `image`, `captions`) |
| picture classification | `PictureItem.annotations` → `PictureClassificationData.predicted_classes` **(moved from the 2.14 `classification` field; the adapter back-fills a legacy-shaped `classification`)** |
| chart region + metadata | typed `PictureItem.annotations` (`PictureBarChartData`/`PictureLineChartData`/…) → `source-chart-metadata-v2` (`crop_only` under the current model set) |
| vectors (`vector-cluster`) | PyMuPDF FITZ pass (unchanged; sidecar-side, not docling) |
| crops | **E1 renders its own** from the source PDF; vNext images are evidence |
| provider references / confidence | `self_ref`, per-item `confidence`, `annotations[].provenance` |
| model versions | `RuntimeConversionResult.engine_identity` (docling version, pipeline family, table mode, ocr engine, converter_key) |

## Canonical region-ID independence

E1 region IDs are `src-p{page:04d}-{type}-{ordinal:04d}-{fnv8}` derived from
**parent-global page number + type + normalized bbox + ordinal** — never from the
vNext provider-local `self_ref` (e.g. `#/tables/0`), which is document-position
dependent and would differ between monolithic and chunked parses. So vNext output
populates E1 regions with the **same** canonical IDs regardless of provider or
chunk execution. This is the property the joint gate must assert.

## Joint-gate mapping proof

The fixture `vnext_to_v3_example.json` shows a vNext table + line-chart picture
mapped into `source-region-v2` (with `<fnv8>`/`<64-hex>` placeholders the real
E1 algorithm fills). At the E1/E2 joint gate, run E1's
`build_page_regions` / `build_source_spans` on a real vNext `model_dump` and
assert: geometry, spans, table topology, picture/chart regions, provider evidence,
crop-required completeness, and chunk-parity IDs all validate against
`pdf-page-artifact-contract-v3`.

## What must NOT happen

- vNext chart CSV / summary is **not** authoritative financial truth (validated separately).
- A chart-extraction failure must **not** remove the source picture/crop.
- vNext must **not** rearrange table cells; E4 arbitrates candidates later.
- No signed URL, source text, or model path crosses into a persisted E1 artifact.
