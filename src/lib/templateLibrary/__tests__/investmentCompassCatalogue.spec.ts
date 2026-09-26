/**
 * The Investment Compass catalogue — ten families, fifty masters, five hundred
 * combinations.
 *
 * These tests do not stop at "the schema parses". A catalogue entry that parses
 * but renders an empty page is worse than no entry: a user spends time reading
 * it, copies it, opens the Builder and finds a blank document. So every
 * template is pushed through the **real** production HTML renderer — the same
 * `renderTemplateToHtml` that produces the customer's PDF — and the output is
 * inspected.
 *
 * Four questions they are built to answer:
 *
 *  1. Is this the approved catalogue? (names, codes, order, manifests)
 *  2. Do the fifty actually DIFFER, or is a family five recolours?
 *  3. Does every colourway reach the page, in both light and dark?
 *  4. Does a colourway change only the colour — never the layout?
 *
 * Transcription fidelity against the Design source is a separate concern and
 * lives in `investmentCompassSource.spec.ts`.
 */
import { describe, it, expect } from 'vitest';
import { ReportTemplateSchema, parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { evalConditional } from '@/lib/reportTemplate/bindingResolver';
import {
  deriveEntryFacts, validateForPublish,
} from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import { PRODUCTION_SAFE_BLOCK_TYPES } from '../../../../supabase/functions/_shared/productionBlockTypes';
import {
  COMPANION_NOTE_CHARS, INVESTMENT_COMPASS_TEMPLATES, PRIVATE_BANKING_TEMPLATES,
} from '../../../../scripts/template-library/investmentCompass/templates';
import { TIER_CONTENT } from '../../../../supabase/functions/_shared/reports/investment/tierContent.pure';
import {
  DESIGN_FAMILIES, familyByKey, resolveManifest,
} from '../../../../scripts/template-library/investmentCompass/family';
import {
  coverPlan, hasRail, imageSlotPlan,
} from '../../../../scripts/template-library/investmentCompass/resolvers';
import {
  COLOURWAYS_BY_FAMILY, colourwayTokenOverride, colourwaysForFamily, resolveColourway,
} from '../colourways';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

/**
 * The sample as a tier that carries the financial modelling.
 *
 * `SAMPLE` previews the COMPASS, and since seed v14 a Compass draws no
 * acquisition table, no cash flow and no ten-year equity chart — the rule
 * `compassSectionRegistry` has stated since v2.0, enforced at the projection
 * by `tierContent.pure.ts` so it reaches all 500 masters at once.
 *
 * These are catalogue assertions about the MASTERS, though: whether fifty
 * designs are fifty designs, and whether every page a master declares can
 * draw. Rendering them as a Compass would exercise three fewer pages and
 * would let a master differ from its sibling only on a page neither drew. So
 * the structural tests render the tier that has every page, and
 * `the Compass drops the financial modelling` below asserts the other half.
 */
const SAMPLE_WITH_MODELLING = {
  ...SAMPLE,
  report: { ...(SAMPLE.report as object), tier: 'financial', drawsFinancialModelling: true },
};

/** Visible text, with tags and whitespace collapsed. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Every colour literal the rendered document actually paints. */
function coloursIn(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/#[0-9a-f]{6}\b/gi)) out.add(m[0].toUpperCase());
  return out;
}

describe('the catalogue', () => {
  it('ships fifty masters across ten families', () => {
    expect(INVESTMENT_COMPASS_TEMPLATES).toHaveLength(50);
    expect(new Set(INVESTMENT_COMPASS_TEMPLATES.map((t) => t.designMeta.familyKey)).size).toBe(10);
  });

  it('ships five masters per family, in catalogue order', () => {
    for (const family of DESIGN_FAMILIES) {
      const templates = INVESTMENT_COMPASS_TEMPLATES.filter(
        (t) => t.designMeta.familyKey === family.key,
      );
      expect(templates, family.name).toHaveLength(5);
      expect(templates.map((t) => t.name)).toEqual(family.variants.map((v) => v.name));
      expect(templates.map((t) => t.designMeta.templateCode))
        .toEqual(family.variants.map((v) => v.code));
    }
  });

  it('still ships the five approved Private Banking names', () => {
    expect(PRIVATE_BANKING_TEMPLATES.map((t) => t.name)).toEqual([
      'Chancery', 'Chancery Compact', 'Sovereign Folio', 'Bullion Rail', 'Discretion Ledger',
    ]);
  });

  it('has unique slugs and unique template codes', () => {
    const slugs = INVESTMENT_COMPASS_TEMPLATES.map((t) => t.slug);
    const codes = INVESTMENT_COMPASS_TEMPLATES.map((t) => t.designMeta.templateCode);
    expect(new Set(slugs).size).toBe(50);
    expect(new Set(codes).size).toBe(50);
  });

  it('scopes every master to the Investment Compass report type', () => {
    // The pilot's rule, still holding at fifty: no other report type is
    // accidentally activated.
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      expect(t.reportType, t.name).toBe('investment_compass');
      expect(t.category, t.name).toBe('investment');
    }
  });

  it('is production-ready, because investment_compass normalises to the investment adapter', () => {
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      const facts = deriveEntryFacts({ report_type: t.reportType, schema: t.schema });
      expect(facts.production_ready, t.name).toBe(true);
    }
  });

  it('marks exactly one reference per family, and it is the first variant', () => {
    for (const family of DESIGN_FAMILIES) {
      const references = INVESTMENT_COMPASS_TEMPLATES.filter(
        (t) => t.designMeta.familyKey === family.key && t.designMeta.isFamilyReference,
      );
      expect(references, family.name).toHaveLength(1);
      expect(references[0].designMeta.templateCode).toBe(family.variants[0].code);
      expect(references[0].designMeta.archetypeCoverage).toBe('built');
    }
  });

  it('binds a companion note on every one of the fifty', () => {
    /*
     * The count is the assertion. The first attempt hung the note on
     * `sectionHeading`'s optional standfirst and 32 of 50 carried it — `bare`,
     * `decimal` and `eyebrow` openers drop a standfirst, which is right for
     * styling and wrong for a cross-reference. `hasContents` records the same
     * rule one level up: a family decides HOW a thing is drawn, never whether
     * the document carries it.
     */
    const bound = INVESTMENT_COMPASS_TEMPLATES.filter((t) => {
      const page = (t.schema as any).pages.find((p: any) => p.name === 'Contents');
      return page?.blocks.some(
        (b: any) => JSON.stringify(b).includes('{{report.companionNote}}'),
      );
    });
    expect(bound.length).toBe(INVESTMENT_COMPASS_TEMPLATES.length);
  });

  it('reserves the longest companion note any tier publishes', () => {
    /*
     * `companionNote()` declares a height from this count, and a block that
     * under-declares does not overflow the page — it prints over the contents
     * list beneath it. The set is closed and small, so the number is the exact
     * longest rather than an estimate, and this fails the day a tier's
     * sentence is rewritten longer than the masters reserve for it.
     */
    const lengths = Object.values(TIER_CONTENT).map((t) => t.companionNote?.length ?? 0);
    expect(Math.max(...lengths)).toBe(COMPANION_NOTE_CHARS);
    expect(lengths.filter((n) => n > 0).length, 'five of six tiers carry one').toBe(5);
  });

  it('covers all seven report archetypes on every master', () => {
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      expect(t.schema.pages.length, t.name).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('the fifty are structurally distinct, not fifty recolours', () => {
  it('gives every variant the approved override set and resolved manifest', () => {
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      const family = familyByKey(t.designMeta.familyKey)!;
      const variant = family.variants.find((v) => v.code === t.designMeta.templateCode)!;
      expect(t.designMeta.overrides, t.name).toEqual(variant.overrides);
      expect(t.designMeta.manifest, t.name).toEqual(resolveManifest(family, variant));
    }
  });

  it('produces fifty distinct resolved manifests', () => {
    // If any two were equal, two templates would be the same document under two
    // names — precisely the failure the family model exists to prevent.
    const seen = new Set(
      INVESTMENT_COMPASS_TEMPLATES.map((t) => JSON.stringify(t.designMeta.manifest)),
    );
    expect(seen.size).toBe(50);
  });

  it('renders fifty distinct documents', () => {
    // Stronger than comparing manifests: two different manifests could still
    // resolve to identical output if a resolver flattened them.
    const rendered = INVESTMENT_COMPASS_TEMPLATES.map(
      (t) => renderTemplateToHtml(t.schema, { data: SAMPLE_WITH_MODELLING }).html,
    );
    expect(new Set(rendered).size).toBe(50);
  });

  it('differs within every family on more than colour', () => {
    for (const family of DESIGN_FAMILIES) {
      const templates = INVESTMENT_COMPASS_TEMPLATES.filter(
        (t) => t.designMeta.familyKey === family.key,
      );
      // A family's five share a palette by construction, so if their documents
      // differ it is structure that differs.
      const rendered = templates.map((t) => renderTemplateToHtml(t.schema, { data: SAMPLE_WITH_MODELLING }).html);
      expect(new Set(rendered).size, family.name).toBe(5);
    }
  });

  it('uses all three density steps across the catalogue', () => {
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      expect(t.designMeta.manifest.density, t.name).toBe(t.designMeta.density);
    }
    const densities = new Set(INVESTMENT_COMPASS_TEMPLATES.map((t) => t.designMeta.density));
    expect([...densities].sort()).toEqual(['balanced', 'compact', 'spacious']);
  });

  it('draws a rail only where the manifest asks for one', () => {
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      const railed = t.schema.pages.some((p) => p.blocks.some(
        (b) => b.type === 'divider'
          && (b.props as Record<string, unknown>).orientation === 'vertical',
      ));
      const m = t.designMeta.manifest;
      // Asserted against the resolvers rather than a regex over the manifest
      // string. `scroll_rail` reads like a rail and is not one: the source
      // describes Signal Compact as "tab strip becomes a scroll rail. Print
      // stays A4-correct" — a screen affordance, not a printed rule. A regex
      // would have quietly demanded a rail on a page that must not have one.
      //
      // A framed cover also draws vertical dividers (two of its four edges),
      // so it counts here without being a rail.
      const cover = coverPlan(m.cover_overlay);
      const wantsVertical = hasRail(m.navigation_style) || !!cover.rail || !!cover.frame;
      expect(railed, `${t.name} (${m.navigation_style} / ${m.cover_overlay})`).toBe(wantsVertical);
    }
  });
});

