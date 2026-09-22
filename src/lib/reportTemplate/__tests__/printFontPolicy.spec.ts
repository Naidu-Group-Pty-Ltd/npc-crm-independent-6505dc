/**
 * Every template this product prints must survive the render boundary.
 *
 * ## The defect this guards against returning
 *
 * `render-template-pdf` calls `assertSafeRenderResources` before it invokes
 * WeasyPrint, and that gate admits only `data:` payloads and objects under this
 * project's own storage origin. All 500 seeded Investment Compass masters
 * declare their typefaces as `tokens.fontFaces` entries carrying a Google Fonts
 * `cssUrl` — 2,838 of them across the seed migrations — and the renderer
 * emitted each as `@import url('https://fonts.googleapis.com/…')`. One is
 * enough to fail a whole document.
 *
 * So **every** design-system render this product attempted was rejected, and
 * rejected invisibly: the assertion ran before the `template_render_jobs` row
 * was inserted and before `templateId` was read, so neither the ledger nor
 * `template_events` recorded it. The route reported `render_failed`, the caller
 * fell through to its legacy generator, and the client received a
 * well-typeset document in the wrong design. Measured on 14 August 2026: 10 of
 * 10 downloads that day came from the composer, `0` `template_render_jobs` rows
 * since 11 August, `0` render failures logged since 6 August.
 *
 * Nothing caught it because nothing had ever asserted the two halves against
 * each other: the renderer's own specs check the HTML, and the policy's specs
 * check hand-written strings. This file renders a real seeded master and puts
 * the result through the real gate.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTemplateToHtml } from '../htmlRenderer';
import { compileTemplateHtmlForPdf } from '../compileTemplateForPdf';
import { parseTemplate } from '../templateSchema';
import { assertSafeRenderResources } from '../../../../supabase/functions/_shared/renderResourcePolicy.pure';
import {
  PRINT_FONT_SUBSTITUTIONS,
  isContainerInstalledFamily,
  substitutePrintFamily,
  substitutePrintFontFaces,
  substitutePrintFontStack,
  substitutePrintTokenFonts,
  unsubstitutedPrintFamilies,
} from '../../../../supabase/functions/_shared/reportDesign/printFontPolicy.pure';

const SUPABASE_URL = 'https://dduzbchuswwbefdunfct.supabase.co';
const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');

/** A template shaped like the seeded masters: Google-hosted faces on a page. */
const templateWithRemoteFonts = () => ({
  version: 1,
  name: 'Probe',
  tokens: {
    colors: { ink: '#111111', surface: '#ffffff', primary: '#2F4858' },
    fonts: {
      display: 'Lato, sans-serif',
      heading: 'Lato, sans-serif',
      body: 'Noto Serif, serif',
      mono: 'IBM Plex Mono, monospace',
    },
    spacing: { gutter: 11, padding: 45 },
    fontFaces: [
      { family: 'Lato', cssUrl: 'https://fonts.googleapis.com/css2?family=Lato&display=swap' },
      { family: 'Noto Serif', cssUrl: 'https://fonts.googleapis.com/css2?family=Noto+Serif' },
    ],
  },
  slots: {},
  pages: [{
    id: 'p1',
    name: 'Cover',
    size: { width: 595, height: 842 },
    background: { color: 'token:surface' },
    blocks: [{
      id: 'b1',
      type: 'text-block',
      props: { x: 45, y: 45, width: 505, body: 'Hello', bodyFont: 'token:body', color: 'token:ink' },
      overlays: [],
    }],
  }],
});

