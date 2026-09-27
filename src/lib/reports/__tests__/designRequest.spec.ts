/**
 * A render request may name the design its document is drawn in — and that is
 * all it may change.
 *
 * Every standard route (nine of them) takes an optional `design`: one of the
 * catalogue's fifty designs in one of its colourways, or a `report_templates`
 * row. These are the rules every route shares, stated once across all nine so
 * no route can come to read a design differently from the others:
 *
 *  - absent means the standard design, and changes nothing else in the request;
 *  - a malformed design is refused with a sentence, never silently dropped — a
 *    caller that meant to ask for one must not receive the standard document
 *    and believe it got the design;
 *  - a template row is honoured only where the Template Builder would list it
 *    for this person and the chooser would offer it for this report type;
 *  - a design that cannot be applied never costs the document: the route draws
 *    the standard one and says why, in words the person can act on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const superadmin = vi.hoisted(() => ({ ok: false }));
/** Whether the caller may view templates — the Template Builder's own permission. */
const templatesView = vi.hoisted(() => ({ ok: true, asked: [] as string[] }));
vi.mock('../../../../supabase/functions/_shared/authz.ts', () => ({
  requireSuperadmin: vi.fn(async () => (superadmin.ok ? { ok: true } : { ok: false, error: 'no' })),
  requireModulePermission: vi.fn(async (_s: unknown, _a: unknown, moduleKey: string, perm: string) => {
    templatesView.asked.push(`${moduleKey}:${perm}`);
    return templatesView.ok ? { ok: true } : { ok: false, error: 'no' };
  }),
}));

import { parseRenderRequest as parseBorrowing } from '../../../../supabase/functions/_shared/reports/borrowingCapacity/route.pure';
import { parseRenderRequest as parseCashFlow } from '../../../../supabase/functions/_shared/reports/cashFlow/route.pure';
import { parseRenderRequest as parseCashFlowComparison } from '../../../../supabase/functions/_shared/reports/cashFlowComparison/route.pure';
import { parseRenderRequest as parseClientDetails } from '../../../../supabase/functions/_shared/reports/clientDetails/route.pure';
import { parseCapacityRequest as parseCommercial } from '../../../../supabase/functions/_shared/reports/commercialCapacity/route.pure';
import { parseRenderRequest as parseMarketIntelligence } from '../../../../supabase/functions/_shared/reports/marketIntelligence/route.pure';
import { parseRenderRequest as parsePortfolio } from '../../../../supabase/functions/_shared/reports/portfolio/route.pure';
import { parseRenderRequest as parseComparison } from '../../../../supabase/functions/_shared/reports/propertyComparison/route.pure';
import { parseRenderRequest as parseQa } from '../../../../supabase/functions/_shared/reports/reportQa/route.pure';
import {
  appliedEcho,
  catalogueColourways,
  catalogueDesign,
  DESIGN_REFUSAL_TEXT,
  refusedEcho,
  resolveCatalogueDesign,
  type TemplateDesignRefusal,
} from '../../../../supabase/functions/_shared/reportDesign/templateDesign.pure';
import {
  borrowedDesignNote,
  designBorrowersOf,
  designRowUsableFor,
  templateVisibleTo,
  type DesignTemplateRow,
} from '../../../../supabase/functions/_shared/reports/templateDesignRoute.pure';
import {
  chosenDesignReference,
  resolveRequestedDesign,
} from '../../../../supabase/functions/_shared/reports/templateDesignRead';

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER = '11111111-2222-4333-8444-555555555555';
const TEMPLATE = '9a1b2c3d-0000-4000-8000-000000000009';

type Parse = (body: unknown) => { ok: true; request: Record<string, unknown> } | { ok: false; error: string };

/** Each route, with the smallest body it accepts. */
const ROUTES: ReadonlyArray<readonly [string, Parse, Record<string, unknown>]> = [
  ['borrowing capacity', parseBorrowing as Parse, { clientId: ID }],
  ['cash flow', parseCashFlow as Parse, { reportId: ID, projection: { years: [] } }],
  ['cash flow comparison', parseCashFlowComparison as Parse, {
    primaryReportId: ID,
    properties: [{ reportId: ID, projection: { years: [] } }, { reportId: OTHER, projection: { years: [] } }],
  }],
  ['client details', parseClientDetails as Parse, { clientId: ID }],
  ['commercial capacity', parseCommercial as Parse, { assessmentId: ID }],
  ['market intelligence', parseMarketIntelligence as Parse, { reportId: ID }],
  ['portfolio', parsePortfolio as Parse, { reportId: ID }],
  ['property comparison', parseComparison as Parse, { comparisonId: ID }],
  ['report Q&A', parseQa as Parse, { conversationId: ID, subject: 'structured' }],
];

