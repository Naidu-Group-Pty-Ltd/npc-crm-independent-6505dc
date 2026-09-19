/**
 * pdf-page-artifact-contract-v3 (E1) — parent manifest validator + preference.
 *
 * Includes the E2 provider-neutrality proof (Phase 23): a manifest whose scene
 * graph was produced by a hypothetical Docling vNext / Document-AI engine still
 * validates as E1 V3 because the contract never depends on engine-specific field
 * names — only provider-neutral region evidence.
 */
import { describe, it, expect } from 'vitest';
import {
  validatePageArtifactContractV3,
  preferPageArtifactContract,
  PAGE_ARTIFACT_CONTRACT_V2_VERSION,
  PER_PAGE_DOCLING_ARTIFACT_VERSION,
} from '../pdfImport/pageArtifactContractV3.pure';
import { PAGE_ARTIFACT_CONTRACT_VERSION, SOURCE_SCENE_GRAPH_VERSION } from '../pdfImport/sourceSceneGraphV2.pure';

function v3Page(pageNo: number, over: Record<string, unknown> = {}) {
  return {
    page_no: pageNo,
    page_id: `docling-page-${pageNo}`,
    source_path: `job/pages/page-${String(pageNo).padStart(3, '0')}.png`,
    source_sha256: 'a'.repeat(64),
    docling_path: `job/pages/page-${String(pageNo).padStart(3, '0')}/docling.json`,
    blocks_path: `job/pages/page-${String(pageNo).padStart(3, '0')}/blocks.json`,
    summary_path: `job/pages/page-${String(pageNo).padStart(3, '0')}/summary.json`,
    regions_path: `job/pages/page-${String(pageNo).padStart(3, '0')}/regions.json`,
    source_spans_path: `job/pages/page-${String(pageNo).padStart(3, '0')}/source-spans.json`,
    foreground_path: `job/pages/page-${String(pageNo).padStart(3, '0')}/foreground.json`,
    region_crop_paths: {
      [`src-p${String(pageNo).padStart(4, '0')}-chrt-0001-abcd1234`]: `job/pages/page-${String(pageNo).padStart(3, '0')}/regions/src-p${String(pageNo).padStart(4, '0')}-chrt-0001-abcd1234.png`,
    },
    region_count: 3,
    critical_region_count: 1,
    scene_graph_version: SOURCE_SCENE_GRAPH_VERSION,
    complete: true,
    problems: [],
    ...over,
  };
}

function v3Manifest(pages: unknown[], over: Record<string, unknown> = {}) {
  return {
    version: PER_PAGE_DOCLING_ARTIFACT_VERSION,
    artifact_contract_version: PAGE_ARTIFACT_CONTRACT_VERSION,
    scene_graph_version: SOURCE_SCENE_GRAPH_VERSION,
    job_id: 'job',
    page_count: pages.length,
    pages,
    ...over,
  };
}

