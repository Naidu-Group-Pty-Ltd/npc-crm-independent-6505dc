/**
 * The judge, and the check on the judge.
 *
 * Two contracts matter here. A finding that names an element the page does not
 * contain must never reach a reviewer — it looks exactly like a real defect and
 * points at an id they cannot find. And a claim geometry can settle must be
 * settled BY geometry, not passed through on the model's word: this programme's
 * whole thesis is that a model is good at noticing and bad at measuring.
 */
import { describe, it, expect } from 'vitest';
import {
  parseCritiqueFindings,
  corroborateFindings,
  summariseCritique,
  orderFindingsForReview,
  CRITIQUE_KINDS,
  CRITIQUE_TOOL_SCHEMA,
  MAX_CRITIQUE_FINDINGS,
  MAX_CRITIQUE_NOTE_LENGTH,
  FIT_TOLERANCE_PT,
  VISUAL_CRITIQUE_VERSION,
  type CritiqueOverlayEvidence,
  type VisualCritiqueFinding,
} from '../../../../supabase/functions/_shared/visualCritique.pure';

const PAGE = { pageWidth: 595, pageHeight: 842 };
const IDS = ['title', 'body', 'logo', 'rule'];
const ctx = { overlayIds: IDS, ...PAGE };

const finding = (over: Partial<VisualCritiqueFinding> & Record<string, unknown> = {}): VisualCritiqueFinding => ({
  kind: 'text_clipped', severity: 'critical', overlayId: 'title',
  note: 'The title is cut off on the right.', ...over,
} as VisualCritiqueFinding);

describe('parseCritiqueFindings', () => {
  it('accepts a well-formed finding', () => {
    const { findings, rejected } = parseCritiqueFindings({ findings: [finding()] }, ctx);
    expect(rejected).toEqual([]);
    expect(findings).toEqual([{
      kind: 'text_clipped', severity: 'critical', overlayId: 'title',
      note: 'The title is cut off on the right.',
    }]);
  });

  it('accepts a bare array as well as the tool envelope', () => {
    expect(parseCritiqueFindings([finding()], ctx).findings).toHaveLength(1);
  });

  it('rejects a finding naming an element that is not on the page', () => {
    // The important rejection. An invented id reaches a reviewer looking exactly
    // like a real defect, pointing at something they cannot find.
    const { findings, rejected } = parseCritiqueFindings([finding({ overlayId: 'ghost' })], ctx);
    expect(findings).toEqual([]);
    expect(rejected[0].reason).toContain('not on this page');
  });

  it('rejects an invented related element too', () => {
    const { rejected } = parseCritiqueFindings(
      [finding({ kind: 'occluded', relatedOverlayId: 'phantom' })], ctx,
    );
    expect(rejected[0].reason).toContain('related element');
  });

  it('rejects a kind or severity outside the closed vocabulary', () => {
    // Open categories mean nothing downstream can corroborate them and the
    // review surface fills with prose.
    expect(parseCritiqueFindings([finding({ kind: 'vibes_off' as never })], ctx).rejected[0].reason)
      .toContain('unknown kind');
    expect(parseCritiqueFindings([finding({ severity: 'catastrophic' as never })], ctx).rejected[0].reason)
      .toContain('unknown severity');
  });

  it('rejects a finding that locates nothing', () => {
    const { rejected } = parseCritiqueFindings([finding({ overlayId: undefined })], ctx);
    expect(rejected[0].reason).toBe('finding locates nothing');
  });

  it('accepts a region when no element applies, and rejects one off the page', () => {
    const ok = parseCritiqueFindings(
      [finding({ kind: 'missing_element', overlayId: undefined, region: { x: 40, y: 700, width: 200, height: 40 } })],
      ctx,
    );
    expect(ok.findings[0].region).toEqual({ x: 40, y: 700, width: 200, height: 40 });

    for (const bad of [
      { x: 500, y: 10, width: 200, height: 20 },
      { x: -20, y: 10, width: 50, height: 20 },
      { x: 10, y: 10, width: 0, height: 20 },
      { x: 10, y: 10, width: 50 },
    ]) {
      const { rejected } = parseCritiqueFindings(
        [finding({ kind: 'missing_element', overlayId: undefined, region: bad as never })], ctx,
      );
      expect(rejected[0]?.reason, JSON.stringify(bad)).toContain('region');
    }
  });

  it('rejects an empty note — a finding a reviewer cannot read is not one', () => {
    expect(parseCritiqueFindings([finding({ note: '   ' })], ctx).rejected[0].reason).toBe('empty note');
  });

  it('bounds the note rather than dropping the finding', () => {
    const long = 'x'.repeat(MAX_CRITIQUE_NOTE_LENGTH + 100);
    expect(parseCritiqueFindings([finding({ note: long })], ctx).findings[0].note)
      .toHaveLength(MAX_CRITIQUE_NOTE_LENGTH);
  });

  it('bounds how many findings one page may carry, and says what it dropped', () => {
    const many = Array.from({ length: MAX_CRITIQUE_FINDINGS + 3 }, () => finding());
    const { findings, rejected } = parseCritiqueFindings(many, ctx);
    expect(findings).toHaveLength(MAX_CRITIQUE_FINDINGS);
    expect(rejected).toHaveLength(3);
    expect(rejected[0].reason).toContain('exceeds max');
  });

  it('returns a stated reason rather than an empty list for a non-array payload', () => {
    for (const raw of [null, undefined, 'nope', 42, { findings: 'nope' }]) {
      const { findings, rejected } = parseCritiqueFindings(raw, ctx);
      expect(findings).toEqual([]);
      expect(rejected[0].reason).toContain('not an array');
    }
  });

  it('exposes the closed vocabulary to the tool schema it forces', () => {
    const kinds = CRITIQUE_TOOL_SCHEMA.input_schema.properties.findings.items.properties.kind.enum;
    expect([...kinds].sort()).toEqual([...CRITIQUE_KINDS].sort());
  });
});

