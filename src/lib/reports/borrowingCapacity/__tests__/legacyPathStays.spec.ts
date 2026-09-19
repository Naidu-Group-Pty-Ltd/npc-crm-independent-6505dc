/**
 * The legacy generator is not deprecated, and this is what stops it becoming so.
 *
 * The Snapshot was migrated onto the design system across six phases, and the
 * migration's own front-end wiring treated the in-browser generator as a
 * *deployment* fallback: reached only when `render-borrowing-capacity-pdf` was
 * absent. That was right for landing the new path and wrong as a resting state —
 * the moment the function was deployed, the generator that has produced this
 * document for the life of the product became unreachable from every button in
 * the app. Nobody decided to retire it; it would simply have stopped happening.
 *
 * These are structural assertions on source, not renders, because that is the
 * property that matters: **every surface that produces this document offers both
 * renderers, and the modules behind the legacy one still exist.** A behavioural
 * test of one button cannot say that about five call sites.
 *
 * `src/lib/reports/cashFlow/__tests__/render.spec.ts` holds the same guard for
 * the Cash Flow report, for the same reason.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

/** The five surfaces that produce a Borrowing Capacity Snapshot. */
const SURFACES = [
  'src/components/borrowing-capacity/ResultsPanel.tsx',
  'src/components/borrowing-capacity/BorrowingCapacityCard.tsx',
  'src/components/borrowing-capacity/scenarios/StrategyScenarioModeling.tsx',
  'src/components/clients/ClientReportsTab.tsx',
] as const;

describe('the in-browser generator still exists', () => {
  it('is where it has always been, with both entry points exported', () => {
    const source = read('src/components/borrowing-capacity/BorrowingCapacityPDFReport.tsx');
    expect(source).toContain('export async function generateBorrowingCapacityPDF');
    expect(source).toContain('export async function fetchAndGenerateBorrowingCapacityPDF');
    expect(source).toContain("import jsPDF from 'jspdf'");
  });

  it('is still re-exported from the barrel, so an importer does not have to know the filename', () => {
    expect(read('src/components/borrowing-capacity/index.ts'))
      .toContain('generateBorrowingCapacityPDF');
  });

  /**
   * The other three live implementations. Two are section packs for other
   * reports and one is the Strategy Rationale Brief; none is superseded by the
   * Snapshot's render route, and deleting one because "the Snapshot moved" would
   * take a different document down with it.
   */
  it.each([
    ['section pack — Formara report', 'src/utils/borrowingCapacityPdfSections.ts'],
    ['section pack — Portfolio report', 'src/utils/borrowingCapacityPdfLibSections.ts'],
    ['Strategy Rationale Brief', 'src/components/borrowing-capacity/scenarios/StrategyRationalePDF.ts'],
  ])('%s is still present', (_label, path) => {
    expect(() => read(path)).not.toThrow();
  });
});

describe('every surface offers both renderers', () => {
  it.each(SURFACES)('%s routes through the shared control or helper', (path) => {
    const source = read(path);
    const usesControl = source.includes('SnapshotDownloadButton');
    const usesBlobHelper = source.includes('snapshotBlob');
    expect(
      usesControl || usesBlobHelper,
      `${path} produces the Snapshot without going through SnapshotDownloadButton `
        + 'or snapshotBlob, so its legacy option is whatever that file happens to do',
    ).toBe(true);
  });

  it.each(SURFACES)('%s hands the shared control a legacy generator to call', (path) => {
    const source = read(path);
    expect(
      /legacy[=:]\s*\{?\s*(?:async\s*)?\(\)/.test(source),
      `${path} does not pass a \`legacy\` generator — the legacy path is unreachable from it`,
    ).toBe(true);
    // Either entry point: `generateBorrowingCapacityPDF` takes data the caller
    // already has, `fetchAndGenerateBorrowingCapacityPDF` loads it first.
    expect(source).toMatch(/[Gg]enerateBorrowingCapacityPDF/);
  });
});

describe('the control puts both in front of the person pressing it', () => {
  const control = read('src/components/borrowing-capacity/SnapshotDownloadButton.tsx');

  it('offers the server render and the legacy layout as two menu items', () => {
    expect(control).toContain("run('server')");
    expect(control).toContain("run('legacy')");
    expect(control).toContain('Download (legacy layout)');
  });

  it('renders the same two choices in both appearances', () => {
    // One `choices` block, used by the split button and the compact menu, so the
    // legacy item cannot be present on one and missing from the other.
    expect(control.match(/const choices = \(/g) ?? []).toHaveLength(1);
    expect(control.match(/\{choices\}/g) ?? []).toHaveLength(2);
  });
});

describe('choosing the legacy layout is a choice, not a fallback', () => {
  const deliver = read('src/lib/reports/borrowingCapacity/deliverSnapshot.ts');

  it('short-circuits to the generator without asking the server', () => {
    expect(deliver).toMatch(/if \(input\.variant === 'legacy'\) return deliverLegacy/);
  });

  /**
   * The narrow undeployed-function fallback stays. It answers a different
   * question — "the route is not there yet" — and `requestSnapshot.ts` is
   * deliberately strict about which failures qualify.
   */
  it('keeps the undeployed-function fallback on the server path', () => {
    const request = read('src/lib/reports/borrowingCapacity/requestSnapshot.ts');
    expect(request).toContain('looksUndeployed');
    // Asserted against the shared predicate rather than against this file's own
    // substring list. That list WAS here, and it was stale: it could not match
    // the message the transport produces for an absent function, so the
    // fallback this spec exists to protect never actually fired. The strictness
    // the comment above describes now lives — and is tested — in
    // `undeployedRoute.spec.ts`.
    expect(request).toContain("from '../undeployedRoute'");
    const shared = read('src/lib/reports/undeployedRoute.ts');
    expect(shared).toContain('function not found');
    // A 500 from a deployed route must never reach the generator.
    expect(shared).not.toMatch(/message\.includes\('500'\)/);
  });
});
