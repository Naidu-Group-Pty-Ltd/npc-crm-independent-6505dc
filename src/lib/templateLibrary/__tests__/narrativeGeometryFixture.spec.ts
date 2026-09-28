/**
 * The geometry fixture is a DOCUMENT, and stays one.
 *
 * `templates:compass:qa` is the only check that lays a master out in a real
 * browser and measures the boxes, and until 20 Sep 2026 it was measuring seven
 * pages of a thirty-page document — `SAMPLE_REPORT_DATA` carries no narrative,
 * so every page gated on `narrative.pages > n` evaluated false, and it carries
 * no `report.type`, so `planNarrative` returned null and the true page count
 * was never written. See `docs/reports/THE_GATE_MEASURED_THE_FRONT_MATTER.md`.
 *
 * These assert the property rather than the numbers: that the body is the size
 * the registry declares, that body pages actually draw, and that all five
 * documents the Investment masters serve are among the things measured. A
 * count would go stale the first time a section's budget changed; the point is
 * that the fixture tracks the registry.
 */
import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../../reportTemplate/htmlRenderer';
import { COMPASS_40_SECTIONS } from '../../reports/compassSectionRegistry';
import {
  NARRATIVE_GEOMETRY_BODY,
  investmentGeometryDocuments,
} from '../narrativeGeometryFixture';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import {
  COMPASS_DEPTH_PAGES,
  DERIVED_TIERS,
  frontMatterFlagsFor,
} from '../../../../supabase/functions/_shared/reports/investment/tierPageSequence.pure';

const compassSections = COMPASS_40_SECTIONS.filter((s) => s.includeInCompass);

/** The page each rendered `.tpl-page` came from, by the id it carries. */
function renderedPages(schema: any, data: Record<string, unknown>): string[] {
  const { html } = renderTemplateToHtml(schema, { data });
  const byId = new Map<string, string>(
    schema.pages.map((p: any) => [String(p.id ?? ''), String(p.name ?? '')]),
  );
  return [...String(html).matchAll(/<section[^>]*class="[^"]*\btpl-page\b[^"]*"[^>]*data-pdf-page-id="([^"]*)"/g)]
    .map((m) => byId.get(m[1]) ?? m[1]);
}

const documents = investmentGeometryDocuments();
const compass = documents.find((d) => d.tier === 'compass')!;

describe('the narrative geometry fixture', () => {
  it('carries a heading for every section the Compass includes', () => {
    for (const section of compassSections) {
      expect(NARRATIVE_GEOMETRY_BODY).toContain(`## ${section.name}`);
    }
  });

  it('is never shorter than the document the registry declares', () => {
    const declared = compassSections.reduce((sum, s) => sum + (s.maxWordCount ?? 0), 0);
    const words = NARRATIVE_GEOMETRY_BODY.split(/\s+/).filter(Boolean).length;
    expect(declared).toBeGreaterThan(0);
    expect(words).toBeGreaterThanOrEqual(declared);
  });

  it('draws body pages, not just the front matter', () => {
    /*
     * The guard the gate did not have. Every page gated on `narrative.pages`
     * is a body page; if the fixture ever stops producing a body — a missing
     * `report.type`, an empty source — none of them draws and the measure
     * silently becomes a measure of the cover and the dashboard.
     */
    for (const master of INVESTMENT_COMPASS_TEMPLATES.slice(0, 5)) {
      const schema = master.schema as any;
      const bodyPages = schema.pages.filter(
        (p: any) => /narrative\s*&&\s*narrative\.pages/.test(String(p.conditional ?? '')),
      ).length;
      expect(bodyPages).toBeGreaterThan(0);
      const drawn = renderedPages(schema, compass.data);
      const nonBody = schema.pages.length - bodyPages;
      expect(drawn.length).toBeGreaterThan(nonBody - bodyPages);
      // And concretely: more than the seven-page front matter this closed.
      expect(drawn.length).toBeGreaterThan(10);
    }
  });

  it('is one document per kind the Investment masters serve', () => {
    expect(documents.map((d) => d.tier).sort())
      .toEqual(['briefing', 'compass', 'financial', 'snapshot', 'strategic']);
    for (const doc of documents) {
      // Both places the production adapter sets it: `pagesForDocument` reads
      // the top-level key, the masters bind the one on `report`.
      expect((doc.data as any).tier).toBe(doc.tier);
      expect((doc.data as any).report.tier).toBe(doc.tier);
    }
  });

  it('gives each derived tier the pages its tier rule says it has', () => {
    const schema = INVESTMENT_COMPASS_TEMPLATES[0].schema as any;
    for (const tier of DERIVED_TIERS) {
      const doc = documents.find((d) => d.tier === tier)!;
      const drawn = renderedPages(schema, doc.data);
      for (const depth of COMPASS_DEPTH_PAGES) expect(drawn).not.toContain(depth);
      expect(drawn.length).toBeGreaterThan(0);
    }
    // And a document that does not flow keeps them, so the assertion above is
    // about the tier rule rather than about a page nothing draws. Since seed
    // v20 that is the stored pre-tier report; the Compass itself flows, and
    // draws its summary instead.
    const legacy = {
      ...(compass.data as Record<string, any>),
      report: { ...(compass.data as Record<string, any>).report, ...frontMatterFlagsFor('composite') },
    };
    const legacyDrawn = renderedPages(schema, legacy);
    expect(legacyDrawn.some((n) => COMPASS_DEPTH_PAGES.includes(n))).toBe(true);
    expect(renderedPages(schema, compass.data)).toContain('Executive summary');
  });
});
