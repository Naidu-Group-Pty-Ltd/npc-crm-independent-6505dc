/**
 * Routing a scanned PDF to the engine that can read it.
 *
 * Template Builder has two PDF engines and only one of them can read a scan.
 * The deterministic path reads a text layer; a scanned page has none, so it
 * produces a picture of the page and reports success. OCR is not the answer —
 * measured on the production ledger, **0 OCR pages across 1,164** — because
 * `GLOBAL_CAPABILITIES.ocr` is a hard ceiling that defaults false.
 *
 * Two rules carry these: a probe that FAILED must never read as "scanned", and
 * a stray character must never make a scanned page look native.
 */
import { describe, it, expect } from 'vitest';
import {
  assessTextLayer,
  describeScannedRouting,
  MIN_PAGE_TEXT_CHARACTERS,
  MAX_LISTED_PAGES,
  SCANNED_DOCUMENT_POLICY_VERSION,
} from '../scannedDocumentPolicy.pure';

const page = (pageNumber: number, characters: number) => ({ pageNumber, characters });
const pages = (n: number, characters: number) =>
  Array.from({ length: n }, (_, i) => page(i + 1, characters));

describe('assessTextLayer', () => {
  it('calls a document with text on every page native', () => {
    const assessment = assessTextLayer(pages(8, 1_800), 8);
    expect(assessment).toMatchObject({
      version: SCANNED_DOCUMENT_POLICY_VERSION,
      verdict: 'native', pagesMeasured: 8, pagesWithText: 8, pagesWithoutText: 0,
      characters: 14_400,
    });
  });

  it('calls a document with no text on any page scanned', () => {
    expect(assessTextLayer(pages(6, 0), 6).verdict).toBe('scanned');
  });

  it('does not let a stray character make a scanned page look native', () => {
    // A scan routinely carries a stamp, a form field or a producer watermark.
    // Calling such a page native on four characters is how a scanned document
    // gets imported as a picture with nobody told.
    expect(assessTextLayer(pages(5, MIN_PAGE_TEXT_CHARACTERS - 1), 5).verdict).toBe('scanned');
    expect(assessTextLayer(pages(5, MIN_PAGE_TEXT_CHARACTERS), 5).verdict).toBe('native');
  });

  it('calls a mixed document partial and names the pages', () => {
    const mixed = [...pages(6, 1_200).slice(0, 6), page(7, 0), page(8, 0)];
    const assessment = assessTextLayer(mixed, 8);
    expect(assessment.verdict).toBe('partial');
    expect(assessment.pagesWithoutTextNumbers).toEqual([7, 8]);
  });

  it('counts a page the probe never reached as having no text', () => {
    // A page missing from the walk is a page PDF.js found nothing on.
    const assessment = assessTextLayer([page(1, 2_000)], 5);
    expect(assessment.pagesWithoutText).toBe(4);
    expect(assessment.pagesWithoutTextNumbers).toEqual([2, 3, 4, 5]);
    expect(assessment.verdict).toBe('scanned');
  });

  it('bounds the page list it will name', () => {
    const assessment = assessTextLayer([page(1, 5_000)], 40);
    expect(assessment.pagesWithoutTextNumbers).toHaveLength(MAX_LISTED_PAGES);
    expect(assessment.pagesWithoutText).toBe(39);
  });

  it('is unknown — never scanned — when nothing could be measured', () => {
    // The probe fails on an encrypted or malformed file, and those are not
    // scans. Recommending a different engine off a failed probe is the worse
    // error.
    for (const input of [[], null, undefined]) {
      expect(assessTextLayer(input as never).verdict).toBe('unknown');
    }
    expect(assessTextLayer([], 12).verdict).toBe('unknown');
  });

  it('ignores unusable page records rather than counting them', () => {
    const assessment = assessTextLayer(
      [page(1, 1_000), { pageNumber: Number.NaN, characters: 5 }, { pageNumber: 3 }] as never,
      2,
    );
    expect(assessment.pagesWithText).toBe(1);
  });
});

describe('describeScannedRouting', () => {
  it('prefers Claude for a scan and says what the other engine would do', () => {
    const routing = describeScannedRouting(assessTextLayer(pages(6, 0), 6));
    expect(routing.preferClaude).toBe(true);
    expect(routing.notify).toBe(true);
    expect(routing.message).toContain('no text layer');
    // The fact the user needs is what happens if they do nothing.
    expect(routing.message).toContain('picture of each page');
  });

  it('never offers OCR', () => {
    // OCR is off at the capability ceiling — 0 OCR pages across 1,164 in
    // production — so pointing someone at it sends them to a setting that
    // changes nothing.
    for (const assessment of [pages(6, 0), [...pages(6, 900), page(7, 0), page(8, 0)]]) {
      expect(describeScannedRouting(assessTextLayer(assessment, 8)).message.toLowerCase())
        .not.toContain('ocr');
    }
  });

  it('keeps a mostly-readable document on the deterministic path', () => {
    // It measures real glyph geometry where there is any, which no amount of
    // reading a picture can match.
    const routing = describeScannedRouting(assessTextLayer([...pages(6, 900), page(7, 0), page(8, 0)], 8));
    expect(routing.preferClaude).toBe(false);
    expect(routing.notify).toBe(true);
    expect(routing.message).toContain('7, 8');
  });

  it('says nothing about a native document, or one it could not read', () => {
    for (const verdictInput of [pages(8, 2_000), []]) {
      const routing = describeScannedRouting(assessTextLayer(verdictInput, 8));
      expect(routing.notify).toBe(false);
      expect(routing.preferClaude).toBe(false);
      expect(routing.message).toBe('');
    }
  });

  it('phrases a single-page scan without a page count', () => {
    expect(describeScannedRouting(assessTextLayer([page(1, 0)], 1)).message)
      .not.toMatch(/\d of its \d/);
  });
});