describe('the print font boundary', () => {
  it('rejects the HTML the renderer used to send — the defect, reproduced', () => {
    const { html } = renderTemplateToHtml(parseTemplate(templateWithRemoteFonts()), { data: {} });
    expect(html, 'the preview no longer links its webfonts at all — that is a different change')
      .toContain('fonts.googleapis.com');
    expect(() => assertSafeRenderResources(html, SUPABASE_URL)).toThrow(/normalized into project storage/);
  });

  it('names what it refused, so the next person does not need a reproduction', () => {
    const { html } = renderTemplateToHtml(parseTemplate(templateWithRemoteFonts()), { data: {} });
    expect(() => assertSafeRenderResources(html, SUPABASE_URL))
      .toThrow(/fonts\.googleapis\.com/);
  });

  it('passes the gate once the container is the font source', () => {
    const { html } = renderTemplateToHtml(parseTemplate(templateWithRemoteFonts()), {
      data: {},
      fontSource: 'container',
    });
    expect(() => assertSafeRenderResources(html, SUPABASE_URL)).not.toThrow();
    // The families are still NAMED — fontconfig resolves them inside the image.
    // Dropping the link and the family would set the document in the engine
    // default, which is the failure this is not allowed to trade for.
    expect(html).toContain('Lato');
    expect(html).toContain('Noto Serif');
  });

  it('the one PDF compiler forces it, so no caller can forget', async () => {
    const { html } = await compileTemplateHtmlForPdf(
      parseTemplate(templateWithRemoteFonts()) as never,
      { data: {}, fontSource: 'remote' } as never,
    );
    // Even asked for `remote` explicitly: there is no PDF render for which a
    // network fetch is correct, and a caller passing the wrong thing must not
    // be able to produce HTML the renderer will refuse.
    expect(() => assertSafeRenderResources(html, SUPABASE_URL)).not.toThrow();
  });

  it('drops a remote @font-face src too, not only the stylesheet link', () => {
    const tpl = templateWithRemoteFonts() as any;
    tpl.tokens.fontFaces = [
      { family: 'Lato', src: 'https://cdn.example.com/lato.woff2' },
      { family: 'Inter', src: 'data:font/woff2;base64,AAAA' },
    ];
    const { html } = renderTemplateToHtml(parseTemplate(tpl), { data: {}, fontSource: 'container' });
    expect(() => assertSafeRenderResources(html, SUPABASE_URL)).not.toThrow();
    // The embedded face travels with the document and still reaches the page.
    expect(html).toContain('data:font/woff2;base64,AAAA');
  });
});

describe('the substitution map', () => {
  it('leaves a family the container installs exactly alone', () => {
    for (const family of ['Lato', 'Inter', 'Noto Serif', 'Playfair Display', 'IBM Plex Mono', 'Cinzel']) {
      expect(isContainerInstalledFamily(family), `${family} is no longer installed`).toBe(true);
      expect(substitutePrintFamily(family)).toBe(family);
      expect(substitutePrintFontStack(`${family}, serif`)).toBe(`${family}, serif`);
    }
  });

  it('rewrites only the leading family, keeping the generic fallback', () => {
    expect(substitutePrintFontStack('Fraunces, serif')).toBe('Playfair Display, serif');
    expect(substitutePrintFontStack('Public Sans, sans-serif')).toBe('Inter, sans-serif');
  });

  it('leaves a family it does not know rather than guessing', () => {
    // A wrong substitution is worse than the generic fallback — the point of
    // `unsubstitutedPrintFamilies` is that the gap fails a spec instead.
    expect(substitutePrintFamily('Some Unshipped Face')).toBe('Some Unshipped Face');
    expect(unsubstitutedPrintFamilies(['Some Unshipped Face'])).toEqual(['Some Unshipped Face']);
    expect(unsubstitutedPrintFamilies(['Lato', 'Fraunces', 'Public Sans'])).toEqual([]);
  });

  it('applies through the renderer, in the preview as well as the print', () => {
    const tpl = templateWithRemoteFonts() as any;
    tpl.tokens.fonts.body = 'Fraunces, serif';
    tpl.tokens.fontFaces = [
      { family: 'Fraunces', cssUrl: 'https://fonts.googleapis.com/css2?family=Fraunces' },
    ];
    // A preview that fetched Fraunces would show a document the printer cannot
    // produce; what you see has to be what prints.
    const { html } = renderTemplateToHtml(parseTemplate(tpl), { data: {} });
    expect(html).toContain('Playfair Display');
    expect(html).not.toContain('Fraunces');
    expect(substitutePrintFontFaces(tpl.tokens.fontFaces)).toEqual([]);
  });

  it('substitutes a tokens.fonts map without disturbing what it need not touch', () => {
    const fonts = { body: 'Fraunces, serif', mono: 'IBM Plex Mono, monospace' };
    const out = substitutePrintTokenFonts(fonts);
    expect(out.body).toBe('Playfair Display, serif');
    expect(out.mono).toBe('IBM Plex Mono, monospace');
    // Nothing to change is the identity, so an unchanged document keeps its
    // token object and the page cache's stable-JSON key does not move.
    const untouched = { body: 'Lato, sans-serif' };
    expect(substitutePrintTokenFonts(untouched)).toBe(untouched);
  });
});

