/**
 * What a Market Intelligence template may bind.
 *
 * The assertions that carry weight here are the ones about *omission*. This is
 * the format that clips a section and says so on the page, and the record shows
 * why — one stored `layer5_outlook` is 244,332 characters, about ninety-nine
 * pages of a single section. A projection that dropped content silently would
 * be indistinguishable from one that worked.
 */
import { describe, it, expect } from 'vitest';
import {
  projectMarketIntelligence, applyMarketIntelligenceProjection, layerPageCount, CAPS,
} from '../../../../supabase/functions/_shared/marketIntelligenceProjection.pure';
import { packMarkdownPages } from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import { MARKET_INTELLIGENCE_TEMPLATES }
  from '../../../../scripts/template-library/investmentCompass/marketIntelligence';

const BODY = [
  '## Rates',
  '',
  'The cash rate held at **4.35%**, with the board noting *sticky* services inflation.',
  '',
  '- Held in April',
  '- Market pricing one cut by December',
].join('\n');

function layer(key: string, title: string, over: Record<string, any> = {}) {
  return { key, title, content: BODY, citations: ['RBA'], empty: false, ...over };
}

function report(over: Record<string, any> = {}): any {
  return {
    meta: {
      reportId: 'r1',
      reportPeriod: 'April 2026',
      reportType: 'full',
      reportTypeLabel: 'Full market intelligence',
      audienceSegment: 'general',
      preparedOn: '2026-08-13T00:00:00.000Z',
      generatedAt: '2026-04-22T06:47:13.888Z',
      includeAdvisoryStrategy: true,
      layersShown: 2,
      layersEmpty: 1,
      truncated: false,
    },
    narrative: 'Rates held; housing steady.',
    prose: {
      executiveSummary: 'The period was defined by a hold.',
      keyInsightsSnapshot: 'Three things stood out.',
      actionableStrategy: 'Watch the December meeting.',
      ctaContent: 'Book a call with our team today!',
    },
    layers: [
      layer('layer1_rba', 'RBA & Interest Rate Analysis'),
      layer('layer2_housing', 'Housing Market Pulse', { content: '', empty: true }),
      layer('layer3_sentiment', 'Consumer & Investor Sentiment'),
    ],
    events: [
      { date: '2026-04-01', event: 'RBA holds', category: 'interest_rate', impact: 'Neutral', description: 'Held', relevanceScore: 0.8, upcoming: false },
      { date: '2026-12-01', event: 'December meeting', category: 'interest_rate', impact: 'Watch', description: 'Pricing a cut', relevanceScore: null, upcoming: true },
    ],
    citations: ['RBA', 'ABS'],
    correlation: null,
    notices: { layersEmpty: 1, sectionsDropped: 0, charsOmitted: 0 },
    ...over,
  };
}

describe('layers stay Markdown and empty ones are dropped, not carried', () => {
  const { marketIntel } = projectMarketIntelligence(report());

  it('publishes source rather than formatted text or HTML', () => {
    const layers = marketIntel.layers as any[];
    expect(layers[0].content).toContain('**4.35%**');
    expect(layers[0].content).not.toContain('<strong>');
  });

  it('drops the empty layer so positions are all real', () => {
    const layers = marketIntel.layers as any[];
    // Three layers in, one empty; the survivors must be contiguous so a master
    // binds `layers.0` and `layers.1` without a hole between them.
    expect(layers).toHaveLength(2);
    expect(layers.map((l) => l.key)).toEqual(['layer1_rba', 'layer3_sentiment']);
  });

  it('still says what came back empty', () => {
    expect(marketIntel.layersOmitted)
      .toBe('One section was requested and returned no content: Housing Market Pulse.');
  });

  it('pluralises when more than one is missing', () => {
    const { marketIntel: mi } = projectMarketIntelligence(report({
      layers: [
        layer('layer1_rba', 'RBA & Interest Rate Analysis'),
        layer('layer2_housing', 'Housing Market Pulse', { content: '', empty: true }),
        layer('layer4_regulatory', 'Regulatory & Policy Watch', { content: '', empty: true }),
      ],
    }));
    expect(mi.layersOmitted).toContain('2 sections were requested');
  });
});

