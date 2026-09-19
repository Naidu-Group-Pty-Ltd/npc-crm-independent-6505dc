/**
 * The catalogue matches the approved Design source, and every value it uses is
 * mapped.
 *
 * Two jobs, both about trust rather than behaviour:
 *
 *  1. **Transcription.** `families.generated.ts` and
 *     `templateColourways.generated.ts` are emitted from `source.json`, itself a
 *     verbatim evaluation of `FAMILIES` and `COLOURWAYS` in the approved Claude
 *     Design catalogue. These tests re-derive the comparison, so a hand-edit to
 *     a generated file — the exact way a design decision gets quietly changed by
 *     an engineer — fails here rather than shipping.
 *
 *  2. **Coverage.** Every manifest value in the source must resolve to a
 *     renderer primitive. The resolvers throw rather than defaulting, so a
 *     family added to Design and not mapped here is a failing test rather than a
 *     template that silently renders as somebody else's layout.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DESIGN_FAMILIES, resolveManifest, scaleFor, typographyFor, marginFor, spacingFor,
  type Density,
} from '../../../../scripts/template-library/investmentCompass/family';
import { COLOURWAYS_BY_FAMILY } from '../../../../supabase/functions/_shared/templateColourways.generated';
import {
  calloutKind, chartPlan, coverPlan, kpiPlan, recommendationKind, riskKind,
  sectionHeaderKind, tablePlan,
} from '../../../../scripts/template-library/investmentCompass/resolvers';

interface Source {
  FAMILIES: Array<{
    code: string;
    no: string;
    name: string;
    note: string;
    faces: string;
    base: Record<string, string>;
    variants: Array<[string, string, string, string, string, string, string, Record<string, string>]>;
  }>;
  COLOURWAYS: Record<string, Array<[string, string, string, string, string, string, string]>>;
}

const SOURCE: Source = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../scripts/template-library/investmentCompass/source.json'),
  'utf8',
));

describe('the approved source itself', () => {
  it('is ten families of five variants', () => {
    expect(SOURCE.FAMILIES).toHaveLength(10);
    for (const family of SOURCE.FAMILIES) {
      expect(family.variants, family.name).toHaveLength(5);
    }
  });

  it('is ten colourways per family', () => {
    expect(Object.keys(SOURCE.COLOURWAYS)).toHaveLength(10);
    for (const [code, rows] of Object.entries(SOURCE.COLOURWAYS)) {
      expect(rows, code).toHaveLength(10);
    }
  });

  it('describes 50 masters and 500 combinations', () => {
    const masters = SOURCE.FAMILIES.reduce((n, f) => n + f.variants.length, 0);
    const combinations = SOURCE.FAMILIES.reduce(
      (n, f) => n + f.variants.length * SOURCE.COLOURWAYS[f.code].length, 0,
    );
    expect(masters).toBe(50);
    expect(combinations).toBe(500);
  });
});

describe('families are transcribed, not retyped', () => {
  it('ships every family in catalogue order', () => {
    expect(DESIGN_FAMILIES.map((f) => f.code)).toEqual(SOURCE.FAMILIES.map((f) => f.code));
    expect(DESIGN_FAMILIES.map((f) => f.name)).toEqual(SOURCE.FAMILIES.map((f) => f.name));
  });

  it.each(SOURCE.FAMILIES.map((f) => [f.name, f] as const))('%s', (_name, sourceFamily) => {
    const family = DESIGN_FAMILIES.find((f) => f.code === sourceFamily.code)!;
    expect(family.ordinal).toBe(sourceFamily.no);
    expect(family.note).toBe(sourceFamily.note);
    expect(family.faces).toBe(sourceFamily.faces);
    expect(family.key).toBe(sourceFamily.base.design_family);
    expect(family.base).toEqual(sourceFamily.base);

    family.variants.forEach((variant, i) => {
      const [name, code, ground, density, architecture, use, description, overrides] =
        sourceFamily.variants[i];
      expect(variant.name).toBe(name);
      expect(variant.code).toBe(code);
      expect(variant.ground).toBe(ground);
      expect(variant.density).toBe(density);
      expect(variant.architecture).toBe(architecture);
      expect(variant.use).toBe(use);
      expect(variant.description).toBe(description);
      expect(variant.overrides).toEqual(overrides);
    });
  });
});

describe('colourways are transcribed, not retyped', () => {
  it.each(SOURCE.FAMILIES.map((f) => [f.name, f.code, f.base.design_family] as const))(
    '%s',
    (_name, code, key) => {
      const shipped = COLOURWAYS_BY_FAMILY[key];
      const source = SOURCE.COLOURWAYS[code];
      expect(shipped, key).toBeDefined();
      expect(shipped).toHaveLength(source.length);
      shipped.forEach((cw, i) => {
        const [name, paper, ink, accent, rule, muted, ground] = source[i];
        expect(cw.name).toBe(name);
        expect(cw.paper).toBe(paper);
        expect(cw.ink).toBe(ink);
        expect(cw.accent).toBe(accent);
        expect(cw.rule).toBe(rule);
        expect(cw.muted).toBe(muted);
        expect(cw.ground).toBe(ground);
      });
    },
  );

  it('gives every colourway a unique id across the whole catalogue', () => {
    const ids = Object.values(COLOURWAYS_BY_FAMILY).flatMap((set) => set.map((c) => c.id));
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
  });
});

describe('every manifest value resolves to a primitive', () => {
  /** Every resolved manifest the catalogue can produce. */
  const manifests = DESIGN_FAMILIES.flatMap((family) =>
    family.variants.map((variant) => ({
      label: `${variant.code} ${variant.name}`,
      manifest: resolveManifest(family, variant),
      family,
    })));

  it('produces 50 resolved manifests', () => {
    expect(manifests).toHaveLength(50);
  });

  it.each(manifests.map((m) => [m.label, m] as const))('%s', (_label, { manifest, family }) => {
    // Each of these throws on an unmapped value rather than defaulting, so
    // reaching the end is the assertion.
    expect(() => kpiPlan(manifest.kpi_layout)).not.toThrow();
    expect(() => tablePlan(manifest.table_style)).not.toThrow();
    expect(() => sectionHeaderKind(manifest.section_header_style)).not.toThrow();
    expect(() => coverPlan(manifest.cover_overlay)).not.toThrow();
    expect(() => calloutKind(manifest.callout_style)).not.toThrow();
    expect(() => riskKind(manifest.risk_display)).not.toThrow();
    expect(() => recommendationKind(manifest.recommendation_style)).not.toThrow();
    expect(() => chartPlan(manifest.chart_style)).not.toThrow();
    expect(() => marginFor(manifest)).not.toThrow();
    expect(() => spacingFor(manifest)).not.toThrow();
    expect(() => typographyFor(family.key)).not.toThrow();
    expect(() => scaleFor(family.key, manifest.density as Density)).not.toThrow();
  });

  it('maps the whole vocabulary, including values no variant currently uses', () => {
    // Walks the SOURCE rather than the resolved manifests, so a value that
    // appears only in a family base that every variant overrides is still
    // covered — those are one edit away from being reachable.
    const axis = (key: string): string[] => {
      const values = new Set<string>();
      for (const family of SOURCE.FAMILIES) {
        if (family.base[key]) values.add(family.base[key]);
        for (const variant of family.variants) {
          const v = variant[7][key];
          if (v) values.add(v);
        }
      }
      return [...values].sort();
    };

    const checks: Array<[string, (v: string) => unknown]> = [
      ['kpi_layout', kpiPlan],
      ['table_style', tablePlan],
      ['section_header_style', sectionHeaderKind],
      ['cover_overlay', coverPlan],
      ['callout_style', calloutKind],
      ['risk_display', riskKind],
      ['recommendation_style', recommendationKind],
      ['chart_style', chartPlan],
    ];

    const unmapped: string[] = [];
    for (const [key, resolver] of checks) {
      for (const value of axis(key)) {
        try {
          resolver(value);
        } catch {
          unmapped.push(`${key}: ${value}`);
        }
      }
    }
    expect(unmapped).toEqual([]);
  });

  it('maps every margin and spacing preset the source names', () => {
    const unmapped: string[] = [];
    for (const family of SOURCE.FAMILIES) {
      const values = [family.base, ...family.variants.map((v) => v[7])];
      for (const set of values) {
        if (set.page_margin_preset) {
          try {
            marginFor({ page_margin_preset: set.page_margin_preset } as never);
          } catch { unmapped.push(`margin: ${set.page_margin_preset}`); }
        }
        if (set.spacing_scale) {
          try {
            spacingFor({ spacing_scale: set.spacing_scale } as never);
          } catch { unmapped.push(`spacing: ${set.spacing_scale}`); }
        }
      }
    }
    expect([...new Set(unmapped)]).toEqual([]);
  });
});

describe('typography is declared for every family', () => {
  it.each(DESIGN_FAMILIES.map((f) => [f.name, f] as const))('%s', (_name, family) => {
    const type = typographyFor(family.key);
    // The catalogue's `faces` string names what the family sets. Every face it
    // names must appear in the resolved roles — a family that says "Cinzel ·
    // Playfair · Inter · Plex Mono" and compiles only Inter is filed under a
    // typography it does not have.
    const roles = [type.display, type.heading, type.body, type.mono];
    const named = family.faces.split('·').map((s) => s.trim());
    for (const face of named) {
      // The catalogue abbreviates: "Playfair" for Playfair Display, "Plex Mono"
      // for IBM Plex Mono.
      const matched = roles.some((r) => r.includes(face) || face.includes(r.split(' ')[0]));
      expect(matched, `${family.name} names ${face} but compiles ${roles.join(', ')}`).toBe(true);
    }
  });

  it('sets figures in a face the family actually loads', () => {
    for (const family of DESIGN_FAMILIES) {
      const type = typographyFor(family.key);
      expect(['heading', 'body', 'mono']).toContain(type.numericFace);
    }
  });
});
