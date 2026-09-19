/**
 * Phase 3 — heading resolution and the partition rule, measured against the
 * corpus rather than against opinion.
 *
 * Phase 2 built the registry and proved every declared section can be produced.
 * Phase 3 assembles documents from it, and the first question that has to be
 * answered honestly is whether the registry can recognise what production
 * actually wrote. Measured over the 1,199 stored reports: **966 distinct H2
 * headings** for a product with 38 sections.
 *
 * ## The fixture used to be half the corpus
 *
 * It carried H2 headings only, because the partition read `##` only. Both were
 * wrong about the same thing: **70.2% of stored reports write their sections
 * at H1** (`# 1. Location Overview` … `# 36. Demographic & Economic Data`), and
 * that cohort's headings are the larger half by instances — 26,860 against
 * 10,185. So this file measured 27% of the corpus's section headings and
 * reported a coverage number about the rest of it.
 *
 * The consequence was not academic. Ten headings the registry could not name
 * sat above 400 reports each — `12. Amenity Scores` on 578,
 * `22. Principal & Interest Loan` on 541 — and none could show up here.
 * Adding them lifted H1 resolution from 78.9% to 96.0% and reassigned nothing:
 * across all 575 fixture rows, 30 headings gained a section and **0 changed
 * section or lost one**.
 *
 * The fixture therefore carries `level` now, and every row is a heading
 * production actually wrote at that level. Its H1 half has a floor of ten
 * reports rather than two, because below ten the H1 inventory is dominated by
 * document title blocks that name a client's property
 * (`Investment Report: 68 Craigmore Drive, …`, on 2-9 reports each). A coverage
 * instrument is not a corpus dump, and those are neither sections nor ours to
 * keep in a repository.
 *
 * That ratio is the finding. The legacy generator promotes its sub-headings to
 * H2 — `Strengths`, `Weaknesses`, `Opportunities` and `Threats` under SWOT;
 * `Market Commentary:` and `Yield Commentary:` under their own sections; the
 * whole `11.1 …` / `15.1 …` / `4.2 …` family — so a partition that dropped
 * every heading it could not name would discard nearly a third of every legacy
 * document, and one that treated each as a section would fragment one SWOT into
 * four.
 *
 * Hence the rule these tests exist to hold: **an unrecognised heading is
 * content belonging to the section above it. Never a section, never a
 * deletion.**
 *
 * `fixtures/corpusHeadings.json` is the real heading inventory — every heading
 * carried by two or more reports, with its report count, scrubbed of the twelve
 * singletons that named a property address. It is a fixture rather than a live
 * query so the guard runs in CI, and it is the reason a coverage regression
 * shows up as a failing number instead of as a quietly thinner report.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isSubHeadingByNumbering,
  normaliseHeading,
  partitionByRegistry,
  sectionIdForHeading,
} from '../investment/sectionRegistry.pure';

type HeadingRow = { h: string; reports: number; level: 1 | 2 };

const FIXTURE: HeadingRow[] = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/corpusHeadings.json'), 'utf8'),
);

/**
 * Headings that are not sections, so the registry is right not to name them.
 *
 * One list, read by both coverage guards below. It was two — an inline
 * `!== 'contact us'` in one and a longer allowance in the other — and they
 * disagreed the moment the fixture grew: `REPORT TITLE`, on 570 reports, is
 * furniture by one and a missing section by the other.
 */
const NOT_A_SECTION = (h: string): boolean => {
  const n = normaliseHeading(h);
  return (
    h.trimEnd().endsWith(':') ||             // `Market Commentary:`, a sub-heading
    isSubHeadingByNumbering(h) ||             // `11.1 Public Transport Network`
    ['strengths', 'weaknesses', 'opportunities', 'threats'].includes(n) ||
    // Marketing furniture and document title blocks. A title sits above the
    // first section and is absorbed into the preamble, which is where it
    // belongs — attributing it to whatever follows would put the letterhead
    // inside a client's verdict.
    [
      'contact us',                                                    // 787 reports
      'report title',                                                  // 570
      'naidu property consulting services',                            // 403
      'client investment feasibility & financial performance report',  // 11, the Financial fork
      'property & location due diligence report',                      // 11, the Due Diligence fork
    ].includes(n)
  );
};

