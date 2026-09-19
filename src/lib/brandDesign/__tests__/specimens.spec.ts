/**
 * Every specimen card, rendered.
 *
 * Eight iframes on a page is not a thing a unit test can look at, but the HTML
 * that goes into them is — and that HTML is the *renderer's*, not a React
 * approximation of it. So what this can check is exactly what matters: that
 * every card produces real markup under every combination the page can put it
 * in, that none of it is a hole, and that nothing reaches an iframe that should
 * not be there.
 *
 * The combinations are not decoration. `coverStyle` only affects the Cover
 * card, `tableStyle` only the Data card, and a specimen that silently returns
 * `''` for one of them is a blank card nobody would notice until they were
 * choosing a design system through it.
 */
import { describe, expect, it } from 'vitest';

import { BRAND_SPECIMENS, specimensByGroup, SPECIMEN_GROUPS } from '../specimens';
import { importDesignSystem } from '../import.pure';
import { resolveReportPalette, type ReportPreset } from '@/lib/reportDesign/brandResolve.pure';
import { buildReportCss } from '@/lib/reportDesign/css.pure';
import { renderDocument } from '@/lib/reportDesign/primitives.pure';
import {
  DEFAULT_REPORT_DESIGN_OPTIONS,
  type ReportChapterStyle,
  type ReportCoverStyle,
  type ReportDesignOptions,
  type ReportTableStyle,
} from '@/lib/reportDesign/options.pure';
import { assertSafeRenderResources } from '@/lib/reportDesign/../../../supabase/functions/_shared/renderResourcePolicy.pure';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PRESETS: ReportPreset[] = ['signature', 'editorial_navy', 'minimal_ink', 'high_contrast'];

/* eslint-disable no-restricted-syntax --
 * Fixture brand colours: the six the form suggests, asserted on rather than
 * chosen as palette values in a component.
 */
const BRANDS = ['#2F5D50', '#1F3A5F', '#7A3B2E', '#4A3B6B', '#0F5C63', '#6B4A16'];
/* eslint-enable no-restricted-syntax */

/** The real house design system, imported — the stock an import actually brings. */
const IMPORTED = (() => {
  const manifest = JSON.parse(readFileSync(
    resolve(__dirname, '../../../../scripts/brandDesign/claudeDesign/npc-services.manifest.json'),
    'utf8',
  ));
  const r = importDesignSystem(manifest);
  if (r.ok === false) throw new Error(r.error);
  return r.result;
})();

const opts = (patch: Partial<ReportDesignOptions> = {}): ReportDesignOptions =>
  ({ ...DEFAULT_REPORT_DESIGN_OPTIONS, ...patch });

