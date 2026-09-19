import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INVESTMENT_PRESENTATION_OPTIONS as DEFAULTS,
  applyPresentationOptionsToContent,
  filterNarrativeFigures,
  filterReportContent,
  filterSections,
  resolvePresentationOptions,
} from '../investment/presentationOptions';

const REPORT = [
  '# 1. Executive Summary',
  '',
  'The property at 12 Example Street was purchased for $700,000 with a weekly rent of $650.',
  '',
  '{{bars: Transport 80, Schools 70}}',
  '',
  '{{margin: Absorption | spark=4,5,6,4 | note=Demand rose and eased.}}',
  '',
  '{{margin: Context | note=A sidenote with no series at all.}}',
  '',
  '## 2. Investment Scoring',
  '',
  'The property scored 72 of 100.',
  '',
  '### 2.1 Score breakdown',
  '',
  'Growth 58, Location 70.',
  '',
  '## 3. Financial Position',
  '',
  'Gross yield 4.83%. Deposit $140,000, loan $560,000, LVR 80%.',
  '',
  '## 33. Data Sources',
  '',
  'ABS Census 2021, RBA statistical tables.',
  '',
  '## 34. Important Information',
  '',
  'This report is general information only.',
  '',
].join('\n');

describe('the two kinds of control are different kinds', () => {
  it('defaults to a complete document with hero imagery off', () => {
    expect(DEFAULTS).toEqual({
      includeSources: true,
      includeScoring: true,
      includeCharts: true,
      includeHeroImages: false,
      includeSparklines: true,
    });
  });

  it('resolves a partial set against the defaults', () => {
    expect(resolvePresentationOptions({ includeSources: false }))
      .toEqual({ ...DEFAULTS, includeSources: false });
    expect(resolvePresentationOptions(null)).toEqual(DEFAULTS);
    expect(resolvePresentationOptions(undefined)).toEqual(DEFAULTS);
  });
});

describe('content inclusion — Sources and Scoring', () => {
  it('changes nothing when both are on', () => {
    expect(filterReportContent(REPORT, DEFAULTS)).toBe(REPORT);
  });

  it('removes the sources section and nothing else', () => {
    const out = filterReportContent(REPORT, { ...DEFAULTS, includeSources: false });
    expect(out).not.toContain('Data Sources');
    expect(out).not.toContain('ABS Census 2021, RBA statistical tables');
    // Every other chapter survives, including the one that FOLLOWS it.
    expect(out).toContain('Executive Summary');
    expect(out).toContain('Investment Scoring');
    expect(out).toContain('Financial Position');
    expect(out).toContain('Important Information');
  });

  /**
   * The generated report numbers its headings. `## 33. Data Sources` has to
   * match a rule written as `sources?$`, or the switch silently does nothing
   * on every report the product actually produces.
   */
  it('matches a heading through its numeral', () => {
    expect(filterReportContent('## 33. Data Sources\n\nbody\n', { ...DEFAULTS, includeSources: false }))
      .not.toContain('body');
  });

  it('takes a removed section’s sub-headings with it', () => {
    const out = filterReportContent(REPORT, { ...DEFAULTS, includeScoring: false });
    expect(out).not.toContain('Investment Scoring');
    expect(out).not.toContain('Score breakdown');
    expect(out).not.toContain('Growth 58, Location 70');
    expect(out).toContain('Financial Position');
  });

  /**
   * The rule that keeps these honest: removing the scoring SECTION removes a
   * section. It does not touch a figure, a calculation or a sentence anywhere
   * else in the document.
   */
  it('never alters a figure in a section it keeps', () => {
    const out = filterReportContent(REPORT, {
      ...DEFAULTS, includeSources: false, includeScoring: false,
    });
    expect(out).toContain('$700,000');
    expect(out).toContain('$650');
    expect(out).toContain('4.83%');
    expect(out).toContain('$140,000');
    expect(out).toContain('$560,000');
    expect(out).toContain('LVR 80%');
  });

  it('filters a parsed section map by the same rule', () => {
    const sections = { 'Data Sources': 'a', 'Investment Scoring': 'b', 'Financial Position': 'c' };
    expect(Object.keys(filterSections(sections, { ...DEFAULTS, includeSources: false })))
      .toEqual(['Investment Scoring', 'Financial Position']);
    expect(Object.keys(filterSections(sections, { ...DEFAULTS, includeScoring: false })))
      .toEqual(['Data Sources', 'Financial Position']);
  });
});

describe('presentation — Charts and Sparklines', () => {
  it('changes nothing when both are on', () => {
    expect(filterNarrativeFigures(REPORT, DEFAULTS)).toBe(REPORT);
  });

  it('removes chart directives and leaves every word of the prose', () => {
    const out = filterNarrativeFigures(REPORT, { ...DEFAULTS, includeCharts: false });
    expect(out).not.toContain('{{bars:');
    expect(out).toContain('purchased for $700,000');
    expect(out).toContain('weekly rent of $650');
    // A sparkline is not a chart.
    expect(out).toContain('spark=4,5,6,4');
  });

  it('removes a sparkline without removing the sidenote that carries no series', () => {
    const out = filterNarrativeFigures(REPORT, { ...DEFAULTS, includeSparklines: false });
    expect(out).not.toContain('spark=4,5,6,4');
    expect(out).toContain('A sidenote with no series at all');
    // A chart is not a sparkline.
    expect(out).toContain('{{bars:');
  });

  it('removes both when both are off, and still nothing else', () => {
    const out = filterNarrativeFigures(REPORT, {
      ...DEFAULTS, includeCharts: false, includeSparklines: false,
    });
    expect(out).not.toContain('{{bars:');
    expect(out).not.toContain('spark=');
    expect(out).toContain('A sidenote with no series at all');
    expect(out).toContain('$700,000');
  });
});

describe('the whole pass', () => {
  it('applies content rules and figure rules together', () => {
    const out = applyPresentationOptionsToContent(REPORT, {
      includeSources: false,
      includeScoring: false,
      includeCharts: false,
      includeHeroImages: false,
      includeSparklines: false,
    });
    expect(out).not.toContain('Data Sources');
    expect(out).not.toContain('Investment Scoring');
    expect(out).not.toContain('{{bars:');
    expect(out).not.toContain('spark=');
    // What a client is still owed.
    expect(out).toContain('Executive Summary');
    expect(out).toContain('Financial Position');
    expect(out).toContain('Important Information');
    expect(out).toContain('$700,000');
  });

  it('is the identity when nothing is switched off', () => {
    expect(applyPresentationOptionsToContent(REPORT, DEFAULTS)).toBe(REPORT);
  });
});
