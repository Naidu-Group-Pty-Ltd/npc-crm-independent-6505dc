/**
 * The seeded catalogue must actually render.
 *
 * A library entry that parses but produces nothing on the page is worse than no
 * entry: a user spends time previewing it, copies it, opens the Builder, and
 * finds a blank document. So these tests do not stop at "the schema is valid" —
 * they push every seeded template through the **real** production HTML
 * renderer with sample data and assert that content comes out the other side.
 */
import { describe, it, expect } from 'vitest';
import { ReportTemplateSchema, parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import {
  deriveEntryFacts, validateForPublish,
} from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import { PRODUCTION_SAFE_BLOCK_TYPES } from '../../../../supabase/functions/_shared/productionBlockTypes';
import { SEED_TEMPLATES } from '../../../../scripts/template-library/templates';

import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

describe('seeded catalogue', () => {
  it('ships a catalogue rather than an empty grid', () => {
    expect(SEED_TEMPLATES.length).toBeGreaterThanOrEqual(40);
  });

  it('gives every category enough choice to be worth filtering', () => {
    // One template behind a chip is a chip that reads as broken. Two is the
    // floor at which a filter earns its place in the UI.
    const counts = new Map<string, number>();
    for (const t of SEED_TEMPLATES) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    for (const [category, n] of counts) {
      expect(n, `category "${category}" has only ${n} template(s)`).toBeGreaterThanOrEqual(2);
    }
  });

  it('has unique slugs', () => {
    const slugs = SEED_TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('covers every category the filter chips offer a user', () => {
    const categories = new Set(SEED_TEMPLATES.map((t) => t.category));
    // A filter that always returns nothing is a broken filter.
    for (const c of ['investment', 'suburb', 'postcode', 'statewide', 'comparison', 'cash_flow', 'client_form', 'compliance']) {
      expect(categories.has(c), `no seeded template in category "${c}"`).toBe(true);
    }
  });

  it('includes production-ready templates, not only preview-only ones', () => {
    const ready = SEED_TEMPLATES.filter(
      (t) => deriveEntryFacts({ report_type: t.reportType, schema: t.schema }).production_ready,
    );
    expect(ready.length).toBeGreaterThanOrEqual(4);
  });

  describe.each(SEED_TEMPLATES.map((t) => [t.slug, t] as const))('%s', (_slug, template) => {
    it('parses against the live Zod schema without salvage', () => {
      const result = ReportTemplateSchema.safeParse(template.schema);
      expect(
        result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      ).toEqual([]);
    });

    it('survives a parseTemplate round-trip with its pages intact', () => {
      // parseTemplate falls back to an empty template on failure, so an
      // unchanged page count proves it took the happy path.
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

    it('has no empty pages', () => {
      const empty = template.schema.pages.filter((p) => p.blocks.length === 0).map((p) => p.name);
      expect(empty).toEqual([]);
    });

    it('is white-label safe — no hard-coded colour outside the token map', () => {
      expect(deriveEntryFacts({ report_type: template.reportType, schema: template.schema }).brand_safe)
        .toBe(true);
    });

    it('defines every token its blocks reference', () => {
      // `token:*` addresses two maps. A prop that names a typeface — the
      // technical voice sets figure columns with `numericFont: 'token:mono'` —
      // resolves against `tokens.fonts`; everything else is a colour. The
      // renderers make the same distinction, so checking both here is what
      // proves a reference actually resolves rather than falling back.
      const declared = {
        colors: new Set(Object.keys(template.schema.tokens.colors)),
        fonts: new Set(Object.keys(template.schema.tokens.fonts)),
      };
      const missing: string[] = [];
      const walk = (node: unknown, key?: string): void => {
        if (typeof node === 'string') {
          if (!node.startsWith('token:')) return;
          const name = node.slice(6);
          const map = key && /font$/i.test(key) ? 'fonts' : 'colors';
          if (!declared[map].has(name)) missing.push(`${map}.${name} (via "${key}")`);
          return;
        }
        if (Array.isArray(node)) { node.forEach((v) => walk(v, key)); return; }
        if (node && typeof node === 'object') {
          for (const [k, v] of Object.entries(node)) walk(v, k);
        }
      };
      walk(template.schema.pages);
      expect(missing).toEqual([]);
    });

    it('renders real content through the production HTML renderer', () => {
      const { html } = renderTemplateToHtml(parseTemplate(template.schema), { data: SAMPLE });
      expect(html.length).toBeGreaterThan(2000);
      // One rendered <section class="tpl-page …"> per authored page.
      // (`data-page-index` is editor-mode only, so it is not the marker here.)
      const pageCount = (html.match(/class="tpl-page /g) ?? []).length;
      expect(pageCount).toBe(template.schema.pages.length);
    });

    it('leaves no unresolved binding markers in the rendered output', () => {
      const { html } = renderTemplateToHtml(parseTemplate(template.schema), { data: SAMPLE });
      // Unknown paths resolve to an empty string by design; what must never
      // survive to a customer's PDF is a literal `{{...}}`.
      expect(html).not.toMatch(/\{\{[^}]+\}\}/);
    });

    it('renders every page with visible content, not just a shell', () => {
      const { html } = renderTemplateToHtml(parseTemplate(template.schema), { data: SAMPLE });
      const pages = html.split('class="tpl-page ').slice(1);
      pages.forEach((pageHtml, i) => {
        // Strip tags and whitespace; a page that renders to nothing is a bug
        // the schema check cannot see.
        const text = pageHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
        expect(text.length, `page ${i + 1} ("${template.schema.pages[i].name}") rendered empty`)
          .toBeGreaterThan(20);
      });
    });

    it('uses only chip vocabulary values where the renderer does not resolve bindings', () => {
      // `scorecard.items[].rating` and `risk-register.items[].rating` /
      // `.confidence` select a chip colour from a fixed palette
      // (blocks/_chips.html.ts) and are deliberately NOT passed through
      // resolveBindable. Putting a {{binding}} there prints the braces into
      // the customer's PDF — which is exactly how this test was earned.
      const RATINGS = ['Strong', 'Moderate', 'Watch', 'High', 'Medium', 'Low'];
      const CONFIDENCES = ['Verified', 'Indicative', 'Planned', 'UnderConstruction', 'Unverified', 'NotAvailable'];
      for (const p of template.schema.pages) {
        for (const b of p.blocks) {
          if (b.type !== 'scorecard' && b.type !== 'risk-register') continue;
          const items = (b.props as { items?: Array<Record<string, string>> }).items ?? [];
          for (const item of items) {
            if (item.rating !== undefined) expect(RATINGS).toContain(item.rating);
            if (item.confidence !== undefined) expect(CONFIDENCES).toContain(item.confidence);
          }
        }
      }
    });

    it('keeps bindings out of table column headers', () => {
      // Same class of trap as the chip vocabularies above, in a different
      // block: `renderDataTableHtml` resolves `rows[].cells` but escapes
      // `headers` verbatim (blocks/dataTable.html.ts:22), so a binding in a
      // header reaches the PDF as literal braces. Column headers are labels.
      for (const p of template.schema.pages) {
        for (const b of p.blocks) {
          if (b.type !== 'data-table') continue;
          const headers = (b.props as { headers?: string[] }).headers ?? [];
          for (const h of headers) {
            expect(h, `header "${h}" on page "${p.name}"`).not.toMatch(/\{\{/);
          }
        }
      }
    });

    it('has every binding populated by the preview sample data', () => {
      // The Library renders these templates with SAMPLE_REPORT_DATA on the
      // browse and preview surfaces. A binding with no sample value renders as
      // an empty cell, so a gap here is a visibly half-filled document in the
      // catalogue — the exact "looks unfinished" problem the previews exist to
      // solve. Asserted per template so a new template cannot quietly ship
      // without its data.
      const read = (path: string) =>
        path.split('.').reduce<unknown>(
          (acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[key]),
          SAMPLE,
        );

      const bindings = new Set<string>();
      const walk = (node: unknown): void => {
        if (typeof node === 'string') {
          for (const m of node.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) bindings.add(m[1]);
          return;
        }
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node && typeof node === 'object') Object.values(node).forEach(walk);
      };
      walk(template.schema.pages);

      const missing = [...bindings].filter((b) => {
        const v = read(b);
        return v === undefined || v === null || v === '';
      });
      expect(missing.sort()).toEqual([]);
    });

    it('has descriptive catalogue metadata', () => {
      expect(template.name.trim().length).toBeGreaterThan(3);
      expect(template.description.trim().length).toBeGreaterThan(20);
      expect(template.longDescription.trim().length).toBeGreaterThan(80);
      expect(template.tags.length).toBeGreaterThanOrEqual(2);
      expect(template.industry.length).toBeGreaterThanOrEqual(1);
    });
  });
});
