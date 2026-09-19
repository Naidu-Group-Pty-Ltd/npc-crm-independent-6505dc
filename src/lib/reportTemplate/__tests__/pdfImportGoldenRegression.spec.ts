/**
 * Tier 1 — pure golden regression (Path-to-100 v2 · C10).
 *
 * Always-CI, deterministic. Pins the three-tier taxonomy + its CI-safety
 * invariant, the live-corpus manifest loader (which must refuse inline/committed
 * PDF bytes), and a small golden end-to-end assertion tying the C5/C6 output
 * policy to the real HTML renderer (the anti-duplication guarantee).
 */
import { describe, it, expect } from 'vitest';
import {
  GOLDEN_REGRESSION_TIERS,
  GOLDEN_REGRESSION_TIERS_VERSION,
  resolveActiveTiers,
  isGoldenLiveEnabled,
  tierCiSafetyViolations,
  parseGoldenLiveCorpusManifest,
  PDF_IMPORT_GOLDEN_LIVE_FLAG,
} from '../ingestion/goldenCorpus';
import { renderTemplateToHtml } from '../htmlRenderer';
import { parseTemplate } from '../templateSchema';
import { pixelFallbackPolicy, nativePolicy } from '../rendering/pdfImportPagePolicy';

describe('three-tier taxonomy', () => {
  it('defines all three tiers with a stable version', () => {
    expect(GOLDEN_REGRESSION_TIERS_VERSION).toBe('golden-regression-tiers-v1');
    expect(Object.keys(GOLDEN_REGRESSION_TIERS).sort()).toEqual(['tier-1-pure', 'tier-2-browser', 'tier-3-live']);
  });

  it('only Tier 1 runs in CI; the live tier is env-gated and reads the client corpus', () => {
    expect(GOLDEN_REGRESSION_TIERS['tier-1-pure'].runsInCi).toBe(true);
    expect(GOLDEN_REGRESSION_TIERS['tier-2-browser'].runsInCi).toBe(false);
    const live = GOLDEN_REGRESSION_TIERS['tier-3-live'];
    expect(live.runsInCi).toBe(false);
    expect(live.usesLiveServices).toBe(true);
    expect(live.usesClientCorpus).toBe(true);
    expect(live.gate).toBe('PDF_IMPORT_GOLDEN_LIVE=1');
  });

  it('resolves active tiers by environment', () => {
    expect(resolveActiveTiers({})).toEqual(['tier-1-pure']);
    expect(resolveActiveTiers({}, { browser: true })).toEqual(['tier-1-pure', 'tier-2-browser']);
    expect(resolveActiveTiers({ [PDF_IMPORT_GOLDEN_LIVE_FLAG]: '1' })).toEqual(['tier-1-pure', 'tier-3-live']);
    expect(resolveActiveTiers({ [PDF_IMPORT_GOLDEN_LIVE_FLAG]: '1' }, { browser: true }))
      .toEqual(['tier-1-pure', 'tier-2-browser', 'tier-3-live']);
  });

  it('recognizes the live flag only when truthy', () => {
    expect(isGoldenLiveEnabled({ [PDF_IMPORT_GOLDEN_LIVE_FLAG]: '1' })).toBe(true);
    expect(isGoldenLiveEnabled({ [PDF_IMPORT_GOLDEN_LIVE_FLAG]: 'true' })).toBe(true);
    expect(isGoldenLiveEnabled({ [PDF_IMPORT_GOLDEN_LIVE_FLAG]: '0' })).toBe(false);
    expect(isGoldenLiveEnabled({})).toBe(false);
  });

  it('INVARIANT: no CI-running tier touches live services or the client corpus', () => {
    expect(tierCiSafetyViolations()).toEqual([]);
  });
});

describe('live-corpus manifest loader — never inline / committed PDFs', () => {
  it('parses valid relative .pdf references', () => {
    const res = parseGoldenLiveCorpusManifest({
      entries: [
        { id: 'a', category: 'simple_one_page', file: 'a.pdf', expectedPageCount: 1 },
        { id: 'b', category: 'multi_page_report', file: 'sub/b.pdf' },
      ],
    }, '/local/corpus');
    expect(res.entries).toHaveLength(2);
    expect(res.problems).toEqual([]);
    expect(res.entries[0].expectedPageCount).toBe(1);
    expect(res.entries[1].expectedPageCount).toBeNull();
  });

  it('refuses inline PDF bytes, absolute paths, traversal, and non-pdf files', () => {
    const res = parseGoldenLiveCorpusManifest({
      entries: [
        { id: 'inline', file: 'data:application/pdf;base64,AAAA' },
        { id: 'abs', file: '/etc/passwd.pdf' },
        { id: 'trav', file: '../secret.pdf' },
        { id: 'notpdf', file: 'a.png' },
      ],
    }, '/local/corpus');
    expect(res.entries).toHaveLength(0);
    expect(res.problems.join(' ')).toMatch(/inline PDF bytes/);
    expect(res.problems.join(' ')).toMatch(/absolute path/);
    expect(res.problems.join(' ')).toMatch(/traverse/);
    expect(res.problems.join(' ')).toMatch(/must be a \.pdf/);
  });

  it('rejects duplicate / missing ids and a missing entries array', () => {
    const dup = parseGoldenLiveCorpusManifest({ entries: [{ id: 'x', file: 'x.pdf' }, { id: 'x', file: 'y.pdf' }] }, '/c');
    expect(dup.entries).toHaveLength(1);
    expect(dup.problems.join(' ')).toMatch(/duplicate id/);
    expect(parseGoldenLiveCorpusManifest({}, '/c').problems).toEqual(['manifest has no `entries` array']);
  });
});

describe('golden end-to-end — output policy renders exactly one visual copy', () => {
  const RASTER = 'https://x/page-001.png';
  const MARKER = 'GOLDEN_NATIVE_TEXT';

  function page(meta: Record<string, unknown>, background: Record<string, unknown>) {
    return {
      id: 'p1', name: 'P1', size: { width: 595, height: 842 }, background, meta,
      blocks: [{ id: 'b1', type: 'free', props: {}, overlays: [{ id: 'o', type: 'text', x: 20, y: 20, width: 200, height: 30, content: MARKER }] }],
    };
  }

  it('raster-only page paints the raster and omits native content', () => {
    const tpl = parseTemplate({ version: 1, tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [page({ pdfImport: pixelFallbackPolicy() }, { imageUrl: RASTER, underlay: false, opacity: 1, imageFit: 'fill' })] });
    const { html } = renderTemplateToHtml(tpl, { data: {}, editorMode: false });
    expect(html).toContain(RASTER);
    expect(html).not.toContain(MARKER);
  });

  it('native page renders content and no raster', () => {
    const tpl = parseTemplate({ version: 1, tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [page({ pdfImport: nativePolicy('semantic') }, { color: '#ffffff' })] });
    const { html } = renderTemplateToHtml(tpl, { data: {}, editorMode: false });
    expect(html).toContain(MARKER);
    expect(html).not.toContain(RASTER);
  });
});
