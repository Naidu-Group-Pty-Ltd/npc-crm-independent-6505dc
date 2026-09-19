import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { docxPartXmlToText, extractDocxText, headingLevelForStyle } from '../docxText';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Wrap WordprocessingML body content in a minimal `document.xml`. */
function docXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`;
}

function para(text: string, styleId?: string): string {
  const pPr = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

async function buildDocx(parts: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(parts)) zip.file(path, content);
  return zip.generateAsync({ type: 'blob' });
}

describe('headingLevelForStyle', () => {
  it.each([
    ['Heading1', 1],
    ['heading 3', 3],
    ['Title', 1],
    ['Subtitle', 2],
    ['Heading9', 6],
    ['BodyText', 0],
    [null, 0],
  ])('maps %s to level %i', (styleId, level) => {
    expect(headingLevelForStyle(styleId)).toBe(level);
  });
});

describe('docxPartXmlToText', () => {
  it('emits markdown headings for Word heading styles', () => {
    const text = docxPartXmlToText(docXml(para('Investment Summary', 'Heading1') + para('Body copy.')));
    expect(text).toBe('# Investment Summary\n\nBody copy.');
  });

  it('joins runs inside a paragraph without inserting spaces', () => {
    const xml = docXml('<w:p><w:r><w:t>Rich</w:t></w:r><w:r><w:t>mond</w:t></w:r></w:p>');
    expect(docxPartXmlToText(xml)).toBe('Richmond');
  });

  it('keeps accepted tracked-change insertions', () => {
    // `w:ins` wraps runs; walking `w:r` children directly dropped this text.
    const xml = docXml(
      '<w:p><w:r><w:t>Rent is </w:t></w:r><w:ins w:id="1"><w:r><w:t>$780</w:t></w:r></w:ins>' +
        '<w:r><w:t> per week</w:t></w:r></w:p>',
    );
    expect(docxPartXmlToText(xml)).toBe('Rent is $780 per week');
  });

  it('excludes deleted tracked-change text', () => {
    const xml = docXml(
      '<w:p><w:r><w:t>Rent is </w:t></w:r>' +
        '<w:del w:id="2"><w:r><w:delText>$650</w:delText></w:r></w:del>' +
        '<w:r><w:t>$780</w:t></w:r></w:p>',
    );
    expect(docxPartXmlToText(xml)).toBe('Rent is $780');
  });

  it('excludes field instruction codes', () => {
    const xml = docXml(
      '<w:p><w:r><w:instrText> PAGE \\* MERGEFORMAT </w:instrText></w:r><w:r><w:t>Contents</w:t></w:r></w:p>',
    );
    expect(docxPartXmlToText(xml)).toBe('Contents');
  });

  it('descends into hyperlinks and content controls', () => {
    const xml = docXml(
      '<w:p><w:hyperlink r:id="rId1" xmlns:r="http://x"><w:r><w:t>the report</w:t></w:r></w:hyperlink></w:p>' +
        '<w:sdt><w:sdtContent>' + para('Controlled paragraph') + '</w:sdtContent></w:sdt>',
    );
    expect(docxPartXmlToText(xml)).toBe('the report\n\nControlled paragraph');
  });

  it('reads text boxes', () => {
    const xml = docXml(
      '<w:p><w:r><w:drawing><wps:txbx xmlns:wps="http://x"><w:txbxContent>' +
        para('Callout text') +
        '</w:txbxContent></wps:txbx></w:drawing></w:r></w:p>',
    );
    expect(docxPartXmlToText(xml)).toContain('Callout text');
  });

  it('renders breaks, tabs and symbol runs', () => {
    const xml = docXml(
      '<w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t><w:tab/><w:t>C</w:t>' +
        '<w:sym w:font="Wingdings" w:char="0041"/></w:r></w:p>',
    );
    expect(docxPartXmlToText(xml)).toBe('A\nB\tCA');
  });

  it('marks list paragraphs and preserves their nesting level', () => {
    const listItem = (text: string, level: number) =>
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
      `<w:r><w:t>${text}</w:t></w:r></w:p>`;
    const text = docxPartXmlToText(docXml(listItem('Top', 0) + listItem('Nested', 1)));
    expect(text).toBe('- Top\n  - Nested');
  });

  it('renders a table as a pipe table with rows and columns preserved', () => {
    const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const xml = docXml(
      '<w:tbl>' +
        `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('Item')}${cell('Status')}</w:tr>` +
        `<w:tr>${cell('Sign agreement')}${cell('Done')}</w:tr>` +
        `<w:tr>${cell('Order search')}${cell('Pending')}</w:tr>` +
        '</w:tbl>',
    );
    expect(docxPartXmlToText(xml)).toBe(
      '| Item | Status |\n| --- | --- |\n| Sign agreement | Done |\n| Order search | Pending |',
    );
  });

  it('pads horizontally merged cells so columns stay aligned', () => {
    const cell = (text: string, span?: number) =>
      `<w:tc>${span ? `<w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>` : ''}` +
      `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const xml = docXml(
      '<w:tbl>' +
        `<w:tr>${cell('A')}${cell('B')}${cell('C')}</w:tr>` +
        `<w:tr>${cell('Merged', 2)}${cell('C2')}</w:tr>` +
        '</w:tbl>',
    );
    const rows = docxPartXmlToText(xml).split('\n');
    expect(rows[0]).toBe('| A | B | C |');
    expect(rows[2]).toBe('| Merged |  | C2 |');
  });

  it('escapes a literal pipe so it cannot break the table', () => {
    const xml = docXml(
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A | B</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>ok</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    );
    expect(docxPartXmlToText(xml)).toContain('A \\| B');
  });

  it('decodes XML entities exactly once, in the correct order', () => {
    // The old regex reader decoded `&amp;` first, turning `&amp;lt;` into `<`.
    const xml = docXml('<w:p><w:r><w:t>Fees &amp;lt; costs &amp; charges</w:t></w:r></w:p>');
    expect(docxPartXmlToText(xml)).toBe('Fees &lt; costs & charges');
  });

  it('returns an empty string for malformed XML rather than throwing', () => {
    expect(docxPartXmlToText('<w:document><w:body>')).toBe('');
  });
});

