/**
 * The line under every master's cover wordmark is the issuer's, and only the
 * prime has one (seed v23).
 *
 * All 500 family masters set "Your dedicated property partner" as a LITERAL
 * under the wordmark. It is the house's own tagline (`HOUSE_TAGLINE`), so every
 * clone's templated cover printed the house's words under the clone's name,
 * whatever else the white-label work had removed. The owner's rule
 * (26 Sep 2026): the house's identity is a legacy the prime keeps and a clone
 * never sees.
 *
 * The masters bind `{{org.tagline}}` now, and `applyOrganisationProjection`
 * publishes it on the prime alone. Three promises are pinned, each through the
 * production renderer rather than by reading a schema:
 *
 *   - **No master carries the words.** Not in a block, not in the preview.
 *   - **The prime's cover is unchanged.** Rendered with the prime's
 *     organisation, every master draws byte for byte what the same master
 *     draws with the literal put back, which is what v22 printed.
 *   - **A clone's cover draws no tagline, and no empty box where it was.**
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { applyOrganisationProjection } from '../../../../supabase/functions/_shared/organisationProjection.pure';
import {
  HOUSE_COVER_TAGLINE,
  isHouseTagline,
} from '../../../../supabase/functions/_shared/reports/issuerIdentity.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/portfolio';
import { COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/comparison';
import { CASH_FLOW_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlow';
import { CLIENT_DETAILS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/clientDetails';
import { CASH_FLOW_COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlowComparison';
import { REPORT_QA_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/reportQa';
import { COMMERCIAL_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/commercialCapacity';
import { MARKET_INTELLIGENCE_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/marketIntelligence';
import { SAMPLE_REPORT_DATA } from '../sampleReportData';
import { withIssuerTagline, ISSUER_TAGLINE_BINDING } from '@/lib/reportTemplate/houseTaglineGuard.pure';
import { TREE_IS_PRIME } from '../../testSupport/primeTree';

interface SchemaBlock { id: string; type: string; name?: string; props: Record<string, unknown> }
interface SchemaPage { id: string; name: string; blocks: SchemaBlock[] }
interface Master {
  name: string;
  schema: { pages: SchemaPage[] } & Record<string, unknown>;
}

const MASTERS = [
  ...INVESTMENT_COMPASS_TEMPLATES,
  ...BORROWING_CAPACITY_TEMPLATES,
  ...PORTFOLIO_TEMPLATES,
  ...COMPARISON_TEMPLATES,
  ...CASH_FLOW_COMPASS_TEMPLATES,
  ...CLIENT_DETAILS_TEMPLATES,
  ...CASH_FLOW_COMPARISON_TEMPLATES,
  ...REPORT_QA_TEMPLATES,
  ...COMMERCIAL_CAPACITY_TEMPLATES,
  ...MARKET_INTELLIGENCE_TEMPLATES,
] as unknown as Master[];

/** A clone's own letterhead: its name, and no tagline, because none is stated. */
const CLONE_ROW = { company_name: 'Harbour Lane Buyers Agency' };

/** The cover page alone, so a render is one sheet rather than the whole master. */
function coverOnly(master: Master): Master['schema'] {
  const cover = master.schema.pages.find((p) => p.name === 'Cover');
  if (!cover) throw new Error(`${master.name} has no page named Cover`);
  return { ...master.schema, pages: [cover] };
}

/** The same cover with the literal every master carried until v23. */
function withLiteralTagline(schema: Master['schema']): Master['schema'] {
  return {
    ...schema,
    pages: schema.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => (block.name === 'Tagline'
        ? { ...block, props: { ...block.props, body: HOUSE_COVER_TAGLINE } }
        : block)),
    })),
  };
}

/** The same cover with no tagline block at all. */
function withoutTaglineBlock(schema: Master['schema']): Master['schema'] {
  return {
    ...schema,
    pages: schema.pages.map((page) => ({
      ...page,
      blocks: page.blocks.filter((block) => block.name !== 'Tagline'),
    })),
  };
}