const accepted = (parse: Parse, body: unknown) => {
  const parsed = parse(body);
  if (parsed.ok === false) throw new Error(`refused: ${parsed.error}`);
  return parsed.request;
};

describe.each(ROUTES)('the %s route reads a design', (_name, parse, body) => {
  it('as the standard design when none is named', () => {
    expect(accepted(parse, body).design).toBeNull();
    expect(accepted(parse, { ...body, design: null }).design).toBeNull();
  });

  it('as a catalogue design, whatever case it was typed in', () => {
    expect(accepted(parse, { ...body, design: { code: ' DE-01 ' } }).design)
      .toEqual({ kind: 'catalogue', code: 'de-01', colourway: null });
  });

  it('with the colourway it names', () => {
    const colourway = catalogueColourways(catalogueDesign('pb-01')!.familyKey)[1].id;
    expect(accepted(parse, { ...body, design: { code: 'pb-01', colourway } }).design)
      .toEqual({ kind: 'catalogue', code: 'pb-01', colourway });
  });

  it('as a template row', () => {
    expect(accepted(parse, { ...body, design: { templateId: TEMPLATE.toUpperCase() } }).design)
      .toEqual({ kind: 'template', templateId: TEMPLATE });
  });

  it('as a catalogue code the catalogue no longer holds: a retired design is not a broken request', () => {
    // It is still drawn, in the standard design, and says so (`unknown_design`).
    expect(accepted(parse, { ...body, design: { code: 'zz-99' } }).design)
      .toEqual({ kind: 'catalogue', code: 'zz-99', colourway: null });
  });

  it('and changes nothing else in the request', () => {
    const plain = accepted(parse, body);
    const designed = accepted(parse, { ...body, design: { code: 'de-01' } });
    expect({ ...designed, design: null }).toEqual(plain);
  });

  it.each([
    ['a bare string', 'de-01'],
    ['a list', ['de-01']],
    ['neither a code nor a template', {}],
    ['a code that is not a catalogue code at all', { code: 'chancery' }],
    ['a template id that is not a uuid', { templateId: 'chancery' }],
    ['a colourway that is not an id', { code: 'pb-01', colourway: 'Oxblood!' }],
  ])('and refuses %s, rather than drawing the standard design without saying so', (_label, design) => {
    const parsed = parse({ ...body, design });
    expect(parsed.ok).toBe(false);
    expect((parsed as { ok: false; error: string }).error).toMatch(/^design/);
  });
});

describe('what a route says back', () => {
  const reasons = Object.keys(DESIGN_REFUSAL_TEXT) as TemplateDesignRefusal[];

  it('has a sentence for every refusal, and no two alike', () => {
    expect(reasons.sort()).toEqual([
      'palette_illegible', 'palette_incomplete', 'template_unavailable', 'template_unreadable', 'unknown_design',
    ]);
    expect(new Set(reasons.map((r) => DESIGN_REFUSAL_TEXT[r])).size).toBe(reasons.length);
  });

  it.each(reasons)('says, for %s, that the standard design was used and where to go', (reason) => {
    const echo = refusedEcho(reason);
    expect(echo.applied).toBeNull();
    expect(echo.refusal).toBe(reason);
    expect(echo.message).toContain('standard design was used');
    expect(echo.message).toMatch(/template chooser|Template Builder/);
    // A refusal is about the design, never a failure of the document.
    expect(echo.message).not.toMatch(/fail|error/i);
  });

  it('names the design it drew in, and asks nothing of the person', () => {
    const resolved = resolveCatalogueDesign({ code: 'de-01' });
    if (resolved.ok === false) throw new Error(resolved.detail);
    const echo = appliedEcho(resolved.design);
    expect(echo).toEqual({
      applied: { label: resolved.design.label, code: 'de-01', colourway: null },
      refusal: null,
      message: null,
    });
  });
});