// ─── corroboration ───────────────────────────────────────────────────────────

const overlay = (over: Partial<CritiqueOverlayEvidence> = {}): CritiqueOverlayEvidence => ({
  id: 'title', type: 'text', x: 48, y: 96, width: 300, height: 30,
  content: 'Borrowing Capacity Snapshot', fontSizePt: 20, lineHeight: 1.3,
  paintOrder: 200_000, ...over,
});

/** A measurer with a fixed advance, so the arithmetic in a test is legible. */
const perChar = (ptPerChar: number) =>
  (text: string, size: number) => text.length * ptPerChar * (size / 20);

function verdictOf(f: VisualCritiqueFinding, overlays: CritiqueOverlayEvidence[], measure?: ReturnType<typeof perChar>) {
  return corroborateFindings([f], { overlays, ...PAGE, measure })[0];
}

describe('a claim geometry can settle is settled by geometry', () => {
  it('confirms a clipped single line by measuring it against its box', () => {
    const o = overlay({ nowrap: true, width: 200 });
    // 27 chars × 10pt = 270pt of text in a 200pt box.
    const result = verdictOf(finding(), [o], perChar(10));
    expect(result.verdict).toBe('confirmed');
    expect(result.basis).toContain('270.0pt in a 200.0pt box');
  });

  it('refutes a clip claim when the text plainly fits', () => {
    const o = overlay({ nowrap: true, width: 400 });
    const result = verdictOf(finding(), [o], perChar(10));
    expect(result.verdict).toBe('refuted');
    expect(result.basis).toContain('fits');
  });

  it('does not decide inside the measurement noise', () => {
    // A canvas measures a different rasteriser's advances than WeasyPrint lays
    // out with, so a claim is only confirmed when it misses by more than that.
    const width = 270 - FIT_TOLERANCE_PT / 2;
    expect(verdictOf(finding(), [overlay({ nowrap: true, width })], perChar(10)).verdict).toBe('refuted');
  });

  it('counts tracking into the width the text needs', () => {
    // Layout width is natural + spacing × n, not × (n − 1) — the same rule that
    // makes a box copied from the source's ink extent one space short.
    const o = overlay({ nowrap: true, width: 280, letterSpacingPt: 2 });
    expect(verdictOf(finding(), [o], perChar(10)).verdict).toBe('confirmed');
  });

  it('confirms an overflow when wrapped text cannot fit its box height', () => {
    const o = overlay({ width: 100, height: 30 });
    const result = verdictOf(finding({ kind: 'text_overflow' }), [o], perChar(10));
    expect(result.verdict).toBe('confirmed');
    expect(result.basis).toContain('line(s)');
  });

  it('refuses to refute a marginal wrapped case', () => {
    // The line estimate is good enough to catch a bad overflow and not good
    // enough to clear a close one.
    const o = overlay({ width: 200, height: 200 });
    expect(verdictOf(finding({ kind: 'text_overflow' }), [o], perChar(10)).verdict)
      .toBe('unverifiable');
  });

  it('refutes a text claim about something that is not text', () => {
    const o = overlay({ id: 'logo', type: 'image', content: undefined });
    const result = verdictOf(finding({ overlayId: 'logo' }), [o], perChar(10));
    expect(result.verdict).toBe('refuted');
    expect(result.basis).toContain('is a image, not text');
  });

  it('says so when there is no measurer rather than guessing', () => {
    expect(verdictOf(finding(), [overlay({ nowrap: true, width: 10 })]).verdict).toBe('unverifiable');
  });
});

