import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { drawStrengthsWatchBlock } from '../blocks/strengthsWatch';
import type { BlockRenderContext } from '../blocks';

/**
 * A list with nothing in it draws nothing at all.
 *
 * `investment_score.strengths` and `.weaknesses` are `[]` on a report whose
 * evidence was insufficient to grade — the ordinary state, not an error. The
 * block resolved each item INSIDE the draw and placed its glyph badge before
 * the text, so an item resolving to nothing left a coloured dot under a
 * heading bar with no words beside it: on the certification render, the
 * Verdict page of all three selectable structures carried "STRENGTHS" and
 * "CONSIDERATIONS" as two title bars each with one stray bullet.
 *
 * The rule is `definition-list`'s, stated there for the same reason: no
 * heading rule hanging over empty space, and above all no placeholder.
 */
const context = (data: Record<string, unknown>): BlockRenderContext => {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  return {
    doc,
    page: { id: 'p', name: 'P', width: 595, height: 842, blocks: [] },
    data,
    tokens: {},
  } as unknown as BlockRenderContext;
};

const block = (props: Record<string, unknown>) =>
  ({ id: 'b', type: 'strengths-watch', props } as any);

/** What jsPDF drew, as an operation count. */
const opsOf = (ctx: BlockRenderContext): number =>
  ((ctx.doc as any).internal.pages[1] as string[]).length;

describe('strengths & watch points', () => {
  it('draws nothing when both columns resolve to nothing', () => {
    const ctx = context({ scores: { strengths: [], weaknesses: [] } });
    const before = opsOf(ctx);
    drawStrengthsWatchBlock(block({
      x: 40, y: 100, width: 500,
      strengthsTitle: 'Strengths', watchTitle: 'Considerations',
      strengths: ['{{scores.strengths.0}}'], watch: ['{{scores.weaknesses.0}}'],
    }), ctx);
    expect(opsOf(ctx)).toBe(before);
  });

  it('draws the column that HAS something, and only that one', () => {
    const ctx = context({ scores: { strengths: ['Large landholding'], weaknesses: [] } });
    drawStrengthsWatchBlock(block({
      x: 40, y: 100, width: 500,
      strengthsTitle: 'Strengths', watchTitle: 'Considerations',
      strengths: ['{{scores.strengths.0}}'], watch: ['{{scores.weaknesses.0}}'],
    }), ctx);
    const drawn = ((ctx.doc as any).internal.pages[1] as string[]).join('\n');
    expect(drawn).toContain('STRENGTHS');
    expect(drawn).not.toContain('CONSIDERATIONS');
  });

  it('still draws both when both carry text', () => {
    const ctx = context({});
    drawStrengthsWatchBlock(block({
      x: 40, y: 100, width: 500,
      strengthsTitle: 'Strengths', watchTitle: 'Considerations',
      strengths: ['Large landholding'], watch: ['Single-car parking'],
    }), ctx);
    const drawn = ((ctx.doc as any).internal.pages[1] as string[]).join('\n');
    expect(drawn).toContain('STRENGTHS');
    expect(drawn).toContain('CONSIDERATIONS');
  });
});
