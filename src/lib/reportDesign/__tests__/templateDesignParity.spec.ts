/**
 * A template changes how a document looks and nothing else — proved, for every
 * report type that takes a chosen design, under every design there is.
 *
 * The owner's rule (26 Sep 2026). On that day none of the nine non-Investment
 * report types carried the same information through a template as through its
 * standard document (`docs/reports/TEMPLATE_PARITY.md`): a master's page
 * sequence is a second statement of what a report says, and two statements
 * drift. So those report types draw their own standard document in the chosen
 * design, and this file is the check that never existed:
 *
 *   - **The body is the standard body.** For each report type, the longest
 *     document it can produce is drawn with no design and with each of the
 *     fifty catalogue designs, and with every colourway of every family. The
 *     `<body>` must be byte for byte the standard one, apart from the colours
 *     and faces painted inside its chart images — which is what a design is
 *     for. Every figure, label, section, list item and table row is therefore
 *     the standard document's, by construction rather than by inspection.
 *   - **The head says the same thing.** Title, author and subject metadata.
 *   - **The design did something.** Its stylesheet differs from the standard
 *     one and names its faces, so a design that silently fell through to the
 *     house look fails here rather than passing as "identical".
 *   - **The design's rules cannot hide or add words.** No `display: none`, no
 *     generated `content`, no `text-transform`, no `visibility`, no remote
 *     resource, anywhere in what a design appends.
 *   - **Every one of the 500 designs prints legibly.** Each passes the same
 *     contrast audit every document's palette does.
 */
import { describe, expect, it } from 'vitest';
import { parityFormats } from './fixtures/designParityDocuments';
import {
  catalogueColourways,
  catalogueDesigns,
  designFromTemplateRow,
  resolveCatalogueDesign,
  type ReportTemplateDesign,
} from '../../../../supabase/functions/_shared/reportDesign/templateDesign.pure';
import { templateDesignCss } from '../../../../supabase/functions/_shared/reportDesign/templateDesignCss.pure';
import { auditPaletteContrast } from '../../../../supabase/functions/_shared/reportDesign/brandResolve.pure';
import { normalizeReportDesignOptions, scaledType } from '../../../../supabase/functions/_shared/reportDesign/options.pure';
import { CONTAINER_INSTALLED_FAMILIES } from '../../../../supabase/functions/_shared/reportDesign/typography.pure';

// ── What is compared ────────────────────────────────────────────────────────

