/**
 * A finished Hub answer, printed as the adviser's report rather than as an
 * export of a chat.
 *
 * The owner's export of 30 Sep 2026 (report `B3D8F047`, Institutional Research
 * and Dark Executive designs) carried everything the answer said and set it
 * like a chat log: the issuer's name as the cover title, "Document: Single
 * answer" and "Exchanges: 3" as the first facts, "One answer from an
 * Intelligence Hub conversation … Answers came from report_qa." as the first
 * sentence, three sentences of instructions to the Hub in an "Asked" callout,
 * "01 1. EXECUTIVE SUMMARY" in the contents, 31pt section titles over 12.8pt
 * subheads, labels in two lines of tracked capitals, tables split to a single
 * row, and the masthead wrapping at the foot of every page. Each rule below is
 * one of those, stated as what the page must do.
 */
import { describe, expect, it } from 'vitest';
import {
  findPlaceholders,
  hubDocumentTopic,
  isGenericSectionHeading,
  isPlaceholderValue,
  namesTheIssuer,
  readTitleBlock,
} from '../documentIdentity.pure';
import { buildReportQaDocument } from '../normalise.pure';
import { renderMarkdown } from '../markdown.pure';
import {
  estimatedTableLines,
  finePrintStart,
  groupTableRows,
  KEEP_WHOLE_TABLE_LINES,
  renderReportQaFromBrand,
} from '../render.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';
import { footerMastheadTracking, MEMO_TITLE_RATIO } from '@/lib/reportDesign/css.pure';
import { BRIEF_CLASS, FINE_PRINT_CLASS, SUBHEAD_CLASS } from '@/lib/reportDesign/primitives.pure';
import { PRINT_TRACKING } from '@/lib/reportDesign/tokens.pure';
import { contentsEntriesFor } from '@/lib/reportDesign/structure.pure';

const ISSUER = 'NAIDU PROPERTY CONSULTING SERVICES';
const NOW = '2026-09-30T04:00:00.000Z';

const PERTH_ROWS = [
  ['Belmont', 'Core balanced option', 'Employment access, airport precinct proximity, transport and rental depth.', 'Aircraft noise, road exposure, flood overlays and street quality.'],
  ['Cloverdale', 'Growth and accessibility', 'Established housing, access to Perth CBD, airport and major retail.', 'Busy roads, small or compromised blocks, comparable sales.'],
  ['Beckenham', 'Value and connectivity', 'Transport access, established homes and relative affordability.', 'Industrial interfaces, rail/road noise and dwelling condition.'],
  ['Balga', 'Yield-led house strategy', 'Accessible price point and rental demand in selected pockets.', 'Street-by-street selection, tenant profile and property condition.'],
  ['Girrawheen', 'Entry-level land-backed strategy', 'Established stock and potential value in selected streets.', 'Crime perception, tenant quality and redevelopment assumptions.'],
  ['Maddington', 'Affordable established housing', 'Transport, retail and broad family tenant demand.', 'Flood exposure, street presentation and local supply.'],
  ['Gosnells', 'Income-focused option', 'Lower entry price and established rental market.', 'Higher variance between streets, tenants and resale depth.'],
];