describe('every specimen, under every preset and brand', () => {
  it('produces real markup rather than a hole', () => {
    for (const preset of PRESETS) {
      for (const brandHex of BRANDS) {
        const palette = resolveReportPalette({ preset, brandHex });
        const options = opts({ preset });
        for (const s of BRAND_SPECIMENS) {
          const html = s.body(palette, options);
          expect(html.trim().length, `${s.id} / ${preset} / ${brandHex}`).toBeGreaterThan(40);
          expect(html, `${s.id} / ${preset}`).toMatch(/<\w+/);
        }
      }
    }
  });

  it('produces real markup on imported grounds too', () => {
    const palette = resolveReportPalette({
      neutrals: IMPORTED.neutrals,
      brandHex: IMPORTED.brandHex,
    });
    for (const s of BRAND_SPECIMENS) {
      expect(s.body(palette, opts()).trim().length, s.id).toBeGreaterThan(40);
    }
  });

  it('moves when the option it is about moves', () => {
    // A card that shows the same thing whatever you set is a card that is lying
    // about what it shows — which is precisely the failure the old
    // dropdown-and-a-hint form had.
    //
    // Where the movement lands differs by card, and that is not a wrinkle: type
    // size is a *stylesheet* decision, so the Body scale card's HTML is
    // deliberately identical at 85% and 115% and its stylesheet is not. The
    // eyebrow card prints the resolved point sizes as text, so its HTML does
    // move. Both are checked at the layer the change actually happens in.
    const palette = resolveReportPalette();

    const scale = BRAND_SPECIMENS.find((x) => x.id === 'scale')!;
    const small = buildReportCss({ palette, options: opts({ bodyScale: 85 }), masthead: 'S' });
    const large = buildReportCss({ palette, options: opts({ bodyScale: 115 }), masthead: 'S' });
    expect(small).not.toBe(large);
    expect(scale.tokenLine(opts({ bodyScale: 85 })))
      .not.toBe(scale.tokenLine(opts({ bodyScale: 115 })));

    const eyebrow = BRAND_SPECIMENS.find((x) => x.id === 'eyebrow')!;
    expect(eyebrow.body(palette, opts({ bodyScale: 85 })))
      .not.toBe(eyebrow.body(palette, opts({ bodyScale: 115 })));

    // The chapter and table cards move through the stylesheet as well.
    for (const [a, b] of [
      [opts({ chapterStyle: 'classic' }), opts({ chapterStyle: 'opener_band' })],
      [opts({ tableStyle: 'classic' }), opts({ tableStyle: 'ledger' })],
      [opts({ coverStyle: 'editorial' }), opts({ coverStyle: 'image' })],
      [opts({ density: 'compact' }), opts({ density: 'spacious' })],
    ] as const) {
      expect(buildReportCss({ palette, options: a, masthead: 'S' }))
        .not.toBe(buildReportCss({ palette, options: b, masthead: 'S' }));
    }
  });

  it('reports a failing palette on the Contrast card rather than hiding it', () => {
    // The card is the gate made visible. An illegible system must read as one.
    const contrast = BRAND_SPECIMENS.find((x) => x.id === 'contrast')!;
    const good = contrast.body(resolveReportPalette(), opts());
    expect(good).toContain('clears its floor');

    const bad = contrast.body(
      resolveReportPalette({
        neutrals: {
          paper: '#FFFFFF', paperAlt: '#FEFEFE', paperBright: '#FFFFFF',
          field: '#FDFDFD', rule: '#FCFCFC', bodyInk: '#FAFAFA', mutedInk: '#F9F9F9',
        },
      }),
      opts(),
    );
    expect(bad).toContain('below the floor');
  });

  it('carries a token line that names what it is showing', () => {
    for (const s of BRAND_SPECIMENS) {
      const line = s.tokenLine(opts({ preset: 'minimal_ink', density: 'compact' }));
      expect(line.trim().length, s.id).toBeGreaterThan(0);
      expect(line.length, s.id).toBeLessThan(120);
    }
  });

  it('carries a note that says why, not what', () => {
    for (const s of BRAND_SPECIMENS) {
      // A note shorter than a sentence is a label, and the pane already has one.
      expect(s.note.length, s.id).toBeGreaterThan(80);
      expect(s.name.length, s.id).toBeGreaterThan(2);
      expect(s.subtitle.length, s.id).toBeGreaterThan(2);
      expect(s.viewport.w, s.id).toBeGreaterThan(100);
      expect(s.viewport.h, s.id).toBeGreaterThan(100);
    }
  });

  it('gives every card a unique id', () => {
    const ids = BRAND_SPECIMENS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the whole document a card renders into', () => {
  const palette = resolveReportPalette({ brandHex: BRANDS[0] });

  it('passes the render-resource policy — nothing external, no script', () => {
    // The same assertion the nine render routes make before handing HTML to
    // WeasyPrint. A specimen goes into a sandboxed iframe rather than a PDF,
    // but "no remote reference and no script" is worth holding either way.
    for (const s of BRAND_SPECIMENS) {
      const html = renderDocument({
        title: s.name,
        author: 'Specimen',
        css: buildReportCss({ palette, options: opts(), masthead: 'Specimen' }),
        bodyHtml: s.body(palette, opts()),
      });
      expect(() => assertSafeRenderResources(html, ''), s.id).not.toThrow();
      expect(html, s.id).not.toContain('<script');
    }
  });

  it('covers every cover, table and chapter style without going blank', () => {
    const covers: ReportCoverStyle[] = ['image', 'title_overlay', 'editorial'];
    const tables: ReportTableStyle[] = ['classic', 'ledger', 'minimal'];
    const chapters: ReportChapterStyle[] = ['classic', 'opener_band', 'minimal'];
    for (const coverStyle of covers) {
      for (const tableStyle of tables) {
        for (const chapterStyle of chapters) {
          const options = opts({ coverStyle, tableStyle, chapterStyle });
          const css = buildReportCss({ palette, options, masthead: 'Specimen' });
          expect(css.length).toBeGreaterThan(1_000);
          for (const s of BRAND_SPECIMENS) {
            expect(
              s.body(palette, options).trim().length,
              `${s.id} / ${coverStyle} / ${tableStyle} / ${chapterStyle}`,
            ).toBeGreaterThan(40);
          }
        }
      }
    }
  });
});

describe('grouping', () => {
  it('orders the groups as the Design System pane does', () => {
    const groups = specimensByGroup().map((g) => g.group);
    const known = groups.filter((g) => (SPECIMEN_GROUPS as readonly string[]).includes(g));
    expect(known).toEqual(SPECIMEN_GROUPS.filter((g) => known.includes(g)));
  });

  it('loses no specimen to grouping', () => {
    const flat = specimensByGroup().flatMap((g) => g.specimens);
    expect(flat).toHaveLength(BRAND_SPECIMENS.length);
    expect(new Set(flat.map((s) => s.id)).size).toBe(BRAND_SPECIMENS.length);
  });
});
