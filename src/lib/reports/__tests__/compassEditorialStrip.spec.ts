/**
 * The commentary strip, against the shapes production actually writes.
 *
 * Every fixture below is copied from a stored `investment_reports` row rather
 * than invented, because the defect this replaces was a matcher written against
 * an imagined shape: `^#{2,4} what this means$` found 11 of the 5,043 labels in
 * the corpus, since the model writes the bold form 82.5% of the time.
 */
import { describe, expect, it } from 'vitest';

import {
  findEditorialLabels,
  postProcessReportMarkdown,
  stripEditorialBlocks,
} from '../compassPostProcessor';
import { runQAValidation } from '../compassQAValidator';

const strip = (body: string) =>
  stripEditorialBlocks({ heading: 'Test', bodyLines: body.split('\n') });

describe('stripEditorialBlocks — the three forms', () => {
  it('removes the bold form and its paragraph (4,161 of 5,043 in the corpus)', () => {
    const { lines, removedBlocks } = strip(
      [
        'Banora Point is an established residential suburb in Tweed Shire.',
        '',
        '**What This Means**  ',
        'Thinking about Banora Point in the context of its neighbours helps clarify',
        'its role for a long-term investor.',
        '',
        'Council documents name it for future housing growth.',
      ].join('\n'),
    );
    const out = lines.join('\n');
    expect(removedBlocks).toBe(1);
    expect(out).not.toContain('What This Means');
    expect(out).not.toContain('helps clarify');
    expect(out).toContain('established residential suburb');
    expect(out).toContain('Council documents name it');
  });

  it('removes the heading form (424 in the corpus)', () => {
    const { lines, removedBlocks } = strip(
      ['### NPC view', 'From a strategic perspective, Banora Point is well placed.', '', '## Next'].join('\n'),
    );
    expect(removedBlocks).toBe(1);
    expect(lines.join('\n')).not.toContain('NPC view');
    expect(lines.join('\n')).not.toContain('well placed');
    expect(lines.join('\n')).toContain('## Next');
  });

  it('removes the bare-line form (458 in the corpus)', () => {
    const { lines, removedBlocks } = strip(
      ['What to watch  ', 'Growth here is infill rather than greenfield.', '', 'Rail is 900m away.'].join('\n'),
    );
    expect(removedBlocks).toBe(1);
    expect(lines.join('\n')).not.toContain('What to watch');
    expect(lines.join('\n')).not.toContain('infill rather than greenfield');
    expect(lines.join('\n')).toContain('Rail is 900m away.');
  });

  it('removes all five labels', () => {
    for (const label of ['What This Means', 'Why this matters', 'What to watch', 'Key takeaway', 'NPC view']) {
      const { removedBlocks } = strip([`**${label}**`, 'Restatement of the table above.'].join('\n'));
      expect(removedBlocks, label).toBe(1);
    }
  });

  it('removes the label however the separator sits against the emphasis', () => {
    // Production writes the colon INSIDE the bold markers; an earlier matcher
    // here only handled it outside, and left `** ` on the line.
    for (const line of ['**What This Means:**', '**What This Means**:', 'What This Means:', '### NPC view:']) {
      const { lines, removedBlocks } = strip([line, 'Commentary paragraph.'].join('\n'));
      expect(removedBlocks, line).toBe(1);
      expect(lines.join('').trim(), line).toBe('');
    }
  });
});