/** The head, a section of each kind and the tail of the owner's answer. */
const OWNER_ANSWER = [
  `# ${ISSUER}`,
  '',
  '## Strategic Investment Acquisition Report',
  '',
  '### $750,000 Residential Investment Property Mandate',
  '',
  '**Prepared for:** [Client Name]  ',
  '**Prepared by:** Naidu Property Consulting Services  ',
  '**Date:** [Insert Date]  ',
  '**Investment Budget:** Up to $750,000 excluding or including acquisition costs  ',
  '**Purpose:** Identify suitable Australian residential investment locations.',
  '',
  '---',
  '',
  '## 1. Executive Summary',
  '',
  '### Recommended investment direction',
  '',
  'For a client investing up to **$750,000**, our recommended strategy is to acquire an established house.',
  '',
  '# 2. Client Investment Mandate',
  '',
  'The mandate is long-term growth with a sustainable rental return.',
  '',
  '# 3. Market Priority and Suburb Research Shortlist',
  '',
  '## Priority 1 — Perth, Western Australia',
  '',
  '### Strategic rationale: balanced growth, rental demand and house accessibility',
  '',
  'Perth should be considered a leading market for this budget.',
  '',
  '| Suburb | Investment position | Why it is on the shortlist | Due-diligence focus |',
  '| --- | --- | --- | --- |',
  ...PERTH_ROWS.map((r) => `| ${r.join(' | ')} |`),
  '',
  '### Illustrative acquisition structure',
  '',
  '| Item | Example |',
  '| --- | ---: |',
  '| Purchase price | $750,000 |',
  '| Deposit / equity at 20% | $150,000 |',
  '| Loan at 80% LVR | $600,000 |',
  '| Transfer duty and acquisition costs | Varies by state |',
  '',
  '# 4. Next Steps',
  '',
  '1. **Confirm client funding position**',
  '   - Deposit/equity available',
  '   - Maximum borrowing capacity',
  '2. **Select two priority markets**',
  '   A practical starting point is Perth plus Adelaide.',
  '',
  '---',
  '',
  '## Important Disclaimer',
  '',
  'This report is provided for general property-investment education and strategic discussion only.',
  '',
  'Market conditions, rents and borrowing policies can change.',
].join('\n');

const QUESTION = 'Okay, thank you so much for providing me with that response, really appreciate it. '
  + 'What I need you to do now is make it into a very forefronting property consulting reporting manner.';

const conversation = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'New conversation',
  report_names: [],
  structured_report: null,
  created_at: '2026-09-30T03:00:00.000Z',
};

const messages = [
  { id: '61111111-1111-4111-8111-111111111111', role: 'user', content: QUESTION, created_at: '2026-09-30T03:05:00.000Z' },
  {
    id: '71111111-1111-4111-8111-111111111111', role: 'assistant', content: OWNER_ANSWER,
    created_at: '2026-09-30T03:06:00.000Z', model_provider: 'report_qa', model_version: 'openai/gpt-5.2',
  },
];

const built = buildReportQaDocument({
  conversation,
  messages,
  subject: 'answer',
  messageId: '71111111-1111-4111-8111-111111111111',
  preparedOn: NOW,
  issuerNames: [ISSUER],
});
if (built.ok === false) throw new Error(built.error);
const DOC = built.document;

const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: ISSUER, brandColour: '#BF9B50', preset: 'signature' },
  contact: { company_name: ISSUER, abn: '50 684 555 771' },
  capturedAt: NOW,
});
const OUT = renderReportQaFromBrand({ document: DOC, snapshot });
/** The body between the contents page and the closing company page. */
const BODY = OUT.bodyHtml.slice(OUT.bodyHtml.indexOf('<section class="chapter'));
const COVER = OUT.bodyHtml.slice(0, OUT.bodyHtml.indexOf('</section>'));