describe('whose template a route may draw in', () => {
  const ME = 'user-a';
  const row = (over: Partial<DesignTemplateRow>): DesignTemplateRow => ({
    id: TEMPLATE, report_type: 'portfolio', is_active: true, is_draft: false,
    scope: 'global', owner_user_id: null, ...over,
  });

  it('is exactly what the Template Builder lists for them', () => {
    expect(templateVisibleTo(row({ scope: 'global' }), ME, false)).toBe(true);
    expect(templateVisibleTo(row({ scope: 'user', owner_user_id: ME }), ME, false)).toBe(true);
    expect(templateVisibleTo(row({ scope: 'user', owner_user_id: 'user-b' }), ME, false)).toBe(false);
    expect(templateVisibleTo(row({ scope: 'user', owner_user_id: null }), ME, false)).toBe(false);
    // Nothing in the schema says which agency a person belongs to.
    expect(templateVisibleTo(row({ scope: 'agency' }), ME, false)).toBe(false);
    // A row with no scope was not read from the table (the column is NOT NULL).
    expect(templateVisibleTo(row({ scope: null }), ME, false)).toBe(false);
  });

  it('is everything, for a superadmin', () => {
    expect(templateVisibleTo(row({ scope: 'agency' }), ME, true)).toBe(true);
    expect(templateVisibleTo(row({ scope: 'user', owner_user_id: 'user-b' }), ME, true)).toBe(true);
  });

  it('is only what the chooser would offer for this report type', () => {
    expect(designRowUsableFor(row({}), 'portfolio')).toBe(true);
    expect(designRowUsableFor(row({ report_type: 'investment' }), 'portfolio')).toBe(false);
    expect(designRowUsableFor(row({ is_active: false }), 'portfolio')).toBe(false);
    expect(designRowUsableFor(row({ is_draft: true }), 'portfolio')).toBe(false);
    // One format, several spellings: the chooser's alias map decides.
    expect(designRowUsableFor(row({ report_type: 'cash_flow' }), 'cashflow')).toBe(true);
  });

  it('lends the 10 Year Cash Flow\'s design to the comparison made beside it, and nothing else', () => {
    // The comparison has no templates of its own to choose from; it wears the
    // design chosen for the report it is made from (`DESIGN_BORROWED_FROM`).
    expect(designRowUsableFor(row({ report_type: 'cashflow' }), 'cash_flow_comparison')).toBe(true);
    expect(designRowUsableFor(row({ report_type: 'cash_flow' }), 'cash_flow_comparison')).toBe(true);
    // Lending is one way, and a borrowed row must still be one the chooser offers.
    expect(designRowUsableFor(row({ report_type: 'cash_flow_comparison' }), 'cashflow')).toBe(false);
    expect(designRowUsableFor(row({ report_type: 'cashflow', is_draft: true }), 'cash_flow_comparison')).toBe(false);
    expect(designRowUsableFor(row({ report_type: 'cashflow' }), 'portfolio')).toBe(false);
  });

  it('is said where the lender\'s choice is made, in every spelling of it, and nowhere else', () => {
    for (const spelling of ['cashflow', 'cash_flow']) {
      expect(designBorrowersOf(spelling)).toEqual(['cash_flow_comparison']);
      expect(borrowedDesignNote(spelling))
        .toBe('Also sets the design of the Cash Flow Comparison, which is made from this report.');
    }
    for (const other of ['portfolio', 'investment', 'cash_flow_comparison']) {
      expect(designBorrowersOf(other)).toEqual([]);
      expect(borrowedDesignNote(other)).toBeNull();
    }
  });
});