describe('extractDocxText', () => {
  it('extracts the document body', async () => {
    const file = await buildDocx({
      'word/document.xml': docXml(para('Checklist', 'Heading1') + para('First task')),
    });
    await expect(extractDocxText(file)).resolves.toBe('# Checklist\n\nFirst task');
  });

  it('includes headers, footers and footnotes', async () => {
    const file = await buildDocx({
      'word/document.xml': docXml(para('Body copy')),
      'word/header1.xml': `<w:hdr ${W}>${para('Confidential — NPC Services')}</w:hdr>`,
      'word/footer1.xml': `<w:ftr ${W}>${para('Page footer disclaimer')}</w:ftr>`,
      'word/footnotes.xml': `<w:footnotes ${W}><w:footnote w:id="1">${para('Source: valuation report')}</w:footnote></w:footnotes>`,
    });
    const text = await extractDocxText(file);
    expect(text).toContain('Body copy');
    expect(text).toContain('Confidential — NPC Services');
    expect(text).toContain('Page footer disclaimer');
    expect(text).toContain('Source: valuation report');
  });

  it('emits a repeated header only once', async () => {
    const header = `<w:hdr ${W}>${para('Same header')}</w:hdr>`;
    const file = await buildDocx({
      'word/document.xml': docXml(para('Body')),
      'word/header1.xml': header,
      'word/header2.xml': header,
      'word/header3.xml': header,
    });
    const text = await extractDocxText(file);
    expect(text.match(/Same header/g)).toHaveLength(1);
  });

  it('can skip auxiliary parts', async () => {
    const file = await buildDocx({
      'word/document.xml': docXml(para('Body')),
      'word/header1.xml': `<w:hdr ${W}>${para('Header')}</w:hdr>`,
    });
    await expect(extractDocxText(file, { includeAuxiliaryParts: false })).resolves.toBe('Body');
  });

  it('normalises ligatures and non-breaking spaces from the source', async () => {
    const file = await buildDocx({
      'word/document.xml': docXml(para('Oﬃce space')),
    });
    await expect(extractDocxText(file)).resolves.toBe('Office space');
  });

  it('truncates at a boundary when a cap is given', async () => {
    const file = await buildDocx({
      'word/document.xml': docXml(para('Sentence one. Sentence two. Sentence three.')),
    });
    const text = await extractDocxText(file, { maxChars: 30 });
    expect(text).toContain('Sentence one.');
    expect(text).toContain('truncated');
  });

  it('reports a clear error when the body part is missing', async () => {
    const file = await buildDocx({ 'word/styles.xml': '<styles/>' });
    await expect(extractDocxText(file)).rejects.toThrow(/word\/document\.xml is missing/);
  });
});