describe('family typography reaches the page', () => {
  it.each(DESIGN_FAMILIES.map((f) => [f.name, f] as const))('%s', (_name, family) => {
    const templates = INVESTMENT_COMPASS_TEMPLATES.filter(
      (t) => t.designMeta.familyKey === family.key,
    );
    for (const t of templates) {
      const fonts = t.schema.tokens.fonts as Record<string, string>;
      const faces = (t.schema.tokens as Record<string, unknown>).fontFaces as
        Array<{ family: string; cssUrl: string }>;
      const loaded = new Set(faces.map((f) => f.family));
      for (const role of ['display', 'heading', 'body', 'mono']) {
        expect(fonts[role], `${t.name}.${role}`).toBeTruthy();
        // Every face named is loadable. A template that names a face without
        // one renders in the engine default and nothing says so.
        expect(loaded.has(fonts[role].split(',')[0]), `${t.name} loads ${fonts[role]}`).toBe(true);
      }
      for (const face of faces) expect(face.cssUrl).toMatch(/^https:\/\/fonts\.googleapis\.com\//);
    }
  });

  it('loads each face once, even when a family sets one face for every role', () => {
    // Luxury Editorial is `noto_serif_only` and Swiss Minimal `inter_grotesk`.
    // Four identical @font-face imports is four fetches for one file.
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      const faces = (t.schema.tokens as Record<string, unknown>).fontFaces as
        Array<{ family: string }>;
      expect(new Set(faces.map((f) => f.family)).size, t.name).toBe(faces.length);
    }
  });

  it('emits the @import that makes the face available to WeasyPrint', () => {
    for (const family of DESIGN_FAMILIES) {
      const t = INVESTMENT_COMPASS_TEMPLATES.find((x) => x.designMeta.familyKey === family.key)!;
      const { css } = renderTemplateToHtml(t.schema, { data: SAMPLE });
      expect(css, family.name).toContain('@import');
    }
  });
});

