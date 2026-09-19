/**
 * Reading a Market Intelligence row.
 *
 * The four editorial strips are carried verbatim from the generator being
 * replaced, so they are asserted against the phrases that generator actually
 * matches rather than against paraphrases. Two of its passes are deliberately
 * **not** carried, and there is an assertion for each of those too — a strip
 * that was dropped on purpose looks identical, in a diff, to one that was
 * forgotten.
 */
import { describe, expect, it } from 'vitest';
import {
  buildMarketIntelligenceReport,
  cleanLayerContent,
  layerSummary,
  narrativeFor,
  stripDataLimitations,
  stripDuplicateBrandTagline,
  stripEmptyRegulatorySections,
  toCitations,
  toEvents,
  toLayers,
} from '../normalise.pure';
import { LAYER_ORDER, LAYER_TITLES } from '../payload.pure';
import { cites, layerBody, PREPARED_ON, prose, reportRow } from './fixtures';

const BRAND = 'Tenant Advisory';
const build = (row: unknown, audienceOverride?: string | null) =>
  buildMarketIntelligenceReport({
    row: row as never,
    preparedOn: PREPARED_ON,
    brandName: BRAND,
    audienceOverride,
  });

describe('the editorial strips', () => {
  it('removes a data-limitations aside', () => {
    const cleaned = stripDataLimitations(
      `${prose(0, 1)}\n\n## Data Limitations\n\nSome sources were unavailable.\n\n## Next\n\nMore.`,
    );
    expect(cleaned).not.toMatch(/Data Limitations/i);
    expect(cleaned).toContain('## Next');
  });

  it('drops a numbered regulatory section that is mostly N/A', () => {
    // The heuristic is the generator's own: two or more N/A phrases and fewer
    // than four substantive lines. Asserted against that shape rather than a
    // paraphrase, because the whole claim is that it is carried unchanged.
    const cleaned = stripEmptyRegulatorySections(
      '### 1. Land tax thresholds\nN/A\nWhen:\nWhich States\nN/A\n\n'
      + '### 2. Lending standards\nThe buffer is unchanged at 3%.\nAPRA restated its position.\n'
      + 'Two lenders repriced.\nBrokers report faster approvals.\n',
    );
    expect(cleaned).toContain('Lending standards');
    expect(cleaned).not.toContain('Land tax thresholds');
  });

  it('keeps a numbered regulatory section that has something to say', () => {
    const body = '### 1. Land tax thresholds\nTwo states have flagged changes.\n'
      + 'Neither has legislated.\nConsultation closes this quarter.\nImpact is deferred.\n';
    expect(stripEmptyRegulatorySections(body)).toContain('Land tax thresholds');
  });

  it('removes the model\'s own "Why <brand>?" block', () => {
    const withTagline = `${prose(0, 1)}\n\n## Why ${BRAND}?\n\nWe are data-driven and insight-led.\n`;
    const cleaned = stripDuplicateBrandTagline(withTagline, BRAND);
    expect(cleaned).not.toContain('insight-led');
    expect(cleaned).toContain('cash rate');
  });

  it('removes the house block by name too, whoever the tenant is', () => {
    // The prompts still say "NPC Services" on a white-labelled deployment, so
    // the generator matches that literal as well as the tenant's own name.
    const cleaned = stripDuplicateBrandTagline(
      '## Why NPC Services?\n\nWe are data-driven.\n', 'Someone Else',
    );
    expect(cleaned).not.toContain('data-driven');
  });

  it('leaves a different firm\'s block alone', () => {
    const other = '## Why Another Advisory?\n\nThey are data-driven.\n';
    expect(stripDuplicateBrandTagline(other, BRAND)).toContain('Another Advisory');
  });

  it('does not transliterate away non-Latin text', () => {
    // The generator's `sanitise` drops every codepoint outside a Latin-1
    // whitelist, because jsPDF cannot set them. WeasyPrint can, and the
    // container installs `fonts-noto-cjk` precisely so it does.
    const cleaned = cleanLayerContent(`${prose(0, 1)}\n\nContact 中村 佳子 for detail.`, BRAND);
    expect(cleaned).toContain('中村 佳子');
  });

  it('keeps smart punctuation and arrows', () => {
    const cleaned = cleanLayerContent('Growth rose 4.1% — up from 3.8% — and vacancy fell ≤ 1.1%.', BRAND);
    expect(cleaned).toContain('—');
    expect(cleaned).toContain('≤');
  });

  it('neutralises a bare URL so the resource policy cannot fire', () => {
    const cleaned = cleanLayerContent('See https://example.test/report for the full series.', BRAND);
    expect(cleaned).not.toContain('//');
    expect(cleaned).not.toMatch(/https?:/);
  });
});

