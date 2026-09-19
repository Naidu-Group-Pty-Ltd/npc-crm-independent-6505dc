/**
 * The Snapshot as HTML.
 *
 * Two groups of assertions. The first is that the findings Phase 0 recorded are
 * actually gone from the output — not fixed in principle, present in the
 * markup. The second is that the document cannot regress into being *drawn*:
 * no positioning, no colour of its own, no bare number.
 *
 * The layout itself was checked by rendering this fixture through WeasyPrint
 * and reading all ten pages. Everything that turned up there is either fixed
 * or written down in `BORROWING_CAPACITY.md` §8.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { writeRenderArtifact } from '../../__tests__/renderArtifact';

import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import { mastheadFor, resolveCompanyBlock } from '@/lib/reportDesign/companyBlock.pure';

import { buildSnapshot } from '../normalise.pure';
import {
  AUDIT_EFFECT,
  DOCUMENT_NAME,
  formatAssessedOn,
  renderBorrowingCapacityDocument,
  renderSnapshotBody,
  type RenderSnapshotInput,
} from '../render.pure';
import {
  SAMPLE_ASSESSMENT,
  SAMPLE_AUDIT_TRAIL,
  SAMPLE_CLIENT_NAME,
  SAMPLE_EXPLANATION,
  SAMPLE_GLOBAL_SETTINGS,
  SAMPLE_SCENARIO_PRESETS,
} from './fixtures/sampleAssessment';

const contact = SAMPLE_GLOBAL_SETTINGS.contactDetails as never;

function input(over: Partial<RenderSnapshotInput> = {}): RenderSnapshotInput {
  return {
    payload: buildSnapshot({
      clientName: SAMPLE_CLIENT_NAME,
      assessment: SAMPLE_ASSESSMENT,
      auditTrail: SAMPLE_AUDIT_TRAIL,
      explanation: SAMPLE_EXPLANATION,
      scenarioPresets: SAMPLE_SCENARIO_PRESETS,
    }),
    palette: resolveReportPalette({ preset: 'signature' }),
    company: resolveCompanyBlock(contact, SAMPLE_GLOBAL_SETTINGS.disclaimer as never),
    masthead: mastheadFor(contact),
    edition: 'VOL. 2026 · ED. 08',
    reference: 'BCS-2026-0801',
    ...over,
  };
}

const body = () => renderSnapshotBody(input());

/**
 * The document, on disk, for the eye.
 *
 * `reports/` is gitignored. Assertions catch what can be written down; page
 * economy, a table that tore across a break, a KPI label that wrapped and
 * dropped its own value below its neighbours' — those were all found by
 * rendering this file through WeasyPrint and reading the pages, and every later
 * phase will need to do the same. Nine other formats now do this too; the whole
 * set is `npx tsx scripts/reports/renderAll.mts`, and `renderArtifact.ts`
 * explains why.
 */
beforeAll(() => {
  writeRenderArtifact('borrowing-capacity', renderBorrowingCapacityDocument(input()));
});