describe('stripEditorialBlocks — what it must not touch', () => {
  it('never consumes a chart directive', () => {
    // 53 figures a report; a strip that ate one would remove the data and keep
    // nothing, which is strictly worse than the commentary it is removing.
    const { lines } = strip(
      [
        '**What This Means**',
        'The combination of highway and hospital supports demand.',
        '{{bars: Yield 7.4, Growth 8.1 | title=Investment Pillars | max=10}}',
        'Median grew to $1.17M.',
      ].join('\n'),
    );
    const out = lines.join('\n');
    expect(out).toContain('{{bars: Yield 7.4, Growth 8.1 | title=Investment Pillars | max=10}}');
    expect(out).toContain('Median grew to $1.17M.');
    expect(out).not.toContain('supports demand');
  });

  it('never consumes a table', () => {
    const { lines } = strip(
      ['### Why this matters', '| Metric | Value |', '| --- | --- |', '| Median Price | $1.17M |'].join('\n'),
    );
    const out = lines.join('\n');
    expect(out).toContain('| Median Price | $1.17M |');
    expect(out).not.toContain('Why this matters');
  });

  it('never consumes a list or a following heading', () => {
    const { lines } = strip(
      ['**Key takeaway**', '- Large 2,131 m² block', '- Four bedrooms', '', '### Infrastructure'].join('\n'),
    );
    const out = lines.join('\n');
    expect(out).toContain('- Large 2,131 m² block');
    expect(out).toContain('### Infrastructure');
  });

  it('removes a labelled heading whole, however it trails', () => {
    // `### NPC view – overall recommendation` occurs in production. Read as the
    // inline form it would lose the `###` and leave "overall recommendation"
    // hanging above the opinion it was titling.
    for (const heading of [
      '### NPC view – overall recommendation',
      '### NPC view – Proceed with caution',
      '### Why this matters for investors',
    ]) {
      const { lines, removedBlocks } = strip(
        [heading, 'The adviser opinion paragraph.', '', '## Next section'].join('\n'),
      );
      const out = lines.join('\n');
      expect(removedBlocks, heading).toBe(1);
      expect(out, heading).not.toContain('NPC view');
      expect(out, heading).not.toContain('overall recommendation');
      expect(out, heading).not.toContain('adviser opinion');
      expect(out, heading).toContain('## Next section');
    }
  });

  it('leaves ordinary prose that merely mentions a label word', () => {
    const body = 'What this means for the tenant profile is covered in the demand section.';
    const { lines, removedBlocks } = strip(body);
    expect(removedBlocks).toBe(0);
    expect(lines.join('\n')).toBe(body);
  });
});

describe('stripEditorialBlocks — the inline form keeps its sentence', () => {
  it('drops the label and keeps the finding', () => {
    // Final Recommendation writes its verdict this way, and that section was
    // 39% editorial by character — blanket removal would have emptied it.
    const { lines, removedBlocks } = strip(
      '**Key takeaway:** 93 Bimbadeen Avenue is best viewed as a proceed-with-caution opportunity.',
    );
    expect(removedBlocks).toBe(1);
    expect(lines.join('\n')).toBe(
      '93 Bimbadeen Avenue is best viewed as a proceed-with-caution opportunity.',
    );
  });

  it('keeps the rationale under an inline NPC view', () => {
    const { lines } = strip(
      '**NPC view:** NPC’s view is that this property can work for the right buyer.',
    );
    expect(lines.join('\n')).toContain('can work for the right buyer');
    expect(lines.join('\n')).not.toContain('NPC view:');
  });
});