/**
 * Section headings the registry deliberately does not name, and why.
 *
 * Frozen the way `PRODUCER_GAPS` and `edge-missing-names.txt` are: closing one
 * means deleting its line, and a NEW unnamed section fails the guard below.
 * The difference from `NOT_A_SECTION` is the whole point — these ARE sections,
 * and saying so is more honest than filing them under furniture.
 */
const UNNAMED_SECTIONS: ReadonlyArray<{ h: string; why: string }> = [
  {
    h: '37. Methodology Notes',
    // Naming it would cost more than it buys. `normaliseHeading` strips a
    // trailing colon, so one alias covers both forms — and the corpus writes
    // `Methodology Notes:` as a sub-heading on 31 reports against 22 that write
    // it as a section. The alias would promote a sub-heading more often than it
    // named a section.
    why: 'the colon sub-heading form outnumbers the section form, 31 reports to 22',
  },
  {
    h: '6. Investment Insights',
    // It sits in an eight-section variant between `Demographics` and
    // `Environmental & Risk Factors`, where either the verdict or the
    // recommendation could live. The corpus does not settle which, and a
    // registry that guesses is the thing this file exists to prevent.
    why: 'a real section on 17 reports whose target the corpus does not settle',
  },
];

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe('a heading is stripped to what identifies it', () => {
  it('removes a leading ordinal, with or without trailing punctuation', () => {
    expect(normaliseHeading('9. Financial Analysis')).toBe('financial analysis');
    // The case the first version missed: the legacy generator numbers its
    // sub-sections `11.1 X` with no punctuation after the number, and that one
    // absent `?` in the pattern cost 3.5 points of corpus coverage.
    expect(normaliseHeading('11.1 Public Transport Network')).toBe('public transport network');
    expect(normaliseHeading('4.2 Public Transport Access')).toBe('public transport access');
    expect(normaliseHeading('12) Key Opportunities')).toBe('key opportunities');
  });

  it('removes emoji and a trailing colon, and collapses whitespace', () => {
    expect(normaliseHeading('⚖️ PROFESSIONAL DISCLAIMER')).toBe('professional disclaimer');
    expect(normaliseHeading('Market Commentary:')).toBe('market commentary');
    expect(normaliseHeading('  Risk   Dashboard ')).toBe('risk dashboard');
  });

  it('never eats a number that is part of the name', () => {
    // `10-Year …` survives because a hyphen is not whitespace.
    expect(normaliseHeading('10-Year Investment Projections')).toBe('10-year investment projections');
    expect(normaliseHeading('Top 3 Risks')).toBe('top 3 risks');
    // And a bare number followed by a space is NOT an ordinal. Making the
    // trailing punctuation merely optional would strip this, and no corpus
    // heading has the shape today — which is the moment to close it, not after
    // one arrives.
    expect(normaliseHeading('2026 Market Review')).toBe('2026 market review');
    expect(normaliseHeading('12 Month Outlook')).toBe('12 month outlook');
  });
});

// ---------------------------------------------------------------------------
// Qualified variants
// ---------------------------------------------------------------------------

