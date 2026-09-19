/**
 * The markup contract.
 *
 * Two classes of defect are covered here. The first is injection: every string
 * a report prints came from a client record, a settings form or a model, and a
 * cover title containing `<script>` or a `"` is not hypothetical. The second is
 * the pair of embarrassments the prototype shipped — our name on a white-label
 * tenant's cover, and the render engine's name on a premium client document.
 */
import { describe, expect, it } from 'vitest';
import {
  closeChapter,
  escapeHtml,
  openChapter,
  renderBandedMatrix,
  renderBrandLockup,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderContentsPage,
  renderCover,
  renderDataTable,
  renderDecisionBox,
  renderDocument,
  renderGrid12,
  renderKpiStrip,
  renderPullQuote,
} from '../primitives.pure';
import { resolveCompanyBlock } from '../companyBlock.pure';

const HOSTILE = '<script>alert("x")</script> & "quoted" \'apostrophe\'';

describe('escaping', () => {
  it('neutralises tags, ampersands and both quote characters', () => {
    expect(escapeHtml(HOSTILE)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quoted&quot; &#39;apostrophe&#39;',
    );
  });

  it('renders null and undefined as empty, not as the words', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('renderCover', () => {
  const base = {
    title: '13 Bean Street',
    subtitle: 'Blackwater, QLD 4717',
    eyebrow: 'Cash Flow Analysis',
    masthead: 'Harbour Capital',
    edition: 'VOL. 2026 · ED. 08',
  };

  it('prints the caller\'s masthead and nothing of ours', () => {
    const html = renderCover(base);
    expect(html).toContain('Harbour Capital');
    expect(html).not.toMatch(/\bNPC\b/);
    expect(html).not.toMatch(/WeasyPrint/i);
  });

  it('takes the edition as an input rather than reading the clock', () => {
    // Same input, later call — identical output. The prototype computed the
    // year and month with `new Date()`, so no two renders matched.
    expect(renderCover(base)).toBe(renderCover(base));
    expect(renderCover({ ...base, edition: null })).toContain('<span class="vol"></span>');
  });

  it('escapes a hostile title and subtitle', () => {
    const html = renderCover({ ...base, title: HOSTILE, subtitle: HOSTILE });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('strips quotes and parentheses out of the hero url', () => {
    const html = renderCover({
      ...base,
      heroDataUri: "data:image/png;base64,AAA')\"></div><script>x</script>",
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('cover-scrim');
  });

  it('omits the scrim when there is no photograph to scrim', () => {
    expect(renderCover(base)).not.toContain('cover-scrim');
  });

  it('sets the subtitle in the accent italic, and omits it when absent', () => {
    expect(renderCover(base)).toContain('<em>Blackwater, QLD 4717</em>');
    expect(renderCover({ ...base, subtitle: null })).not.toContain('<em>');
  });
});

describe('renderBrandLockup', () => {
  it('renders nothing when there is neither mark nor wordmark', () => {
    expect(renderBrandLockup({})).toBe('');
  });

  it('carries alt text on the mark — a tagged PDF needs it', () => {
    const html = renderBrandLockup({ markDataUri: 'data:image/png;base64,AAA', wordmark: 'Acme' });
    expect(html).toContain('alt="Acme"');
  });

  it('switches to the on-field accent on a dark ground', () => {
    expect(renderBrandLockup({ wordmark: 'Acme', onField: true })).toContain('brand-lockup on-field');
  });
});

describe('chapters', () => {
  it('cannot be opened without naming itself for the running head', () => {
    const open = openChapter('Financials', '03', 'Ten-Year Projection');
    expect(open).toContain('data-eyebrow="Financials"');
    expect(open).toContain('data-chapter-title="Ten-Year Projection"');
    expect(closeChapter()).toBe('</section>');
  });

  it('opens on the body page by default, so continuation pages keep their head', () => {
    // `page: chapter-opener` applies to every page the chapter spans, not just
    // the first — which suppressed the running head for a whole chapter.
    expect(openChapter('a', '01', 'b')).toContain('page-body');
    expect(openChapter('a', '01', 'b', 'chapter-opener')).toContain('page-chapter-opener');
  });

  it('uses the archetype\'s chapter word', () => {
    expect(renderChapterHeader({ number: '02', title: 'Yield', label: 'Section' }))
      .toContain('SECTION 02');
  });
});

describe('tables', () => {
  const cols = [
    { key: 'item', label: 'Item' },
    { key: 'amount', label: 'Amount', align: 'right' as const },
  ];

  it('makes the first cell of each row a row header, for the structure tree', () => {
    const html = renderDataTable(cols, [{ item: 'Rates', amount: '$1,200' }]);
    expect(html).toContain('<th scope="row"');
    expect(html).toContain('<th scope="col"');
  });

  it('wraps the table so its caption cannot be stranded on the previous page', () => {
    const html = renderDataTable(cols, [{ item: 'Rates', amount: '$1,200' }], {
      caption: 'Outgoings',
    });
    expect(html.startsWith('<div class="table-block">')).toBe(true);
    expect(html.indexOf('<caption>')).toBeGreaterThan(html.indexOf('table-block'));
  });

  it('tones a negative figure, in both conventions the product uses', () => {
    const html = renderDataTable(
      cols,
      [
        { item: 'A', amount: '-$400' },
        { item: 'B', amount: '($400)' },
        { item: 'C', amount: '$400' },
      ],
      { signedKeys: ['amount'] },
    );
    expect(html.match(/class="num neg"/g)).toHaveLength(2);
  });

  it('does not tone a column that was not declared signed', () => {
    expect(renderDataTable(cols, [{ item: 'A', amount: '-$400' }])).not.toContain('neg');
  });

  it('renders nothing for an empty row set, rather than a headed empty table', () => {
    expect(renderDataTable(cols, [])).toBe('');
  });

  it('puts a wide matrix on the landscape page', () => {
    const html = renderBandedMatrix(
      'Line item',
      ['Yr 1', 'Yr 2'],
      [{ label: 'Net cash flow', values: ['-$4,120', '$980'] }, { label: 'Total', values: ['-$3,140', ''], total: true }],
    );
    expect(html).toContain('class="page-landscape-table"');
    expect(html).toContain('class="total"');
    expect(html).toContain('neg');
  });
});

describe('the closing company page', () => {
  const block = resolveCompanyBlock(
    {
      company_name: 'Harbour Capital Advisory',
      email: 'hello@example.com',
      phone: '',
      abn: '11 222 333 444',
    },
    { is_enabled: true, text: 'Line one.\n\nLine two.', font_size: 'medium' },
  );

  it('splits the company name into a lockup', () => {
    const html = renderCompanyPage({ block });
    expect(html).toContain('HARBOUR CAPITAL');
    expect(html).toContain('<span class="tail">ADVISORY</span>');
  });

  it('omits an empty contact field rather than printing a bare label', () => {
    const html = renderCompanyPage({ block });
    // Uppercasing is the stylesheet's job; the markup carries the label as written.
    expect(html).toContain('>Email<');
    expect(html).not.toContain('>Phone<');
  });

  it('honours the configured disclaimer size', () => {
    expect(renderCompanyPage({ block })).toContain('font-size:10pt');
  });

  it('prints each disclaimer paragraph separately', () => {
    expect(renderCompanyPage({ block }).match(/<p>/g)).toHaveLength(2);
  });

  it('drops the contact block entirely when there is nothing to show', () => {
    const empty = resolveCompanyBlock({ company_name: 'Solo' }, { is_enabled: false, text: '' });
    const html = renderCompanyPage({ block: empty });
    expect(html).not.toContain('class="contact"');
    expect(html).not.toContain('class="disclaimer"');
  });
});

describe('renderDocument', () => {
  it('writes PDF metadata a tagged document needs', () => {
    const html = renderDocument({
      title: 'Cash Flow Analysis',
      author: 'Harbour Capital',
      subject: '13 Bean Street',
      css: 'body{}',
      bodyHtml: '<p>x</p>',
    });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en-AU">');
    expect(html).toContain('<title>Cash Flow Analysis</title>');
    expect(html).toContain('<meta name="author" content="Harbour Capital">');
  });

  it('escapes metadata, which is otherwise an attribute-injection point', () => {
    const html = renderDocument({
      title: HOSTILE, author: HOSTILE, css: '', bodyHtml: '',
    });
    expect(html).not.toContain('<script>');
  });
});

describe('the remaining primitives render their contract', () => {
  it('KPI strip tones values and renders nothing when empty', () => {
    expect(renderKpiStrip([])).toBe('');
    const html = renderKpiStrip([
      { label: 'Net yield', value: '4.8%', tone: 'positive', foot: 'gross 5.9%' },
      { label: 'Yr 1 cash flow', value: '-$4,120', tone: 'negative' },
    ]);
    expect(html).toContain('kpi-value pos');
    expect(html).toContain('kpi-value neg');
    expect(html).toContain('kpi-foot');
  });

  it('callout tone is a Category B role, never the brand', () => {
    expect(renderCallout('negative', 'Risk', '<p>x</p>')).toContain('callout tone-negative');
  });

  it('decision box carries its label', () => {
    expect(renderDecisionBox('What this means', '<p>x</p>')).toContain('decision-label');
  });

  it('pull quote attribution is optional', () => {
    expect(renderPullQuote('Text')).not.toContain('<cite>');
    expect(renderPullQuote('Text', 'Analyst')).toContain('<cite>Analyst</cite>');
  });

  it('grid columns render their span class', () => {
    expect(renderGrid12([{ span: 7, html: 'a' }, { span: 5, html: 'b' }]))
      .toContain('class="col col-7"');
    expect(renderGrid12([])).toBe('');
  });

  it('contents rows carry number, title, note and page', () => {
    const html = renderContentsPage('Financial Analysis', [
      { number: '01', title: 'Purchase costs', note: 'Stamp duty and fees', page: 3 },
    ]);
    expect(html).toContain('class="page-contents"');
    expect(html).toContain('Stamp duty and fees');
    expect(html).toContain('>3<');
  });
});