describe('occlusion is decided by the boxes and the paint order', () => {
  const logo = overlay({ id: 'logo', type: 'image', x: 48, y: 90, width: 120, height: 60, paintOrder: -10_000 });
  const backdrop = overlay({ id: 'rule', type: 'vector', x: 0, y: 0, width: 595, height: 842, paintOrder: 500_000 });

  it('confirms when the boxes overlap and the other element paints on top', () => {
    const result = verdictOf(
      { kind: 'occluded', severity: 'critical', overlayId: 'logo', relatedOverlayId: 'rule', note: 'The logo is buried.' },
      [logo, backdrop],
    );
    expect(result.verdict).toBe('confirmed');
    expect(result.basis).toContain('paints above');
  });

  it('refutes when the boxes do not overlap at all', () => {
    const far = overlay({ id: 'rule', type: 'vector', x: 400, y: 700, width: 100, height: 10, paintOrder: 500_000 });
    const result = verdictOf(
      { kind: 'occluded', severity: 'major', overlayId: 'logo', relatedOverlayId: 'rule', note: 'Hidden.' },
      [logo, far],
    );
    expect(result.verdict).toBe('refuted');
    expect(result.basis).toContain('do not overlap');
  });

  it('refutes when the named victim is the one on top', () => {
    const under = overlay({ id: 'rule', type: 'vector', x: 40, y: 80, width: 200, height: 100, paintOrder: -1_000_000 });
    expect(verdictOf(
      { kind: 'occluded', severity: 'major', overlayId: 'logo', relatedOverlayId: 'rule', note: 'Hidden.' },
      [logo, under],
    ).verdict).toBe('refuted');
  });

  it('needs both parties named', () => {
    expect(verdictOf({ kind: 'occluded', severity: 'major', overlayId: 'logo', note: 'Hidden.' }, [logo]).verdict)
      .toBe('unverifiable');
  });
});

describe('the claims only pixels can settle are marked as such', () => {
  it.each(['wrong_colour', 'wrong_typeface', 'spurious_element', 'artifact'] as const)('%s is unverifiable', (kind) => {
    const result = verdictOf(finding({ kind }), [overlay()], perChar(10));
    expect(result.verdict).toBe('unverifiable');
    expect(result.basis).toContain('source pixels');
  });

  it('refutes a missing-element claim when something already covers the region', () => {
    const result = verdictOf(
      { kind: 'missing_element', severity: 'major', region: { x: 50, y: 100, width: 100, height: 20 }, note: 'The heading is gone.' },
      [overlay({ x: 48, y: 96, width: 300, height: 30 })],
    );
    expect(result.verdict).toBe('refuted');
    expect(result.basis).toContain('already covers');
  });

  it('will not confirm a missing element from an empty region alone', () => {
    // Nothing is placed there, which agrees with the claim — but "missing" is
    // measured against the SOURCE, and this module does not hold its pixels.
    const result = verdictOf(
      { kind: 'missing_element', severity: 'major', region: { x: 400, y: 700, width: 100, height: 20 }, note: 'Gone.' },
      [overlay()],
    );
    expect(result.verdict).toBe('unverifiable');
  });
});