describe('page counts agree with the block, and clipping is announced', () => {
  it('layerPageCount equals what packMarkdownPages will produce', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Para ${i}. ${'word '.repeat(30)}`).join('\n\n');
    for (const lpp of [12, 34, 80]) {
      expect(layerPageCount(long, lpp)).toBe(packMarkdownPages(renderMarkdown(long).blocks, lpp).length);
    }
  });

  it('says nothing when the layer fits its allocation', () => {
    const { marketIntel } = projectMarketIntelligence(report());
    expect((marketIntel.layers as any[])[0].omissionNote).toBeUndefined();
  });

  it('names the pages not shown when it does not fit', () => {
    // A 244,332-character layer exists in the record. A projection that dropped
    // its tail silently would look identical to one that worked.
    const huge = Array.from({ length: 200 }, (_, i) => `Para ${i}. ${'word '.repeat(30)}`).join('\n\n');
    const { marketIntel } = projectMarketIntelligence(report({
      layers: [layer('layer5_outlook', '90-Day Strategic Outlook', { content: huge })],
    }));
    const l = (marketIntel.layers as any[])[0];
    expect(l.pages).toBeGreaterThan(CAPS.layerPages);
    expect(l.omissionNote).toMatch(/continues for \d+ further pages/);
  });

  it('restates the document budget notice from the normaliser', () => {
    const { marketIntel } = projectMarketIntelligence(report({
      notices: { layersEmpty: 0, sectionsDropped: 2, charsOmitted: 40_000 },
    }));
    expect(marketIntel.truncationNote).toBe(
      'The document budget did not show 2 sections and 40,000 characters.',
    );
  });
});

describe('what it deliberately does not publish', () => {
  it('leaves the call to action out', () => {
    // `ctaContent` is copy for the email the legacy attached this PDF to. A
    // "book a call" panel in a market report reads as an advertisement.
    const { marketIntel } = projectMarketIntelligence(report());
    expect(JSON.stringify(marketIntel)).not.toContain('Book a call');
    expect((marketIntel.prose as any).ctaContent).toBeUndefined();
  });

  it('does not turn an absent relevance score into a zero', () => {
    const { marketIntel } = projectMarketIntelligence(report());
    expect((marketIntel.events as any[])[0].relevanceScore).toBe(0.8);
    expect((marketIntel.upcoming as any[])[0].relevanceScore).toBeUndefined();
  });

  it('never publishes an empty string or a null', () => {
    const { marketIntel } = projectMarketIntelligence(report({
      citations: [], events: [],
      prose: { executiveSummary: '', keyInsightsSnapshot: '', actionableStrategy: '', ctaContent: '' },
    }));
    const walk = (v: unknown): void => {
      if (v === '' || v === null) throw new Error('published an empty value');
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    expect(() => walk(marketIntel)).not.toThrow();
    expect(marketIntel.prose).toBeUndefined();
    expect(marketIntel.citations).toBeUndefined();
  });

  it('writes nothing at all when no layer has content', () => {
    const target: Record<string, unknown> = {};
    applyMarketIntelligenceProjection(target, report({
      narrative: '',
      layers: [layer('layer1_rba', 'RBA', { content: '', empty: true })],
    }) as any);
    // `audienceSegment` and `reportTypeLabel` are always present on the payload
    // and would otherwise make this truthy — a page conditional on
    // `marketIntel` would then draw blank.
    expect(target.marketIntel).toBeUndefined();
  });
});

describe('the fifty masters', () => {
  it('exist, uniquely', () => {
    expect(MARKET_INTELLIGENCE_TEMPLATES).toHaveLength(50);
    expect(new Set(MARKET_INTELLIGENCE_TEMPLATES.map((t) => t.slug)).size).toBe(50);
  });

  it('carry a category the column will accept', () => {
    // `market` is in the TypeScript union but not in the CHECK constraint. The
    // seed builder's guard caught that at build time; this keeps it caught.
    const ALLOWED = new Set([
      'investment', 'suburb', 'postcode', 'statewide', 'comparison',
      'cash_flow', 'client_form', 'compliance', 'finance', 'portfolio',
    ]);
    for (const t of MARKET_INTELLIGENCE_TEMPLATES) {
      expect(ALLOWED.has(t.category), `${t.slug} has category "${t.category}"`).toBe(true);
    }
  });

  it('bind every layer body to a markdown-block, never a text-block', () => {
    for (const master of MARKET_INTELLIGENCE_TEMPLATES) {
      for (const page of master.schema.pages as any[]) {
        for (const block of page.blocks as any[]) {
          const props = JSON.stringify(block.props ?? {});
          if (/\{\{marketIntel\.layers\.\d+\.content\}\}/.test(props)) {
            expect(block.type, `${master.slug} bound a layer to a ${block.type}`)
              .toBe('markdown-block');
          }
        }
      }
    }
  });

  it('make every layer continuation conditional on the projection page count', () => {
    /*
     * Bracket-indexed, and this assertion used to demand the opposite: it
     * matched `marketIntel.layers.0.pages`, the dot-numeric form that is a
     * SyntaxError inside a page conditional — so the spec enforced exactly the
     * defect that kept all thirty-two layer pages dark on every master. The
     * catalogue spec now constructs each expression as well, so the broken
     * form cannot come back under either file.
     */
    const master = MARKET_INTELLIGENCE_TEMPLATES[0];
    const conts = (master.schema.pages as any[])
      .filter((p) => /^Layer \d+ \(\d+\)$/.test(p.name));
    expect(conts.length).toBeGreaterThan(0);
    for (const p of conts) {
      expect(p.conditional).toMatch(/marketIntel\.layers\[\d+\]\.pages > \d+/);
      expect(() => new Function('marketIntel', `return (${p.conditional});`)).not.toThrow();
    }
  });
});

describe('what the legacy document says, restated', () => {
  it('labels the edition in the legacy cover line\'s words, never the enum', () => {
    expect((projectMarketIntelligence(report()).marketIntel.meta as any).editionLabel).toBe('General');
    const investor = projectMarketIntelligence(report({
      meta: { ...report().meta, audienceSegment: 'investor' },
    }));
    expect((investor.marketIntel.meta as any).editionLabel).toBe('Investor Edition');
  });

  it('publishes the audience panels the segment decides — one named, two general', () => {
    const general = projectMarketIntelligence(report()).marketIntel;
    expect((general.audiencePanels as any[]).map((p) => p.title)).toEqual([
      'What this means for investors', 'What this means for homebuyers',
    ]);
    const investor = projectMarketIntelligence(report({
      meta: { ...report().meta, audienceSegment: 'investor' },
    })).marketIntel;
    expect((investor.audiencePanels as any[])).toHaveLength(1);
    expect((investor.audiencePanels as any[])[0].title).toBe('What this means for your portfolio');
  });

  it('composes the timeline cells the legacy composes', () => {
    const { marketIntel } = projectMarketIntelligence(report());
    const ev = (marketIntel.events as any[])[0];
    expect(ev.dateLabel).toBe('01 Apr 2026');
    expect(ev.categoryLabel).toBe('interest rate');
    expect(ev.impactLabel).toBe('Neutral');
  });

  it('prints the em dash for an impact the record does not carry', () => {
    const { marketIntel } = projectMarketIntelligence(report({
      events: [{ date: '2026-04-01', event: 'X', category: 'economic', impact: '', description: 'd', relevanceScore: null, upcoming: false }],
    }));
    expect((marketIntel.events as any[])[0].impactLabel).toBe('—');
  });

  it('labels each event note with the event, upcoming first', () => {
    // "A date alone makes a reader flip back to the table" — the legacy's own
    // sidenote rule, and none of the stored report's twelve descriptions had
    // ever reached a page.
    const { marketIntel } = projectMarketIntelligence(report());
    const notes = marketIntel.eventNotes as any[];
    expect(notes.map((n) => n.label)).toEqual([
      '01 Dec 2026 · December meeting', '01 Apr 2026 · RBA holds',
    ]);
    expect(notes[1].description).toBe('Held');
    expect(marketIntel.eventNotesOmitted).toBeUndefined();
  });

  it('caps the notes and says so in a whole sentence', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, '0')}`, event: `E${i}`, category: 'economic',
      impact: 'neutral', description: `D${i}`, relevanceScore: null, upcoming: false,
    }));
    const { marketIntel } = projectMarketIntelligence(report({ events: many }));
    expect((marketIntel.eventNotes as any[])).toHaveLength(CAPS.eventNotes);
    expect(marketIntel.eventNotesOmitted)
      .toBe('3 further events are described only in the calendar above.');
  });

  it('pages the briefing like the other prose a model writes', () => {
    // The stored briefing measures 1,146 characters, already past the
    // 1,100-character block it used to be set into.
    const { marketIntel } = projectMarketIntelligence(report());
    expect((marketIntel.prose as any).keyInsightsPages).toBe(1);
  });

  it('publishes the correlation bodies paged, and nothing when there is none', () => {
    expect(projectMarketIntelligence(report()).marketIntel.correlation).toBeUndefined();
    const { marketIntel } = projectMarketIntelligence(report({
      correlation: {
        aiAnalysis: '## Correlation\n\nRates and clearance moved together.',
        perplexityResearch: 'The research corroborates the correlation.',
        citations: ['Source A'],
      },
    }));
    const corr = marketIntel.correlation as any;
    expect(corr.analysis).toContain('moved together');
    expect(corr.analysisPages).toBe(1);
    expect(corr.researchPages).toBe(1);
  });
});
