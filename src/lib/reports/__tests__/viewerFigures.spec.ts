/**
 * The report page draws what the document draws — never the directive source.
 */
import { describe, expect, it } from 'vitest';

import { splitMarkdownForViewer } from '@/lib/reports/viewerFigures';
import { planningChartContext } from '@/lib/reports/vizFigures.pure';

const ctx = planningChartContext();

const REPORT = [
  '# Investment Report: 291 Stone Mason Drive, Kellyville NSW 2155',
  '',
  '{{glance: ✓ Gross yield 3.15% | ▲ Five-year growth 6.1% p.a. | ● 31 days on market}}',
  '',
  '## Executive Verdict',
  '',
  'The property sits in the top quartile for its suburb.',
  '',
  '{{gauge: 72 | Location score | Measured on walkability, commute and schools}}',
  '',
  '{{bars: 2022 1450000, 2023 1520000, 2024 1610000 | title=Median price by year | unit=$}}',
  '',
  'A sentence carrying {{gauge: 9/10}} in the middle stays prose.',
  '',
  '{{nosuchkind: 1 | 2 | 3}}',
  '',
  '## Costs',
  '',
  '| Item | Amount |',
  '|---|---|',
  '| Rates | $2,400 |',
].join('\n');

describe('splitMarkdownForViewer', () => {
  const split = splitMarkdownForViewer(REPORT, ctx);
  const figures = split.segments.filter((s) => s.kind === 'figure');
  const prose = split.segments.filter((s): s is { kind: 'markdown'; text: string } => s.kind === 'markdown');

  it('draws every directive-only line as a figure, in document order', () => {
    expect(figures.map((f) => (f as { directive: string }).directive)).toEqual(['glance', 'gauge', 'bars']);
    expect(split.drawn).toBe(3);
    for (const f of figures) {
      const html = (f as { html: string }).html;
      expect(html.length).toBeGreaterThan(40);
      expect(html).not.toContain('{{');
    }
  });

  it('never shows a directive\'s source — drawn, tabulated or dropped', () => {
    const shown = prose.map((p) => p.text).join('\n');
    expect(shown).not.toMatch(/\{\{(glance|gauge: 72|bars|nosuchkind)/);
    expect(split.dropped).toBe(1); // the unknown kind
  });

  it('leaves a directive embedded in a sentence as prose, and keeps the headings and tables around it', () => {
    const shown = prose.map((p) => p.text).join('\n');
    expect(shown).toContain('A sentence carrying {{gauge: 9/10}} in the middle stays prose.');
    expect(shown).toContain('# Investment Report: 291 Stone Mason Drive');
    expect(shown).toContain('## Executive Verdict');
    expect(shown).toContain('| Rates | $2,400 |');
  });

  it('keeps the prose before and after a figure as separate runs, in order', () => {
    expect(split.segments[0]).toMatchObject({ kind: 'markdown' });
    expect(split.segments[1]).toMatchObject({ kind: 'figure', directive: 'glance' });
    expect(split.segments[2]).toMatchObject({ kind: 'markdown' });
    expect((split.segments[2] as { text: string }).text).toContain('## Executive Verdict');
  });

  it('a report with no directives is one run of Markdown, unchanged', () => {
    const plain = '# Title\n\nSome prose.\n\n- a\n- b\n';
    const s = splitMarkdownForViewer(plain, ctx);
    expect(s.segments).toEqual([{ kind: 'markdown', text: plain }]);
    expect(s.drawn + s.tabulated + s.dropped).toBe(0);
  });

  it('an empty or missing body is no segments, not a crash', () => {
    expect(splitMarkdownForViewer('', ctx).segments).toEqual([]);
    expect(splitMarkdownForViewer(undefined as unknown as string, ctx).segments).toEqual([]);
  });
});
