import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The standard presentation may not print a chart directive, and removing one
 * may not cost the document a chapter.
 *
 * The generator's prompt writes figures as `{{bars: …}}`, `{{gauge: …}}`,
 * `{{glance: …}}` and nine more kinds; `markdown.pure.ts` states the rule for
 * them — a directive is drawn or dropped, and its source is never printed.
 * This presentation had never heard of them: measured on production report
 * 783bb982, THIRTY-SIX raw directives were set as body copy, one of them
 * repeated on four consecutive pages as a table's header row. 60 of the 1,195
 * completed reports carry directives (4,652 of them), and they are the ones
 * the current generator writes.
 *
 * The second assertion is the one that matters more, because the first fix
 * broke it: removing the directives BEFORE `parseReportContent` emptied every
 * chapter whose own body is a single `{{glance: …}}` opener, and
 * `allSectionNames` drops a section under 40 characters — so four chapters,
 * their contents entries and the appendix that carries the source notes
 * disappeared from the document.
 */
vi.mock('@/hooks/useGlobalReportSettings', async (orig) => ({
  ...(await orig() as object),
  fetchGlobalReportSettings: async () => ({
    contactDetails: {
      company_name: 'Test Co', phone: '', email: '', website: '', address: '', abn: '',
    },
    disclaimer: { text: 'Test disclaimer.', font_size: 'medium', is_enabled: true },
  }),
}));

const CHAPTERS = ['Alpha Chapter', 'Beta Chapter', 'Gamma Chapter'];

/** A chapter whose OWN body is only a glance strip; its prose is in its H3. */
const CONTENT = [
  '# Investment Report: 9 Test Street, Cowra NSW 2794',
  '',
  '## Alpha Chapter',
  '',
  '{{glance: ✓ One | ◆ Two | ⚠ Three | ★ Four}}',
  '',
  '### Alpha Detail',
  '',
  'Alpha prose that is comfortably longer than the forty-character floor the section filter applies.',
  '',
  '## Beta Chapter',
  '',
  '{{gauge: 64 | Location Fundamentals | Regional town with steady growth}}',
  '',
  '### Beta Detail',
  '',
  'Beta prose that is comfortably longer than the forty-character floor the section filter applies.',
  '',
  '## Gamma Chapter',
  '',
  'Gamma prose with an inline {{bars: One 8, Two 7, Three 5 | max=10}} figure and more words after it '
  + 'so the section clears the forty-character floor with room to spare.',
  '',
].join('\n');

