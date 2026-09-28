/**
 * How a chosen design sets type, pinned by the rules rather than the renders.
 *
 * The renders are measured elsewhere (459 of them, see `templateDesignCss.pure.ts`
 * and `docs/reports/TEMPLATE_PARITY.md`). These are the rules those renders
 * depend on, stated so that a change to one of them fails here, next to its
 * reason, rather than as a page that quietly breaks somewhere else.
 */
import { describe, expect, it } from 'vitest';
import {
  catalogueDesigns,
  designFromTemplateRow,
  designTypography,
  FACE_ADVANCE_EM,
  hasTrueItalic,
  resolveCatalogueDesign,
  UNIT_TYPE_FIT,
  type ReportTemplateDesign,
} from '../../../../supabase/functions/_shared/reportDesign/templateDesign.pure';
import { templateDesignCss } from '../../../../supabase/functions/_shared/reportDesign/templateDesignCss.pure';
import { buildReportCss } from '../../../../supabase/functions/_shared/reportDesign/css.pure';
import { resolveReportPalette } from '../../../../supabase/functions/_shared/reportDesign/brandResolve.pure';
import { normalizeReportDesignOptions, scaledType } from '../../../../supabase/functions/_shared/reportDesign/options.pure';

function design(code: string): ReportTemplateDesign {
  const r = resolveCatalogueDesign({ code, colourway: null });
  if (r.ok === false) throw new Error(`${code}: ${r.detail}`);
  return r.design;
}

const type = scaledType(normalizeReportDesignOptions(null));
const sheetFor = (d: ReportTemplateDesign) =>
  templateDesignCss(d.layer, d.palette, normalizeReportDesignOptions(d.options), type);

describe('a display line keeps the measure the house face gave it', () => {
  it('sets the reference design at the house sizes, because its faces are the house faces', () => {
    expect(design('pb-01').layer.fit).toEqual(UNIT_TYPE_FIT);
  });

  it('sets a wider face smaller by exactly the measured width ratio', () => {
    const mono = design('de-01').layer.fit;
    const houseSemibold = FACE_ADVANCE_EM['Playfair Display'].semibold;
    expect(mono.display).toBeCloseTo(houseSemibold / FACE_ADVANCE_EM['IBM Plex Mono'].semibold, 3);
    // Its italic voice is the body face, Inter, measured against Playfair's italic.
    expect(mono.accent).toBeCloseTo(
      FACE_ADVANCE_EM['Playfair Display'].italic! / FACE_ADVANCE_EM.Inter.italic!, 3,
    );
  });

  it('never enlarges a narrower face', () => {
    for (const v of catalogueDesigns()) {
      const fit = design(v.code).layer.fit;
      for (const value of Object.values(fit)) {
        expect(value, v.code).toBeGreaterThan(0.6);
        expect(value, v.code).toBeLessThanOrEqual(1);
      }
    }
    // Lato and Roboto are narrower than Playfair SemiBold: the house size stands.
    expect(design('ap-01').layer.fit.display).toBe(1);
    expect(design('wm-01').layer.fit.display).toBe(1);
  });

  it('leaves a face it has no measurement for at the house size', () => {
    const t = designTypography({ heading: 'Noto Sans', body: 'Noto Sans' }, []);
    expect(t.fit.display).toBe(1);
  });

  it('folds the cover fit into the cover title scale', () => {
    // Dark Executive sets its cover in IBM Plex Mono, which is wider than Cinzel.
    const de = design('de-01').layer;
    expect(de.fit.cover).toBeLessThan(1);
    expect(de.coverTitleScale).toBeCloseTo((33 / 41) * de.fit.cover, 2);
  });
});

describe('the italic voice is always a face with a real italic', () => {
  it('knows which faces the print container ships without one', () => {
    expect(hasTrueItalic('IBM Plex Mono')).toBe(false);
    expect(hasTrueItalic('Cinzel')).toBe(false);
    expect(hasTrueItalic('Playfair Display')).toBe(true);
    expect(hasTrueItalic('Inter')).toBe(true);
  });

  it('takes the body face when the heading face cannot slant', () => {
    const t = designTypography({ heading: 'Cinzel', body: 'Lato' }, []);
    expect(t.typography.accent.startsWith("'Lato'")).toBe(true);
    expect(t.displayItalic).toBe(false);
  });

  it('sets the pull quote in that voice where the display face has no italic, and only there', () => {
    expect(sheetFor(design('de-01'))).toContain(`.pull-quote { font-family: ${design('de-01').layer.typography.accent}; }`);
    expect(sheetFor(design('pb-01'))).not.toContain('.pull-quote');
    expect(sheetFor(design('sm-01'))).not.toContain('.pull-quote');
  });
});

describe('the rest of what a design sets', () => {
  it('insets a framed cover with an outline, never a border at the trim', () => {
    const sheet = sheetFor(design('ap-01'));
    expect(sheet).toMatch(/outline: 0\.75pt solid #[0-9A-F]{6};\s*outline-offset: -10mm;/);
    expect(sheet).not.toMatch(/\.report-cover \{[^}]*\bborder:/);
  });

  it('sets a numeral section number in the display face at the subhead step', () => {
    const d = design('ap-01');
    expect(sheetFor(d)).toContain(`font-family: ${d.layer.typography.display};`);
    expect(sheetFor(d)).toMatch(/\.chapter-header \.chapter-no \{\s*font-family: [^;]+;\s*font-size: 14pt;/);
  });

  it('changes nothing on a document that has no design', () => {
    const palette = resolveReportPalette({ preset: 'signature', brandHex: '#2E6F95' });
    const plain = buildReportCss({ palette, options: null, masthead: 'Tenant Advisory' });
    expect(plain).not.toContain('The chosen design');
    expect(plain).not.toContain('outline-offset');
  });

  it('keeps a hand-built template on the house structure with its own faces', () => {
    const r = designFromTemplateRow({
      id: '9a1b2c3d-0000-4000-8000-000000000009',
      name: 'Hand-built',
      tokens: {
        colors: {
          primary: '#2B5138', bg: '#1A2018', surface: '#F9FAF6', panel: '#EFF1EA',
          text: '#F9FAF6', ink: '#262C23', mutedInk: '#555C52', line: '#DADFD6',
        },
        fonts: { heading: 'IBM Plex Mono', body: 'Inter' },
      },
      lineage: null,
    });
    if (r.ok === false) throw new Error(r.detail);
    expect(r.design.layer.coverGround).toBe('field');
    expect(r.design.layer.fit.display).toBeLessThan(1);
    // With no catalogue scale, the cover title scale is the cover fit alone.
    expect(r.design.layer.coverTitleScale).toBe(r.design.layer.fit.cover);
  });
});
