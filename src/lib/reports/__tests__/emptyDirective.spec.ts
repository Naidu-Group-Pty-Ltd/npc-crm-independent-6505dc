/**
 * A figure the model asked for and gave nothing to draw.
 *
 * ## How this was found
 *
 * By drawing the document. The Due Diligence report for 18 Annabelle
 * Crescent printed `{{stat block}}` as body copy, between two paragraphs
 * about schools — the model asking for a figure, on a client's page, in
 * braces.
 *
 * `VIZ_DIRECTIVE_RE` requires `{{kind: args}}`. A payload-less token matches
 * nothing, so `directiveOnlyBlock` answered false and the line fell through
 * to a paragraph. Measured over the whole corpus: **12 occurrences across 5
 * reports**, every one a bare kind — `timeline` ×3, `donut` ×2, `bars` ×2,
 * `glance` ×2, `stat block`, `tiles`, `gauge`.
 *
 * The rule is the one the template renderer already holds: an unresolved
 * `{{…}}` renders as the empty string, never as a visible one. There is
 * nothing to draw, so there is nothing to print — and it is COUNTED as a
 * refusal, because a silent drop looks exactly like a report the model chose
 * not to illustrate.
 */
import { describe, expect, it } from 'vitest';

import {
  directiveOnlyBlock, scanVizDirectives,
} from '../../../../supabase/functions/_shared/reports/vizDirectives.pure';
import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';

/** Every bare kind the corpus actually carries. */
const MEASURED = ['{{timeline}}', '{{donut}}', '{{bars}}', '{{glance}}', '{{stat block}}', '{{tiles}}', '{{gauge}}'];

describe('a directive with nothing to draw', () => {
  it('is a directive-only block, and is counted as refused', () => {
    for (const token of MEASURED) {
      expect(directiveOnlyBlock(token), token).toBe(true);
      expect(scanVizDirectives(token).refused, token).toBe(1);
      expect(scanVizDirectives(token).directives, token).toEqual([]);
    }
  });

  it('never reaches the page', () => {
    for (const token of MEASURED) {
      const out = renderMarkdown(`Schools are plentiful.\n\n${token}\n\nCheck the catchment.`);
      const html = out.blocks.map((b) => b.html).join('');
      expect(html, token).not.toContain('{{');
      expect(html).toContain('Schools are plentiful.');
      expect(html).toContain('Check the catchment.');
      expect(out.notices.figuresDropped).toBeGreaterThan(0);
    }
  });

  it('leaves a real directive alone', () => {
    expect(scanVizDirectives('{{bars: A 10, B 20}}').refused).toBe(0);
    expect(scanVizDirectives('{{bars: A 10, B 20}}').directives).toHaveLength(1);
  });

  it('leaves a legend bullet alone, because it is not directive-only', () => {
    // The 13 corpus lines where the model names the kinds in prose. Lifting
    // one out would leave a bullet with a hole in it.
    const bullet = '- **{{gauge}}** — a score out of 100';
    expect(directiveOnlyBlock(bullet)).toBe(false);
    const html = renderMarkdown(bullet).blocks.map((b) => b.html).join('');
    expect(html).toContain('a score out of 100');
  });

  it('does not touch a template binding or a numeric token', () => {
    // A binding belongs to the renderer that owns it; a dot is excluded from
    // the kind, and a kind must start with a letter.
    expect(directiveOnlyBlock('{{financials.weeklyRent}}')).toBe(false);
    expect(directiveOnlyBlock('{{2}}')).toBe(false);
  });
});
