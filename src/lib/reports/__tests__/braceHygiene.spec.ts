/**
 * No brace markup reaches a client's page.
 *
 * Every fixture below is verbatim from `investment_reports.report_content` for
 * the Investment Compass delivered for 9 Hollow Street, Golden Square on
 * 21 Sep 2026 — the document whose pages 25, 26 and 30 printed
 * `{{stat label="…"` to the client.
 */
import { describe, expect, it } from 'vitest';
import {
  scrubUnresolvedBraces,
  unresolvedBraces,
} from '../investment/braceHygiene.pure';
import { FENCE_KINDS } from '../../../../supabase/functions/_shared/reports/markdown.pure';

/** p25 — closed by a bare `:::`, with blank lines around the body. */
const CRIME = [
  '### Crime & personal safety',
  '',
  '{{stat label="Crime data coverage" unit="" sub="Recorded-crime register integration for this location"',
  '',
  'Crime register not integrated',
  '',
  ':::',
  '',
  'Crime risk cannot be rated for this property.',
].join('\n');

/** p26 — closed by `:::`, body tight against the fence. */
const PROJECTS = [
  '### Infrastructure & major projects',
  '',
  '{{stat label="Registered major public projects" unit="" sub="Within ~15 km of the property"',
  'None recorded in queried register',
  ':::',
].join('\n');

/** p30 — NOT closed by `:::`. The body runs into the section rule. */
const MEDIAN = [
  '### Methodology Notes',
  '',
  '{{stat label="Golden Square house median" unit="$" sub="Vic Valuer-General, 2025"',
  '',
  '567500',
  '',
  '---',
  '',
  '## Planning controls and development registers',
].join('\n');

/** A real directive from the same document, which must not be touched. */
const HEATMAP =
  '{{heatmap: 8.6,5.6 / 1.5,1.9 / 8.5,3.8 | rows=1-year,3-year,5-year | cols=Golden Square,Victoria}}';

describe('the three openers that printed to a client', () => {
  it('leaves nothing unresolved in any of them', () => {
    for (const doc of [CRIME, PROJECTS, MEDIAN]) {
      expect(unresolvedBraces(doc)).toHaveLength(1);
      expect(unresolvedBraces(scrubUnresolvedBraces(doc).markdown)).toEqual([]);
    }
  });

  it('repairs the delimiter rather than deleting the figure', () => {
    const r = scrubUnresolvedBraces(MEDIAN);
    expect(r.repaired).toEqual(['stat']);
    expect(r.stripped).toEqual([]);
    expect(r.markdown).toContain('::: stat label="Golden Square house median" unit="$"');
    // The whole point: the number survives.
    expect(r.markdown).toContain('567500');
  });

  it('closes a fence whose body ran into the next section', () => {
    // p30 ends on `---`, not `:::`. Stripping the opener would leave `567500`
    // standing alone as a paragraph, which is worse than the defect.
    const out = scrubUnresolvedBraces(MEDIAN).markdown;
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines.indexOf(':::')).toBeGreaterThan(lines.indexOf('567500'));
    expect(lines.indexOf(':::')).toBeLessThan(lines.indexOf('---'));
    // The section rule and the heading after it are kept.
    expect(out).toContain('## Planning controls and development registers');
  });

  it('keeps an existing closer rather than adding a second', () => {
    const out = scrubUnresolvedBraces(CRIME).markdown;
    expect(out.split('\n').filter((l) => l.trim() === ':::')).toHaveLength(1);
  });

  it('produces a fence the renderer recognises', () => {
    // `renderMarkdown` opens on /^:::\s*([A-Za-z][\w-]*)\s*(.*)$/.
    const opener = scrubUnresolvedBraces(CRIME).markdown
      .split('\n').find((l) => l.startsWith(':::') && l.trim() !== ':::');
    expect(opener).toBeDefined();
    const m = /^:::\s*([A-Za-z][\w-]*)\s*(.*)$/.exec(opener!.trim());
    expect(m).not.toBeNull();
    expect((FENCE_KINDS as readonly string[])).toContain(m![1]);
    expect(m![2]).toContain('label="Crime data coverage"');
  });
});

describe('what it must not touch', () => {
  it('leaves a legitimate directive alone, including a long one', () => {
    const doc = `## Market\n\n${HEATMAP}\n\nProse after.`;
    expect(scrubUnresolvedBraces(doc).markdown).toBe(doc);
  });

  it('leaves a multi-line directive alone', () => {
    // `VIZ_DIRECTIVE_RE`'s body is `[^}]*`, which matches newlines.
    const doc = '{{bars: Alpha 1,\nBeta 2,\nGamma 3 | title=Spread}}';
    expect(scrubUnresolvedBraces(doc).markdown).toBe(doc);
  });

  it('leaves a template binding to the renderer that owns it', () => {
    const doc = 'Rent is {{financials.weeklyRent}} weekly.';
    expect(scrubUnresolvedBraces(doc).markdown).toBe(doc);
  });

  it('is byte-identical on a document with no braces', () => {
    const doc = '# Title\n\nJust prose, and a table.\n\n| a | b |\n| - | - |\n| 1 | 2 |';
    expect(scrubUnresolvedBraces(doc).markdown).toBe(doc);
  });
});

describe('the guarantee, where repair is impossible', () => {
  it('strips an opener with no end inside its section, rather than printing it', () => {
    const doc = ['{{stat label="Orphan"', '', 'a', '', 'b', '', 'c', '', 'd', '', 'e', '', 'f', '', 'g', '', 'h'].join('\n');
    const r = scrubUnresolvedBraces(doc);
    expect(r.repaired).toEqual([]);
    expect(r.stripped).toHaveLength(1);
    expect(unresolvedBraces(r.markdown)).toEqual([]);
    expect(r.markdown).not.toContain('{{');
  });

  it('strips an unknown kind rather than printing it', () => {
    const doc = '### Heading\n\n{{dashboard label="Not a kind anything draws"\n\nbody\n\n:::';
    const r = scrubUnresolvedBraces(doc);
    expect(r.repaired).toEqual([]);
    expect(r.stripped).toHaveLength(1);
    expect(r.markdown).not.toContain('{{');
  });

  it('removes debris inside a sentence without eating the sentence', () => {
    const doc = 'The nearest stop is {{stat broken and the walk is 400 m.';
    const r = scrubUnresolvedBraces(doc);
    expect(r.markdown).toBe('The nearest stop is');
    expect(r.markdown).not.toContain('{{');
  });
});

describe('the read path carries it', () => {
  it('presentStoredMarkdown leaves no unresolved brace', async () => {
    const { presentStoredMarkdown } = await import('../investment/derivedHygiene.pure');
    const doc = `${CRIME}\n\n${PROJECTS}\n\n${HEATMAP}\n\n${MEDIAN}`;
    expect(unresolvedBraces(doc)).toHaveLength(3);
    const out = presentStoredMarkdown(doc);
    expect(unresolvedBraces(out)).toEqual([]);
    // …and the real directive is still there to be drawn.
    expect(out).toContain('{{heatmap:');
  });
});