describe.each(INVESTMENT_COMPASS_TEMPLATES.map((t) => [
  `${t.designMeta.templateCode} ${t.name}`, t,
] as const))('%s', (_label, template) => {
  it('parses against the live Zod schema without salvage', () => {
    const result = ReportTemplateSchema.safeParse(template.schema);
    expect(
      result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    ).toEqual([]);
  });

  it('survives a parseTemplate round-trip with its pages intact', () => {
    const parsed = parseTemplate(template.schema);
    expect(parsed.pages).toHaveLength(template.schema.pages.length);
  });

  it('uses only block types the production renderer supports', () => {
    const unsupported = template.schema.pages
      .flatMap((p) => p.blocks.map((b) => b.type))
      .filter((t) => !PRODUCTION_SAFE_BLOCK_TYPES.has(t));
    expect([...new Set(unsupported)]).toEqual([]);
  });

  it('passes the publish gate', () => {
    expect(validateForPublish({
      name: template.name, slug: template.slug, schema: template.schema,
    })).toBeNull();
  });

  it('hard-codes no colour outside the token map', () => {
    // This is what lets a colourway repaint the document at all. A literal in a
    // block prop would survive every palette and show up as one stubborn
    // element in the wrong colour.
    const facts = deriveEntryFacts({ report_type: template.reportType, schema: template.schema });
    expect(facts.brand_safe).toBe(true);
  });

  it('renders real content with sample data', () => {
    const { html } = renderTemplateToHtml(template.schema, { data: SAMPLE });
    const text = textOf(html);
    expect(text.length).toBeGreaterThan(1200);
    expect(html).not.toContain('{{');
    expect(text).toContain('Leichhardt');
  });

  it('renders every unconditional page, not just the cover', () => {
    /*
     * Counted against the pages that are NOT conditional.
     *
     * The masters now carry the report the model actually wrote — the document
     * the configured structure guide defines — and its length is not knowable
     * when the template is built: measured over the 1,183 stored bodies, a
     * snapshot is 71 lines at the median and a strategic report 1,166. So the
     * narrative is a run of conditional pages, each holding one bucket of the
     * same source, and a page whose bucket does not exist must not render.
     * `SAMPLE_REPORT_DATA` carries no body, so none of them does here.
     *
     * This assertion was `=== pages.length` while every page was
     * unconditional. Keeping it that way would have meant either dropping the
     * narrative or giving the sample a body long enough to fill all 24 pages —
     * which would assert that a template prints its maximum, not that it
     * prints what it has.
     */
    const { html } = renderTemplateToHtml(template.schema, { data: SAMPLE_WITH_MODELLING });
    const pages = html.match(/class="[^"]*tpl-page/g) ?? [];
    // Every page except the narrative run, whose buckets the sample has none
    // of. The pre-existing conditionals — the assessment's per-dimension prose,
    // the opportunity, the risk row — all resolve against the sample and are
    // therefore still counted, exactly as before. The three financial pages
    // resolve here because this data is a tier that carries them.
    //
    // A page whose conditional does not hold for this data is not expected
    // either: since seed v20 the master carries BOTH front matters — the
    // `Executive summary` a flowing tier draws and the typed pages a stored
    // pre-tier report draws — and the sample, which names no flowing tier,
    // selects the second. Counting the summary here would assert that a
    // master prints two front matters at once.
    const ctx = { data: SAMPLE_WITH_MODELLING as Record<string, unknown>, tokens: (template.schema as any).tokens };
    const expected = template.schema.pages.filter(
      (p: any) => !/^(The report|Not the whole report)/.test(p.name)
        && (!p.conditional || evalConditional(p.conditional, ctx as never)),
    );
    expect(pages.length).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(4);
  });

  it('drops the financial modelling on a tier that may not carry it', () => {
    /*
     * The other half of the same rule. `compassSectionRegistry` has said since
     * v2.0 that "ALL detailed financial modelling ... MUST NOT appear here",
     * the generator obeyed it, and one master served five document kinds — so
     * the Investment Compass opened on purchase price, gross yield, LVR and a
     * ten-year projection while the Financial Analysis carried the location
     * case. Each report answered the other's question.
     */
    const asCompass = renderTemplateToHtml(template.schema, { data: SAMPLE }).html;
    const asFinancial = renderTemplateToHtml(template.schema, { data: SAMPLE_WITH_MODELLING }).html;
    const count = (h: string) => (h.match(/class="[^"]*tpl-page/g) ?? []).length;
    // The pages that print for the modelling tier and not for the Compass:
    // read by evaluating each page's own conditional under both, because a
    // financial page's conditional also names the front matter it belongs to
    // (seed v20), so matching it as a string tests the spelling, not the rule.
    const at = (data: unknown) => ({ data: data as Record<string, unknown>, tokens: (template.schema as any).tokens });
    const dropped = template.schema.pages.filter((p: any) => Boolean(p.conditional)
      && evalConditional(p.conditional, at(SAMPLE_WITH_MODELLING) as never)
      && !evalConditional(p.conditional, at(SAMPLE) as never)
      && String(p.conditional).includes('report.drawsFinancialModelling'));
    expect(dropped.length, 'the master must make its financial pages conditional').toBeGreaterThanOrEqual(2);
    expect(count(asCompass)).toBe(count(asFinancial) - dropped.length);
    // And the drop is clean: no labelled empty rows survive where the tables were.
    expect(textOf(asCompass)).not.toContain('Total upfront cash');
    expect(textOf(asCompass)).not.toContain('Loan repayments');
  });

  it('points the reader at its companion document, above the contents list', () => {
    /*
     * The other end of the tier split. A Compass deliberately carries no
     * financial modelling and a Financial Analysis carries no location case,
     * so each publishes a sentence saying where the other half is —
     * `TIER_CONTENT.companionNote`, on the projection as
     * `report.companionNote` since the split. `render-investment-report-pdf`
     * drew it; the TEMPLATE route is what a client's document comes through,
     * and NO master bound it. The tier that is told to point elsewhere never
     * did, on any page of any document anyone opened.
     *
     * Above the list, never below it: `contents()`'s row count is a size hint
     * with eight rows of slack, so a document whose real list outruns the hint
     * draws DOWN into the space beneath — which has to stay empty.
     */
    const page = (template.schema as any).pages.find((p: any) => p.name === 'Contents');
    expect(page, 'every master emits a Contents page').toBeTruthy();
    const note = page.blocks.find(
      (b: any) => JSON.stringify(b).includes('{{report.companionNote}}'),
    );
    expect(note, 'no companion note is bound on the Contents page').toBeTruthy();
    const toc = page.blocks.find((b: any) => b.type === 'toc');
    expect(Number(note.props.y)).toBeLessThan(Number(toc.props.y));
  });

  it('draws the companion sentence, and nothing at all without one', () => {
    const note = (SAMPLE.report as any).companionNote as string;
    const withoutNote = {
      ...SAMPLE,
      report: Object.fromEntries(
        Object.entries(SAMPLE.report as object).filter(([k]) => k !== 'companionNote'),
      ),
    };
    expect(textOf(renderTemplateToHtml(template.schema, { data: SAMPLE }).html)).toContain(note);
    // `composite` is the one tier that publishes none. An unresolved binding
    // renders as the empty string, never as a visible `{{…}}`.
    const bare = renderTemplateToHtml(template.schema, { data: withoutNote }).html;
    expect(textOf(bare)).not.toContain(note);
    expect(bare).not.toContain('{{');
  });

  it('makes every narrative page conditional on the projection having it', () => {
    // A page that is unconditional here prints blank on the 4 stored reports
    // with no body, and on every report shorter than the allowance — which is
    // most of them. The first is conditional on there being a body at all; the
    // continuations on the page count the projection computed with the same
    // `packMarkdownPages` the block uses.
    const narrative = template.schema.pages.filter((p: any) => /^The report/.test(p.name));
    expect(narrative.length).toBeGreaterThan(1);
    for (const p of narrative as any[]) {
      expect(p.conditional, `page "${p.name}" is unconditional`).toBeTruthy();
    }
    for (const [i, p] of (narrative as any[]).slice(1).entries()) {
      expect(p.conditional).toBe(`narrative && narrative.pages > ${i + 1}`);
    }
  });

  it('leaves no page blank', () => {
    for (const page of template.schema.pages) {
      expect(page.blocks.length, `${template.name} / ${page.name}`).toBeGreaterThan(0);
    }
  });

  it('survives a report with whole sections missing', () => {
    const sparse = { property: { address: '1 Test Street' } };
    expect(() => renderTemplateToHtml(template.schema, { data: sparse })).not.toThrow();
    const { html } = renderTemplateToHtml(template.schema, { data: sparse });
    expect(html).not.toContain('{{');
  });

  it('survives an address long enough to wrap three lines', () => {
    const long = {
      ...SAMPLE,
      property: {
        ...(SAMPLE.property as object),
        address: 'Unit 14B, Level 3, The Sebastopol Residences, 1188-1200 Wentworthville Parade, Upper Kedron Heights QLD 4055',
        suburb: 'Wallumbilla-Yuleba-Injune Statistical Area Level Two',
      },
    };
    const { html } = renderTemplateToHtml(template.schema, { data: long });
    expect(textOf(html)).toContain('Sebastopol Residences');
  });

  it('survives figures at both ends of the range', () => {
    for (const price of [0, 45_000, 98_500_000]) {
      const data = {
        ...SAMPLE,
        financials: { ...(SAMPLE.financials as object), purchasePrice: price, weeklyNet: -price / 52 },
      };
      expect(() => renderTemplateToHtml(template.schema, { data })).not.toThrow();
    }
  });

  it('renders at A4, portrait', () => {
    for (const page of template.schema.pages) {
      expect(page.size.width).toBe(595);
      expect(page.size.height).toBe(842);
    }
  });
});

