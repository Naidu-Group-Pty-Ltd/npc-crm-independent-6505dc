/**
 * The browser's half of the design path (`standardDesign.ts`): which design a
 * report's own route is asked to draw in, and what the person is told about
 * the answer.
 *
 * The rules, each pinned here:
 *
 *  - the person's choice is sent for a report type that keeps its own pages,
 *    and never for one drawn through a template's pages (that would describe
 *    one choice twice);
 *  - a caller that has already read the choice is believed, `null` included,
 *    and nothing is read a second time;
 *  - a failed read is the standard design, never an error;
 *  - a comparison with no templates of its own wears the design chosen for the
 *    report it is made from, and its own choice would still win;
 *  - a design that was applied needs no words; one that was refused, or that a
 *    route never answered for, is said out loud beside the working file.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  selections: [] as Array<{ id: string; report_type: string; template_id: string }>,
  failRead: false,
  reads: 0,
  toasts: [] as Array<[string, string, string | undefined]>,
}));

vi.mock('../templateSelection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../templateSelection')>();
  return {
    ...actual,
    fetchTemplateSelections: async () => {
      h.reads += 1;
      if (h.failRead) throw new Error('manage-templates unavailable');
      return h.selections;
    },
  };
});

vi.mock('sonner', () => ({
  toast: {
    warning: (title: string, opts?: { description?: string }) => h.toasts.push(['warning', title, opts?.description]),
    info: (title: string, opts?: { description?: string }) => h.toasts.push(['info', title, opts?.description]),
  },
}));

import {
  announceDesignOutcome,
  designBody,
  designOutcome,
  DESIGN_NOT_DRAWN_TEXT,
  DESIGN_NOT_USED_TITLE,
  DESIGN_UNANSWERED_TEXT,
  readDesignEcho,
  standardDesignFor,
} from '../standardDesign';
import { DESIGN_REFUSAL_TEXT } from '../../../../supabase/functions/_shared/reportDesign/templateDesign.pure';

const APPLIED = { applied: { label: 'Private Banking — Chancery', code: 'pb-01', colourway: null }, refusal: null, message: null };
const REFUSED = { applied: null, refusal: 'template_unavailable', message: DESIGN_REFUSAL_TEXT.template_unavailable };

beforeEach(() => {
  h.selections = [];
  h.failRead = false;
  h.reads = 0;
  h.toasts = [];
});

describe('which design a route is asked for', () => {
  it('is the person\'s choice for a report type that keeps its own pages', async () => {
    h.selections = [{ id: 's1', report_type: 'portfolio', template_id: 'tpl-1' }];
    expect(await standardDesignFor('portfolio')).toEqual({ templateId: 'tpl-1' });
  });

  it('is found under every spelling of the report type', async () => {
    h.selections = [{ id: 's1', report_type: 'cash_flow', template_id: 'tpl-cf' }];
    expect(await standardDesignFor('cashflow')).toEqual({ templateId: 'tpl-cf' });
  });

  it('is nothing when nothing is chosen', async () => {
    expect(await standardDesignFor('portfolio')).toBeNull();
  });

  it('is never sent for the Investment tiers, whose template draws its own pages', async () => {
    h.selections = [{ id: 's1', report_type: 'investment', template_id: 'tpl-compass' }];
    expect(await standardDesignFor('investment')).toBeNull();
    expect(h.reads).toBe(0);
  });

  it('believes a caller that has already read the choice, null included, and reads nothing', async () => {
    h.selections = [{ id: 's1', report_type: 'portfolio', template_id: 'tpl-1' }];
    expect(await standardDesignFor('portfolio', { templateId: 'tpl-2' })).toEqual({ templateId: 'tpl-2' });
    expect(await standardDesignFor('portfolio', null)).toBeNull();
    expect(h.reads).toBe(0);
  });

  it('is the standard design when the choice cannot be read — never an error', async () => {
    h.failRead = true;
    await expect(standardDesignFor('portfolio')).resolves.toBeNull();
  });

  it('lends the 10 Year Cash Flow\'s design to the comparison made beside it', async () => {
    h.selections = [{ id: 's1', report_type: 'cashflow', template_id: 'tpl-cf' }];
    expect(await standardDesignFor('cash_flow_comparison')).toEqual({ templateId: 'tpl-cf' });
    // Its own choice, were one ever made, wins.
    h.selections.push({ id: 's2', report_type: 'cash_flow_comparison', template_id: 'tpl-own' });
    expect(await standardDesignFor('cash_flow_comparison')).toEqual({ templateId: 'tpl-own' });
  });

  it('lends nothing anywhere else', async () => {
    h.selections = [{ id: 's1', report_type: 'cashflow', template_id: 'tpl-cf' }];
    expect(await standardDesignFor('portfolio')).toBeNull();
  });

  it('adds nothing to a request body when no design is sent', () => {
    expect(designBody(null)).toEqual({});
    expect(designBody({ templateId: 'tpl-1' })).toEqual({ design: { templateId: 'tpl-1' } });
  });
});

describe('what the route said', () => {
  it('is read defensively — anything malformed is no answer at all', () => {
    expect(readDesignEcho(APPLIED)).toEqual(APPLIED);
    expect(readDesignEcho(REFUSED)).toEqual(REFUSED);
    for (const junk of [null, undefined, 'applied', 42, {}, { refusal: 'invented_reason' }]) {
      expect(readDesignEcho(junk), JSON.stringify(junk)).toBeNull();
    }
  });

  it('is one of four outcomes', () => {
    expect(designOutcome(null, APPLIED)).toBe('none');
    expect(designOutcome({ templateId: 't' }, APPLIED)).toBe('applied');
    expect(designOutcome({ templateId: 't' }, REFUSED)).toBe('refused');
    // A route that says nothing about a design it was sent predates designs.
    expect(designOutcome({ templateId: 't' }, undefined)).toBe('unanswered');
  });
});

describe('what the person is told', () => {
  it('nothing, when the design was applied or none was asked for', () => {
    expect(announceDesignOutcome({ templateId: 't' }, APPLIED)).toBe('applied');
    expect(announceDesignOutcome(null, undefined)).toBe('none');
    expect(h.toasts).toEqual([]);
  });

  it('the route\'s own sentence, when the design was refused', () => {
    expect(announceDesignOutcome({ templateId: 't' }, REFUSED)).toBe('refused');
    expect(h.toasts).toEqual([['warning', DESIGN_NOT_USED_TITLE, DESIGN_REFUSAL_TEXT.template_unavailable]]);
  });

  it('that the service predates designs, when it said nothing about one it was sent', () => {
    expect(announceDesignOutcome({ templateId: 't' }, undefined)).toBe('unanswered');
    expect(h.toasts).toEqual([['warning', DESIGN_NOT_USED_TITLE, DESIGN_UNANSWERED_TEXT]]);
  });

  it('that the browser drew it, when no route did', () => {
    expect(announceDesignOutcome({ templateId: 't' }, null, { drawnWithoutRoute: true })).toBe('unanswered');
    expect(h.toasts).toEqual([['warning', DESIGN_NOT_USED_TITLE, DESIGN_NOT_DRAWN_TEXT]]);
  });

  it('in words about the document, never about a failure', () => {
    for (const text of [DESIGN_NOT_USED_TITLE, DESIGN_UNANSWERED_TEXT, DESIGN_NOT_DRAWN_TEXT]) {
      expect(text).not.toMatch(/error|fail|parity|adapter|route|echo|_/i);
    }
  });
});