describe('layers', () => {
  it('is ordered 1, 2, 3, 4, 6, 7, 8, then 5', () => {
    expect(LAYER_ORDER[LAYER_ORDER.length - 1]).toBe('layer5_outlook');
    expect([...LAYER_ORDER]).toEqual([
      'layer1_rba', 'layer2_housing', 'layer3_sentiment', 'layer4_regulatory',
      'layer6_economic', 'layer7_micro', 'layer8_competitive_edge', 'layer5_outlook',
    ]);
  });

  it('carries an empty layer rather than dropping it, so the document can say so', () => {
    const data = { ...(reportRow().report_data as Record<string, unknown>) };
    data.layer3_sentiment = { content: '' };
    const layers = toLayers(data, BRAND);
    const sentiment = layers.find((l) => l.key === 'layer3_sentiment');
    expect(sentiment).toBeDefined();
    expect(sentiment!.empty).toBe(true);
    expect(sentiment!.title).toBe(LAYER_TITLES.layer3_sentiment);
  });

  it('treats a layer under MIN_SECTION_CHARS as empty', () => {
    const data = { ...(reportRow().report_data as Record<string, unknown>) };
    data.layer4_regulatory = { content: 'No data available.' };
    const layers = toLayers(data, BRAND);
    expect(layers.find((l) => l.key === 'layer4_regulatory')!.empty).toBe(true);
  });

  it('matches includedLayers by its short name', () => {
    // The row stores `layer1`, the payload key is `layer1_rba`. Matching on the
    // full key would mark every layer as un-requested.
    const data = { includedLayers: ['layer1'], layer1_rba: { content: layerBody(0) } };
    const layers = toLayers(data, BRAND);
    expect(layers.map((l) => l.key)).toEqual(['layer1_rba']);
    expect(layers[0].empty).toBe(false);
  });
});

describe('citations', () => {
  it('deduplicates in first-seen order', () => {
    const seen = new Set<string>();
    expect(toCitations(['A', 'B', 'A'], seen)).toEqual(['A', 'B']);
    expect(toCitations(['B', 'C'], seen)).toEqual(['C']);
  });

  it('ignores anything that is not a list of strings', () => {
    expect(toCitations(null)).toEqual([]);
    expect(toCitations([1, {}, ''])).toEqual([]);
  });
});

describe('events', () => {
  it('puts what is still ahead first, then the past most-recent-first', () => {
    const parsed = toEvents(
      [
        { date: '2026-01-05', event: 'Past A' },
        { date: '2026-09-01', event: 'Future A' },
        { date: '2026-07-01', event: 'Past B' },
        { date: '2026-12-01', event: 'Future B' },
      ],
      PREPARED_ON,
    );
    expect(parsed.map((e) => e.event)).toEqual(['Future A', 'Future B', 'Past B', 'Past A']);
    expect(parsed.map((e) => e.upcoming)).toEqual([true, true, false, false]);
  });

  it('drops an entry with no date or no name rather than printing a blank row', () => {
    expect(toEvents([{ event: 'No date' }, { date: '2026-01-01' }], PREPARED_ON)).toEqual([]);
  });
});

