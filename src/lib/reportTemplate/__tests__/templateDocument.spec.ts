/**
 * The call every format's delivery path makes before its own route.
 *
 * The rule this file exists to hold: **a templated document is an improvement
 * on a working path, so it may never be the reason somebody cannot get their
 * file.** A refused adapter, no activated template, a render that failed, a
 * template carrying a block this renderer cannot draw — every one of them has
 * to answer null, because the caller's next line is the standard presentation.
 *
 * The document is a Blob now rather than a signed URL. It used to be written
 * to a bucket by a render service and fetched back here, so "the URL will not
 * fetch" and "the body was empty" were two more ways to end up with no file;
 * the renderer runs in this tab, so there is nothing to fetch and emptiness is
 * checked once, beside the render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  routed: null as {
    blob: Blob; fileName: string; templateId: string; renderer?: string; storagePath?: string | null;
  } | null,
  routeCalls: [] as Array<[string, string, unknown]>,
  routeThrows: false,
  selections: [] as Array<{ id: string; report_type: string; template_id: string }>,
  selectionsThrow: false,
  selectionCalls: 0,
  /**
   * Whether the real release register decides. Off for the mechanism tests,
   * which are about how a RELEASED report type reaches its template and use
   * several report types to show the alias map and the variant at work; on for
   * the hold tests, which are about which report types are released at all.
   */
  realRegister: false,
  toasts: [] as Array<[string, string]>,
}));

vi.mock('../../../../supabase/functions/_shared/reports/templateParity.pure.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../supabase/functions/_shared/reports/templateParity.pure')>();
  return {
    ...actual,
    isTemplateDeliveryHeld: (reportType?: string | null) =>
      (h.realRegister ? actual.isTemplateDeliveryHeld(reportType) : false),
  };
});

vi.mock('sonner', () => {
  const record = (kind: string) => (title: string) => { h.toasts.push([kind, title]); };
  return {
    toast: Object.assign(record('default'), {
      info: record('info'), warning: record('warning'), error: record('error'), success: record('success'),
    }),
  };
});

vi.mock('@/lib/reportTemplate/templateSelection', async (importOriginal) => {
  // The pure half stays real, so the alias map decides which format a
  // selection belongs to — the same map the picker and the server use.
  const actual = await importOriginal<typeof import('../templateSelection')>();
  return {
    ...actual,
    fetchTemplateSelections: async () => {
      h.selectionCalls += 1;
      if (h.selectionsThrow) throw new Error('selections unreadable');
      return h.selections;
    },
  };
});

vi.mock('@/lib/reportTemplate/compassRoute', () => ({
  tryRouteThroughTemplateBuilderFor: async (
    reportType: string, reportId: string, opts?: unknown,
  ) => {
    h.routeCalls.push([reportType, reportId, opts]);
    if (h.routeThrows) throw new Error('the routing layer exploded');
    return h.routed;
  },
}));

import { tryTemplateDocument } from '../templateDocument';

const pdf = (text: string) => new Blob([text], { type: 'application/pdf' });

beforeEach(() => {
  h.routed = { blob: pdf('%PDF-1.7 rendered'), fileName: 'x.pdf', templateId: 'tpl-1' };
  h.routeCalls = [];
  h.routeThrows = false;
  h.selections = [];
  h.selectionsThrow = false;
  h.selectionCalls = 0;
  h.realRegister = false;
  h.toasts = [];
});