function part(html: string, tag: 'head' | 'body'): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*)</${tag}>`).exec(html);
  if (!m) throw new Error(`no <${tag}>`);
  return m[1];
}

/** The stylesheet alone. */
function styleOf(html: string): string {
  const m = /<style>([\s\S]*?)<\/style>/.exec(html);
  if (!m) throw new Error('no <style>');
  return m[1];
}

/** The head without its stylesheet: title, author, subject. */
function metaOf(html: string): string {
  return part(html, 'head').replace(/<style>[\s\S]*?<\/style>/, '');
}

/**
 * Paint removed from an SVG: colours, faces and type sizes, which a design
 * changes, and nothing else. Values, labels, geometry and order are left
 * exactly as drawn. (A design sets a chart's display type smaller where its
 * face is wider than the house's — `templateDesign.pure.ts`, `FACE_ADVANCE_EM`
 * — so a title keeps the measure it was drawn for.)
 */
function unpainted(svg: string): string {
  return svg
    .replace(/#[0-9A-Fa-f]{6}\b/g, '#colour')
    .replace(/rgba?\([^)]*\)/g, 'rgb(colour)')
    .replace(/font-family="[^"]*"/g, 'font-family="face"')
    .replace(/font-family:[^;"]*/g, 'font-family:face')
    .replace(/font-size="[^"]*"/g, 'font-size="size"');
}

/**
 * The body with every chart image decoded and unpainted.
 *
 * A chart is an `<img>` holding a base64 SVG, so its words and figures are not
 * visible to a string comparison until it is decoded — which is exactly where a
 * design could hide a changed number if it could change one.
 */
function comparableBody(html: string): string {
  return part(html, 'body')
    .replace(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g, (_m, b64: string) =>
      `svg:${unpainted(Buffer.from(b64, 'base64').toString('utf8'))}`)
    .replace(/<svg[\s\S]*?<\/svg>/g, (svg) => unpainted(svg));
}

// ── The designs under test ──────────────────────────────────────────────────

function mustResolve(code: string, colourway: string | null): ReportTemplateDesign {
  const r = resolveCatalogueDesign({ code, colourway });
  if (r.ok === false) throw new Error(`${code}/${colourway}: ${r.reason} ${r.detail}`);
  return r.design;
}

/**
 * Every design once in its family's default colourway, then every other
 * colourway of each family on its reference design — 140 designs, which reach
 * every variant and every colourway there is.
 */
function designsUnderTest(): ReportTemplateDesign[] {
  const out: ReportTemplateDesign[] = [];
  for (const v of catalogueDesigns()) out.push(mustResolve(v.code, null));
  for (const v of catalogueDesigns().filter((d) => d.axis.startsWith('A'))) {
    for (const cw of catalogueColourways(v.familyKey).slice(1)) out.push(mustResolve(v.code, cw.id));
  }
  // A template row with no lineage — hand-built — takes colours and faces only.
  const handBuilt = designFromTemplateRow({
    id: '9a1b2c3d-0000-4000-8000-000000000009',
    name: 'Hand-built',
    tokens: {
      colors: {
        primary: '#2B5138', bg: '#1A2018', surface: '#F9FAF6', panel: '#EFF1EA',
        text: '#F9FAF6', ink: '#262C23', mutedInk: '#555C52', line: '#DADFD6',
      },
      fonts: { heading: 'Noto Serif, serif', body: 'Lato, sans-serif' },
    },
    lineage: null,
  });
  if (handBuilt.ok === false) throw new Error(handBuilt.detail);
  out.push(handBuilt.design);
  return out;
}

const DESIGNS = designsUnderTest();

// ── The check ───────────────────────────────────────────────────────────────

describe('a chosen design changes the look of a document and nothing else', () => {
  it('reaches every catalogue design and every colourway', () => {
    expect(catalogueDesigns()).toHaveLength(50);
    expect(DESIGNS.length).toBe(50 + 90 + 1);
  });

  for (const format of parityFormats()) {
    describe(format.label, () => {
      const standard = format.render(null);
      const standardBody = comparableBody(standard);
      const standardMeta = metaOf(standard);
      const standardStyle = styleOf(standard);

      it('draws the standard document when no design is chosen, exactly as before', () => {
        // `design: null` and no design at all are the same call.
        expect(format.render(null)).toBe(standard);
        expect(standardStyle).not.toContain('The chosen design');
      });

      it('keeps every word, figure and chart of the standard document under all 141 designs', () => {
        const failures: string[] = [];
        for (const design of DESIGNS) {
          const html = format.render(design);
          if (comparableBody(html) !== standardBody) failures.push(`${design.label}: body differs`);
          if (metaOf(html) !== standardMeta) failures.push(`${design.label}: head differs`);
          if (styleOf(html) === standardStyle) failures.push(`${design.label}: stylesheet unchanged`);
        }
        expect(failures).toEqual([]);
      }, 120_000);

      it("sets the design's own faces", () => {
        const swiss = mustResolve('sm-01', null);
        const editorial = mustResolve('le-01', null);
        expect(styleOf(format.render(swiss))).toContain("'Inter'");
        expect(styleOf(format.render(editorial))).toContain("'Noto Serif'");
        expect(styleOf(format.render(editorial))).not.toContain("'Cinzel'");
      });
    });
  }
});

describe("a design's own rules", () => {
  const type = scaledType(normalizeReportDesignOptions(null));

  it('never hide, add or recase a word, and never fetch anything', () => {
    for (const design of DESIGNS) {
      const css = templateDesignCss(
        design.layer, design.palette, normalizeReportDesignOptions(design.options), type,
      );
      expect(css, design.label).not.toMatch(/display\s*:\s*none/);
      expect(css, design.label).not.toMatch(/text-transform/);
      expect(css, design.label).not.toMatch(/visibility/);
      expect(css, design.label).not.toMatch(/url\(|@import/);
      // `content: none` removes a pseudo-element the design itself would add;
      // any other generated content would be words the document never had.
      expect(css.replace(/content:\s*none/g, ''), design.label).not.toMatch(/content\s*:/);
    }
  });

  it('never cost a figure: a numeric head may wrap, and no table shell clips', () => {
    // Measured before this rule, with WeasyPrint 69.0 over 459 renders: 31 of
    // the 50 designs cut the C&I Capacity report's Evidence column at the edge
    // of the sheet, and the raised designs clipped Adjusted EBITDA inside the
    // table's rounded shell. After it: no clipped text in any render, and no
    // page count changed. Figures themselves still never wrap.
    for (const design of DESIGNS) {
      const css = templateDesignCss(
        design.layer, design.palette, normalizeReportDesignOptions(design.options), type,
      );
      const fit = css.slice(css.indexOf('A design never costs a figure'));
      expect(fit, design.label).toContain('table.data th.num { white-space: normal; }');
      expect(fit, design.label).toContain('.table-block, table.data { overflow: visible; }');
      expect(fit, design.label).not.toMatch(/td\.num[^{]*\{[^}]*white-space/);
      // After every rule it must win over, so it wins by order.
      expect(css.lastIndexOf('overflow: visible'), design.label).toBeGreaterThan(css.lastIndexOf('overflow: hidden'));
    }
    // And a standard document gets none of it.
    expect(templateDesignCss(null, DESIGNS[0].palette, normalizeReportDesignOptions(null), type)).toBe('');
  });

  it('name only faces the print container has', () => {
    const installed = new Set(CONTAINER_INSTALLED_FAMILIES);
    for (const design of DESIGNS) {
      for (const stack of Object.values(design.layer.typography)) {
        const lead = /^'([^']+)'/.exec(stack)?.[1];
        expect(lead && installed.has(lead), `${design.label}: ${stack}`).toBe(true);
      }
    }
  });
});

describe('every design prints legibly', () => {
  it('passes the contrast audit in all 500 design and colourway combinations', () => {
    let checked = 0;
    for (const v of catalogueDesigns()) {
      for (const cw of catalogueColourways(v.familyKey)) {
        const design = mustResolve(v.code, cw.id);
        expect(auditPaletteContrast(design.palette), `${v.code} · ${cw.id}`).toEqual([]);
        checked += 1;
      }
    }
    expect(checked).toBe(500);
  });
});
