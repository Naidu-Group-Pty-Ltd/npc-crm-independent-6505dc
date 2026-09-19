/**
 * What the file declares itself to be, and what a press needs from it.
 *
 * These are claims a machine downstream acts on — a screen reader, a
 * conformance validator, a plate-setter — rather than things a reader sees. So
 * each one is asserted against the *measurement* that settled it, and the
 * measurements are recorded in the comments beside them.
 *
 * The one thing this file cannot do is validate a PDF; that needs an engine and
 * veraPDF, and it lives in `scripts/reports/validateUa.mts` and in the image's
 * own `selfcheck.py`. What is here is everything that decides whether the
 * document handed to those two can pass.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildReportCss } from '../css.pure';
import { resolveReportPalette } from '../brandResolve.pure';
import { chartFigure } from '../charts.pure';
import { DEFAULT_REPORT_DESIGN_OPTIONS } from '../options.pure';
import { withDecodedCharts } from './chartSvg';
import { PDF_NO_VARIANT, renderPdf } from '../../../../supabase/functions/_shared/weasyprintClient';

const REPO = resolve(__dirname, '../../../..');
const css = (options?: Record<string, unknown>) => buildReportCss({
  palette: resolveReportPalette(),
  masthead: 'Acme',
  options: options as never,
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 4">'
  + '<rect width="10" height="4" fill="#333"/></svg>';

describe('a chart is reachable, not merely drawn', () => {
  /**
   * Probed against the pinned engine, three ways. Only the third produces a
   * `/Figure` with `/Alt` in the structure tree:
   *
   *   inline `<svg role="img" aria-label="…">`  →  /Span, /NonStruct
   *   inline `<svg><title>…</title>`            →  /Span, /NonStruct
   *   `<img src="data:image/svg+xml;base64,…" alt="…">`  →  /Figure + /Alt
   *
   * And the part that makes this worth a test rather than a comment: with the
   * drawing under `/NonStruct` there is no figure for a validator to demand
   * alternative text for, so **the document passes PDF/UA with every chart in
   * it unreachable**. The validator cannot catch this one.
   */
  it('emits the chart as an image with alternative text', () => {
    const figure = chartFigure(SVG, 'Capacity and headroom');
    expect(figure).toContain('<img class="chart-img"');
    expect(figure).toContain('src="data:image/svg+xml;base64,');
    expect(figure).toContain('alt="Capacity and headroom"');
    expect(figure).toContain('<figcaption>Capacity and headroom</figcaption>');
  });

  it('carries the drawing intact inside the payload', () => {
    expect(withDecodedCharts(chartFigure(SVG, 'A caption'))).toContain('viewBox="0 0 10 4"');
  });

  it('takes an explicit description when the caption would not do', () => {
    expect(chartFigure(SVG, '', 'A gauge of the assessed limit'))
      .toContain('alt="A gauge of the assessed limit"');
  });

  it('stays inline and untagged when it has nothing to describe it', () => {
    // A `/Figure` with an empty `/Alt` fails PDF/UA — and it lies. An untagged
    // drawing is merely silent, which is the lesser of the two.
    const figure = chartFigure(SVG);
    expect(figure).not.toContain('<img');
    expect(figure).toContain('<svg');
  });

  it('is base64 rather than percent-encoded, which the resource policy needs', () => {
    // `renderResourcePolicy.pure.ts` skips exactly the base64 payload of a
    // `data:` URI. A percent-encoded SVG stays under the URL scan, where its
    // own markup can trip the scheme-relative check.
    const policy = readFileSync(
      resolve(REPO, 'supabase/functions/_shared/renderResourcePolicy.pure.ts'),
      'utf8',
    );
    expect(policy).toContain(';base64,');
    expect(chartFigure(SVG, 'x')).toContain(';base64,');
  });

  it('survives a label the engine would choke on in latin1', () => {
    // `btoa` takes a latin1 string and a chart label carries an em dash or a
    // currency symbol often enough that passing the SVG straight in throws.
    const withGlyphs = SVG.replace('</svg>', '<text>−$9,420 — 3.98%</text></svg>');
    expect(withDecodedCharts(chartFigure(withGlyphs, 'x'))).toContain('−$9,420 — 3.98%');
  });
});

