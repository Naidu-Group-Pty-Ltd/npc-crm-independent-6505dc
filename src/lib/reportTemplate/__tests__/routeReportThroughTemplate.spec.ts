/**
 * The routing layer's two repaired seams.
 *
 * **The variant.** `resolveRoutingContext` and `buildBindingContext` declared
 * `variant` on the adapter interface from the start, and
 * `routeReportThroughTemplate` passed it to neither — so the Cash Flow
 * adapter's three stored scenarios all rendered as `moderate` and the Q&A
 * adapter's subject picker never saw a subject, whatever the caller asked for.
 * The first group pins the pass-through: the same variant, to both calls, and
 * `null` rather than `undefined` when the caller had none, because the
 * adapters distinguish "not asked" from "not supplied".
 *
 * **The door.** `tryRouteThroughTemplateBuilder` was the pilot's entry and for
 * a year the only one — every other format's masters were seeded, adapter and
 * all, with no product surface able to reach them.
 * `tryRouteThroughTemplateBuilderFor` is the generic entry, and the second
 * group pins its gate: a production format routes, a preview-only or unknown
 * type resolves null without a single adapter or template lookup, and a render
 * failure is a null — never a throw — so a caller's legacy fallback stays one
 * `??` long.
 *
 * The adapter registry is replaced with a capturing fake (the real adapters
 * read production tables); `normaliseReportType` stays real, so the gate is
 * tested through the same alias map and trimming the product uses. The
 * template parser, HTML renderer and production guard are real too — only the
 * template resolution and the PDF call are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  routingCalls: [] as Array<Record<string, unknown>>,
  bindingCalls: [] as Array<Record<string, unknown>>,
  routingResult: null as Record<string, unknown> | null,
  bindingResult: null as { data: Record<string, unknown> } | null,
  resolveCalls: [] as Array<Record<string, unknown>>,
  resolved: null as Record<string, unknown> | null,
  invokeCalls: [] as Array<[string, Record<string, unknown>]>,
  invokeResult: { data: null, error: null } as { data: unknown; error: unknown },
}));

vi.mock('@/lib/reportTemplate/adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters')>();
  const production = {
    reportType: 'portfolio',
    label: 'Portfolio Analysis',
    supportsProduction: true,
    legacyFallback: { label: 'Portfolio Analysis legacy generator' },
    resolveRoutingContext: async (args: Record<string, unknown>) => {
      h.routingCalls.push(args);
      return h.routingResult;
    },
    buildBindingContext: async (args: Record<string, unknown>) => {
      h.bindingCalls.push(args);
      return h.bindingResult;
    },
  };
  const previewOnly = {
    reportType: 'cash_flow_comparison',
    label: 'Cash Flow Comparison',
    supportsProduction: false,
    legacyFallback: { label: 'Cash Flow Comparison legacy generator' },
    resolveRoutingContext: async () => null,
    buildBindingContext: async () => null,
  };
  const registry = [production, previewOnly];
  const getAdapter = (reportType?: string | null) => {
    const key = actual.normaliseReportType(reportType);
    return registry.find((a) => a.reportType === key) ?? null;
  };
  return {
    ...actual,
    getAdapter,
    listAdapters: () => [...registry],
    supportsProduction: (t?: string | null) => !!getAdapter(t)?.supportsProduction,
  };
});

vi.mock('@/lib/reportTemplate/resolveTemplate', () => ({
  resolveReportTemplate: async (args: Record<string, unknown>) => {
    h.resolveCalls.push(args);
    return h.resolved;
  },
}));

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: async (name: string, payload: Record<string, unknown>) => {
    h.invokeCalls.push([name, payload]);
    return h.invokeResult;
  },
  describeAuthError: () => null,
}));

import { routeReportThroughTemplate } from '../routeReportThroughTemplate';
import { tryRouteThroughTemplateBuilderFor } from '../compassRoute';

const REPORT_ID = 'r4d5a570-0000-4000-8000-000000000001';

// A real, parseable template with a real binding, so the route runs the real
// parser, the real production guard and the real HTML renderer end to end.
const TEMPLATE_ROW = {
  id: 'tpl-portfolio-01',
  name: 'Meridian 01',
  custom_css: null,
  schema: {
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [{
      id: 'p1', name: 'Cover', size: { width: 595, height: 842 }, background: {},
      // A block type the browser renderer actually draws: the route refuses a
      // template whose blocks it cannot draw whole, which is the point of the
      // capability gate that replaced the `engine` column check.
      blocks: [{ id: 'b1', type: 'text-block', props: { body: '{{portfolio.review.summary}}', x: 40, y: 100, width: 500 } }],
    }],
  },
};

beforeEach(() => {
  h.routingCalls = [];
  h.bindingCalls = [];
  h.resolveCalls = [];
  h.invokeCalls = [];
  h.routingResult = {
    reportId: REPORT_ID,
    reportType: 'portfolio',
    variant: null,
    tier: null,
    title: 'Portfolio Performance Review',
    fileLabel: 'portfolio-performance-review',
    sourceTable: 'portfolio_analysis_reports',
  };
  h.bindingResult = { data: { portfolio: { review: { summary: 'All good.' } } } };
  h.resolved = { template: TEMPLATE_ROW, engine: 'weasyprint', source: 'global' };
  h.invokeResult = {
    data: { url: 'https://cdn.example/x.pdf', path: 'template-builder/2026-09-14/x.pdf', fileName: 'x.pdf' },
    error: null,
  };
});

describe('an adapter that declines is not overruled', () => {
  /**
   * The worst outcome this pipeline can produce is not an error — it is a
   * plausible document that is wrong, and a blank one under the client's own
   * letterhead is exactly that.
   */
  it('renders nothing when the adapter cannot build a context', async () => {
    h.bindingResult = null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await routeReportThroughTemplate(REPORT_ID, { reportType: 'portfolio' });

    // Null is the adapter saying "this record cannot make a document", and its
    // documented consequence is the legacy generator. This used to read
    // `ctx?.data ?? {}`: since an unresolved binding renders as the empty
    // string, the route produced the whole document with every field empty,
    // uploaded it, and returned a URL — so the caller never fell back.
    expect(result).toBeNull();
    expect(h.invokeCalls, 'a PDF was rendered for a record the adapter refused')
      .toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('declined report'));
    warn.mockRestore();
  });

  it('does not render an empty document when the context carries no data', async () => {
    // The same refusal in its other shape — a context object with nothing in
    // it is no more renderable than no context at all.
    h.bindingResult = { data: {} } as { data: Record<string, unknown> };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await routeReportThroughTemplate(REPORT_ID, { reportType: 'portfolio' })).toBeNull();
    expect(h.invokeCalls).toEqual([]);
    warn.mockRestore();
  });
});

