import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  DOCUMENT_MAX_BYTES,
  convertDocumentToHtml,
  convertPlainTextToHtml,
  documentKindForFile,
  rtfToPlainText,
} from '../docConvert';

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function docxXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${body}</w:body></w:document>`;
}

async function makeDocxFile(bodyXml: string, name = 'sample.docx'): Promise<File> {
  const zip = new JSZip();
  zip.file('word/document.xml', docxXml(bodyXml));
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

describe('documentKindForFile', () => {
  it('classifies by extension and mime', () => {
    expect(documentKindForFile({ name: 'report.docx' })).toBe('docx');
    expect(documentKindForFile({ name: 'x', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('docx');
    expect(documentKindForFile({ name: 'legacy.doc' })).toBe('doc');
    expect(documentKindForFile({ name: 'notes.txt' })).toBe('txt');
    expect(documentKindForFile({ name: 'letter.rtf' })).toBe('rtf');
    expect(documentKindForFile({ name: 'style.css' })).toBeNull();
    expect(documentKindForFile({ name: 'page.pdf', type: 'application/pdf' })).toBeNull();
  });
});

describe('convertDocumentToHtml (docx)', () => {
  it('converts headings, formatted runs, lists, and tables to semantic HTML', async () => {
    const file = await makeDocxFile(`
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Executive Summary</w:t></w:r></w:p>
      <w:p><w:r><w:t>Plain intro with </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold text</w:t></w:r><w:r><w:t xml:space="preserve"> &amp; more.</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First bullet</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Second bullet</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Metric</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    `);
    const { html, filename } = await convertDocumentToHtml(file);
    expect(filename).toBe('sample.html');
    expect(html).toContain('<h1>Executive Summary</h1>');
    expect(html).toContain('<strong>bold text</strong>');
    expect(html).toContain('&amp; more.');
    expect(html).toContain('<ul><li>First bullet</li><li>Second bullet</li></ul>');
    expect(html).toContain('<td>Metric</td>');
    expect(html).toContain('<td>Value</td>');
  });

  it('rejects an empty or bodyless docx with an actionable error', async () => {
    const file = await makeDocxFile('');
    await expect(convertDocumentToHtml(file)).rejects.toThrow(/empty/i);

    const zip = new JSZip();
    zip.file('readme.txt', 'not a docx');
    const notDocx = new File([await zip.generateAsync({ type: 'blob' })], 'broken.docx');
    await expect(convertDocumentToHtml(notDocx)).rejects.toThrow(/document\.xml/i);
  });

  it('rejects legacy .doc with guidance', async () => {
    const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'legacy.doc', { type: 'application/msword' });
    await expect(convertDocumentToHtml(file)).rejects.toThrow(/\.docx/);
  });

  it('enforces the size cap', async () => {
    const file = new File([new Uint8Array(8)], 'big.docx');
    Object.defineProperty(file, 'size', { value: DOCUMENT_MAX_BYTES + 1 });
    await expect(convertDocumentToHtml(file)).rejects.toThrow(/too large/i);
  });
});

describe('plain text and RTF conversion', () => {
  it('converts text paragraphs and escapes markup', () => {
    const html = convertPlainTextToHtml('First para\nsecond line\n\n<script>alert(1)</script>', 'notes');
    expect(html).toContain('<p>First para<br />second line</p>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('converts a txt file end-to-end', async () => {
    const file = new File(['Hello world\n\nSecond paragraph'], 'notes.txt', { type: 'text/plain' });
    const { html, filename } = await convertDocumentToHtml(file);
    expect(filename).toBe('notes.html');
    expect(html).toContain('<p>Hello world</p>');
    expect(html).toContain('<p>Second paragraph</p>');
  });

  it('strips RTF control words and honours \\par', () => {
    const text = rtfToPlainText(String.raw`{\rtf1\ansi\deff0 {\fonttbl{\f0 Calibri;}}Hello \b world\b0.\par Second line.}`);
    expect(text).toContain('Hello world.');
    expect(text).toContain('Second line.');
    expect(text).not.toContain('\\b');
    expect(text).not.toContain('{');
  });
});

// ── Structural fidelity regressions ───────────────────────────────────────────

async function makeDocxWithParts(
  parts: Record<string, string>,
  name = 'sample.docx',
): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(parts)) zip.file(path, content);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

describe('convertDocumentToHtml (structural fidelity)', () => {
  it('keeps accepted tracked-change insertions and drops deletions', async () => {
    const file = await makeDocxFile(`
      <w:p>
        <w:r><w:t xml:space="preserve">Rent is </w:t></w:r>
        <w:del w:id="1"><w:r><w:delText>$650</w:delText></w:r></w:del>
        <w:ins w:id="2"><w:r><w:t>$780</w:t></w:r></w:ins>
        <w:r><w:t xml:space="preserve"> per week</w:t></w:r>
      </w:p>
    `);
    const { html } = await convertDocumentToHtml(file);
    expect(html).toContain('Rent is $780 per week');
    expect(html).not.toContain('$650');
  });

  it('excludes field instruction codes from the imported text', async () => {
    const file = await makeDocxFile(`
      <w:p><w:r><w:instrText> PAGE \\* MERGEFORMAT </w:instrText></w:r><w:r><w:t>Contents</w:t></w:r></w:p>
    `);
    const { html } = await convertDocumentToHtml(file);
    expect(html).toContain('<p>Contents</p>');
    expect(html).not.toContain('MERGEFORMAT');
  });

  it('renders strikethrough, superscript and subscript runs', async () => {
    const file = await makeDocxFile(`
      <w:p>
        <w:r><w:rPr><w:strike/></w:rPr><w:t>old</w:t></w:r>
        <w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r>
        <w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>n</w:t></w:r>
      </w:p>
    `);
    const { html } = await convertDocumentToHtml(file);
    expect(html).toContain('<s>old</s>');
    expect(html).toContain('<sup>2</sup>');
    expect(html).toContain('<sub>n</sub>');
  });

  it('honours an explicit off value on a bold toggle', async () => {
    const file = await makeDocxFile(`
      <w:p><w:r><w:rPr><w:b w:val="false"/></w:rPr><w:t>not bold</w:t></w:r></w:p>
    `);
    const { html } = await convertDocumentToHtml(file);
    expect(html).toContain('<p>not bold</p>');
    expect(html).not.toContain('<strong>');
  });

  it('nests list levels instead of flattening them', async () => {
    const listItem = (text: string, level: number) =>
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const file = await makeDocxFile(listItem('Top', 0) + listItem('Child', 1) + listItem('Back', 0));
    const { html } = await convertDocumentToHtml(file);
    expect(html).toContain('<ul><li>Top</li><ul><li>Child</li></ul><li>Back</li></ul>');
  });

  it('renders a numbered list as an ordered list', async () => {
    const numbering = `<?xml version="1.0"?><w:numbering ${W_NS}>
      <w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
      <w:num w:numId="3"><w:abstractNumId w:val="7"/></w:num>
    </w:numbering>`;
    const file = await makeDocxWithParts({
      'word/document.xml': docxXml(
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>Step one</w:t></w:r></w:p>`,
      ),
      'word/numbering.xml': numbering,
    });
    const { html } = await convertDocumentToHtml(file);
    expect(html).toContain('<ol><li>Step one</li></ol>');
  });

  it('preserves horizontal and vertical cell merges', async () => {
    const cell = (text: string, tcPr = '') =>
      `<w:tc>${tcPr}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const file = await makeDocxFile(`
      <w:tbl>
        <w:tr>${cell('Wide', '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>')}${cell('C')}</w:tr>
        <w:tr>${cell('Tall', '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>')}${cell('B2')}${cell('C2')}</w:tr>
        <w:tr>${cell('', '<w:tcPr><w:vMerge/></w:tcPr>')}${cell('B3')}${cell('C3')}</w:tr>
      </w:tbl>
    `);
    const { html } = await convertDocumentToHtml(file);
    expect(html).toContain('<td colspan="2">Wide</td>');
    expect(html).toContain('<td rowspan="2">Tall</td>');
    // The continuation cell must not shift B3/C3 across a column.
    expect(html).toContain('<tr><td>B3</td><td>C3</td></tr>');
  });

  it('puts a marked header row in a thead', async () => {
    const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const file = await makeDocxFile(`
      <w:tbl>
        <w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('Metric')}${cell('Value')}</w:tr>
        <w:tr>${cell('Yield')}${cell('6.25%')}</w:tr>
      </w:tbl>
    `);
    const { html } = await convertDocumentToHtml(file);
    expect(html).toContain('<thead><tr><th>Metric</th><th>Value</th></tr></thead>');
    expect(html).toContain('<tbody><tr><td>Yield</td><td>6.25%</td></tr></tbody>');
  });

  it('renders a nested table inside its parent cell', async () => {
    const file = await makeDocxFile(`
      <w:tbl><w:tr><w:tc>
        <w:p><w:r><w:t>Outer</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:tc></w:tr></w:tbl>
    `);
    const { html } = await convertDocumentToHtml(file);
    expect(html).toContain('Outer');
    expect(html).toContain('Inner');
    expect(html.match(/<table>/g)).toHaveLength(2);
  });

  it('reads block content inside a content control', async () => {
    const file = await makeDocxFile(`
      <w:sdt><w:sdtContent>
        <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Controlled heading</w:t></w:r></w:p>
      </w:sdtContent></w:sdt>
    `);
    const { html } = await convertDocumentToHtml(file);
    expect(html).toContain('<h2>Controlled heading</h2>');
  });

  it('reads prose out of a text box', async () => {
    const file = await makeDocxFile(`
      <w:p><w:r><w:drawing><wps:txbx xmlns:wps="http://example.test/wps"><w:txbxContent>
        <w:p><w:r><w:t>Callout copy</w:t></w:r></w:p>
      </w:txbxContent></wps:txbx></w:drawing></w:r></w:p>
    `);
    const { html } = await convertDocumentToHtml(file);
    expect(html).toContain('Callout copy');
  });
});