describe('a production-shaped section, end to end', () => {
  // Reproduces the structure of "Why This Location Matters" from report
  // 1be16c4a: glance strip, bold takeaway, prose, tiles, two What This Means,
  // a margin note, What to watch, NPC view.
  const SECTION = `## Why This Location Matters

{{glance: ✓ Established coastal suburb | ◆ Growth corridor | ⚠ Planning overlays}}

**Key takeaway**
Banora Point sits in a well-amenitised coastal growth corridor in Tweed Shire.

---

### Strategic Position

Banora Point is an established residential suburb within Tweed Shire, just south
of Tweed Heads and close to the Queensland border.

{{tiles: Banora Point "Coastal hub" sub="Strong amenity" int=0.8 | cols=4}}

**What This Means**
Thinking about Banora Point in the context of its neighbours helps clarify its
role for a long-term investor.

Council's Growth Management Strategy names Banora Point for future housing growth.

{{margin: Tweed Shire growth outlook | spark=2021,2024,2030,2041}}

**What This Means**
Council naming the suburb signals that infrastructure planning is expected.

What to watch
Growth is more likely to be infill than large-scale greenfield release.

NPC view
From a strategic perspective, Banora Point is well placed for a steady-growth
narrative rather than a boom-suburb one.
`;

  it('removes all five blocks and keeps every figure and heading', () => {
    const { markdown, report } = postProcessReportMarkdown(SECTION, 'compass-40');

    expect(report.editorialBlocksRemoved).toBe(5);
    expect(report.editorialWordsRemoved).toBeGreaterThan(40);

    for (const label of ['What This Means', 'What to watch', 'NPC view']) {
      expect(markdown).not.toContain(label);
    }
    // The inline `**Key takeaway**` here is a standalone line, so it goes too.
    expect(markdown).not.toContain('Key takeaway');

    // Data survives intact.
    expect(markdown).toContain('{{glance:');
    expect(markdown).toContain('{{tiles:');
    expect(markdown).toContain('{{margin:');
    expect(markdown).toContain('### Strategic Position');
    expect(markdown).toContain('established residential suburb');
    expect(markdown).toContain('Growth Management Strategy');
  });

  it('is materially shorter and leaves no label for QA to find', () => {
    const { markdown, report } = postProcessReportMarkdown(SECTION, 'compass-40');
    expect(report.finalWordCount).toBeLessThan(report.initialWordCount);
    expect(findEditorialLabels(markdown)).toHaveLength(0);
  });

  it('does not glue a surviving block onto the one before it', () => {
    const { markdown } = postProcessReportMarkdown(SECTION, 'compass-40');
    // A heading that lost its paragraph break stops being a heading.
    expect(markdown).not.toMatch(/\S\n### /);
  });
});

describe('the word-cap trim keeps the data too', () => {
  // Found by running the post-processor over a whole assembled report for the
  // first time: 6 of 48 figures vanished. `truncateNarrativeToCap` had its own
  // inline structural test that covered blanks, tables, bullets and headings but
  // NOT `{{…}}` directives, so a figure counted against the word budget like a
  // paragraph and was truncated mid-shortcode once the budget ran out. It could
  // never show up before, because the caps only ran on the derived variants —
  // which carry no directives.
  const fat = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      `Paragraph ${i} of prose that exists only to burn through the word budget, `
      + 'repeated until the cap is comfortably exceeded and the trimmer has to act.',
    ).join('\n\n');

  const section = `## Amenity & Access

{{glance: ✓ One | ◆ Two | ⚠ Three}}

${fat(30)}

{{bars: Schools 82, Transport 61, Retail 74 | title=Amenity | max=100}}

| Amenity | Distance |
| --- | --- |
| Primary school | 1.1 km |

${fat(30)}

{{timeline: Existing "Highway upgrade", 3-5y "Town centre" | title=Pipeline}}
`;

  it('never truncates a chart directive', () => {
    const { markdown } = postProcessReportMarkdown(section, 'compass-40');
    expect(markdown).toContain('{{glance: ✓ One | ◆ Two | ⚠ Three}}');
    expect(markdown).toContain('{{bars: Schools 82, Transport 61, Retail 74 | title=Amenity | max=100}}');
    expect(markdown).toContain('{{timeline: Existing "Highway upgrade", 3-5y "Town centre" | title=Pipeline}}');
    // A half-eaten shortcode is worse than a long section: the figure is gone
    // and its source prints on the page in its place.
    expect(markdown).not.toMatch(/\{\{[^}]*…/);
  });

  it('still removes prose, and keeps the table', () => {
    const { markdown, report } = postProcessReportMarkdown(section, 'compass-40');
    expect(markdown.length).toBeLessThan(section.length);
    expect(report.sectionsTrimmed.length + report.trimsApplied.length).toBeGreaterThan(0);
    expect(markdown).toContain('| Primary school | 1.1 km |');
  });
});

describe('runQAValidation — the editorial-label rule', () => {
  it('fails a report that still carries a label, in any form', () => {
    for (const line of ['**What This Means**', '### NPC view', 'What to watch']) {
      const md = `## Executive Verdict\n\nProceed with caution.\n\n${line}\nSome commentary.\n`;
      const qa = runQAValidation(md, 'compass-40');
      const hit = qa.findings.find((f) => f.rule === 'editorial-label');
      expect(hit, line).toBeDefined();
      expect(hit?.severity).toBe('error');
    }
  });

  it('passes the same report once the post-processor has run', () => {
    const md = '## Executive Verdict\n\nProceed with caution.\n\n**What This Means**\nSome commentary.\n';
    const { markdown } = postProcessReportMarkdown(md, 'compass-40');
    const qa = runQAValidation(markdown, 'compass-40');
    expect(qa.findings.find((f) => f.rule === 'editorial-label')).toBeUndefined();
  });

  it('flags a section that is over its sub-heading budget', () => {
    const md = [
      '## Amenity & Access',
      ...Array.from({ length: 9 }, (_, i) => `### Sub ${i}\n\nSome text.`),
    ].join('\n\n');
    const qa = runQAValidation(md, 'compass-40');
    expect(qa.findings.find((f) => f.rule === 'subheading-density')).toBeDefined();
  });
});