describe('the variant reaches the adapter', () => {
  it('passes the caller\'s variant to both adapter calls, unchanged', async () => {
    const result = await routeReportThroughTemplate(REPORT_ID, {
      reportType: 'portfolio',
      variant: 'optimistic',
    });
    expect(result?.templateId).toBe(TEMPLATE_ROW.id);
    // The two answers must describe one document: the routing call and the
    // binding call see the same variant.
    expect(h.routingCalls).toEqual([{ reportId: REPORT_ID, variant: 'optimistic', payload: null }]);
    expect(h.bindingCalls).toHaveLength(1);
    expect(h.bindingCalls[0]).toMatchObject({ reportId: REPORT_ID, variant: 'optimistic' });
  });

  it('passes null — not undefined — when the caller had no variant', async () => {
    await routeReportThroughTemplate(REPORT_ID, { reportType: 'portfolio' });
    // The interface says `string | null`: "not asked for" is a value, and an
    // adapter that reads it must not have to guess between two absences.
    expect(h.routingCalls[0].variant).toBeNull();
    expect(h.bindingCalls[0].variant).toBeNull();
  });

  it('resolves the template for the routing context the adapter answered', async () => {
    h.routingResult = { ...h.routingResult!, variant: 'detailed' };
    await routeReportThroughTemplate(REPORT_ID, {
      reportType: 'portfolio',
      variant: 'detailed',
    });
    expect(h.resolveCalls).toHaveLength(1);
    expect(h.resolveCalls[0]).toMatchObject({ reportType: 'portfolio', variant: 'detailed' });
  });
});