describe('every colourway reaches the page', () => {
  const combos = INVESTMENT_COMPASS_TEMPLATES.flatMap((t) =>
    colourwaysForFamily(t.designMeta.familyKey).map(
      (c) => [`${t.designMeta.templateCode} in ${c.name}`, t, c] as const,
    ));

  it('covers the full five hundred combinations', () => {
    expect(combos).toHaveLength(500);
  });

  it.each(combos)('%s', (_label, template, colourway) => {
    const { html } = renderTemplateToHtml(template.schema, {
      data: SAMPLE,
      tokenOverrides: colourwayTokenOverride(colourway),
    });
    const resolved = resolveColourway(colourway);
    const painted = coloursIn(html);

    // The accent and the page stock are both actually on the page — not merely
    // declared in a variable the blocks never reference.
    expect(painted, `${colourway.name} accent`).toContain(resolved.primary.toUpperCase());
    expect(painted, `${colourway.name} paper`).toContain(resolved.surface.toUpperCase());
    expect(html).not.toContain('{{');
    expect(textOf(html).length).toBeGreaterThan(1200);
  });

  it('paints a genuinely different document per colourway', () => {
    // Guards the failure where token overrides are accepted and then dropped:
    // ten identical renders would pass every other test in this file.
    for (const family of DESIGN_FAMILIES) {
      const template = INVESTMENT_COMPASS_TEMPLATES.find(
        (t) => t.designMeta.familyKey === family.key,
      )!;
      const rendered = colourwaysForFamily(family.key).map(
        (c) => renderTemplateToHtml(template.schema, {
          data: SAMPLE,
          tokenOverrides: colourwayTokenOverride(c),
        }).html,
      );
      expect(new Set(rendered).size, family.name).toBe(10);
    }
  });

  // Five hundred renders (fifty masters, ten colourways each) — a catalogue,
  // not a unit. Measured 14 Sep 2026 on the merged main head: 5.2–5.8 s on a
  // loaded container against the 5 s default, so the budget is stated here
  // rather than left to the machine.
  it('changes the colour and never the layout', () => {
    // The catalogue's own rule: "tokens carry no layout meaning". If a
    // colourway moved a box, the 500 combinations would be 500 documents and
    // the whole architecture would be wrong. Every block's geometry must be
    // identical across a family's ten palettes.
    const geometry = (html: string) =>
      (html.match(/left:[\d.]+pt;top:[\d.]+pt/g) ?? []).join('|');
    for (const template of INVESTMENT_COMPASS_TEMPLATES) {
      const base = geometry(renderTemplateToHtml(template.schema, { data: SAMPLE }).html);
      for (const c of colourwaysForFamily(template.designMeta.familyKey)) {
        const other = geometry(renderTemplateToHtml(template.schema, {
          data: SAMPLE,
          tokenOverrides: colourwayTokenOverride(c),
        }).html);
        expect(other, `${template.name} / ${c.name}`).toBe(base);
      }
    }
  }, 60_000);

  it('inverts the page for a dark ground', () => {
    for (const [key, set] of Object.entries(COLOURWAYS_BY_FAMILY)) {
      const dark = set.find((c) => c.ground === 'dark');
      if (!dark) continue;
      const template = INVESTMENT_COMPASS_TEMPLATES.find((t) => t.designMeta.familyKey === key)!;
      const { html } = renderTemplateToHtml(template.schema, {
        data: SAMPLE,
        tokenOverrides: colourwayTokenOverride(dark),
      });
      expect(coloursIn(html), `${key} / ${dark.name}`)
        .toContain(resolveColourway(dark).surface.toUpperCase());
    }
  });
});

