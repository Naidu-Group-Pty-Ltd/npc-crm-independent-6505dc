/**
 * How an earlier conversion reads in the history panel.
 *
 * Every case here is a state the panel actually reaches and gets wrong if the
 * logic is naive: a conversion that failed, one that was never rendered, and
 * one whose stored object has gone missing so re-signing produced no URL.
 */
import { describe, expect, it } from 'vitest';
import { describeConversionRow, formatBytes } from '../conversionRows.pure';
import type { ConvertListRow } from '../route.pure';

const row = (patch: Partial<ConvertListRow> = {}): ConvertListRow => ({
  id: 'c1',
  status: 'succeeded',
  sourceFilename: 'Borrowing Power.pdf',
  fileName: 'Borrowing_Power_converted.pdf',
  boundFormat: 'borrowing-capacity',
  formatName: 'Borrowing Capacity Assessment',
  designSystemName: 'Warm Editorial',
  pageCount: 13,
  bytes: 240_000,
  boundChapters: 5,
  unfilledChapters: 2,
  appendixSections: 4,
  enrichedChapters: 0,
  fidelity: null,
  enrichmentModel: null,
  bindingSource: null,
  unstructured: false,
  error: null,
  createdAt: '2026-08-04T00:00:00.000Z',
  url: 'https://example.test/signed.pdf',
  ...patch,
});

describe('the design-pass chips', () => {
  it('says nothing about a conversion made before the design pass existed', () => {
    // Every such row has `enrichment_model` null. Captioning it "0 designed"
    // would report a failure that never happened.
    const view = describeConversionRow(row());
    expect(view.chips.join(' ')).not.toMatch(/designed/i);
  });

  it('says how many chapters were designed, and in which mode', () => {
    const view = describeConversionRow(row({
      enrichedChapters: 4, enrichmentModel: 'claude-opus-4-8', fidelity: 'connective',
    }));
    expect(view.chips).toContain('4 designed');
    expect(view.chips).toContain('Add connecting lines');
  });

  it('says so when the pass ran and every chapter fell back', () => {
    // The case worth knowing about: a model ran, cost eleven seconds, and the
    // document is exactly the flat output it would have been without one.
    const view = describeConversionRow(row({
      enrichedChapters: 0, enrichmentModel: 'claude-opus-4-8', fidelity: 'restructure',
    }));
    expect(view.chips).toContain('Not designed');
  });

  it('flags a binding that was matched on wording rather than proposed', () => {
    expect(describeConversionRow(row({ bindingSource: 'scorer' })).chips)
      .toContain('matched on wording');
    expect(describeConversionRow(row({ bindingSource: 'model' })).chips)
      .not.toContain('matched on wording');
  });
});

describe('describeConversionRow', () => {
  it('reads a rendered conversion as openable', () => {
    const view = describeConversionRow(row());
    expect(view.tone).toBe('success');
    expect(view.canOpen).toBe(true);
    expect(view.title).toBe('Borrowing_Power_converted.pdf');
    expect(view.error).toBeNull();
  });

  it('surfaces a failure and offers nothing to open', () => {
    const view = describeConversionRow(row({ status: 'failed', error: 'WeasyPrint refused', url: null }));
    expect(view.tone).toBe('danger');
    expect(view.canOpen).toBe(false);
    expect(view.error).toBe('WeasyPrint refused');
  });

  it('says something even when a failure recorded no reason', () => {
    const view = describeConversionRow(row({ status: 'failed', error: null, url: null }));
    expect(view.error).toBeTruthy();
  });

  it('falls back to the upload name when nothing was rendered', () => {
    const view = describeConversionRow(row({ status: 'review', fileName: '', url: null }));
    expect(view.title).toBe('Borrowing Power.pdf');
    expect(view.canOpen).toBe(false);
    expect(view.statusLabel).toBe('Awaiting review');
  });

  it('keys the Open affordance on the URL, not the status', () => {
    // A row can be `succeeded` and still have no link — the stored object has
    // gone missing and re-signing failed. Offering an Open button that 404s is
    // worse than offering none.
    const view = describeConversionRow(row({ url: null }));
    expect(view.tone).toBe('success');
    expect(view.canOpen).toBe(false);
  });

  it('omits the appendix chip when there is no appendix', () => {
    // A `+0 appendix` chip on every row is noise that trains people to stop
    // reading the chips.
    const withNone = describeConversionRow(row({ appendixSections: 0 }));
    expect(withNone.chips.some((c) => c.includes('appendix'))).toBe(false);

    const withSome = describeConversionRow(row({ appendixSections: 4 }));
    expect(withSome.chips).toContain('+4 appendix');
  });

  it('reports bound out of what the format wanted', () => {
    // 5 of 7, not 5 of 11 — the appendix was never something the format asked
    // for, so counting it would make every conversion look badly bound.
    expect(describeConversionRow(row()).chips).toContain('5/7 bound');
  });

  it('flags a source that had no headings', () => {
    expect(describeConversionRow(row({ unstructured: true })).chips).toContain('no headings');
  });

  it('never emits an empty chip', () => {
    const bare = describeConversionRow(row({
      formatName: null,
      designSystemName: null,
      pageCount: null,
      bytes: null,
      boundChapters: 0,
      unfilledChapters: 0,
      appendixSections: 0,
    }));
    expect(bare.chips.every((c) => c.trim().length > 0)).toBe(true);
  });
});

describe('formatBytes', () => {
  it('scales, and says nothing about nothing', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
  });
});