const REPORT = {
  id: 'test-report',
  address: '9 Test Street, Cowra NSW 2794',
  content: CONTENT,
  created_at: '2026-09-13T00:00:00.000Z',
  enhanced_data: { financialData: {}, investmentScore: {} },
};

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? input);
    if (url.startsWith('/')) {
      const file = path.resolve(process.cwd(), 'public', url.replace(/^\//, ''));
      if (!fs.existsSync(file)) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(fs.readFileSync(file)), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

async function drawnText(
  report: unknown = REPORT, reportTier: 'compass' | 'financial' = 'compass',
): Promise<string> {
  const { generateInvestmentPdfBlob } = await import('../investmentPdfDocument');
  const { blob } = await generateInvestmentPdfBlob({ report: report as any, reportTier });
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false,
  }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out += content.items.map((it: any) => it.str ?? '').join('') + '\n';
  }
  return out;
}

describe('the standard Investment presentation and chart directives', () => {
  it('prints no directive source, and keeps every chapter it came from', async () => {
    const text = await drawnText();
    expect(text.match(/\{\{[^}\n]{0,40}/g) ?? []).toEqual([]);
    for (const chapter of CHAPTERS) {
      expect(text.replace(/\s+/g, ''), `${chapter} must survive`)
        .toContain(chapter.replace(/\s+/g, ''));
    }
    // The prose the directive sat beside is untouched — a removed figure never
    // removes a sentence.
    expect(text.replace(/\s+/g, '')).toContain('Alphaprosethatiscomfortably');
    expect(text.replace(/\s+/g, '')).toContain('figureandmorewordsafterit');
  }, 120_000);

  /**
   * The KPI band reads the key a producer actually writes.
   *
   * It asked for `keyMetrics.grossYield`, which NO producer has ever written:
   * measured over the 204 completed reports carrying a `keyMetrics` block, 188
   * hold `grossRentalYield` and zero hold `grossYield`, so the Gross Yield tile
   * could never render and the market block's `rentalYield` fell through to a
   * SCORE. The tiles are Financial-tier only, which is what kept it invisible.
   */
  it('draws the Gross Yield tile from the stored grossRentalYield', async () => {
    const text = await drawnText({
      ...REPORT,
      content: [
        '# Investment Report: 9 Test Street, Cowra NSW 2794',
        '',
        '## Financial Snapshot',
        '',
        'The holding position for this property is set out below, with the acquisition and the',
        'annual return stated against the contract price.',
        '',
      ].join('\n'),
      enhanced_data: {
        financialData: {
          keyMetrics: { grossRentalYield: 4.17, netRentalYield: 1.85, lvr: 80 },
          initialCosts: { propertyValue: 555000, stampDuty: 19162, deposit: 111000 },
          income: { weeklyRent: 445, annualRent: 23140 },
          loanDetails: { loanAmount: 444000, interestRate: 6.5, lvr: 80 },
        },
        investmentScore: {},
      },
    }, 'financial');
    const flat = text.replace(/\s+/g, '');
    expect(flat).toContain('GROSSYIELD');
    expect(flat).toContain('4.17%');
  }, 120_000);

  /**
   * The presentation does not rewrite the report's prose.
   *
   * `sanitizeAIContent` repairs merged words in model output, and two of its
   * rules split every case boundary they found — which is what a NAME looks
   * like. Measured over the completed corpus, the camelCase splitter's hit
   * list is this product's own data sources and Australian agencies:
   * CoreLogic 3,975, OpenAgent 447, AreaSearch 160, OnTheHouse 97, PropTrack
   * 83, plus QuickStats, MacKillop, VicRoads, VicPlan, TrainLink and
   * OpenStreetMap. Every standard-presentation PDF printed "Core Logic" and
   * "Prop Track", so the document misnamed the sources it cites — while the
   * template presentation printed them correctly, which means one record was
   * producing two different sentences.
   *
   * The punctuation rule was the same defect on a contact line: `e.g.,` came
   * out `e. g.` and `www.npcservices.com.au` came out `www. npcservices. com.
   * au`, which is a URL a reader cannot use.
   */
  it('leaves a proper noun, a URL and a unit exactly as the record wrote them', async () => {
    const KEEP = [
      'CoreLogic', 'PropTrack', 'OpenAgent', 'AreaSearch', 'SuburbCheck', 'OnTheHouse',
      'QuickStats', 'VicRoads', 'VicPlan', 'TrainLink', 'OpenStreetMap', 'MacKillop',
      'www.npcservices.com.au', 'admin@example.com.au', 'e.g.,', '988 m2', 'SA2', 'R2',
      'Section 10.7(2)',
    ];
    const prose = [
      'CoreLogic and PropTrack and OpenAgent and AreaSearch and SuburbCheck and OnTheHouse report data.',
      'QuickStats from VicRoads and VicPlan and TrainLink and OpenStreetMap and MacKillop College.',
      'See Section 10.7(2) and e.g., Yarrabilly Estate, plus the R2 zone and the Cowra SA2 area.',
      'Visit www.npcservices.com.au or email admin@example.com.au about a 988 m2 holding.',
      'The 2026 report said done.The next line, which is a real merge and must be repaired.',
    ];
    const text = await drawnText({
      ...REPORT,
      content: ['# Investment Report: 9 Test Street', '', '## Prose Section', '',
        ...prose.flatMap((p) => [p, '']),
      ].join('\n'),
    });
    const flat = text.replace(/\s+/g, ' ');
    for (const phrase of KEEP) expect(flat, `must survive: ${phrase}`).toContain(phrase);
    // …and the one repair the rules are actually for still happens.
    expect(flat).toContain('done. The next line');
    expect(flat).not.toContain('done.The');
  }, 120_000);

  /**
   * Punctuation sits against the word it belongs to, and a bold phrase keeps
   * the space in front of it.
   *
   * `parseMarkdownText` returns a run per emphasis span, and every run was
   * split on spaces into independent words — so `**988 m² land size**, paired`
   * drew the comma as its own word with a space in front: "land size , paired".
   * Three of them on the first page of prose in the certification render.
   *
   * The other half of the rule is what the first attempt at it broke: a run's
   * own text never begins with the space that separates it from the run
   * before (that space is at the END of the previous run), so gluing on "does
   * not start with white space" alone produced "is aland-rich". BOTH sides
   * decide.
   */
  it('sets punctuation against its word and keeps the space before a bold run', async () => {
    const text = await drawnText({
      ...REPORT,
      content: [
        '# Investment Report: 9 Test Street',
        '',
        '## Emphasis Section',
        '',
        'The core insight is that this is a **land-rich, house-on-a-large-block play**, more about '
        + 'conservative growth than rapid transformation, and the **988 m² land size**, paired with '
        + 'the designation as a **Residential Property** and on-site parking for **1 vehicle**. That '
        + 'gives you a **land-banking angle**: your investment is backed by land.',
        '',
      ].join('\n'),
    });
    const flat = text.replace(/\s+/g, ' ');
    // Nothing has a space before its punctuation…
    expect(flat).not.toMatch(/[A-Za-z0-9%²] [,.;:]/);
    // …and nothing lost the space in front of a bold run.
    for (const phrase of [
      'is a land-rich', 'the 988 m² land size', 'as a Residential Property',
      'for 1 vehicle', 'a land-banking angle',
    ]) {
      expect(flat, `must keep its space: ${phrase}`).toContain(phrase);
    }
  }, 120_000);
});
