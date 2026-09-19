import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOLDEN_CORPUS_REGISTRY,
  GOLDEN_CORPUS_REGISTRY_VERSION,
  GOLDEN_CORPUS_REQUIRED_IDS,
  getGoldenCorpusItem,
  listGoldenCorpusItems,
  validateGoldenCorpusItem,
  validateGoldenCorpusRegistry,
  type GoldenCorpusRegistry,
} from '../ingestion/goldenCorpus';

/** Deep clone the default registry so mutation-based negative tests stay isolated. */
function cloneDefault(): GoldenCorpusRegistry {
  return JSON.parse(JSON.stringify(DEFAULT_GOLDEN_CORPUS_REGISTRY)) as GoldenCorpusRegistry;
}

describe('goldenCorpusRegistry', () => {
  it('pins the registry version', () => {
    expect(DEFAULT_GOLDEN_CORPUS_REGISTRY.version).toBe('pdf-import-golden-corpus-registry-v1');
    expect(DEFAULT_GOLDEN_CORPUS_REGISTRY.version).toBe(GOLDEN_CORPUS_REGISTRY_VERSION);
  });

  it('includes all required corpus IDs', () => {
    const ids = DEFAULT_GOLDEN_CORPUS_REGISTRY.corpus.map((c) => c.corpusId);
    for (const required of GOLDEN_CORPUS_REQUIRED_IDS) {
      expect(ids).toContain(required);
    }
    expect(ids).toEqual(
      expect.arrayContaining([
        'golden-simple-001',
        'golden-design-001',
        'golden-report-001',
        'golden-table-001',
        'golden-image-001',
        'golden-ocr-001',
      ]),
    );
  });

  it('validates the default registry as ok', () => {
    const result = validateGoldenCorpusRegistry(DEFAULT_GOLDEN_CORPUS_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('getGoldenCorpusItem returns the correct item for golden-simple-001', () => {
    const item = getGoldenCorpusItem('golden-simple-001');
    expect(item).not.toBeNull();
    expect(item?.category).toBe('simple_one_page');
  });

  it('getGoldenCorpusItem returns null for an unknown ID', () => {
    expect(getGoldenCorpusItem('does-not-exist')).toBeNull();
    expect(getGoldenCorpusItem('')).toBeNull();
  });

  it('listGoldenCorpusItems returns all items', () => {
    expect(listGoldenCorpusItems()).toHaveLength(DEFAULT_GOLDEN_CORPUS_REGISTRY.corpus.length);
    expect(listGoldenCorpusItems()).toHaveLength(6);
  });

  it('flags duplicate corpus IDs as an error', () => {
    const reg = cloneDefault();
    reg.corpus.push(JSON.parse(JSON.stringify(reg.corpus[0])));
    const result = validateGoldenCorpusRegistry(reg);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'duplicate_corpus_id')).toBe(true);
  });

  it('flags a missing required corpus ID as an error', () => {
    const reg = cloneDefault();
    reg.corpus = reg.corpus.filter((c) => c.corpusId !== 'golden-ocr-001');
    const result = validateGoldenCorpusRegistry(reg);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'missing_required_corpus_id')).toBe(true);
  });

  it('flags a threshold below 0 as an error', () => {
    const reg = cloneDefault();
    reg.corpus[0].scoreThresholds.visualQaMinimum = -0.1;
    const result = validateGoldenCorpusRegistry(reg);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'invalid_threshold')).toBe(true);
  });

  it('flags a threshold above 1 as an error', () => {
    const reg = cloneDefault();
    reg.corpus[0].scoreThresholds.exportParityMinimum = 1.2;
    const result = validateGoldenCorpusRegistry(reg);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'invalid_threshold')).toBe(true);
  });

  it('flags missing mandatory metadata as an error', () => {
    const reg = cloneDefault();
    reg.corpus[0].requiredMetadata = reg.corpus[0].requiredMetadata.filter((k) => k !== 'exportParityStatus');
    const result = validateGoldenCorpusRegistry(reg);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'missing_required_metadata_key')).toBe(true);
  });

  it('allows manual review for golden-ocr-001', () => {
    const item = getGoldenCorpusItem('golden-ocr-001');
    expect(item?.expectedOutcomes.manualReviewAllowed).toBe(true);
  });

  it('expects exactly one page for the simple corpus', () => {
    const item = getGoldenCorpusItem('golden-simple-001');
    expect(item?.pageCountExpectation.mode).toBe('exact');
    expect(item?.pageCountExpectation.exact).toBe(1);
  });

  it('does not pin the multi-page corpus to exactly one page', () => {
    const item = getGoldenCorpusItem('golden-report-001');
    expect(item?.pageCountExpectation.mode).not.toBe('exact');
    expect(['minimum', 'range', 'unknown']).toContain(item?.pageCountExpectation.mode);
    expect(item?.pageCountExpectation.exact).not.toBe(1);
  });

  it('mirrors the committed JSON template exactly', () => {
    const templatePath = resolve(process.cwd(), 'docs/pdf-import/golden-corpus-registry.template.json');
    const template = JSON.parse(readFileSync(templatePath, 'utf8'));
    expect(template).toEqual(DEFAULT_GOLDEN_CORPUS_REGISTRY);
  });

  it('validateGoldenCorpusItem passes for a well-formed item and fails for a bad category', () => {
    const good = getGoldenCorpusItem('golden-table-001')!;
    expect(validateGoldenCorpusItem(good).ok).toBe(true);

    const bad = JSON.parse(JSON.stringify(good));
    bad.category = 'not_a_category';
    const result = validateGoldenCorpusItem(bad);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'invalid_category')).toBe(true);
  });
});