describe('resolveRequestedDesign', () => {
  /** A client that answers one `report_templates` read, and records it. */
  const client = (answer: { data: unknown; error: { message: string } | null }) => {
    const calls: Array<{ table: string; columns: string; id: unknown }> = [];
    const supabase = {
      from(table: string) {
        const call = { table, columns: '', id: undefined as unknown };
        calls.push(call);
        const chain = {
          select(columns: string) { call.columns = columns; return chain; },
          eq(_col: string, id: unknown) { call.id = id; return chain; },
          maybeSingle: async () => answer,
        };
        return chain;
      },
    };
    return { supabase, calls };
  };

  const templateRow = (over: Record<string, unknown> = {}) => ({
    id: TEMPLATE, name: 'Hand-built', report_type: 'portfolio', engine: 'weasyprint',
    scope: 'user', owner_user_id: 'user-a', is_active: true, is_draft: false,
    tokens: {
      colors: {
        primary: '#2B5138', bg: '#1A2018', surface: '#F9FAF6', panel: '#EFF1EA',
        text: '#F9FAF6', ink: '#262C23', mutedInk: '#555C52', line: '#DADFD6',
      },
      fonts: { heading: 'IBM Plex Mono', body: 'Inter' },
    },
    lineage: null,
    ...over,
  });

  const ask = (supabase: unknown, reference: Parameters<typeof resolveRequestedDesign>[1]['reference'], userId = 'user-a') =>
    resolveRequestedDesign(supabase, {
      reference, reportType: 'portfolio', actor: { userId, authMethod: 'jwt' }, route: 'spec',
    });

  beforeEach(() => {
    superadmin.ok = false;
    templatesView.ok = true;
    templatesView.asked = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('reads nothing when no design was asked for', async () => {
    const { supabase, calls } = client({ data: null, error: null });
    expect(await ask(supabase, null)).toEqual({ design: null, echo: null });
    expect(calls).toHaveLength(0);
  });

  it('resolves a catalogue design from code, without reading the database', async () => {
    const { supabase, calls } = client({ data: null, error: null });
    const r = await ask(supabase, { kind: 'catalogue', code: 'de-01', colourway: null });
    expect(r.design?.code).toBe('de-01');
    expect(r.echo?.applied?.code).toBe('de-01');
    expect(calls).toHaveLength(0);
  });

  it("asks the Template Builder's own permission before a template row is read", async () => {
    const { supabase, calls } = client({ data: templateRow(), error: null });
    await ask(supabase, { kind: 'template', templateId: TEMPLATE });
    expect(templatesView.asked).toEqual(['templates:can_view']);
    expect(calls).toHaveLength(1);
  });

  it('refuses a template row to somebody who may not view templates, without reading it', async () => {
    // The chooser and the drawn documents refuse the same person the same row,
    // and asking first means the refusal says nothing about whether it exists.
    templatesView.ok = false;
    const { supabase, calls } = client({ data: templateRow(), error: null });
    const r = await ask(supabase, { kind: 'template', templateId: TEMPLATE });
    expect(r).toEqual({ design: null, echo: refusedEcho('template_unavailable') });
    expect(calls).toHaveLength(0);
  });

  it('refuses a catalogue design the catalogue no longer holds, and draws the standard design', async () => {
    const { supabase } = client({ data: null, error: null });
    const r = await ask(supabase, { kind: 'catalogue', code: 'zz-99', colourway: null });
    expect(r).toEqual({ design: null, echo: refusedEcho('unknown_design') });
  });

  it('refuses a catalogue colourway the family does not have, and draws the standard design', async () => {
    const { supabase } = client({ data: null, error: null });
    const r = await ask(supabase, { kind: 'catalogue', code: 'de-01', colourway: 'de-not-a-colourway' });
    expect(r.design).toBeNull();
    expect(r.echo?.refusal).toBe('unknown_design');
  });

  it('reads only the columns a design needs, never a template\'s pages', async () => {
    const { supabase, calls } = client({ data: templateRow(), error: null });
    const r = await ask(supabase, { kind: 'template', templateId: TEMPLATE });
    expect(r.design).not.toBeNull();
    expect(r.echo?.applied?.label).toBeTruthy();
    expect(calls).toEqual([{ table: 'report_templates', columns: expect.any(String), id: TEMPLATE }]);
    expect(calls[0].columns).toContain('tokens:schema->tokens');
    expect(calls[0].columns).not.toMatch(/(^|[ ,])schema([ ,]|$)/);
    expect(calls[0].columns).not.toMatch(/\bpages\b|\bhtml\b|\bcss\b/);
  });

  it('refuses another person\'s template, and draws the standard design', async () => {
    const { supabase } = client({ data: templateRow({ owner_user_id: 'user-b' }), error: null });
    const r = await ask(supabase, { kind: 'template', templateId: TEMPLATE });
    expect(r).toEqual({ design: null, echo: refusedEcho('template_unavailable') });
  });

  it('honours another person\'s template for a superadmin', async () => {
    superadmin.ok = true;
    const { supabase } = client({ data: templateRow({ owner_user_id: 'user-b' }), error: null });
    expect((await ask(supabase, { kind: 'template', templateId: TEMPLATE })).design).not.toBeNull();
  });

  it('refuses a template for another report type, a draft, or one switched off', async () => {
    for (const over of [{ report_type: 'investment' }, { is_draft: true }, { is_active: false }]) {
      const { supabase } = client({ data: templateRow(over), error: null });
      expect((await ask(supabase, { kind: 'template', templateId: TEMPLATE })).echo?.refusal)
        .toBe('template_unavailable');
    }
  });

  it('refuses a template whose colours cannot be printed, saying so', async () => {
    const { supabase } = client({ data: templateRow({ tokens: { colors: {} } }), error: null });
    const r = await ask(supabase, { kind: 'template', templateId: TEMPLATE });
    expect(r.design).toBeNull();
    expect(r.echo?.refusal).toBe('palette_incomplete');
  });

  it('says a failed read failed, rather than that the template is gone — and logs the database\'s own words', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { supabase } = client({ data: null, error: { message: 'connection reset' } });
    const r = await ask(supabase, { kind: 'template', templateId: TEMPLATE });
    expect(r).toEqual({ design: null, echo: refusedEcho('template_unreadable') });
    expect(r.echo?.message).toMatch(/could not be read just now.*Try again/);
    expect(warn.mock.calls.flat().join(' ')).toContain('connection reset');
  });

  it('never throws, whatever the database does: a design is never worth the document', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const supabase = { from: () => { throw new Error('socket hang up'); } };
    const r = await ask(supabase, { kind: 'template', templateId: TEMPLATE });
    expect(r).toEqual({ design: null, echo: refusedEcho('template_unreadable') });
    expect(warn.mock.calls.flat().join(' ')).toContain('socket hang up');
  });
});

