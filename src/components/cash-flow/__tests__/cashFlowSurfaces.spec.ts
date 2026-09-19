/**
 * Audit items 2, 14 and 15 — the cash-flow analysis screen.
 *
 * Read the deployed source. Each assertion is about a rule, and each rule is
 * one the screen got wrong.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..', '..');
const modal = readFileSync(
  join(root, 'src', 'components', 'reports', 'CashFlowAnalysisModal.tsx'),
  'utf8',
);
const dropdown = readFileSync(
  join(root, 'src', 'components', 'ui', 'dropdown-menu.tsx'),
  'utf8',
);
const exportMenu = readFileSync(
  join(root, 'src', 'components', 'cash-flow', 'modal', 'CashFlowExportMenu.tsx'),
  'utf8',
);

describe('item 2 — the frozen column stays frozen', () => {
  /**
   * Two passes, and this pins the second. The first pinned each section
   * heading as a sticky inline-block inside a `colSpan={12}` cell — which
   * held the TEXT still, but left those rows with no frozen CELL, and left
   * the two highlighted total rows' sticky cells TRANSLUCENT, so the year
   * figures slid under "After-Tax Cash Flow p/a $" and showed through the
   * tint. The heading now lives in the same kind of frozen cell as every
   * data row — opaque base, band colour as an inner layer — with the other
   * eleven columns as one spanned band beside it. The class contents are
   * `projectionTableGeometry.spec.ts`'s to pin; this file pins that the
   * modal's rows go through them.
   */
  it('no longer puts sticky on a full-width cell', () => {
    expect(modal).not.toMatch(/<TableCell className="sticky left-0[^"]*" colSpan=\{12\}>/);
  });

  it('gives every section heading a real frozen cell', () => {
    const cells = modal.match(/PROJECTION_SECTION_LABEL_CELL_CLASS\}>/g) ?? [];
    // Statistics, Cash Deductions, Non-Cash Deductions, Summary.
    expect(cells).toHaveLength(4);
    // The first pass's mechanism is gone rather than dormant.
    expect(modal).not.toContain('sticky left-0 inline-block');
  });

  it('keeps the band beside it, spanning the eleven year columns', () => {
    const bands = modal.match(/<TableCell className="bg-primary\/5 p-0 sm:p-0" colSpan=\{11\} \/>/g) ?? [];
    expect(bands).toHaveLength(4);
    expect(modal).not.toContain('colSpan={12}');
  });

  it('freezes the highlighted total rows opaquely too', () => {
    const cells = modal.match(/PROJECTION_TOTAL_LABEL_CELL_CLASS\}>/g) ?? [];
    // After-Tax Cash Flow p/a $ and p/w $.
    expect(cells).toHaveLength(2);
  });
});

describe('item 14 — a failure that names itself', () => {
  /**
   * "Export → Send to Client" reported `PDF generation failed. Please try
   * again.` — `SendToClientModal`'s reading of a falsy return. The generator
   * had five ways to produce one; two logged nothing, and the refused upload
   * discarded `uploadResult.error` outright. That refusal was almost certainly
   * `Invalid upload resource`, the fault behind audit items 5, 7 and 8.
   */
  it('never returns a bare null for a fault', () => {
    const fn = modal.slice(
      modal.indexOf('const generateAndUploadCashFlowPDF'),
      modal.indexOf('}, [report, baseFinancialData, finalCashFlowDocument, describeReviewedProjection, produceFinalCashFlowDocument]);'),
    );
    expect(fn).not.toMatch(/^\s*return null;/m);
  });

  it('says which of the five faults it was', () => {
    expect(modal).toMatch(/This report could not be resolved/);
    expect(modal).toMatch(/no financial figures to render/);
    expect(modal).toMatch(/The PDF renderer produced no document/);
  });

  it('surfaces the storage refusal rather than swallowing it', () => {
    expect(modal).toMatch(/throw new Error\(uploadResult\?\.error \|\| 'The document could not be stored\.'\)/);
  });

  it('still binds the upload to its report, which is what fixed the send', () => {
    expect(modal).toMatch(/resourceId: report\.id/);
  });
});

describe('item 15 — a menu may not borrow the page scrollbar', () => {
  it('bounds the dropdown to the room it has', () => {
    expect(dropdown).toMatch(/max-h-\[var\(--radix-dropdown-menu-content-available-height\)\]/);
  });

  it('scrolls inside rather than overflowing the window', () => {
    expect(dropdown).toMatch(/overflow-y-auto rounded-md border p-1/);
    expect(dropdown).not.toMatch(/overflow-hidden rounded-md border p-1/);
  });

  it('keeps the content off the window edge', () => {
    expect(dropdown).toMatch(/collisionPadding = 8/);
    expect(dropdown).toMatch(/collisionPadding=\{collisionPadding\}/);
  });

  it('applies to the submenu too', () => {
    const bounded = dropdown.match(/max-h-\[var\(--radix-dropdown-menu-content-available-height\)\]/g) ?? [];
    expect(bounded).toHaveLength(2);
  });

  it('lets the export menu inherit it', () => {
    // Its own `overflow-hidden` would have won through tailwind-merge and left
    // the panel exactly as it was.
    expect(exportMenu).not.toMatch(/<DropdownMenuContent[^>]*overflow-hidden/);
  });
});