describe('the press sheet', () => {
  /**
   * Three named pages already declare `bleed: true`, and that flag paints the
   * field colour and suppresses the running chrome — it does **not** extend the
   * trim. A full-bleed obsidian cover trimmed with any tolerance shows a white
   * hairline down the edge it was trimmed short on.
   *
   * Measured on the pinned engine with the flag on: MediaBox
   * `-8.5 -8.5 603.8 850.4` around a TrimBox of `0 0 595.3 841.9`. 8.5pt is
   * 3mm, the trade convention.
   */
  it('is off by default, because crop marks on a client document read as a proof', () => {
    expect(DEFAULT_REPORT_DESIGN_OPTIONS.pressMarks).toBe(false);
    // Anchored to a declaration. A named page's own note begins "Full-bleed:",
    // so a bare substring search matches the prose that explains the flag
    // rather than the flag — which is how this assertion first passed itself.
    expect(css()).not.toMatch(/^\s*marks:/m);
    expect(css()).not.toMatch(/^\s*bleed:/m);
  });

  it('extends the sheet and marks the trim when asked', () => {
    const sheet = css({ pressMarks: true });
    expect(sheet).toContain('marks: crop cross;');
    expect(sheet).toContain('bleed: 3mm;');
  });

  it('declares them on the base page, so every named page inherits', () => {
    // The cover is the page that most needs the bleed and the one that
    // declares its own margins, so a per-page rule would miss it.
    const sheet = css({ pressMarks: true });
    const base = sheet.slice(sheet.indexOf('@page {'), sheet.indexOf('@page cover'));
    expect(base).toContain('marks: crop cross;');
  });
});

describe('the variant the request asks for', () => {
  /**
   * `weasyprint.pdf.VARIANTS` on the pinned engine holds eighteen names and
   * `pdf-1.7` is not one of them — asking for it raises `KeyError: 'pdf-1.7'`
   * inside `Document._render`, which the service returns as a 500. The Export
   * Pipeline dialog offers it as "PDF 1.7 (standard)", so that option has never
   * produced a file.
   */
  const bodyOf = async (options: Record<string, unknown>) => {
    const calls: Array<Record<string, unknown>> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch;
    try {
      await renderPdf({ url: 'http://x', token: 't' }, '<html><head></head><body>x</body></html>', options);
    } finally {
      globalThis.fetch = original;
    }
    return calls[0];
  };

  it('sends no variant at all for the one name the engine does not have', async () => {
    expect((await bodyOf({ variant: PDF_NO_VARIANT })).pdf_variant).toBeNull();
  });

  it('sends the four the engine does have, verbatim', async () => {
    for (const variant of ['pdf/ua-1', 'pdf/a-2b', 'pdf/a-3b'] as const) {
      expect((await bodyOf({ variant })).pdf_variant).toBe(variant);
    }
  });

  it('claims accessibility when the caller says nothing', async () => {
    const body = await bodyOf({});
    expect(body.pdf_variant).toBe('pdf/ua-1');
    // `pdf/ua-1` does not add an output intent the way the PDF/A variants do.
    expect(body.output_intent).toBe('srgb');
    expect(body.custom_metadata).toBe(true);
  });

  it('is the same request the engine check probes with', async () => {
    // `engineCheck.mts` is the gate that asks a deployed container whether it
    // still does what `engineSupport.pure.ts` says it does — and it asked about
    // `pdf/a-2b` for a while after the claim moved to PDF/UA-1. A gate that
    // probes a path production does not take can pass while production is
    // broken, so the two are pinned together here.
    const script = readFileSync(resolve(REPO, 'scripts/reports/engineCheck.mts'), 'utf8');
    const sent = await bodyOf({});
    expect(script).toContain(`pdf_variant: '${sent.pdf_variant}'`);
    expect(script).toContain(`output_intent: '${sent.output_intent}'`);
    expect(script).not.toContain("pdf_variant: 'pdf/a-2b'");
  });
});

describe('the document outline', () => {
  it('names the two heading levels that are structural, and not the cover', () => {
    const sheet = css();
    expect(sheet).toMatch(/\.chapter-header h1[\s\S]{0,160}bookmark-level: 1;/);
    expect(sheet).toMatch(/\.chapter-body h2 \{[^}]*bookmark-level: 2;/);
    expect(sheet).toMatch(/\.report-cover h1\.cover-title \{ bookmark-level: none; \}/);
  });
});