/** Sample data, with `org` replaced by what the projection publishes for this deployment. */
function dataFor(prime: boolean): Record<string, unknown> {
  const data: Record<string, unknown> = { ...SAMPLE_REPORT_DATA };
  delete data.org;
  return applyOrganisationProjection(data, CLONE_ROW, null, null, { prime });
}

const render = (schema: unknown, data: Record<string, unknown>) =>
  renderTemplateToHtml(schema as never, { data }).html;

describe('the cover tagline', () => {
  it('is carried by all 500 family masters, as a binding and never as the words', () => {
    expect(MASTERS).toHaveLength(500);
    for (const master of MASTERS) {
      const taglines = master.schema.pages
        .flatMap((p) => p.blocks)
        .filter((b) => b.name === 'Tagline');
      expect(taglines, master.name).toHaveLength(1);
      expect(taglines[0].props.body, master.name).toBe('{{org.tagline}}');
      // Nowhere else in the master either.
      expect(JSON.stringify(master.schema).toLowerCase(), master.name)
        .not.toContain(HOUSE_COVER_TAGLINE.toLowerCase());
    }
  });

  // The prime's tree only. Every seed from v20 on is over the 40 MiB the
  // cascade can write, so a clone holds the generator and never the file: its
  // newest seed is v19, which predates the binding. Run on a clone, it read
  // v19 and asserted v23. On 26 Sep 2026 that failed the cascade pull request
  // carrying it into npc-client-dashboard (#264), and held back the two clones
  // queued behind that one. See `testSupport/primeTree.ts`. The masters
  // themselves are asserted above, wherever they are carried, and the
  // draw-time guard below is what a clone relies on instead.
  it.runIf(TREE_IS_PRIME)('is what the newest seed carries too, in the schema and the preview of every master', () => {
    // The seed is what a deployment applies, so a fix that reached only the
    // definitions would reach no document. Newest by its own version number.
    const dir = resolve(__dirname, '../../../../supabase/migrations');
    const newest = readdirSync(dir)
      .map((f) => ({ f, v: Number(/_seed_template_library_v(\d+)_/.exec(f)?.[1] ?? NaN) }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => b.v - a.v)[0];
    expect(newest.v).toBeGreaterThanOrEqual(23);
    const sql = readFileSync(join(dir, newest.f), 'utf-8');
    expect(sql.split('{{org.tagline}}').length - 1).toBe(1000);
    expect(sql.toLowerCase()).not.toContain(HOUSE_COVER_TAGLINE.toLowerCase());
  });

  it('is the house tagline, in the case the masters set it', () => {
    expect(isHouseTagline(HOUSE_COVER_TAGLINE)).toBe(true);
  });

  it('is published on the prime with exactly the words the literal carried', () => {
    const org = dataFor(true).org as Record<string, unknown>;
    expect(org.tagline).toBe(HOUSE_COVER_TAGLINE);
    // No deployment stated is the catalogue's own tooling, which reads the
    // masters as they always read.
    const tooling = applyOrganisationProjection({}, CLONE_ROW, null, null, null).org as Record<string, unknown>;
    expect(tooling.tagline).toBe(HOUSE_COVER_TAGLINE);
  });

  it('is never published on a clone, whatever its rows hold', () => {
    const org = dataFor(false).org as Record<string, unknown>;
    expect(org).not.toHaveProperty('tagline');
    // A clone seeded from the prime's rows still gets none.
    const seeded = applyOrganisationProjection(
      {},
      { company_name: 'NPC Services' },
      null,
      { contact: { company_name: 'Naidu Property Consulting Services' } },
      { prime: false },
    ).org as Record<string, unknown>;
    expect(seeded).not.toHaveProperty('tagline');
  });

  it("leaves the prime's cover byte for byte what it was, on every master", () => {
    const prime = dataFor(true);
    for (const master of MASTERS) {
      const cover = coverOnly(master);
      const now = render(cover, prime);
      expect(now, master.name).toContain(HOUSE_COVER_TAGLINE);
      expect(now, master.name).toBe(render(withLiteralTagline(cover), prime));
    }
  });

  it("draws no tagline on a clone's cover, and no empty block where it was", () => {
    const clone = dataFor(false);
    for (const master of MASTERS) {
      const cover = coverOnly(master);
      const html = render(cover, clone);
      expect(html.toLowerCase(), master.name).not.toContain(HOUSE_COVER_TAGLINE.toLowerCase());
      expect(html, master.name).toContain('Harbour Lane Buyers Agency');
      // Dropped rather than drawn empty: the clone's cover is the cover with
      // the tagline block taken out of the schema. The one difference is the
      // blank line the renderer joins an empty block with, which draws nothing.
      const drawn = (h: string) => h.replace(/\n[ \t]*(?=\n)/g, '');
      expect(drawn(html), master.name).toBe(drawn(render(withoutTaglineBlock(cover), clone)));
    }
  });
});

/*
 * Where the seed never arrives.
 *
 * A clone takes migrations through Mission Control's cascade, which never
 * carries a seed this size, and the v23 refresh leaves a customised master as
 * it was. Either way a master can still hold the literal on the day it is
 * drawn, so the rule is applied again where the document is drawn
 * (`houseTaglineGuard.pure.ts`, called by `routeReportThroughTemplate`).
 */
describe('a master that still carries the literal', () => {
  it("is drawn on a clone exactly as the v23 master is, on every master", () => {
    const clone = dataFor(false);
    for (const master of MASTERS) {
      const cover = coverOnly(master);
      const guarded = withIssuerTagline(withLiteralTagline(cover), { prime: false });
      const html = render(guarded, clone);
      expect(html.toLowerCase(), master.name).not.toContain(HOUSE_COVER_TAGLINE.toLowerCase());
      expect(html, master.name).toBe(render(cover, clone));
    }
  });

  it('is left exactly as it is on the prime, the same object', () => {
    const literal = withLiteralTagline(coverOnly(MASTERS[0]));
    expect(withIssuerTagline(literal, { prime: true })).toBe(literal);
  });

  it('changes only a value that is the tagline, however cased or spaced, and never mutates the master', () => {
    const schema = {
      pages: [{
        blocks: [
          { type: 'text-block', props: { body: '  YOUR dedicated   property partner ' } },
          { type: 'text-block', props: { heading: 'Your dedicated property partner', body: 'Kept' } },
          { type: 'text-block', props: { body: 'We are your dedicated property partner.' } },
          { type: 'divider', props: { thickness: 1 } },
        ],
      }],
    };
    const before = JSON.stringify(schema);
    const out = withIssuerTagline(schema, { prime: false });
    expect(JSON.stringify(schema)).toBe(before);
    expect(out.pages[0].blocks.map((b) => b.props)).toEqual([
      { body: ISSUER_TAGLINE_BINDING },
      { heading: ISSUER_TAGLINE_BINDING, body: 'Kept' },
      { body: 'We are your dedicated property partner.' },
      { thickness: 1 },
    ]);
    // A master with nothing to change is returned as it was given.
    const clean = coverOnly(MASTERS[0]);
    expect(withIssuerTagline(clean, { prime: false })).toBe(clean);
  });

  it('is applied by the one route every templated document is drawn through, before either renderer', () => {
    const route = readFileSync(resolve(__dirname, '../../reportTemplate/routeReportThroughTemplate.ts'), 'utf-8');
    const guard = route.indexOf('schema = withIssuerTagline(schema, { prime: isPrimeDeployment() });');
    expect(guard).toBeGreaterThan(-1);
    // After any composition, and before the browser and the final renderer read the schema.
    expect(guard).toBeGreaterThan(route.indexOf('schema = parseTemplate(composition.schema);'));
    expect(guard).toBeLessThan(route.indexOf('preloadImagesWithReport(schema'));
    expect(guard).toBeLessThan(route.indexOf('compileTemplateHtmlForPdf(schema'));
  });
});