describe('refusals', () => {
  it('refuses a row that is still generating', () => {
    const result = build(reportRow({ row: { status: 'generating' } }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/generating/);
  });

  it('refuses a row with no payload', () => {
    const result = build(reportRow({ row: { report_data: null } }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/payload/);
  });

  it('refuses a row with no id', () => {
    expect(build({ status: 'completed', report_data: {} }).ok).toBe(false);
  });

  it('refuses a payload with nothing worth printing', () => {
    expect(build(reportRow({ row: { report_data: { reportPeriod: 'April 2026' } } })).ok).toBe(false);
  });
});

describe('the narrative', () => {
  it('names the empty layers and the event count', () => {
    const text = narrativeFor('April 2026', 'Full Report', 11, 3, 12);
    expect(text).toContain('in 11 sections');
    expect(text).toContain('3 layers were requested');
    expect(text).toContain('12 dated market events');
  });

  it('is singular for one of each', () => {
    const text = narrativeFor('April 2026', 'Full Report', 1, 1, 1);
    expect(text).toContain('in one section');
    expect(text).toContain('One layer was');
    expect(text).toContain('1 dated market event ');
  });
});

describe('the audience override', () => {
  it('leaves the row alone when absent', () => {
    const result = build(reportRow());
    expect(result.ok && result.report.meta.audienceSegment).toBe('general');
  });

  it('issues the report as another edition without touching the prose', () => {
    const asStored = build(reportRow());
    const asHomebuyer = build(reportRow(), 'homebuyer');
    expect(asHomebuyer.ok && asHomebuyer.report.meta.audienceSegment).toBe('homebuyer');
    // Every word the model wrote is the same; only the edition differs.
    expect(asHomebuyer.ok && asStored.ok
      && asHomebuyer.report.layers.map((l) => l.content))
      .toEqual(asStored.ok ? asStored.report.layers.map((l) => l.content) : null);
  });
});

describe('the whole report', () => {
  it('counts what was shown and what was empty', () => {
    const result = build(reportRow({ data: { layer3_sentiment: { content: '' } } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.meta.layersEmpty).toBe(1);
    expect(result.report.meta.layersShown).toBe(7);
    expect(result.report.notices.layersEmpty).toBe(1);
  });

  it('reads the correlation block when the row carries one', () => {
    const result = build(reportRow({
      data: {
        correlationData: {
          aiAnalysis: `## Together\n\n${prose(0, 1)}`,
          perplexityResearch: prose(1, 1),
          citations: cites(2),
        },
      },
    }));
    expect(result.ok && result.report.correlation).not.toBeNull();
  });

  it('has no correlation block when the row does not carry one', () => {
    // Every one of the six stored reports is in this state, because nothing
    // wrote the column until this migration.
    expect(build(reportRow()).ok && build(reportRow()).ok
      && (build(reportRow()) as { ok: true; report: { correlation: unknown } }).report.correlation)
      .toBeNull();
  });
});

describe('layerSummary', () => {
  it('says so for an empty layer', () => {
    expect(layerSummary({ key: 'layer1_rba', title: 'x', content: '', citations: [], empty: true }))
      .toBe('No data returned');
  });

  it('skips the heading and takes the first line of prose', () => {
    const body = layerBody(0);
    const summary = layerSummary({
      key: 'layer1_rba', title: 'x', content: body, citations: [], empty: false,
    });
    expect(summary.startsWith('#')).toBe(false);
    // Read off the fixture rather than quoted from it: the fixture's prose
    // varies per layer by design, and a quoted phrase makes this a test of the
    // fixture's wording instead of the normaliser's behaviour.
    const firstProseLine = body.split('\n').find((l) => l.trim() && !l.startsWith('#'));
    expect(firstProseLine).toContain(summary.replace(/…$/, '').slice(0, 40));
  });

  it('ends on a word and says it was cut', () => {
    const summary = layerSummary({
      key: 'layer1_rba', title: 'x', content: layerBody(0), citations: [], empty: false,
    }, 40);
    expect(summary.length).toBeLessThanOrEqual(40);
    expect(summary.endsWith('…')).toBe(true);
    // Not mid-word: the character before the ellipsis is the end of a token.
    expect(summary.slice(0, -1)).not.toMatch(/-$/);
  });
});