describe("the person's chosen template", () => {
  /**
   * The picker offers a choice for every format and says it is kept. Only the
   * Compass button ever passed the chosen id, so on the other eight formats a
   * selection was stored, displayed as selected, and ignored by the generator
   * it was a choice about.
   */
  it('is looked up and carried into the route', async () => {
    h.selections = [{ id: 's1', report_type: 'client_details', template_id: 'tpl-chosen' }];
    await tryTemplateDocument('client_details', 'client-1');
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: 'tpl-chosen' });
  });

  it('is matched through the alias map, not by raw spelling', async () => {
    // A format is stored under up to four spellings and they are one format;
    // a selection saved as `formara` belongs to the Client Details document.
    h.selections = [{ id: 's1', report_type: 'formara', template_id: 'tpl-alias' }];
    await tryTemplateDocument('client_details', 'client-1');
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: 'tpl-alias' });
  });

  it('carries null when this format has no choice, so the ranking decides', async () => {
    h.selections = [{ id: 's1', report_type: 'portfolio', template_id: 'tpl-other' }];
    await tryTemplateDocument('qa', 'conv-1');
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: null });
  });

  it('still produces the document when the selection cannot be read', async () => {
    // The choice is an improvement on a working path, so failing to read it
    // resolves by ranking rather than costing somebody their file.
    h.selectionsThrow = true;
    const doc = await tryTemplateDocument('portfolio', 'p-1');
    expect(doc).toBeTruthy();
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: null });
  });

  it('is read fresh, so changing it changes the next document', async () => {
    h.selections = [{ id: 's1', report_type: 'portfolio', template_id: 'tpl-first' }];
    await tryTemplateDocument('portfolio', 'p-1');
    h.selections = [{ id: 's1', report_type: 'portfolio', template_id: 'tpl-second' }];
    await tryTemplateDocument('portfolio', 'p-1');
    expect(h.routeCalls[1][2]).toMatchObject({ templateId: 'tpl-second' });
    expect(h.selectionCalls).toBe(2);
  });

  it('is looked up without a report to render, so a dropped choice is said out loud', async () => {
    /*
     * This used to assert the opposite — no lookup, no query, return null. It
     * was the cheaper call and it hid a live defect for as long as it stood.
     *
     * Every Borrowing Capacity surface builds its request as
     * `{ clientId, clientName }` with no `assessmentId`, so `reportId` was
     * always null for that format and the template path was skipped on every
     * download *before* the fall-through notice could fire. The person's chosen
     * template was inert and nothing said so; the legacy composer produces a
     * well-typeset document, so an ignored choice looked exactly like an
     * honoured one. It was reported as "the template selector isn't working".
     *
     * One read on a path that is about to produce a PDF is the cheaper side of
     * that trade — the same reasoning `selectedTemplateFor` already gives for
     * not caching. No selection, no query beyond the read, and still no route.
     */
    h.selections = [{ id: 's1', report_type: 'portfolio', template_id: 'tpl-1' }];
    await tryTemplateDocument('portfolio', null);
    expect(h.selectionCalls).toBe(1);
    // Still no render attempt — there is no record to render.
    expect(h.routeCalls).toHaveLength(0);
  });
});

describe('the renderer and the stored path', () => {
  it('forwards the caller\'s renderer to the route, and asks for none by default', async () => {
    await tryTemplateDocument('portfolio', 'p-1', { renderer: 'weasyprint' });
    expect(h.routeCalls[0][2]).toMatchObject({ renderer: 'weasyprint' });
    await tryTemplateDocument('portfolio', 'p-1');
    // Undefined, not 'browser': the route owns the default, and a caller that
    // did not choose must not look like one that chose the preview renderer.
    expect((h.routeCalls[1][2] as { renderer?: unknown }).renderer).toBeUndefined();
  });

  it('carries the renderer and the stored path back to the caller', async () => {
    h.routed = {
      blob: pdf('%PDF-1.7 final'), fileName: 'x.pdf', templateId: 'tpl-1',
      renderer: 'weasyprint_final', storagePath: 'template-builder/2026-09-14/x.pdf',
    };
    const doc = await tryTemplateDocument('investment', 'r-1', { renderer: 'weasyprint' });
    expect(doc?.renderer).toBe('weasyprint_final');
    expect(doc?.storagePath).toBe('template-builder/2026-09-14/x.pdf');
  });

  it('a document drawn in this tab has no stored path — null, never undefined', async () => {
    h.routed = { blob: pdf('%PDF-1.7 rendered'), fileName: 'x.pdf', templateId: 'tpl-1', renderer: 'browser_template_jspdf' };
    const doc = await tryTemplateDocument('portfolio', 'p-1');
    expect(doc?.storagePath).toBeNull();
  });
});

describe('a choice the caller already read', () => {
  /**
   * The Investment finalisation keys its memo on the chosen template, so it
   * reads the selection itself and hands it down — otherwise the memo's key
   * and the template actually rendered would come from two reads that are
   * free to disagree. Handed down means NOT read again here.
   */
  it('is used as given, without a second read', async () => {
    h.selections = [{ id: 's1', report_type: 'investment', template_id: 'tpl-stale' }];
    await tryTemplateDocument('investment', 'r-1', { selectedTemplateId: 'tpl-handed' });
    expect(h.selectionCalls).toBe(0);
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: 'tpl-handed' });
  });

  it('null is a choice too — "nothing chosen", and still no read', async () => {
    h.selections = [{ id: 's1', report_type: 'investment', template_id: 'tpl-stale' }];
    await tryTemplateDocument('investment', 'r-1', { selectedTemplateId: null });
    expect(h.selectionCalls).toBe(0);
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: null });
  });

  it('undefined is "not read yet", so the shared question reads it', async () => {
    h.selections = [{ id: 's1', report_type: 'investment', template_id: 'tpl-read' }];
    await tryTemplateDocument('investment', 'r-1', { selectedTemplateId: undefined });
    expect(h.selectionCalls).toBe(1);
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: 'tpl-read' });
  });
});