describe('pdf-page-artifact-contract-v3 manifest validation', () => {
  it('valid, complete V3 → valid_v3 and preferred', () => {
    const r = validatePageArtifactContractV3(v3Manifest([v3Page(1), v3Page(2)]), { jobId: 'job' });
    expect(r.state).toBe('valid_v3');
    expect(r.manifest?.complete).toBe(true);
    expect(r.manifest?.totalCropCount).toBe(2);
    expect(preferPageArtifactContract(r)).toBe('v3');
  });

  it('legacy V2 manifest → legacy_v2 and NOT preferred', () => {
    const r = validatePageArtifactContractV3({
      version: PER_PAGE_DOCLING_ARTIFACT_VERSION,
      artifact_contract_version: PAGE_ARTIFACT_CONTRACT_V2_VERSION,
      page_count: 2, pages: [{ page_no: 1 }, { page_no: 2 }],
    });
    expect(r.state).toBe('legacy_v2');
    expect(preferPageArtifactContract(r)).toBe('v2_legacy');
  });

  it('unknown future contract version → unknown_version', () => {
    const r = validatePageArtifactContractV3({ artifact_contract_version: 'pdf-page-artifact-contract-v9', pages: [] });
    expect(r.state).toBe('unknown_version');
  });

  it('discontinuous page coverage → invalid_v3', () => {
    const r = validatePageArtifactContractV3(v3Manifest([v3Page(1), v3Page(3)], { page_count: 2 }), { jobId: 'job' });
    expect(r.state).toBe('invalid_v3');
    expect(r.problems).toContain('page_numbers_not_continuous');
    expect(preferPageArtifactContract(r)).toBe('v2_legacy');
  });

  it('duplicate page numbers → invalid_v3', () => {
    const r = validatePageArtifactContractV3(v3Manifest([v3Page(1), v3Page(1)]), { jobId: 'job' });
    expect(r.problems).toContain('duplicate_page_numbers');
    expect(r.state).toBe('invalid_v3');
  });

  it('duplicate region crop IDs across pages → invalid_v3', () => {
    const dupCrop = { 'src-dup-0001': 'job/pages/page-002/regions/dup.png' };
    const r = validatePageArtifactContractV3(v3Manifest([
      v3Page(1, { region_crop_paths: { 'src-dup-0001': 'job/pages/page-001/regions/dup.png' } }),
      v3Page(2, { region_crop_paths: dupCrop }),
    ]), { jobId: 'job' });
    expect(r.problems.some((p) => p.startsWith('duplicate_region_id'))).toBe(true);
  });

  it('critical-region crop count mismatch → invalid_v3', () => {
    const r = validatePageArtifactContractV3(v3Manifest([
      v3Page(1, { critical_region_count: 3, region_crop_paths: {} }),
    ]), { jobId: 'job' });
    expect(r.problems.some((p) => p.includes('critical_region_crop_count_mismatch'))).toBe(true);
  });

  it('crop path outside the job prefix → invalid_v3', () => {
    const r = validatePageArtifactContractV3(v3Manifest([
      v3Page(1, { region_crop_paths: { 'src-p0001-chrt-0001-abcd1234': 'other-job/pages/page-001/regions/x.png' } }),
    ]), { jobId: 'job' });
    expect(r.state).toBe('invalid_v3');
    expect(r.problems.some((p) => p.includes('outside_job_prefix'))).toBe(true);
  });

  it('missing regions_path → invalid_v3', () => {
    const r = validatePageArtifactContractV3(v3Manifest([v3Page(1, { regions_path: null })]), { jobId: 'job' });
    expect(r.problems.some((p) => p.includes('regions_path_missing'))).toBe(true);
  });

  it('partial V3 (page marked incomplete) is retained but not preferred', () => {
    const r = validatePageArtifactContractV3(v3Manifest([v3Page(1, { complete: false })]), { jobId: 'job' });
    // structurally consistent but a page is incomplete → valid_v3 shape, not complete → not preferred
    expect(r.manifest?.complete).toBe(false);
    expect(preferPageArtifactContract(r)).toBe('v2_legacy');
  });

  it('non-object → invalid_v3', () => {
    expect(validatePageArtifactContractV3(null).state).toBe('invalid_v3');
    expect(validatePageArtifactContractV3('x').state).toBe('invalid_v3');
  });
});

describe('E2 provider-neutrality (Phase 23)', () => {
  it('a hypothetical Docling vNext / Document-AI manifest validates as E1 V3', () => {
    // Different engine + provider names; the V3 contract does NOT depend on
    // engine-specific field names, so it still validates.
    const manifest = v3Manifest([v3Page(1, {
      // vNext may add richer fields — additive, ignored by the validator.
      engine: 'docling-vnext',
      provider_evidence: [{ provider: 'document-ai', evidenceType: 'table', claims: ['structured_complete'] }],
    })], { engine: 'docling-vnext', engine_version: '9.9.9' });
    const r = validatePageArtifactContractV3(manifest, { jobId: 'job' });
    expect(r.state).toBe('valid_v3');
    expect(r.manifest?.sceneGraphVersion).toBe(SOURCE_SCENE_GRAPH_VERSION);
  });
});