describe('the title block', () => {
  const block = readTitleBlock(OWNER_ANSWER, { issuerNames: [ISSUER] });

  it('reads the issuer\'s name as the letterhead, and the heading under it as the title', () => {
    expect(block.letterhead).toBe(ISSUER);
    expect(block.title).toBe('Strategic Investment Acquisition Report');
    expect(block.subtitle).toBe('$750,000 Residential Investment Property Mandate');
  });

  it('places the front matter: facts kept, slots omitted, the issuer and the date not repeated', () => {
    expect(block.facts).toEqual([
      { label: 'Investment Budget', value: 'Up to $750,000 excluding or including acquisition costs' },
      { label: 'Purpose', value: 'Identify suitable Australian residential investment locations.' },
    ]);
    // "[Client Name]" and "[Insert Date]" were printed on the owner's cover.
    expect(block.omitted).toEqual(['Prepared for', 'Date']);
    expect(block.preparedFor).toBe('');
    // "Prepared by: Naidu Property Consulting Services" is the letterhead again.
    expect(block.preparedBy).toBe('');
  });

  it('hands back the body from the first section, with the rule under the block gone', () => {
    expect(block.body.trimStart().startsWith('## 1. Executive Summary')).toBe(true);
    expect(block.body).not.toContain(ISSUER);
  });

  it('without the issuer\'s names, the first heading is all it can read — which is why the route passes them', () => {
    expect(readTitleBlock(OWNER_ANSWER).title).toBe(ISSUER);
    expect(hubDocumentTopic({ body: OWNER_ANSWER })).toBe(ISSUER);
    expect(hubDocumentTopic({ body: OWNER_ANSWER, issuerNames: [ISSUER] }))
      .toBe('Strategic Investment Acquisition Report');
  });

  it('takes a lone heading over prose as the title and leaves a deeper heading where it was written', () => {
    const lone = readTitleBlock('# Mariners Quay: the case for buying\n\nThe position holds.');
    expect(lone.title).toBe('Mariners Quay: the case for buying');
    expect(lone.subtitle).toBe('');
    expect(lone.body.trim()).toBe('The position holds.');
    const nested = readTitleBlock('# Mariners Quay\n\n## Rental position\n\nThe rent covers the loan.');
    expect(nested.title).toBe('Mariners Quay');
    expect(nested.body.trimStart().startsWith('## Rental position')).toBe(true);
  });

  it('never reads a numbered section, or front matter with no title above it, as a title block', () => {
    expect(readTitleBlock('## 1. Executive recommendation\n\nBuy.').title).toBe('');
    const labelled = '**Short answer:** yes.\n\n**Why:** the rent covers the loan.';
    const read = readTitleBlock(labelled);
    expect(read.title).toBe('');
    expect(read.body).toBe(labelled);
  });
});

describe('a section\'s name is not a document\'s title', () => {
  const answer = '## Executive summary\n\nThe position holds on a **3.98%** gross yield.';

  it('keeps "Executive summary" in the body as the first section', () => {
    const read = readTitleBlock(answer);
    expect(read.title).toBe('');
    expect(read.body.trim()).toBe(answer);
  });

  it('titles the document by the conversation instead, and by the section name only where nothing better exists', () => {
    expect(hubDocumentTopic({ body: answer, conversationTitle: 'Mariners Quay investment review' }))
      .toBe('Mariners Quay investment review');
    // A section name says more than a paragraph of instructions to the Hub.
    expect(hubDocumentTopic({ body: answer, conversationTitle: 'New conversation', question: QUESTION }))
      .toBe('Executive summary');
  });

  it('recognises the names any document could open on, and only those', () => {
    for (const generic of ['Executive summary', 'Overview', 'Recommendation', 'The short answer', 'Key findings:']) {
      expect(isGenericSectionHeading(generic), generic).toBe(true);
    }
    for (const specific of ['Perth vs Adelaide for a $750k budget', 'Executive summary: Mariners Quay', 'Rental position']) {
      expect(isGenericSectionHeading(specific), specific).toBe(false);
    }
  });
});

describe('the issuer, slots and placeholders', () => {
  it('matches the issuer through case, punctuation and company suffixes', () => {
    expect(namesTheIssuer('Naidu Property Consulting Services Pty Ltd', [ISSUER])).toBe(true);
    expect(namesTheIssuer('naidu property consulting services.', [ISSUER])).toBe(true);
    expect(namesTheIssuer('Tenant Advisory', [ISSUER])).toBe(false);
    expect(namesTheIssuer(ISSUER, [])).toBe(false);
  });

  it('treats a slot as no value', () => {
    for (const slot of ['[Client Name]', '[Insert Date]', 'TBC', 'N/A', '—', '[XX]', '']) {
      expect(isPlaceholderValue(slot), slot).toBe(true);
    }
    for (const value of ['Jane Citizen', '$750,000', 'Up to $750,000']) {
      expect(isPlaceholderValue(value), value).toBe(false);
    }
  });

  it('finds the slots left in the text, in order and once — never a link or a footnote', () => {
    const text = 'Prepared for [Client Name] on [Insert Date]. Yield [XX]%. '
      + 'Again [Client Name]. See [the report](https://example.com) and note[^1].';
    expect(findPlaceholders(text)).toEqual(['[Client Name]', '[Insert Date]', '[XX]']);
    expect(findPlaceholders(DOC.body)).toEqual(['[Client Name]', '[Insert Date]']);
  });
});