/**
 * Image plates.
 *
 * Two families in the approved catalogue carry photographs — Luxury Editorial
 * and Architectural Property — and the catalogue itself names the failure mode
 * every other family avoids by having no slots at all. Its Monograph variant is
 * described as "editorial typography without image slots. Empty plates never
 * print as holes because there are none."
 *
 * A slotted family cannot take that way out, so it needs the other half: a slot
 * that prints *nothing* when it is empty. These tests assert that on the
 * rendered page, both ways round — with photographs bound and without.
 */
describe('image plates', () => {
  /**
   * Templates that declare at least one plate.
   *
   * Not "templates whose manifest names `image_slots`" — Monograph names it and
   * its value is `none`, which is the catalogue deliberately declaring the
   * absence rather than omitting the key.
   */
  const plated = INVESTMENT_COMPASS_TEMPLATES.filter(
    (t) => imageSlotPlan(t.designMeta.manifest.image_slots).plates.length > 0,
  );

  /** A report with everything the sample has EXCEPT photographs. */
  const NO_PHOTOS = {
    ...SAMPLE,
    property: Object.fromEntries(
      Object.entries(SAMPLE.property as Record<string, unknown>)
        .filter(([k]) => k !== 'images'),
    ),
  };

  it('is declared by the two photographic families and by nobody else', () => {
    const families = new Set(plated.map((t) => t.designMeta.familyKey));
    expect([...families].sort()).toEqual(['architectural_property', 'luxury_editorial']);
  });

  it('leaves Monograph without a single slot, exactly as the catalogue says', () => {
    // "Editorial typography without image slots. Empty plates never print as
    // holes because there are none."
    const monograph = INVESTMENT_COMPASS_TEMPLATES.find((t) => t.designMeta.templateCode === 'le-05')!;
    const json = JSON.stringify(monograph.schema);
    expect(json).not.toContain('property.images');
  });

  it('gives every plate a page of its own, and every page a conditional', () => {
    for (const template of plated) {
      const platePages = template.schema.pages.filter(
        (p) => JSON.stringify(p.blocks).includes('property.images'),
      );
      expect(platePages.length, template.name).toBeGreaterThan(0);
      for (const p of platePages) {
        // A cover is a plate BEHIND a composition, so it is the one page whose
        // blocks are conditional rather than the page itself — losing the whole
        // cover because a photograph is missing would be a defect, not a
        // feature. Every other plate page vanishes entirely.
        const isCover = template.schema.pages.indexOf(p) === 0;
        if (isCover) {
          const imageBlocks = p.blocks.filter(
            (b) => JSON.stringify(b).includes('property.images'),
          );
          expect(imageBlocks.every((b) => typeof (b as { conditional?: string }).conditional === 'string'), template.name).toBe(true);
        } else {
          expect((p as { conditional?: string }).conditional, `${template.name} / ${p.name}`)
            .toContain('property.images');
        }
      }
    }
  });

  it('binds each plate to a distinct photograph', () => {
    for (const template of plated) {
      const bound = [...JSON.stringify(template.schema).matchAll(/property\.images\.(\d+)/g)]
        .map((m) => Number(m[1]));
      const distinct = new Set(bound);
      // Contiguous from zero: an operator filling `images[0]` and `images[1]`
      // fills the first two plates rather than the first and the fourth.
      expect([...distinct].sort((a, b) => a - b), template.name)
        .toEqual(Array.from({ length: distinct.size }, (_, i) => i));
    }
  });

  it('prints the plates when photographs are bound', () => {
    for (const template of plated) {
      const { html } = renderTemplateToHtml(template.schema, { data: SAMPLE });
      const images = (html.match(/<img /g) ?? []).length;
      expect(images, template.name).toBeGreaterThan(0);
    }
  });

  it('prints no hole, and costs no page, when they are not', () => {
    for (const template of plated) {
      const full = renderTemplateToHtml(template.schema, { data: SAMPLE }).html;
      const bare = renderTemplateToHtml(template.schema, { data: NO_PHOTOS }).html;

      // The `image` block's placeholder is the hole the catalogue warns about.
      expect(bare, template.name).not.toContain('No image');
      /*
       * No *plate* image, rather than no image at all.
       *
       * The document still carries the brand mark on its cover and its contact
       * page — `REPORT_RULES.md` §5's two surfaces — and that is an `<img>` too.
       * The assertion here is about the photographs: a plate that is not bound
       * must leave nothing behind, and the mark is not a plate.
       */
      /*
       * "No plate image" must not count the brand mark, which is an `<img>`
       * too. The exclusion is derived from the sample's own mark values rather
       * than a hard-coded base64 prefix — it briefly keyed on the 1x1 PNG the
       * sample used to carry, which broke the moment the sample's mark became
       * a visible picture.
       */
      const markSrcs = [
        String((SAMPLE as any).org?.mark ?? ''),
        String((SAMPLE as any).org?.markMono ?? ''),
      ].filter(Boolean);
      const plateImages = (h: string) => {
        const srcs = [...h.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1]);
        return srcs.filter((s) => !markSrcs.includes(s)).length;
      };
      expect(plateImages(bare), template.name).toBe(0);
      expect(plateImages(full), template.name).toBeGreaterThan(0);

      // And the pages the plates occupied are gone rather than blank.
      const pagesIn = (h: string) => (h.match(/class="tpl-page /g) ?? []).length;
      expect(pagesIn(bare), template.name).toBeLessThan(pagesIn(full));
    }
  });

  it('bleeds for the monograph and measures for the drawing set', () => {
    // The family's difference, not a per-plate option.
    const le = INVESTMENT_COMPASS_TEMPLATES.find((t) => t.designMeta.templateCode === 'le-01')!;
    const ap = INVESTMENT_COMPASS_TEMPLATES.find((t) => t.designMeta.templateCode === 'ap-03')!;

    const lePlate = le.schema.pages.find(
      (p, i) => i > 0 && JSON.stringify(p.blocks).includes('property.images'),
    )!;
    const leImage = lePlate.blocks.find((b) => b.type === 'image')! as {
      props: Record<string, number>;
    };
    expect([leImage.props.x, leImage.props.y]).toEqual([0, 0]);
    expect([leImage.props.width, leImage.props.height]).toEqual([595, 842]);

    const apPlate = ap.schema.pages.find(
      (p) => JSON.stringify(p.blocks).includes('property.images'),
    )!;
    const apImage = apPlate.blocks.find((b) => b.type === 'image')! as {
      props: Record<string, unknown>;
    };
    expect(apImage.props.x).toBeGreaterThan(0);
    expect(String(apImage.props.caption)).toMatch(/^Figure \d+ · /);
    expect(apImage.props.captionTransform).toBe('uppercase');
  });

  it('never lets a plate print a placeholder box', () => {
    // Belt and braces on the prop itself: `placeholder` defaults to TRUE, so an
    // omitted flag is a grey rectangle on a client's report rather than nothing.
    for (const template of plated) {
      for (const page of template.schema.pages) {
        for (const block of page.blocks) {
          if (block.type !== 'image') continue;
          expect((block.props as { placeholder?: boolean }).placeholder, template.name).toBe(false);
        }
      }
    }
  });
});
