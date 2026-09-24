/**
 * The "At a glance" strip is withdrawn from every document a client is shown.
 *
 * The owner read the five reports delivered on 23 Sep 2026 — the Compass, the
 * Financial Analysis, the Due Diligence report, the Snapshot and the Executive
 * Briefing — and asked for the strip to go "throughout" in favour of a
 * different approach. It restated each section's prose in shorthand, filed
 * its findings under categories the model chose, and its "Proceed with
 * caution" contradicted a verdict page that said BUY. See
 * `glanceWithdrawal.pure.ts`.
 *
 * Pinned here:
 *  - a stored document loses every strip on the READ path, so the reports
 *    already issued change too, not only the next ones;
 *  - the heading and the paragraph under a withdrawn strip are separated as
 *    if it had never been there, and nothing else moves;
 *  - a document with no strip is returned byte for byte;
 *  - the generator no longer asks for one, and says what to do instead.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  withdrawGlanceStrips,
} from '../../../../supabase/functions/_shared/reports/investment/glanceWithdrawal.pure';
import { presentStoredMarkdown } from '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure';
import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';

// Verbatim shape of the 23 Sep 2026 Compass for 9 Hollow Street (page 12).
const SECTION = [
  '## Amenity & Access',
  '',
  '{{glance: ✓ Established suburban amenity base | ✓ Schools, retail, healthcare and recreation within the broader Bendigo urban area | ⚠ Property-specific distances require confirmation | ◆ Car reliance remains relevant for some trips}}',
  '',
  '### Amenity overview',
  '',
  'The strongest amenity feature is the concentration of everyday services.',
].join('\n');

describe('a stored strip is not presented', () => {
  it('goes whole, with the break it sat in, and nothing else moves', () => {
    const r = withdrawGlanceStrips(SECTION);
    expect(r.withdrawn).toBe(1);
    expect(r.markdown).toBe([
      '## Amenity & Access',
      '',
      '### Amenity overview',
      '',
      'The strongest amenity feature is the concentration of everyday services.',
    ].join('\n'));
  });

  it('takes a strip whose payload runs over lines, and the payload-less form', () => {
    const md = '## Market Positioning\n\n{{glance: ✓ One |\n  ⚠ Two |\n  ◆ Three}}\n\nProse.\n\n{{glance}}\n\nMore prose.';
    const r = withdrawGlanceStrips(md);
    expect(r.withdrawn).toBe(2);
    expect(r.markdown).toBe('## Market Positioning\n\nProse.\n\nMore prose.');
  });

  it('takes one written inside a line, with the space before it', () => {
    const r = withdrawGlanceStrips('Before the strip {{glance: ✓ One | ⚠ Two}} after it.');
    expect(r.markdown).toBe('Before the strip after it.');
  });

  it('returns a document that never carried one byte for byte', () => {
    const md = '## Heading\n\n\n\nA paragraph with {{bars: A 1, B 2 | title=Two}} in it.\n';
    const r = withdrawGlanceStrips(md);
    expect(r.withdrawn).toBe(0);
    expect(r.markdown).toBe(md);
  });

  it('never touches another directive', () => {
    const md = '{{tiles: Hawthorn $1.42M sub="x" int=0.8 | title=T}}\n\n{{glance: ✓ One}}\n\n{{gauge: 64 | label=Growth}}';
    const r = withdrawGlanceStrips(md);
    expect(r.markdown).toContain('{{tiles: Hawthorn');
    expect(r.markdown).toContain('{{gauge: 64');
    expect(r.markdown).not.toContain('glance');
  });
});

describe('every reader is shown the document without it', () => {
  it('presentStoredMarkdown withdraws it, and nothing drawn says "At a glance"', () => {
    const out = presentStoredMarkdown(`# Investment Report: 9 Hollow Street\n\n${SECTION}\n`);
    expect(out).not.toMatch(/\{\{\s*glance/i);
    const { html } = renderMarkdown(out);
    expect(html).not.toMatch(/at a glance/i);
    expect(html).not.toContain('glance-row');
    // The section itself survives, heading and prose.
    expect(out).toContain('## Amenity & Access');
    expect(out).toContain('The strongest amenity feature');
  });
});

describe('the generator no longer asks for it', () => {
  const source = readFileSync(
    join(process.cwd(), 'supabase/functions/generate-investment-report/index.ts'),
    'utf8',
  );

  it('offers no at-a-glance primitive and no rule demanding one', () => {
    expect(source).not.toMatch(/AT-A-GLANCE STRIP/);
    expect(source).not.toMatch(/MUST open with a \\`\{\{glance/);
    expect(source).not.toMatch(/Lead each section with a \\`\{\{glance/);
  });

  it('says what a section opens with instead', () => {
    expect(source).toMatch(/OPENS WITH ITS FINDING/);
    expect(source).toMatch(/Open each section with ONE plain sentence that states its finding/);
  });

  it('keeps the primitive list numbered without a gap', () => {
    const at = source.indexOf('1. PULL QUOTE');
    const end = source.indexOf('VISUAL-FIRST RULES (CRITICAL):');
    const numbers = [...source.slice(at, end).matchAll(/^(\d+)\. [A-Z]/gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });
});
