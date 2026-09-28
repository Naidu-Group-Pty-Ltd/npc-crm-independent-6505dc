/**
 * The property's floor plan, on a sheet of its own, in every Investment master.
 *
 * A new build's brochure usually carries the plan the house will be built to,
 * and a buyer reads a plan before almost anything else a report says about the
 * house. Since seed v22 every one of the fifty Investment masters carries two
 * floor-plan sheets (`floorPlanPage`), bound to `property.floorPlans[0]` and
 * `[1]`, which the Investment adapter fills from what the report broker signed.
 *
 * Four promises are pinned here, because breaking any one would be seen by a
 * client:
 *   - **A plan is printed whole.** Every photo slot in the catalogue crops to
 *     fill its frame; a cropped plan is a plan with a room missing and nothing
 *     on the page to say so. The sheet draws it `contain`.
 *   - **No plan, no page — and nothing else moves.** Most reports have no plan.
 *     Rendered without one, a master draws byte for byte what the same master
 *     draws with the two sheets taken out of its schema.
 *   - **One plan, one sheet.** The continuation prints only where a second plan
 *     exists.
 *   - **Every document keeps it.** The five Investment documents share one page
 *     sequence and the derived four drop the Compass-depth pages; a plan is a
 *     fact about the property, so none of them drops it.
 */
import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { pagesForDocument, DERIVED_TIERS } from '@/lib/reports/investment/tierPageSequence.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { SAMPLE_FLOOR_PLAN, SAMPLE_REPORT_DATA } from '../sampleReportData';

interface SchemaBlock { id: string; type: string; name?: string; props: Record<string, unknown> }
interface SchemaPage { id: string; name: string; conditional?: string; blocks: SchemaBlock[] }
interface Master {
  name: string;
  schema: { pages: SchemaPage[] } & Record<string, unknown>;
  designMeta: { familyKey: string; templateCode: string; reportFormat: string };
}

const INVESTMENT = (INVESTMENT_COMPASS_TEMPLATES as unknown as Master[])
  .filter((m) => m.designMeta.reportFormat === 'investment-compass');

const SHEET_NAMES = ['Floor plan', 'Floor plan, continued'];
const isSheet = (p: SchemaPage) => SHEET_NAMES.includes(p.name);

/** A second, distinguishable plan: the same sketch, so only its SOURCE differs. */
const SECOND_PLAN = `${SAMPLE_FLOOR_PLAN}#second`;

function withPlans(plans: string[] | undefined): Record<string, unknown> {
  const property = { ...(SAMPLE_REPORT_DATA as { property: Record<string, unknown> }).property };
  if (plans) property.floorPlans = plans;
  else delete property.floorPlans;
  return { ...SAMPLE_REPORT_DATA, property };
}

const render = (schema: unknown, data: Record<string, unknown>) =>
  renderTemplateToHtml(schema as never, { data }).html;