describe('the paths that send HTML to the renderer', () => {
  const withoutComments = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  /**
   * The production route sends HTML to the renderer again (RS-2, 14 Sep 2026:
   * the FINAL client document is drawn by the print engine), and the rule this
   * test protects is the one that bit the first time: the route must never
   * grow its OWN compile step, because a second path to the render service is
   * how the font policy came to be bypassed. It compiles through
   * `compileTemplateHtmlForPdf` — the one compiler, whose font source the test
   * below pins — and addresses the engine through the one client, never by
   * name. The browser preview keeps its own draw.
   */
  it('the production route reaches the renderer only through the one compiler', () => {
    const code = withoutComments(readFileSync(
      join(__dirname, '../routeReportThroughTemplate.ts'), 'utf8',
    ));
    expect(code, 'the route renders its own HTML again — read this file\'s header')
      .not.toMatch(/renderTemplateToHtml\s*\(/);
    expect(code).toContain('compileTemplateHtmlForPdf(');
    expect(code).not.toContain('render-template-pdf');
    expect(code).toContain("from '@/lib/reportTemplate/weasyRenderClient'");
    // The preview renderer, drawn here.
    expect(code).toContain('renderTemplateToBlob(');
  });

  it('the compiler decides the font source; a caller cannot pass one through', () => {
    const code = withoutComments(readFileSync(
      join(__dirname, '../compileTemplateForPdf.ts'), 'utf8',
    ));
    // Spread FIRST, literal after: `{ fontSource: 'container', ...options }`
    // would let a caller override it back to the setting that fails the gate.
    expect(code).toMatch(/\.\.\.options[\s\S]{0,60}fontSource:\s*'container'/);
  });
});

describe('the seeded catalogue', () => {
  /** Every family the seed migrations name, from the stacks and the faces. */
  const seededFamilies = (): string[] => {
    const out = new Set<string>();
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.includes('seed_template_library'))) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      for (const [, family] of sql.matchAll(/"family":\s*"([^"]+)"/g)) out.add(family);
      for (const [, stack] of sql.matchAll(
        /"(?:display|heading|body|mono)":\s*"([^"]*(?:sans-serif|serif|monospace))"/g,
      )) {
        out.add(stack.split(',')[0].trim());
      }
    }
    return [...out].sort();
  };

  /**
   * Timed, not guessed: `seededFamilies()` reads and regex-scans every
   * `seed_template_library` migration — **587 MB across nineteen files** as
   * of seed v19 (the comment above this one said 199 MB across nine, and was
   * three releases stale; each release adds ~41.7 MB and none is ever
   * removed, which is worth knowing before adding the twentieth). That is the
   * catalogue's templates written out as SQL, it is real work, and
   * under vitest's default 5 s allowance it fails the whole file whenever
   * the machine is busy (measured: 7.3 s in a loaded parallel run, ~1 s
   * alone). The assertion is unchanged; only the clock is honest about what
   * the test does.
   */
  it('names no face the container lacks and this module cannot stand in for', { timeout: 120_000 }, () => {
    // The assertion that would have caught Fraunces the day the catalogue was
    // generated. The Dockerfile's own note records dropping it from the report
    // type stacks — no Debian binary package exists — and the catalogue was
    // generated afterwards without being told.
    const families = seededFamilies();
    expect(families.length, 'the seed migrations declare no font families at all').toBeGreaterThan(4);
    expect(unsubstitutedPrintFamilies(families)).toEqual([]);
  });

  it('every substitution names a family the container actually has', () => {
    // A substitute that is itself missing is the same bug wearing a fix.
    for (const [from, to] of Object.entries(PRINT_FONT_SUBSTITUTIONS)) {
      expect(isContainerInstalledFamily(from), `${from} is installed — retire this row`).toBe(false);
      expect(isContainerInstalledFamily(to), `substitute ${to} is not in the image`).toBe(true);
    }
  });
});
