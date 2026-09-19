import { describe, expect, it } from 'vitest';
import { judgeBrowserProductionExport } from '../browserExportGuard';

const page = (types: string[]) => ({
  id: 'p1', name: 'Page 1',
  blocks: types.map((type, i) => ({ id: `b${i}`, type, props: {} })),
});

/**
 * RC-3.2 — the rule is absolute: a paying client never receives a placeholder.
 */
describe('browser production export guard', () => {
  it('permits a template every block of which the browser can draw', () => {
    const verdict = judgeBrowserProductionExport({
      pages: [page(['cover', 'text-block', 'data-table', 'kpi-grid', 'footer'])],
    } as never);
    expect(verdict.ok).toBe(true);
  });

  it('REFUSES a placeholder, not merely warns about it', () => {
    // `exportCapability` calls this a warning, which is right for an operator
    // exporting a draft and wrong for a document leaving the building: a
    // dashed box reading "renders in HTML/PDF pipeline" looks deliberate.
    // `sparkline` is still html-first. `definition-list` and `chart-line` were
    // the examples here until RC-3.2 gave them real renderers — which is the
    // guard working, not the guard breaking.
    const verdict = judgeBrowserProductionExport({
      pages: [page(['text-block', 'sparkline'])],
    } as never);
    expect(verdict.ok).toBe(false);
    if (verdict.ok === true) return;
    expect(verdict.blockTypes.join(' ')).toMatch(/sparkline/i);
  });

  it('refuses a block with no renderer at all', () => {
    // `gantt` has never had a jsPDF renderer and no active template uses it,
    // which is exactly the shape this guard exists to catch: a template that
    // WOULD draw a hole.
    const verdict = judgeBrowserProductionExport({
      pages: [page(['text-block', 'gantt'])],
    } as never);
    expect(verdict.ok).toBe(false);
  });

  it('names the blocks for the operator without naming internals to a client', () => {
    const verdict = judgeBrowserProductionExport({
      pages: [page(['swot'])],
    } as never);
    expect(verdict.ok).toBe(false);
    if (verdict.ok === true) return;
    // The reason a person reads carries no block id, no renderer name and no
    // infrastructure vocabulary.
    expect(verdict.reason).not.toMatch(/jspdf|weasy|placeholder block|drawExtras|Cloud Run/i);
    expect(verdict.reason).toMatch(/standard report has been produced instead/i);
  });

  it('permits when there is no template — the standard document has no blocks', () => {
    expect(judgeBrowserProductionExport(null).ok).toBe(true);
    expect(judgeBrowserProductionExport(undefined).ok).toBe(true);
  });
});

describe('what active production templates use', () => {
  /**
   * Every block type the sixteen active `report_templates` rows actually
   * carry, counted from the live schemas rather than from the vocabulary:
   * 877 text-block, 397 footer, 397 page-number, 341 divider, 215
   * markdown-block, 165 data-table, 122 definition-list, 121 callout, 36
   * kpi-grid, 31 two-column, 19 image, 16 disclaimer, 13 toc, 9
   * strengths-watch, 6 hero, 6 chart-line, 4 risk-register, 4 decision-box.
   *
   * The guard has to permit all eighteen, because a refusal here sends a real
   * report to the fallback presentation.
   */
  const ACTIVE_PRODUCTION_BLOCK_TYPES = [
    'text-block', 'footer', 'page-number', 'divider', 'markdown-block',
    'data-table', 'definition-list', 'callout', 'kpi-grid', 'two-column',
    'image', 'disclaimer', 'toc', 'strengths-watch', 'hero', 'chart-line',
    'risk-register', 'decision-box',
  ];

  it('permits every block type the active templates carry', () => {
    const verdict = judgeBrowserProductionExport({
      pages: [page(ACTIVE_PRODUCTION_BLOCK_TYPES)],
    } as never);
    expect(verdict.ok).toBe(true);
  });

  it('permits each of them on its own, so one bad type cannot hide behind the rest', () => {
    const refused = ACTIVE_PRODUCTION_BLOCK_TYPES.filter(
      (type) => !judgeBrowserProductionExport({ pages: [page([type])] } as never).ok,
    );
    expect(refused).toEqual([]);
  });
});