describe('a known name with a qualifier is the same section', () => {
  it.each([
    ['Property Value Projections (AUD)', 'tenYear'],
    ['Cumulative Cashflow Projections (10 Years - AUD)', 'tenYear'],
    ['Rental Income Projections (Annual - AUD)', 'tenYear'],
    ['Sensitivity Analysis (interest rate, rent, vacancy)', 'sensitivity'],
    ['Cashflow Analysis - Interest-Only Scenario (Year 1)', 'loan'],
    ['Environmental Risk: High Bushfire Rating and Moderate Flood Risk', 'environmentalRisk'],
  ])('%s → %s', (heading, id) => {
    expect(sectionIdForHeading(heading)).toBe(id);
  });

  it('will not let a short name swallow a longer, different one', () => {
    // `Market Position` prefixes `Market Positioning`, so matching on a bare
    // space would make every qualified heading resolve to whichever alias
    // happened to be shortest. The separator must be a bracket, a dash or a
    // colon.
    expect(sectionIdForHeading('Market Position Relative To Nothing')).toBeNull();
    expect(sectionIdForHeading('Risk Dashboard Extended Commentary')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Corpus coverage
// ---------------------------------------------------------------------------

describe('the registry recognises what production wrote', () => {
  const unresolved = FIXTURE.filter((r) => sectionIdForHeading(r.h) === null);
  const instances = (rows: HeadingRow[]) => rows.reduce((s, r) => s + r.reports, 0);
  const coverage = (rows: HeadingRow[]) =>
    (100 * instances(rows.filter((r) => sectionIdForHeading(r.h) !== null))) / instances(rows);

  // A floor per level, not a target, and each is stated as a separate number
  // because one figure over both hides exactly what this file got wrong: a
  // healthy blended percentage said nothing about the 70% of documents whose
  // headings were not in the fixture at all.
  it.each([
    [1 as const, 95],
    [2 as const, 75],
  ])('resolves H%i heading instances above %i%%, and the floor only rises', (level, floor) => {
    expect(coverage(FIXTURE.filter((r) => r.level === level))).toBeGreaterThan(floor);
  });

  it('the headings it cannot name are sub-headings and furniture, not sections', () => {
    // Every unresolved heading carried by 15+ reports, checked by eye against
    // the corpus. If a NEW one joins them, this fails and somebody looks at
    // it — which is the point: an unrecognised section is a silent hole, and an
    // unrecognised sub-heading is fine.
    const known = new Set(UNNAMED_SECTIONS.map((u) => u.h));
    const loud = unresolved.filter((r) => r.reports >= 15 && !NOT_A_SECTION(r.h) && !known.has(r.h));
    // Reported together rather than one at a time: the first failure of this
    // kind is rarely the only one, and a list is what somebody can act on.
    expect(loud.map((r) => `${r.reports}× ${r.h}`)).toEqual([]);
  });

  it('every deliberately unnamed section is still unnamed, and still in the corpus', () => {
    // The list can only shrink. Naming one means deleting its line; and an
    // entry the corpus no longer carries is a stale excuse rather than a
    // decision, so it has to go too.
    for (const { h } of UNNAMED_SECTIONS) {
      expect(sectionIdForHeading(h), `"${h}" now resolves — delete its UNNAMED_SECTIONS line`).toBeNull();
      expect(FIXTURE.some((r) => r.h === h), `"${h}" is no longer in the corpus`).toBe(true);
    }
  });

  it('resolves every heading the current generators are declared to write', () => {
    // Anything on 100+ reports is structural rather than incidental.
    const structural = FIXTURE.filter((r) => r.reports >= 100 && !NOT_A_SECTION(r.h));
    for (const r of structural) {
      expect(sectionIdForHeading(r.h), `"${r.h}" on ${r.reports} reports resolves to nothing`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// The partition rule
// ---------------------------------------------------------------------------

describe('an unrecognised heading belongs to the section above it', () => {
  it('opens a section on a recognised heading and keeps its body', () => {
    const { sections, preamble } = partitionByRegistry(
      '# Title\n\nintro\n\n## Risk Dashboard\n\nflood risk\n\n## Final Recommendation\n\nproceed\n',
    );
    expect(preamble).toBe('# Title\n\nintro');
    expect(sections.map((s) => s.id)).toEqual(['riskDashboard', 'recommendation']);
    expect(sections[0].body).toBe('flood risk');
    expect(sections[1].body).toBe('proceed');
  });

  it('absorbs a sub-heading into the open section rather than splitting it', () => {
    // The SWOT case. Four H2s, one section — not four.
    const { sections, absorbed } = partitionByRegistry(
      '## SWOT Analysis\n\n## Strengths\n\na\n\n## Weaknesses\n\nb\n\n## Threats\n\nc\n',
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('swot');
    // Every word survives, headings included.
    expect(sections[0].body).toContain('## Strengths');
    expect(sections[0].body).toContain('## Weaknesses');
    expect(sections[0].body).toContain('## Threats');
    expect(sections[0].body).toContain('c');
    expect(absorbed.map((a) => a.heading)).toEqual(['Strengths', 'Weaknesses', 'Threats']);
    expect(absorbed.every((a) => a.into === 'swot')).toBe(true);
  });

  it('reports what it absorbed, so a new heading is visible rather than swallowed', () => {
    const { absorbed } = partitionByRegistry('## Risk Dashboard\n\n## Something Nobody Declared\n\nx\n');
    expect(absorbed).toEqual([{ heading: 'Something Nobody Declared', into: 'riskDashboard' }]);
  });

  it('keeps furniture before the first section out of it', () => {
    // `📞 CONTACT US` is on 761 reports and is not a section. Attributing it to
    // whatever follows would put marketing inside a client's verdict.
    const { preamble, sections, absorbed } = partitionByRegistry(
      '## 📞 CONTACT US\n\ncall us\n\n## Executive Verdict\n\nproceed\n',
    );
    expect(preamble).toContain('call us');
    expect(sections.map((s) => s.id)).toEqual(['verdict']);
    expect(sections[0].body).toBe('proceed');
    expect(absorbed[0]).toEqual({ heading: '📞 CONTACT US', into: null });
  });

  it('loses nothing — every line of the input survives somewhere', () => {
    const doc = [
      '# Investment Report', '', 'preamble line', '',
      '## 📞 CONTACT US', '', 'furniture', '',
      '## Location Overview', '', 'the location', '',
      '## 11.1 Public Transport Network', '', 'trains', '',
      '## SWOT Analysis', '', '## Strengths', '', 'good bones', '',
    ].join('\n');
    const { preamble, sections, absorbed } = partitionByRegistry(doc);
    const rejoined = [preamble, ...sections.map((s) => `## ${s.heading}\n${s.body}`)].join('\n');
    for (const line of ['preamble line', 'furniture', 'the location', 'trains', 'good bones']) {
      expect(rejoined, `lost: ${line}`).toContain(line);
    }
    expect(sections.map((s) => s.id)).toEqual(['locationCase', 'swot']);
    expect(absorbed.map((a) => a.heading)).toEqual(['📞 CONTACT US', '11.1 Public Transport Network', 'Strengths']);
  });

  it('keeps a repeated section id in order rather than collapsing it', () => {
    // Production briefing 89b451f6 spreads one section across several headings:
    // 29 headings resolve to 21 distinct sections, with `marketPosition` four
    // times and `tenYear` three. Folding them here would merge bodies that were
    // written apart and silently reorder a client's document.
    const { sections } = partitionByRegistry(
      '## Historical Price Growth Table\n\na\n\n## Market Activity\n\nb\n\n## Risk Dashboard\n\nc\n\n## Comparable Market Evidence\n\nd\n',
    );
    expect(sections.map((s) => s.id)).toEqual([
      'marketPosition', 'marketPosition', 'riskDashboard', 'marketPosition',
    ]);
    expect(sections.map((s) => s.body)).toEqual(['a', 'b', 'c', 'd']);
    // Each keeps the heading the document actually used, which is what lets a
    // later step fold them without inventing a title.
    expect(sections[0].heading).toBe('Historical Price Growth Table');
    expect(sections[3].heading).toBe('Comparable Market Evidence');
  });

  it('handles a document with no recognised heading at all', () => {
    const { preamble, sections } = partitionByRegistry('# Title\n\njust prose\n');
    expect(sections).toEqual([]);
    expect(preamble).toBe('# Title\n\njust prose');
  });

  it('handles an empty document', () => {
    // Level 2 on a tie, which is what every document verified before the H1
    // measurement relied on.
    expect(partitionByRegistry('')).toEqual({ preamble: '', sections: [], absorbed: [], level: 2 });
  });
});