describe('asking for the templated document', () => {
  it('returns the bytes, and passes the report type and variant through', async () => {
    const doc = await tryTemplateDocument('qa', 'conv-1', { variant: 'answer' });
    expect(await doc?.blob.text()).toBe('%PDF-1.7 rendered');
    expect(doc?.fileName).toBe('x.pdf');
    expect(doc?.templateId).toBe('tpl-1');
    // `templateId` rides alongside the variant now — null here, because this
    // person has chosen no template for the format.
    // `onRefusal` rides along too — the route tells the caller which gate it
    // closed at, so the notice can name the cause. Matched rather than
    // compared whole, because a diagnostic callback is not part of what this
    // test is about.
    expect(h.routeCalls).toHaveLength(1);
    expect(h.routeCalls[0][0]).toBe('qa');
    expect(h.routeCalls[0][1]).toBe('conv-1');
    expect(h.routeCalls[0][2]).toMatchObject({
      variant: 'answer', templateId: null, payload: null,
    });
    expect(typeof (h.routeCalls[0][2] as any).onRefusal).toBe('function');
  });

  it('asks nothing at all without a report id', async () => {
    // A Borrowing Capacity Snapshot can be requested without naming an
    // assessment ("omit for the most recent"), and there is no stored record
    // for an adapter to read in that case.
    expect(await tryTemplateDocument('borrowing_capacity', null)).toBeNull();
    expect(await tryTemplateDocument('borrowing_capacity', undefined)).toBeNull();
    expect(await tryTemplateDocument('borrowing_capacity', '')).toBeNull();
    expect(h.routeCalls).toEqual([]);
  });

  it('falls back when no template is activated', async () => {
    h.routed = null;
    expect(await tryTemplateDocument('portfolio', 'p-1')).toBeNull();
  });

  it('falls back when the route produced no document', async () => {
    // A zero-byte document saves as a file that opens to an error, which is
    // worse than the standard presentation. The route refuses it there and
    // answers null; this is the caller honouring that.
    h.routed = null;
    expect(await tryTemplateDocument('portfolio', 'p-1')).toBeNull();
  });

  it('falls back — never throws — when the router fails', async () => {
    h.routeThrows = true;
    await expect(tryTemplateDocument('portfolio', 'p-1')).resolves.toBeNull();
  });
});

describe('a report type held from a template\'s pages', () => {
  /**
   * The owner's rule (26 Sep 2026): a template changes how a document looks
   * and nothing else. None of the nine non-Investment report types carried the
   * same information through a template's pages as through its standard
   * document, so each is drawn by its own route, in the chosen template's
   * design (`templateParity.pure.ts`, `standardDesign.ts`). These run on the
   * REAL register.
   */
  beforeEach(() => { h.realRegister = true; });

  const HELD = [
    'borrowing_capacity', 'cashflow', 'client_details', 'commercial_capacity',
    'comparison', 'market_intelligence', 'portfolio', 'qa', 'cash_flow_comparison',
  ];

  it('never reaches a template for any of the nine, chosen or not', async () => {
    h.selections = HELD.map((type, i) => ({ id: `s${i}`, report_type: type, template_id: `tpl-${type}` }));
    for (const type of HELD) {
      expect(await tryTemplateDocument(type, 'record-1', { renderer: 'weasyprint' }), type).toBeNull();
    }
    expect(h.routeCalls).toEqual([]);
  });

  it('is recognised under every spelling of the report type', async () => {
    for (const alias of ['cash_flow', 'formara', 'commercial_industrial', 'borrowing']) {
      expect(await tryTemplateDocument(alias, 'record-1'), alias).toBeNull();
    }
    expect(h.routeCalls).toEqual([]);
  });

  it('says nothing, chosen or not: the report\'s own route draws the choice as its design', async () => {
    // The choice is not held back any more — `standardDesign.ts` sends it to
    // the standard route, which draws this report's own pages in it. A notice
    // here would be about a choice that IS being honoured.
    h.selections = [{ id: 's1', report_type: 'portfolio', template_id: 'tpl-chosen' }];
    await tryTemplateDocument('portfolio', 'p-1');
    expect(h.toasts).toEqual([]);

    h.selections = [];
    await tryTemplateDocument('portfolio', 'p-1');
    expect(h.toasts).toEqual([]);
  });

  it('never warns that a choice "was not used" — nothing failed', async () => {
    h.selections = [{ id: 's1', report_type: 'qa', template_id: 'tpl-chosen' }];
    await tryTemplateDocument('qa', 'conv-1');
    expect(h.toasts.filter(([kind]) => kind === 'warning')).toEqual([]);
  });

  it('leaves the Investment tiers on their templates', async () => {
    h.selections = [{ id: 's1', report_type: 'investment', template_id: 'tpl-compass' }];
    const doc = await tryTemplateDocument('investment_compass', 'r-1', { renderer: 'weasyprint' });
    expect(doc?.templateId).toBe('tpl-1');
    expect(h.routeCalls[0][2]).toMatchObject({ templateId: 'tpl-compass', renderer: 'weasyprint' });
  });
});
