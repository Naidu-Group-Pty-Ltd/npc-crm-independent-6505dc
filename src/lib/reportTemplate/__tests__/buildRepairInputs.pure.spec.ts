/**
 * W0/W1 — the missing textFixes producer.
 *
 * `repairPassesApplied` was 0 on every one of 14 production imports. The repair
 * ops existed and were applied; nothing produced their input, so the branch
 * that consumes textFixes was unreachable. These tests cover the writer, and in
 * particular the rule that makes an automated loop safe to point at a client's
 * document: no evidence, no fix.
 */
import { describe, it, expect } from 'vitest';
import {
  MIN_LINE_HEIGHT,
  buildRepairInputs,
  lineHeightFixFor,
  type MeasuredTextDefect,
} from '@/lib/reportTemplate/ingestion/visualQuality/repair/v2/buildRepairInputs.pure';

const evidence = { kind: 'e7-dom-geometry' as const, ref: 'page-1/overlay-a', hash: 'abc123' };

const defect = (over: Partial<MeasuredTextDefect> = {}): MeasuredTextDefect => ({
  overlayId: 'o1',
  evidence,
  sourceWidthPt: 100,
  renderedWidthPt: 103,
  boxWidthPt: 100,
  charCount: 40,
  fontSizePt: 12,
  ...over,
});

describe('buildRepairInputs — evidence is mandatory', () => {
  it('produces no fix without an evidence reference', () => {
    // A fix traceable to a measured source fact can be reviewed and reversed.
    // One that is not is an unattributed edit to a client's document.
    const missing = [
      { evidence: undefined as never },
      { evidence: { kind: '' as never, ref: 'x', hash: null } },
      { evidence: { kind: 'e7-dom-geometry' as const, ref: '', hash: null } },
    ];
    for (const over of missing) {
      expect(buildRepairInputs([defect(over)]).inputs.textFixes ?? []).toHaveLength(0);
    }
  });

  it('carries the evidence through onto the fix', () => {
    const { inputs } = buildRepairInputs([defect()]);
    expect(inputs.textFixes![0].evidence).toEqual(evidence);
  });
});

describe('buildRepairInputs — maps remedies onto the existing op vocabulary', () => {
  it('emits letter-spacing for a small overrun', () => {
    const fix = buildRepairInputs([defect()]).inputs.textFixes![0];
    expect(fix.letterSpacing).toBeLessThan(0);
    expect(fix.fontSize).toBeUndefined();
  });

  it('emits a bounded font-size change when tracking cannot absorb it', () => {
    const fix = buildRepairInputs([defect({ renderedWidthPt: 103.5, charCount: 2 })])
      .inputs.textFixes![0];
    expect(fix.fontSize).toBeDefined();
    expect(fix.fontSize!.after).toBeLessThan(fix.fontSize!.before);
  });

  it('emits nowrap for a line-count regression, composing with the width fix', () => {
    const fix = buildRepairInputs([defect({ lineCountRegression: true })]).inputs.textFixes![0];
    expect(fix.whiteSpace).toBe('nowrap');
    expect(fix.letterSpacing).toBeLessThan(0);
  });

  it('does not emit a grow-box change it cannot express', () => {
    // 'grow-box' is a geometry change and belongs in overlayBBoxFixes, which
    // needs a source bbox this module is not given. Emitting it as a text fix
    // would silently drop it.
    const { inputs } = buildRepairInputs([
      defect({ renderedWidthPt: 108, availableGrowthPt: 20 }),
    ]);
    expect(inputs.textFixes ?? []).toHaveLength(0);
  });

  it('produces nothing when the text already fits', () => {
    const { inputs, unresolved } = buildRepairInputs([defect({ renderedWidthPt: 100 })]);
    expect(inputs.textFixes).toBeUndefined();
    expect(unresolved).toHaveLength(0);
  });
});

describe('buildRepairInputs — reporting what it cannot fix', () => {
  it('surfaces an unfixable overlay rather than dropping it', () => {
    // A page whose text genuinely cannot fit should fall back to its source
    // crop, and something has to say so.
    const { unresolved } = buildRepairInputs([defect({ renderedWidthPt: 200, charCount: 3 })]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].overlayId).toBe('o1');
    expect(unresolved[0].reason).toBe('overflow_exceeds_all_bounded_remedies');
  });

  it('still stops the wrap on an unfixable overlay', () => {
    // One long line reads better than two clipped ones.
    const { inputs, unresolved } = buildRepairInputs([
      defect({ renderedWidthPt: 200, charCount: 3, lineCountRegression: true }),
    ]);
    expect(unresolved).toHaveLength(1);
    expect(inputs.textFixes![0].whiteSpace).toBe('nowrap');
  });

  it('never shrinks a size-locked label, and reports it', () => {
    const { unresolved } = buildRepairInputs([
      defect({ renderedWidthPt: 103.5, charCount: 2, label: 'disclaimer' }),
    ]);
    expect(unresolved[0].reason).toBe('size_locked_label_cannot_shrink');
  });
});

describe('buildRepairInputs — contract', () => {
  it('handles many defects and stays deterministic', () => {
    const defects = [
      defect({ overlayId: 'a' }),
      defect({ overlayId: 'b', renderedWidthPt: 103.5, charCount: 2 }),
      defect({ overlayId: 'c', renderedWidthPt: 100 }),
    ];
    const first = buildRepairInputs(defects);
    expect(first.inputs.textFixes).toHaveLength(2);
    expect(buildRepairInputs(defects)).toEqual(first);
  });

  it('never throws on hostile input', () => {
    expect(() => buildRepairInputs([])).not.toThrow();
    expect(() => buildRepairInputs([defect({ sourceWidthPt: Number.NaN })])).not.toThrow();
    expect(() => buildRepairInputs([defect({ charCount: 0, fontSizePt: 0 })])).not.toThrow();
  });
});

describe('lineHeightFixFor — vertical overflow is a separate axis', () => {
  it('tightens leading proportionally to the overflow', () => {
    // A box can be wide enough and still too short.
    expect(lineHeightFixFor(1.5, 120, 100)).toBeCloseTo(1.25, 3);
  });

  it('returns null rather than making lines touch', () => {
    expect(lineHeightFixFor(1.2, 200, 100)).toBeNull();
    expect(lineHeightFixFor(MIN_LINE_HEIGHT, 110, 100)).toBeNull();
  });

  it('returns null when there is no overflow', () => {
    expect(lineHeightFixFor(1.4, 90, 100)).toBeNull();
  });

  it('returns null on unusable measurements', () => {
    for (const args of [[0, 120, 100], [1.4, 0, 100], [1.4, 120, 0], [Number.NaN, 120, 100]]) {
      expect(lineHeightFixFor(args[0], args[1], args[2])).toBeNull();
    }
  });
});