describe('the findings, in the output', () => {
  /**
   * F1. The shipping cover is a raster of our brand, and the generator resolves
   * the tenant's name only to use it in a `catch`. On the golden, page 1 says
   * Naidu and page 8 says Meridian.
   */
  it('carries the tenant on the cover, and us nowhere (F1)', () => {
    const html = renderBorrowingCapacityDocument(input());
    expect(html).toContain('MERIDIAN PROPERTY');
    expect(html).not.toContain('Naidu');
    expect(html).not.toContain('NAIDU');
    expect(html).not.toContain('YOUR DEDICATED PROPERTY PARTNER');
  });

  it('puts the client, the document and the date on the cover (F1)', () => {
    const html = body();
    expect(html).toContain(DOCUMENT_NAME);
    expect(html).toContain('A. &amp; J. Sample');
    expect(html).toContain('01 August 2026');
  });

  /** F2. The shipping audit page renders 6.15% → 8.65% as "$6 → $9, +$3". */
  it('renders an interest rate as a rate (F2)', () => {
    const html = body();
    expect(html).toContain('6.15%');
    expect(html).toContain('8.65%');
    expect(html).toContain('+2.50%');
    expect(html).not.toMatch(/>\$6</);
    expect(html).not.toMatch(/>\$9</);
  });

  /**
   * F3 / F4. Both were consequences of drawing at fixed offsets. The structural
   * answer is that there are no offsets: a table declares columns and the
   * engine measures them.
   */
  it('positions nothing (F3, F4)', () => {
    const html = body();
    expect(html).not.toMatch(/position\s*:/);
    expect(html).not.toMatch(/\bleft\s*:/);
    expect(html).not.toMatch(/\btop\s*:/);
    expect(html).toContain('Example Bank — Investor P&amp;I');
  });

  /**
   * F5. Every colour comes from the resolved palette, which is contrast-audited
   * as a whole.
   *
   * Charts do carry colour in the markup — an SVG `fill` cannot be a class —
   * so the assertion is not "no colour" but the property that actually
   * matters: **every colour in the document traces to the palette.** A hex the
   * format chose for itself is exactly what put three golds and two ambers in
   * the shipping generators (F7), and it is what this catches.
   */
  it('names no colour the palette did not give it (F5)', () => {
    const { palette } = input();
    const allowedHex = new Set(Object.values(palette).map((c) => c.toUpperCase()));
    const allowedRgb = new Set(
      [...allowedHex].map((hex) => {
        const n = Number.parseInt(hex.slice(1), 16);
        return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
      }),
    );

    const html = body();
    for (const hex of html.match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
      expect(allowedHex, `${hex} is not a palette colour`).toContain(hex.toUpperCase());
    }
    for (const rgba of html.match(/rgba?\(([^)]*)\)/g) ?? []) {
      const [r, g, b] = rgba.replace(/^rgba?\(|\)$/g, '').split(',').map((v) => v.trim());
      expect(allowedRgb, `${rgba} is not a palette colour`).toContain(`${r},${g},${b}`);
    }
  });

  it('carries no inline style but the cover hero and the disclaimer size', () => {
    for (const attr of body().match(/style="[^"]*"/g) ?? []) {
      expect(attr).toMatch(/background-image|font-size|font-variant-numeric/);
    }
  });

  /**
   * F6. The HEM floor's delta is `+$700` and it *reduces* what can be borrowed.
   * The shipping report draws it green. Here it says so.
   */
  it('says which way each adjustment moves capacity, in words (F6)', () => {
    const html = body();
    expect(html).toContain('+$700/mo');
    expect(html).toContain(AUDIT_EFFECT.adverse);
    // …and the sentence that makes the one-word column mean something.
    expect(html).toContain('can be an increase and still reduce what can be borrowed');
  });

  /** F10. Income the lender counts none of. */
  it('shows a zero shading rate as 0% (F10)', () => {
    expect(body()).toContain('Unbanked cash income');
    expect(body()).toMatch(/>0%</);
  });

  /**
   * F11. The page number comes from `counter(page) / counter(pages)`, generated
   * by the engine. The shipping generator computes `totalPgs - 2` and is wrong
   * by one whenever the disclaimer page fails to render.
   */
  it('never computes its own page count (F11)', () => {
    const css = renderBorrowingCapacityDocument(input());
    expect(css).toContain('counter(page, decimal-leading-zero)');
    expect(css).toContain('counter(pages, decimal-leading-zero)');
  });

  /** F13. A balance and a monthly repayment have no difference. */
  it('prints no delta between a balance and a repayment (F13)', () => {
    const html = body();
    expect(html).toContain('Liabilities — Credit Card');
    expect(html).not.toContain('-$7,760');
  });

  /**
   * The bug the first render caught: for that same row the engine's `impact`
   * is derived from the meaningless delta, so reading it naively concludes a
   * credit card *increases* borrowing capacity.
   */
  it('does not call a credit card good for capacity', () => {
    const html = body();
    const row = html.slice(html.indexOf('Liabilities — Credit Card'));
    expect(row.slice(0, 400)).toContain(AUDIT_EFFECT.adverse);
    expect(row.slice(0, 400)).not.toContain(AUDIT_EFFECT.favourable);
  });

  /** F14. Two zeroes that mean "not applicable". */
  it('prints an inapplicable entry as em dashes (F14)', () => {
    const html = body();
    const row = html.slice(html.indexOf('Lender Profile'));
    expect(row.slice(0, 300)).not.toContain('$0');
    expect(row.slice(0, 300)).toContain('—');
  });
});

