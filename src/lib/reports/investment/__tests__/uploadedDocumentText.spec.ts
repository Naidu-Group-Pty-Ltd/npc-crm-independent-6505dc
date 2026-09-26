/**
 * An uploaded document's words reach the report — the front of it, bounded.
 *
 * The report form sent `pdfContent` from `parse-property-pdf`'s answer, a field
 * that function has never returned, so every report made from an uploaded PDF
 * was written as though the document had no words in it. These tests hold the
 * repair from both ends: what the pure bound keeps, and that the form and the
 * generator are wired to it rather than to the field nothing fills.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UPLOADED_DOCUMENT_MAX_BYTES,
  UPLOADED_DOCUMENT_MAX_CHARS,
  UPLOADED_DOCUMENT_MAX_PAGES,
  boundUploadedDocumentText,
  uploadedDocumentText,
} from '@/lib/reports/investment/uploadedDocumentText.pure';

const REPO = resolve(__dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

describe('the bound on an uploaded document', () => {
  it('hands over a short document whole, trimmed', () => {
    expect(boundUploadedDocumentText('  --- Page 1 ---\nLot 1629 Hornsea Street\r\nFour bedrooms.  ')).toBe(
      '--- Page 1 ---\nLot 1629 Hornsea Street\nFour bedrooms.',
    );
  });

  it('keeps the FRONT of a long document, never its end', () => {
    const front = '--- Page 1 ---\nThe Hornsea 25 on Lot 1629, facade and inclusions.';
    const back = '--- Page 6 ---\nAnother estate: four homes built elsewhere.';
    const long = `${front}\n\n${'Standard inclusions list. '.repeat(600)}\n\n${back}`;
    const bounded = boundUploadedDocumentText(long)!;
    expect(bounded.startsWith(front)).toBe(true);
    expect(bounded).not.toContain('Another estate');
    expect(bounded.length).toBeLessThanOrEqual(UPLOADED_DOCUMENT_MAX_CHARS);
  });

  it('cuts at a paragraph where one is near the end, never mid-word', () => {
    const para = 'Word '.repeat(300).trim();
    const text = [para, para, para, para, para, para].join('\n\n');
    const bounded = boundUploadedDocumentText(text, 4_000)!;
    expect(bounded.length).toBeLessThanOrEqual(4_000);
    expect(text.startsWith(bounded)).toBe(true);
    expect(text.slice(bounded.length).startsWith('\n\n')).toBe(true);
  });

  it('falls back to a line, then a sentence, then a word — and only then to a hard cut', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `Line ${i} of the inclusions`).join('\n');
    const byLine = boundUploadedDocumentText(lines, 1_000)!;
    expect(lines.slice(byLine.length).startsWith('\n')).toBe(true);

    const sentences = 'A sentence about the kitchen. '.repeat(200);
    const bySentence = boundUploadedDocumentText(sentences, 1_000)!;
    expect(bySentence.endsWith('kitchen.')).toBe(true);

    const words = 'inclusion '.repeat(400);
    const byWord = boundUploadedDocumentText(words, 1_000)!;
    expect(byWord.endsWith('inclusion')).toBe(true);

    const unbroken = 'x'.repeat(5_000);
    expect(boundUploadedDocumentText(unbroken, 1_000)).toBe('x'.repeat(1_000));
  });

  it('answers null where there is nothing to say', () => {
    for (const nothing of ['', '   \n\n ', null, undefined, 42, {}]) {
      expect(boundUploadedDocumentText(nothing)).toBeNull();
    }
  });

  it('hands over nothing from a scan, whatever its garbled layer holds', () => {
    expect(uploadedDocumentText({ text: '�� ⍰⍰ ⍰', likelyNeedsOcr: true })).toBeNull();
    expect(uploadedDocumentText({ text: 'Lot 1629 Hornsea Street', likelyNeedsOcr: false })).toBe('Lot 1629 Hornsea Street');
    expect(uploadedDocumentText(null)).toBeNull();
  });

  it("leaves the server's own bound wide enough never to cut what the browser already bounded", () => {
    // The worst ordinary case: every character a three-byte typographic mark.
    const typographic = '’'.repeat(UPLOADED_DOCUMENT_MAX_CHARS);
    expect(new TextEncoder().encode(boundUploadedDocumentText('Plain text.')!).length).toBeLessThan(UPLOADED_DOCUMENT_MAX_BYTES);
    expect(new TextEncoder().encode(typographic).length).toBeGreaterThan(UPLOADED_DOCUMENT_MAX_BYTES);
    // …which is why the browser's bound is in characters of prose, not marks:
    // an ordinary brochure page is ASCII with the odd apostrophe and m².
    const brochure = 'Four bedrooms, a 25 m² alfresco and the builder’s standard inclusions. '.repeat(200);
    const bounded = boundUploadedDocumentText(brochure)!;
    expect(new TextEncoder().encode(bounded).length).toBeLessThanOrEqual(UPLOADED_DOCUMENT_MAX_BYTES);
  });

  it('reads the front pages only', () => {
    expect(UPLOADED_DOCUMENT_MAX_PAGES).toBeGreaterThan(0);
    expect(UPLOADED_DOCUMENT_MAX_PAGES).toBeLessThanOrEqual(10);
  });
});

describe('the wiring', () => {
  const form = read('src/components/reports/InvestmentReportGenerator.tsx');
  const generator = read('supabase/functions/generate-investment-report/index.ts');

  it('no longer reads a field parse-property-pdf never returns', () => {
    expect(form).not.toMatch(/data\.pdfContent/);
    expect(read('supabase/functions/parse-property-pdf/index.ts')).not.toMatch(/pdfContent/);
  });

  it("hands the generator the document's own words, read beside the parse", () => {
    expect(form).toMatch(/readUploadedDocumentText\(pdfFile\)/);
    expect(form).toMatch(/pdfContent:\s*await documentText\.catch\(\(\) => null\)/);
    // The brochure's photographs keep their order: begin after conversion,
    // settle after the parse has named the property.
    const begin = form.indexOf('brochurePhotographs.begin(pdfFile)');
    const read_ = form.indexOf('readUploadedDocumentText(pdfFile)');
    const settle = form.indexOf('brochurePhotographs.settle(');
    expect(begin).toBeGreaterThan(-1);
    expect(read_).toBeGreaterThan(begin);
    expect(settle).toBeGreaterThan(read_);
  });

  it('bounds an uploaded document from its front on the server, and a listing page as it always was', () => {
    expect(generator).toMatch(/UPLOADED_DOCUMENT_MAX_BYTES, 'PDF listing content', 'head'\)/);
    expect(generator).toMatch(/DOCUMENT_CONTEXT_MAX_BYTES,\s*`\$\{fromPdfUpload \? 'PDF' : 'Scraped'\} listing content`,\s*'head-tail'/);
    expect(generator).toMatch(/typeof propertyDetails\?\.pdfContent === 'string'/);
  });
});