describe('the finished answer', () => {
  it('is titled by the report, not by the firm that issued it', () => {
    expect(DOC.meta.title).toBe('Strategic Investment Acquisition Report');
    expect(DOC.presentation?.subtitle).toBe('$750,000 Residential Investment Property Mandate');
  });

  it('opens on itself: no framing sentence, no question, no system name', () => {
    expect(DOC.narrative).toBe('');
    expect(BODY).not.toContain('>Asked<');
    expect(BODY).not.toContain('forefronting');
    expect(OUT.bodyHtml).not.toContain('report_qa');
    expect(OUT.bodyHtml).not.toContain('gpt-5.2');
    expect(OUT.bodyHtml).not.toContain('Intelligence Hub conversation');
  });

  it('carries the report\'s facts on its cover and nothing about the chat', () => {
    expect(COVER).toContain('Strategic Investment Acquisition Report');
    expect(COVER).toContain('$750,000 Residential Investment Property Mandate');
    expect(COVER).toContain('Prepared on');
    for (const chat of ['Single answer', 'Exchanges', '>Document<']) expect(COVER).not.toContain(chat);
    // A slot is omitted, never printed.
    expect(OUT.bodyHtml).not.toContain('[Client Name]');
    expect(OUT.bodyHtml).not.toContain('[Insert Date]');
  });

  it('never sets the letterhead as a heading of the body', () => {
    expect(BODY).not.toMatch(new RegExp(`<h[1-6][^>]*>\\s*${ISSUER}\\s*</h[1-6]>`));
  });

  it('numbers its sections once, promoting the one written a level too deep', () => {
    // "## 1. Executive Summary" beside "# 2. …": one sequence, one level.
    expect(OUT.sections).toEqual([
      'Executive Summary',
      'Client Investment Mandate',
      'Market Priority and Suburb Research Shortlist',
      'Next Steps',
    ]);
    expect(contentsEntriesFor(OUT.spine).map((e) => e.title)).toEqual(OUT.sections);
    expect(OUT.bodyHtml).not.toMatch(/toc-title">\d+\.\s/);
  });

  it('opens its first section on the brief the answer set under its title', () => {
    const first = BODY.slice(0, BODY.indexOf('</section>'));
    expect(first).toContain(`table-block ${BRIEF_CLASS}`);
    expect(first).toContain('Investment Budget');
    expect(first).toContain('Purpose');
    expect(first.indexOf('Investment Budget')).toBeLessThan(first.indexOf('Recommended investment direction'));
  });

  it('sets every section as a section of one document', () => {
    const chapters = BODY.match(/<section class="chapter[^"]*"/g) ?? [];
    expect(chapters.length).toBe(OUT.sections.length);
    for (const c of chapters) expect(c).toContain(' memo');
  });

  it('sets a long label as a sentence and leaves a short one a label', () => {
    expect(BODY).toMatch(new RegExp(`<h4 class="${SUBHEAD_CLASS}"[^>]*>Strategic rationale: balanced growth`));
    expect(BODY).toMatch(/<h4 id="[^"]*">Recommended investment direction<\/h4>/);
  });

  it('puts a numbered step\'s label on its own line', () => {
    expect(BODY).toMatch(/<strong>Select two priority markets<\/strong><br\s*\/?>\s*A practical starting point/);
  });

  it('sets the answer\'s closing caveat as fine print', () => {
    const at = BODY.indexOf(`<div class="${FINE_PRINT_CLASS}`);
    expect(at).toBeGreaterThan(-1);
    const fine = BODY.slice(at);
    expect(fine).toContain('Important Disclaimer');
    expect(fine).toContain('general property-investment education');
  });

  it('keeps a short table whole and never strands a row of a long one', () => {
    // The acquisition structure: four one-line rows.
    expect(BODY).toMatch(/<div class="table-block keep-together"><table class="data">[\s\S]*?Purchase price/);
    // The Perth shortlist: seven rows of four sentences.
    const perth = BODY.slice(BODY.indexOf('Belmont') - 1200, BODY.indexOf('Gosnells') + 400);
    expect(perth).toContain('<tbody class="lead">');
    expect(perth).toContain('<tbody class="tail">');
  });
});

describe('a table is kept whole by its height, not its row count', () => {
  const tableOf = (rows: string[][], head: string[]) => {
    const md = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
    const block = renderMarkdown(md).blocks.find((b) => b.kind === 'table');
    if (!block?.table) throw new Error('no table');
    return block.table;
  };

  it('estimates five rows of four sentences well past a short table, and five one-line rows within it', () => {
    // 35–47% of a page in the fifty designs, measured: a third of a page left
    // blank in front of it when it was kept whole.
    const tall = tableOf(PERTH_ROWS.slice(0, 5), ['Suburb', 'Investment position', 'Why it is on the shortlist', 'Due-diligence focus']);
    expect(estimatedTableLines(tall)).toBeGreaterThan(KEEP_WHOLE_TABLE_LINES);
    const short = tableOf([['Purchase price', '$750,000'], ['Deposit', '$150,000'], ['Loan', '$600,000'], ['Duty', 'Varies'], ['Total', 'Deposit plus costs']], ['Item', 'Example']);
    expect(estimatedTableLines(short)).toBeLessThanOrEqual(KEEP_WHOLE_TABLE_LINES);
  });
});

describe('row groups', () => {
  const row = (n: number) => `<tr><th scope="row">r${n}</th><td>v${n}</td></tr>`;
  const table = (n: number) => `<div class="table-block"><table class="data"><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead><tbody>${Array.from({ length: n }, (_, i) => row(i + 1)).join('')}</tbody></table></div>`;
  /** Each visible row with its position in its own group, as `nth-child` counts. */
  const bands = (html: string) => [...html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g)].flatMap((g) =>
    (g[1].match(/<tr[\s\S]*?<\/tr>/g) ?? [])
      .map((tr, i) => ({ tr, child: i + 1 }))
      .filter(({ tr }) => !tr.includes('class="parity"'))
      .map(({ tr, child }) => ({ row: Number(/r(\d+)</.exec(tr)?.[1]), odd: child % 2 === 1 })));

  it('sets the first row, the middle and the last two apart', () => {
    const grouped = groupTableRows(table(7));
    expect(grouped).toMatch(/<tbody class="lead">(<tr>(?:(?!<\/tr>).)*<\/tr>)<\/tbody>/);
    const tail = /<tbody class="tail">([\s\S]*?)<\/tbody>/.exec(grouped)?.[1] ?? '';
    expect(tail).toContain('>r6<');
    expect(tail).toContain('>r7<');
    expect(tail).not.toContain('>r5<');
  });

  it.each([4, 5, 6, 7, 8, 11])('keeps every row on the band it had — %i rows', (n) => {
    const read = bands(groupTableRows(table(n)));
    expect(read.map((r) => r.row)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    for (const r of read) expect(r.odd, `row ${r.row}`).toBe(r.row % 2 === 1);
  });

  it('leaves a table of three rows, or one it cannot read, exactly as it was', () => {
    expect(groupTableRows(table(3))).toBe(table(3));
    const odd = '<div class="table-block"><table class="data"><tbody><tr><td>x</td></tr><!-- note --></tbody></table></div>';
    expect(groupTableRows(odd)).toBe(odd);
  });
});

describe('the closing caveat', () => {
  it('is the last heading when it names a caveat and only prose follows', () => {
    const md = '## Findings\n\nText.\n\n## Important Disclaimer\n\nGeneral information only.\n\n- Not advice';
    const parsed = renderMarkdown(md);
    expect(finePrintStart(parsed)).toBe(parsed.headings[1].blockIndex);
  });

  it('is nothing when the caveat carries a table, or is not the last heading, or is not a caveat', () => {
    expect(finePrintStart(renderMarkdown('## Disclaimer\n\n| a | b |\n| - | - |\n| 1 | 2 |'))).toBe(-1);
    expect(finePrintStart(renderMarkdown('## Disclaimer\n\nText.\n\n## Next steps\n\nText.'))).toBe(-1);
    expect(finePrintStart(renderMarkdown('## Next steps\n\nText.'))).toBe(-1);
  });
});

describe('a label on its own line', () => {
  const source = '**Primary shortlist:**\nBelmont, Cloverdale and Beckenham.\n\n1. **Confirm funding**\n   Deposit and borrowing capacity.';

  it('breaks after a line that is only a label, where the memo asks for it', () => {
    const html = renderMarkdown(source, { labelLineBreaks: true }).blocks.map((b) => b.html).join('');
    expect(html).toMatch(/<strong>Primary shortlist:<\/strong><br\s*\/?>\s*Belmont/);
    expect(html).toMatch(/<strong>Confirm funding<\/strong><br\s*\/?>\s*Deposit/);
  });

  it('is off everywhere else — the other formats read exactly what they read before', () => {
    const html = renderMarkdown(source).blocks.map((b) => b.html).join('');
    expect(html).not.toContain('<br');
    expect(html).toMatch(/<strong>Primary shortlist:<\/strong> Belmont/);
  });
});

describe('the stylesheet', () => {
  const css = OUT.html;

  it('sets a memo section title one modular step above its subheads', () => {
    expect(MEMO_TITLE_RATIO).toBeGreaterThan(0.5);
    expect(MEMO_TITLE_RATIO).toBeLessThan(0.75);
    expect(css).toMatch(/\.memo \.chapter-header h1 \{\s*font-size: [\d.]+pt;/);
  });

  it('draws no box for the parity row, and keeps the brief\'s labels on one line', () => {
    expect(css).toMatch(/\.memo table\.data tr\.parity \{ display: none; \}/);
    expect(css).toMatch(/\.memo \.table-block\.brief th\[scope="row"\] \{ white-space: nowrap; \}/);
  });

  it('keeps a grouped table\'s hairlines between its groups', () => {
    // The ledger style takes the hairline off the last row, and
    // `tbody tr:last-child` matched the last row of the lead and middle groups
    // too — two rules missing from the middle of every long table.
    const ledger = renderReportQaFromBrand({ document: DOC, snapshot, options: { tableStyle: 'ledger' } }).html;
    expect(ledger).toContain('table.data tbody:last-child tr:last-child td');
    expect(ledger).not.toMatch(/table\.data tbody tr:last-child td/);
  });
});

describe('the running foot', () => {
  it('keeps the widest tracking for a masthead that fits it, and steps down for one that does not', () => {
    expect(footerMastheadTracking('Tenant Advisory', 7.5)).toBe(PRINT_TRACKING.widest);
    // Printed "NAIDU PROPERTY CONSULTING / SERVICES" on every page at 7.5pt.
    expect(footerMastheadTracking(ISSUER, 7.5)).not.toBe(PRINT_TRACKING.widest);
    expect(footerMastheadTracking('A'.repeat(70), 7.5)).toBe(PRINT_TRACKING.normal);
  });

  it('never tracks a longer masthead wider than a shorter one', () => {
    const em = (v: string) => Number.parseFloat(v) || 0;
    let previous = Infinity;
    for (let n = 1; n <= 80; n += 1) {
      const now = em(footerMastheadTracking('A'.repeat(n), 7.5));
      expect(now).toBeLessThanOrEqual(previous);
      previous = now;
    }
  });
});