describe('typography of figures', () => {
  it('states a period once in the header rather than on every row', () => {
    const html = body();
    expect(html).toContain('Gross per year');
    // The header carries it, so the cells do not.
    const table = html.slice(html.indexOf('Gross per year'), html.indexOf('ON SHADING'));
    expect(table).toContain('$124,000');
    expect(table).not.toContain(`$124,000\u00A0pa`);
  });

  it('keeps the period on a figure that stands alone', () => {
    // The audit table mixes annual and monthly rows in one column, so there is
    // no header period to hoist — every value has to carry its own.
    const html = body();
    expect(html).toContain(`$20,000\u00A0pa`);
    expect(html).toContain('$4,820/mo');
  });

  it('binds the period to its figure so a narrow column cannot split them', () => {
    expect(body()).not.toContain('$20,000 pa');
  });
});

describe('the document', () => {
  it('is a complete HTML document with one stylesheet', () => {
    const html = renderBorrowingCapacityDocument(input());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).toContain(`<title>${DOCUMENT_NAME} — A. &amp; J. Sample</title>`);
  });

  it('is deterministic', () => {
    expect(renderBorrowingCapacityDocument(input())).toBe(renderBorrowingCapacityDocument(input()));
  });

  it('escapes everything that came from a record', () => {
    const html = renderSnapshotBody(input({
      payload: buildSnapshot({
        clientName: '<script>alert(1)</script>',
        assessment: SAMPLE_ASSESSMENT,
      }),
    }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('opens a chapter per section, in order, with the running head set', () => {
    const html = body();
    const chapters = [...html.matchAll(/data-chapter-title="([^"]+)"/g)].map((m) => m[1]);
    expect(chapters).toEqual([
      'Capacity at a glance',
      'Income and commitments',
      'How the capacity is built',
      'How this was calculated',
      'Audit trail',
      'Scenario comparison',
    ]);
    // The running head's eyebrow is the document, not the section number that
    // the chapter header prints 150px below it.
    for (const eyebrow of [...html.matchAll(/data-eyebrow="([^"]+)"/g)].map((m) => m[1])) {
      expect(eyebrow).toBe(DOCUMENT_NAME);
    }
  });

  /** Row headers are what make a table navigable in a tagged PDF. */
  it('gives every table row a header cell', () => {
    const html = body();
    const rows = html.match(/<tr[^>]*>/g) ?? [];
    const rowHeaders = html.match(/<th scope="row"/g) ?? [];
    const colHeaders = html.match(/<tr><th scope="col"/g) ?? [];
    expect(rows.length).toBe(rowHeaders.length + colHeaders.length);
  });

  it('renders every section a payload turns on, and no others', () => {
    const minimal = renderSnapshotBody(input({
      payload: buildSnapshot({ clientName: 'Nobody', assessment: SAMPLE_ASSESSMENT }),
    }));
    expect(minimal).toContain('Capacity at a glance');
    expect(minimal).not.toContain('Audit trail');
    expect(minimal).not.toContain('Scenario comparison');
    expect(minimal).not.toContain('How this was calculated');
  });

  it('survives an assessment with nothing in it', () => {
    const html = renderBorrowingCapacityDocument(input({
      payload: buildSnapshot({ clientName: 'Nobody', assessment: {} }),
    }));
    expect(html).toContain('Capacity at a glance');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });
});

describe('the ledger', () => {
  /**
   * The ledger is the one table that colours by sign, via `signedKeys`. That is
   * only safe because every adverse line is also printed negative — which is
   * true by construction and asserted here, so the day it stops being true the
   * colouring is caught rather than quietly becoming F6 again.
   */
  it('signs every adverse line negative, which is what makes sign-colouring safe', () => {
    for (const row of input().payload.ledger) {
      if (row.direction === 'adverse') expect(row.amount.value).toBeLessThan(0);
      if (row.direction === 'favourable') expect(row.amount.value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('formatAssessedOn', () => {
  it('reads an ISO timestamp without a Date', () => {
    expect(formatAssessedOn('2026-08-01T00:00:00.000Z')).toBe('01 August 2026');
    expect(formatAssessedOn('2026-12-25')).toBe('25 December 2026');
  });

  it('returns nothing it cannot read, rather than guessing', () => {
    expect(formatAssessedOn('')).toBe('');
    expect(formatAssessedOn('not a date')).toBe('');
    expect(formatAssessedOn('2026-13-01')).toBe('');
  });
});