describe('duplication and alignment', () => {
  const a = overlay({ id: 'title', content: 'Total debt' });
  const b = overlay({ id: 'body', x: 48, y: 130, content: 'Total debt' });

  it('confirms a duplicate only when the words actually match', () => {
    expect(verdictOf({ kind: 'duplicated', severity: 'major', overlayId: 'title', relatedOverlayId: 'body', note: 'Twice.' }, [a, b]).verdict)
      .toBe('confirmed');
    expect(verdictOf(
      { kind: 'duplicated', severity: 'major', overlayId: 'title', relatedOverlayId: 'body', note: 'Twice.' },
      [a, { ...b, content: 'Total assets' }],
    ).verdict).toBe('refuted');
  });

  it('refutes a misalignment claim when an edge already agrees', () => {
    const result = verdictOf(
      { kind: 'misaligned', severity: 'minor', overlayId: 'title', relatedOverlayId: 'body', note: 'Not aligned.' },
      [a, b],
    );
    expect(result.verdict).toBe('refuted');
    expect(result.basis).toContain('left edges agree');
  });

  it('leaves a real misalignment to the source to settle', () => {
    const offset = overlay({ id: 'body', x: 61, y: 130, width: 190, height: 12 });
    expect(verdictOf(
      { kind: 'misaligned', severity: 'minor', overlayId: 'title', relatedOverlayId: 'body', note: 'Not aligned.' },
      [a, offset],
    ).verdict).toBe('unverifiable');
  });
});

describe('what a reviewer is shown', () => {
  const mixed = corroborateFindings([
    { kind: 'wrong_colour', severity: 'minor', overlayId: 'title', note: 'Slightly off.' },
    { kind: 'text_clipped', severity: 'critical', overlayId: 'title', note: 'Cut off.' },
    { kind: 'text_clipped', severity: 'critical', overlayId: 'body', note: 'Also cut off.' },
    { kind: 'wrong_typeface', severity: 'critical', overlayId: 'title', note: 'Wrong font.' },
  ] as VisualCritiqueFinding[], {
    overlays: [
      overlay({ nowrap: true, width: 100 }),
      overlay({ id: 'body', nowrap: true, width: 4000 }),
    ],
    ...PAGE,
    measure: perChar(10),
  });

  it('keeps a refuted finding rather than silently shortening the list', () => {
    // A reviewer is better served knowing the model claimed something and
    // measurement disagreed than by a list that quietly lost it.
    expect(mixed).toHaveLength(4);
    expect(mixed.find((f) => f.overlayId === 'body')!.verdict).toBe('refuted');
  });

  it('counts what measurement backed, contradicted and could not reach', () => {
    expect(summariseCritique(mixed)).toEqual({
      version: VISUAL_CRITIQUE_VERSION,
      total: 4, confirmed: 1, refuted: 1, unverifiable: 2, confirmedCritical: 1,
    });
  });

  it('reads confirmed first, then unchecked, then contradicted', () => {
    const ordered = orderFindingsForReview(mixed);
    expect(ordered.map((f) => f.verdict)).toEqual(['confirmed', 'unverifiable', 'unverifiable', 'refuted']);
    // Severity orders within a verdict; source order breaks the remaining tie.
    expect(ordered[1].severity).toBe('critical');
    expect(ordered[2].severity).toBe('minor');
  });

  it('is empty-safe', () => {
    expect(corroborateFindings([], { overlays: [], ...PAGE })).toEqual([]);
    expect(summariseCritique([])).toMatchObject({ total: 0, confirmed: 0, confirmedCritical: 0 });
    expect(orderFindingsForReview([])).toEqual([]);
  });
});