describe('chosenDesignReference — the choice read for a render nobody is watching', () => {
  const selections = (rows: unknown[] | null, error: { message: string } | null = null) => {
    const calls: Array<{ table: string; columns: string; owner: unknown }> = [];
    const supabase = {
      from(table: string) {
        const call = { table, columns: '', owner: undefined as unknown };
        calls.push(call);
        const chain = {
          select(columns: string) { call.columns = columns; return chain; },
          eq: async (_col: string, owner: unknown) => { call.owner = owner; return { data: rows, error }; },
        };
        return chain;
      },
    };
    return { supabase, calls };
  };
  const ask = (supabase: unknown, reportType = 'market_intelligence', userId = 'user-a') =>
    chosenDesignReference(supabase, { userId, reportType, route: 'spec' });

  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  it('is the owner\'s own choice for the report type, under any spelling', async () => {
    const { supabase, calls } = selections([
      { report_type: 'market_intelligence', template_id: TEMPLATE.toUpperCase() },
      { report_type: 'portfolio', template_id: OTHER },
    ]);
    expect(await ask(supabase)).toEqual({ kind: 'template', templateId: TEMPLATE });
    expect(calls).toEqual([{ table: 'report_template_selections', columns: 'report_type, template_id', owner: 'user-a' }]);
  });

  it('lends the 10 Year Cash Flow\'s choice to the comparison, exactly as the browser does', async () => {
    const { supabase } = selections([{ report_type: 'cash_flow', template_id: TEMPLATE }]);
    expect(await ask(supabase, 'cash_flow_comparison')).toEqual({ kind: 'template', templateId: TEMPLATE });
  });

  it('is nothing when nothing is chosen, when the read fails, or for no person at all', async () => {
    expect(await ask(selections([]).supabase)).toBeNull();
    expect(await ask(selections(null, { message: 'permission denied' }).supabase)).toBeNull();
    expect(await ask({ from: () => { throw new Error('socket hang up'); } })).toBeNull();
    const { supabase, calls } = selections([{ report_type: 'market_intelligence', template_id: TEMPLATE }]);
    expect(await ask(supabase, 'market_intelligence', 'service_role')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