describe('the generic entry point', () => {
  it('routes a production format and renders the adapter\'s own data', async () => {
    const result = await tryRouteThroughTemplateBuilderFor('portfolio', REPORT_ID, {
      variant: 'optimistic',
    });
    expect(result).toMatchObject({
      renderer: 'browser_template_jspdf',
      templateId: TEMPLATE_ROW.id,
      source: 'global:portfolio',
    });
    expect(result?.blob.size).toBeGreaterThan(0);
    expect(h.routingCalls[0].variant).toBe('optimistic');
    expect(h.bindingCalls[0]).toMatchObject({ variant: 'optimistic' });
    // The proof the binding data flowed, read off the DOCUMENT rather than off
    // a payload posted to a render service: the drawn PDF carries the review
    // sentence the fake adapter published, and no unresolved binding.
    const drawn = Buffer.from(await result!.blob.arrayBuffer()).toString('latin1');
    expect(drawn).toContain('All good.');
    expect(drawn).not.toContain('{{');
    // Nothing was sent anywhere to draw it.
    expect(h.invokeCalls).toEqual([]);
  });

  it('normalises the caller\'s spelling through the real alias map', async () => {
    const result = await tryRouteThroughTemplateBuilderFor('  Portfolio ', REPORT_ID);
    expect(result?.templateId).toBe(TEMPLATE_ROW.id);
  });

  it('resolves null for a preview-only type without touching anything', async () => {
    const result = await tryRouteThroughTemplateBuilderFor('cash_flow_comparison', REPORT_ID);
    expect(result).toBeNull();
    // The gate is before the route: no adapter call, no template lookup, no
    // render — a deployment where nothing is activated pays nothing.
    expect(h.routingCalls).toEqual([]);
    expect(h.resolveCalls).toEqual([]);
    expect(h.invokeCalls).toEqual([]);
  });

  it('resolves null for a type no adapter claims', async () => {
    const result = await tryRouteThroughTemplateBuilderFor('who_knows', REPORT_ID);
    expect(result).toBeNull();
    expect(h.routingCalls).toEqual([]);
  });

  it('resolves null when no template is active — the inert-until-activated posture', async () => {
    h.resolved = null;
    const result = await tryRouteThroughTemplateBuilderFor('portfolio', REPORT_ID);
    expect(result).toBeNull();
    expect(h.invokeCalls).toEqual([]);
  });

  /**
   * This used to simulate the render CONTAINER failing. There is no container
   * — the document is drawn in this browser — so the reachable failure is a
   * template the renderer cannot draw whole, and the answer is the same: null,
   * never a throw, so the caller falls back to the standard presentation.
   *
   * A placeholder panel is worse than a missing block, because it looks
   * deliberate. The refusal is the point.
   */
  it('resolves null — never throws — for a template it cannot draw whole', async () => {
    h.resolved = {
      template: {
        ...TEMPLATE_ROW,
        schema: {
          ...TEMPLATE_ROW.schema,
          pages: [{
            ...TEMPLATE_ROW.schema.pages[0],
            // `gantt` has never had a browser renderer; it would paint a
            // dashed placeholder box on a client's page.
            blocks: [...TEMPLATE_ROW.schema.pages[0].blocks, { id: 'b2', type: 'gantt', props: {} }],
          }],
        },
      },
      engine: 'weasyprint',
      source: 'global',
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await tryRouteThroughTemplateBuilderFor('portfolio', REPORT_ID);
    expect(result).toBeNull();
    warn.mockRestore();
  });
});

/**
 * The FINAL renderer.
 *
 * RS-2: the same route, the same adapter, the same frozen payload and the
 * same template — drawn by the pinned print engine through
 * `render-template-pdf` in `final` mode instead of by jsPDF in this tab. The
 * caller chooses with `renderer: 'weasyprint'`, and only a deliberate final
 * action does; every other caller gets the browser default above.
 */
describe('the final renderer', () => {
  const fetched = vi.fn();
  beforeEach(() => {
    fetched.mockReset();
    fetched.mockResolvedValue({
      ok: true, status: 200,
      blob: async () => new Blob(['%PDF-1.7 final'], { type: 'application/pdf' }),
    });
    vi.stubGlobal('fetch', fetched);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('compiles the template to print HTML and asks the engine for a FINAL render, once', async () => {
    const result = await routeReportThroughTemplate(REPORT_ID, {
      reportType: 'portfolio', renderer: 'weasyprint',
    });

    expect(result).toMatchObject({
      renderer: 'weasyprint_final',
      templateId: TEMPLATE_ROW.id,
      source: 'global:portfolio',
      storagePath: 'template-builder/2026-09-14/x.pdf',
    });
    expect(await result!.blob.text()).toBe('%PDF-1.7 final');

    // Exactly one call, to the one function, in the one mode, naming the
    // report the gate and the ledger read.
    expect(h.invokeCalls).toHaveLength(1);
    const [fn, body] = h.invokeCalls[0];
    expect(fn).toBe('render-template-pdf');
    expect(body).toMatchObject({
      mode: 'final',
      reportId: REPORT_ID,
      reportType: 'portfolio',
      templateId: TEMPLATE_ROW.id,
      templateName: 'Meridian 01',
      pageCount: 1,
    });
    // The HTML carries the bound data and no unresolved binding — the same
    // proof the browser test reads off the drawn PDF, read here off what the
    // engine is handed, because the engine is what draws it.
    const html = String(body.html);
    expect(html).toContain('All good.');
    expect(html).not.toContain('{{');
    // And it was compiled for PRINT: the container is the font source, so the
    // document asks the engine to fetch nothing.
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    // The bytes are fetched back from the signed URL the engine answered.
    expect(fetched).toHaveBeenCalledWith('https://cdn.example/x.pdf', expect.anything());
  });

  it('draws a template the browser renderer refuses, because the HTML renderer can', async () => {
    h.resolved = {
      template: {
        ...TEMPLATE_ROW,
        schema: {
          ...TEMPLATE_ROW.schema,
          pages: [{
            ...TEMPLATE_ROW.schema.pages[0],
            // `gantt` is HTML-first: jsPDF paints a placeholder, the HTML
            // renderer draws it. Under the browser renderer this template is
            // refused (see above); under the print engine it is the document.
            blocks: [...TEMPLATE_ROW.schema.pages[0].blocks, { id: 'b2', type: 'gantt', props: {} }],
          }],
        },
      },
      engine: 'weasyprint',
      source: 'global',
    };
    const result = await routeReportThroughTemplate(REPORT_ID, {
      reportType: 'portfolio', renderer: 'weasyprint',
    });
    expect(result?.renderer).toBe('weasyprint_final');
    expect(h.invokeCalls).toHaveLength(1);
  });

  it('refuses — null, never a throw, and no render — a block no renderer can draw', async () => {
    h.resolved = {
      template: {
        ...TEMPLATE_ROW,
        schema: {
          ...TEMPLATE_ROW.schema,
          pages: [{
            ...TEMPLATE_ROW.schema.pages[0],
            blocks: [...TEMPLATE_ROW.schema.pages[0].blocks, { id: 'b2', type: 'no-such-block', props: {} }],
          }],
        },
      },
      engine: 'weasyprint',
      source: 'global',
    };
    const refusals: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await routeReportThroughTemplate(REPORT_ID, {
      reportType: 'portfolio', renderer: 'weasyprint', onRefusal: (r) => refusals.push(r),
    });
    warn.mockRestore();
    expect(result).toBeNull();
    expect(refusals).toContain('template_not_renderable');
    // A hole in a page is worse than the standard document, and nothing was
    // spent finding that out.
    expect(h.invokeCalls).toEqual([]);
  });

  it('a render the engine refuses is a null, never a throw — the caller falls back', async () => {
    h.invokeResult = { data: null, error: { message: 'report_not_client_ready' } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await routeReportThroughTemplate(REPORT_ID, {
      reportType: 'portfolio', renderer: 'weasyprint',
    });
    warn.mockRestore();
    expect(result).toBeNull();
    expect(h.invokeCalls).toHaveLength(1);
  });

  it('is never chosen by default — an unspecified renderer is the browser', async () => {
    const result = await routeReportThroughTemplate(REPORT_ID, { reportType: 'portfolio' });
    expect(result?.renderer).toBe('browser_template_jspdf');
    expect(result?.storagePath).toBeNull();
    expect(h.invokeCalls).toEqual([]);
    expect(fetched).not.toHaveBeenCalled();
  });
});