const pagesIn = (html: string) => (html.match(/class="tpl-page /g) ?? []).length;

describe('the floor-plan sheets', () => {
  it('are carried by all fifty Investment masters, two each, in the same place', () => {
    expect(INVESTMENT).toHaveLength(50);
    for (const master of INVESTMENT) {
      const names = master.schema.pages.map((p) => p.name);
      const first = names.indexOf('Floor plan');
      expect(first, master.name).toBeGreaterThan(0);
      expect(names[first + 1], master.name).toBe('Floor plan, continued');
      expect(names.filter((n) => SHEET_NAMES.includes(n)), master.name).toHaveLength(2);
      // After the cover, the contents and any photographic plates — the
      // pictures of the property are met together — and before the verdict,
      // because the property overview is prose that flows on into the body.
      expect(names[first + 2], master.name).toBe('Executive dashboard');
      expect(names.slice(0, first), master.name).toContain('Cover');
    }
  });

  it('are each conditional on their own plan, so an absent plan costs its page', () => {
    for (const master of INVESTMENT) {
      const sheets = master.schema.pages.filter(isSheet);
      expect(sheets.map((p) => p.conditional), master.name).toEqual([
        'property && property.floorPlans && property.floorPlans[0]',
        'property && property.floorPlans && property.floorPlans[1]',
      ]);
    }
  });

  it('draw the plan whole, never cropped, and never as a placeholder box', () => {
    for (const master of INVESTMENT) {
      master.schema.pages.filter(isSheet).forEach((sheet, index) => {
        const images = sheet.blocks.filter((b) => b.type === 'image');
        expect(images, `${master.name} / ${sheet.name}`).toHaveLength(1);
        const { props } = images[0];
        expect(props.src).toBe(`{{property.floorPlans.${index}}}`);
        expect(props.fit).toBe('contain');
        expect(props.placeholder).toBe(false);
        expect(String(props.alt)).toMatch(/^Floor plan of the property/);
      });
    }
  });

  it('give the drawing the room between the heading and the title block, and overlap neither', () => {
    for (const master of INVESTMENT) {
      for (const sheet of master.schema.pages.filter(isSheet)) {
        const image = sheet.blocks.find((b) => b.type === 'image')!.props as Record<string, number>;
        const notes = sheet.blocks.find((b) => b.type === 'definition-list')!.props as Record<string, number>;
        const label = `${master.name} / ${sheet.name}`;
        expect(image.height, label).toBeGreaterThan(300);
        expect(image.y + image.height, label).toBeLessThanOrEqual(notes.y);
        // Nothing above the drawing reaches into it: every block that precedes
        // it in the sheet's flow ends where the drawing begins, or above.
        const above = sheet.blocks.slice(0, sheet.blocks.findIndex((b) => b.type === 'image'))
          .map((b) => b.props as Record<string, number>)
          .filter((p) => typeof p.y === 'number' && typeof p.height === 'number' && p.y < image.y);
        for (const p of above) expect(p.y + p.height, label).toBeLessThanOrEqual(image.y);
      }
    }
  });

  it('say what the plan is: not to scale, where it came from, what to check it against', () => {
    const sheet = INVESTMENT[0].schema.pages.find((p) => p.name === 'Floor plan')!;
    const notes = sheet.blocks.find((b) => b.type === 'definition-list')!.props as {
      items: Array<{ term: string; definition: string }>;
    };
    expect(notes.items.map((i) => i.term)).toEqual(['Scale', 'Source', 'Before relying on it']);
    expect(notes.items[0].definition).toMatch(/^Not to scale/);
  });
});

describe('what the sheets cost a report with no plan', () => {
  it('nothing: every master draws exactly what it draws without the sheets', () => {
    const bare = withPlans(undefined);
    for (const master of INVESTMENT) {
      const without = { ...master.schema, pages: master.schema.pages.filter((p) => !isSheet(p)) };
      expect(render(master.schema, bare), master.name).toBe(render(without, bare));
    }
  });

  it('an empty list is no plan', () => {
    const master = INVESTMENT[0];
    expect(render(master.schema, withPlans([]))).toBe(render(master.schema, withPlans(undefined)));
  });
});

describe('what the sheets print when a plan exists', () => {
  it('one plan prints the first sheet and not the continuation', () => {
    for (const master of INVESTMENT) {
      const bare = render(master.schema, withPlans(undefined));
      const one = render(master.schema, withPlans([SAMPLE_FLOOR_PLAN]));
      expect(pagesIn(one), master.name).toBe(pagesIn(bare) + 1);
      expect(one, master.name).toContain(`src="${SAMPLE_FLOOR_PLAN}"`);
      expect(one, master.name).not.toContain('Floor plan, continued');
    }
  });

  it('two plans print both sheets, each drawing its own plan whole', () => {
    for (const master of INVESTMENT) {
      const bare = render(master.schema, withPlans(undefined));
      const two = render(master.schema, withPlans([SAMPLE_FLOOR_PLAN, SECOND_PLAN]));
      expect(pagesIn(two), master.name).toBe(pagesIn(bare) + 2);
      expect(two, master.name).toContain(`src="${SAMPLE_FLOOR_PLAN}"`);
      expect(two, master.name).toContain(`src="${SECOND_PLAN}"`);
      const planImages = [...two.matchAll(/<img [^>]*src="([^"]*)"[^>]*>/g)]
        .filter((m) => m[1] === SAMPLE_FLOOR_PLAN || m[1] === SECOND_PLAN)
        .map((m) => m[0]);
      expect(planImages, master.name).toHaveLength(2);
      for (const img of planImages) expect(img, master.name).toMatch(/object-fit:\s*contain/);
    }
  });
});

describe('which documents keep the sheets', () => {
  it('all five: the Compass and the four documents derived from it', () => {
    const pages = INVESTMENT[0].schema.pages;
    for (const tier of ['compass', ...DERIVED_TIERS]) {
      // Graded and ungraded alike: the grade rule drops a page about the grade,
      // and a plan is not about the grade.
      for (const grade of ['A', null]) {
        const kept = pagesForDocument(pages, { tier, recommendation: { grade } }).map((p) => p.name);
        expect(kept, `${tier} / ${grade ?? 'ungraded'}`).toEqual(expect.arrayContaining(SHEET_NAMES));
      }
    }
  });
});
