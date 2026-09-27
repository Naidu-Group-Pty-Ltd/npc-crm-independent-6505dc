/**
 * Which design a document drawn in the browser is drawn in
 * (`drawnDocumentDesign.ts`), and the register that says which report type's
 * choice each one wears (`DRAWN_DOCUMENTS`).
 *
 * The rules, each pinned here:
 *
 *  - a drawn document wears the design chosen for the report type the
 *    register names, and no other;
 *  - nothing chosen, or a choice that cannot be read at all, is the house
 *    design, said nothing about — that is the document everyone already had;
 *  - a choice that was read and cannot be honoured is said out loud, in the
 *    same words the typeset routes use, and the document is still produced;
 *  - the row is read the way the routes read it: its design columns only, and
 *    honoured only where the chooser would offer it for that report type.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: vi.fn() }));

import {
  DRAWN_DESIGN_COLUMNS,
  drawnDesignFor,
  type DrawnDesignDeps,
  type DrawnDesignTemplateRow,
} from '@/lib/reports/drawnDocumentDesign';
import {
  DRAWN_DOCUMENTS,
  drawnDocumentDesignSource,
  drawnDocumentsNote,
  drawnDocumentsWearing,
} from '../../../../supabase/functions/_shared/reports/templateDesignRoute.pure';
import { DESIGN_REFUSAL_TEXT } from '@/lib/reportDesign/templateDesign.pure';
import { DESIGN_NOT_USED_TITLE } from '@/lib/reportTemplate/standardDesign';
import { listReportFormats } from '@/lib/reportTemplate/reportFormats';
import { normaliseReportType } from '@/lib/reportTemplate/templateSelection';

const TEMPLATE = '11111111-2222-4333-8444-555555555555';

/** A published Borrowing Capacity master adopted from the catalogue. */
const ROW: DrawnDesignTemplateRow = {
  id: TEMPLATE,
  name: 'Private Banking — Chancery',
  report_type: 'borrowing_capacity',
  engine: 'weasyprint',
  scope: 'global',
  is_active: true,
  is_draft: false,
  tokens: {
    colors: {
      surface: '#FAF7EF', bg: '#1B2130', ink: '#1A1A18', primary: '#22406E', line: '#D8D2C4',
      panel: '#F2EBDE', text: '#F4F1EA', accentInk: '#22406E', accentOnField: '#C9D4E8',
    },
    fonts: { display: 'Cinzel', heading: 'Playfair Display', body: 'Inter', mono: 'IBM Plex Mono' },
  },
  lineage: { templateCode: 'pb-01', colourway: 'pb-navy-signet' },
};

function deps(over: Partial<DrawnDesignDeps> = {}): DrawnDesignDeps & { notified: Array<[string, string]> } {
  const notified: Array<[string, string]> = [];
  return {
    fetchSelections: vi.fn(async () => [{ id: 's1', report_type: 'borrowing_capacity', template_id: TEMPLATE }]),
    fetchTemplateRow: vi.fn(async () => ROW),
    notify: (title, description) => { notified.push([title, description]); },
    notified,
    ...over,
  };
}

describe('the register of drawn documents', () => {
  it('names each document once', () => {
    const keys = DRAWN_DOCUMENTS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(9);
  });

  it("never lists a document drawn in somebody else's session, which cannot read the adviser's choice", () => {
    // The lender packet's cover sheet is drawn in the finance partner's portal.
    expect(DRAWN_DOCUMENTS.map((d) => d.key)).not.toContain('lender_packet_cover');
  });

  it('points every document at a report type the chooser offers, by its canonical key', () => {
    const offered = new Set(listReportFormats().map((f) => f.reportType));
    for (const d of DRAWN_DOCUMENTS) {
      expect(offered.has(d.designFrom), `${d.key} → ${d.designFrom}`).toBe(true);
      expect(normaliseReportType(d.designFrom)).toBe(d.designFrom);
    }
  });

  it('names documents in the words a person uses, never a key', () => {
    for (const d of DRAWN_DOCUMENTS) expect(d.label).not.toMatch(/_/);
  });

  it('answers which documents a report type dresses, under every spelling of it', () => {
    expect(drawnDocumentsWearing('borrowing').map((d) => d.key)).toEqual(['strategy_rationale']);
    expect(drawnDocumentsWearing('commercial_industrial').map((d) => d.key)).toContain('commercial_investment_report');
    expect(drawnDocumentsWearing('qa')).toEqual([]);
  });

  it('is said where the choice is made, in the documents\' own names', () => {
    expect(drawnDocumentsNote('borrowing')).toBe(
      'Also sets the design of the Strategy Rationale, which is drawn without a template of its own.',
    );
    expect(drawnDocumentsNote('commercial_industrial')).toBe(
      'Also sets the design of the Commercial Investment Report, Industrial Investment Report, '
      + 'Commercial 10-year cash flow and Commercial and Industrial intake pack, which are drawn '
      + 'without templates of their own.',
    );
    expect(drawnDocumentsNote('qa')).toBeNull();
    expect(drawnDocumentsNote('investment')).toBeNull();
  });

  it('refuses a document it does not know rather than guessing whose design it wears', () => {
    expect(() => drawnDocumentDesignSource('a_document_added_tomorrow' as never)).toThrow();
  });

  it('is read by every document it names — the picker promises each one the design', () => {
    // `drawnDocumentsNote` tells the person choosing a template that it "also
    // sets the design of" these documents. A register entry nothing asks for
    // makes that promise with nothing behind it, and an unused export
    // typechecks, lints and builds.
    const src = resolve(__dirname, '../../..');
    const sources = (readdirSync(src, { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file) && !/__tests__|\.(spec|test)\.tsx?$/.test(file))
      .map((file) => readFileSync(resolve(src, file), 'utf8'))
      .join('\n');
    const asked = new Set([...sources.matchAll(/drawnDesignFor\('([a-z_]+)'/g)].map((m) => m[1]));
    for (const d of DRAWN_DOCUMENTS) expect(asked.has(d.key), `${d.label} (${d.key}) is never asked for`).toBe(true);
  });
});

describe('which design a drawn document wears', () => {
  it("is the one chosen for the report type it is made from", async () => {
    const d = deps();
    const design = await drawnDesignFor('strategy_rationale', d);
    expect(design?.label).toBe('Private Banking — Chancery');
    expect(design?.family.source).toBe('design');
    expect(design?.family.field).toBe('#1B2130');
    expect(d.fetchTemplateRow).toHaveBeenCalledWith(TEMPLATE);
    expect(d.notified).toEqual([]);
  });

  it('is found under every spelling a choice was stored under', async () => {
    const d = deps({ fetchSelections: vi.fn(async () => [{ id: 's1', report_type: 'borrowing', template_id: TEMPLATE }]) });
    expect((await drawnDesignFor('strategy_rationale', d))?.label).toBe('Private Banking — Chancery');
  });

  it("is never another report type's choice", async () => {
    const d = deps({ fetchSelections: vi.fn(async () => [{ id: 's1', report_type: 'portfolio', template_id: TEMPLATE }]) });
    expect(await drawnDesignFor('strategy_rationale', d)).toBeNull();
    expect(d.fetchTemplateRow).not.toHaveBeenCalled();
  });
});

describe('the house design, said nothing about', () => {
  it('when nothing is chosen', async () => {
    const d = deps({ fetchSelections: vi.fn(async () => []) });
    expect(await drawnDesignFor('strategy_rationale', d)).toBeNull();
    expect(d.fetchTemplateRow).not.toHaveBeenCalled();
    expect(d.notified).toEqual([]);
  });

  it('when the choice cannot be read at all — a person with no templates, a read that failed', async () => {
    const d = deps({ fetchSelections: vi.fn(async () => { throw new Error('403'); }) });
    expect(await drawnDesignFor('strategy_rationale', d)).toBeNull();
    expect(d.notified).toEqual([]);
  });
});

describe('a choice that cannot be honoured is said out loud, and the document is still produced', () => {
  it('when the chosen template cannot be read, saying to try again rather than to choose another', async () => {
    const d = deps({ fetchTemplateRow: vi.fn(async () => { throw new Error('boom'); }) });
    expect(await drawnDesignFor('strategy_rationale', d)).toBeNull();
    expect(d.notified).toEqual([[DESIGN_NOT_USED_TITLE, DESIGN_REFUSAL_TEXT.template_unreadable]]);
  });

  it('when it is not the person\'s to use', async () => {
    const d = deps({ fetchTemplateRow: vi.fn(async () => null) });
    expect(await drawnDesignFor('strategy_rationale', d)).toBeNull();
    expect(d.notified).toEqual([[DESIGN_NOT_USED_TITLE, DESIGN_REFUSAL_TEXT.template_unavailable]]);
  });

  it('when the chooser would not offer it for the report type — retired, a draft, or another format', async () => {
    for (const row of [
      { ...ROW, is_active: false },
      { ...ROW, is_draft: true },
      { ...ROW, report_type: 'portfolio' },
    ]) {
      const d = deps({ fetchTemplateRow: vi.fn(async () => row) });
      expect(await drawnDesignFor('strategy_rationale', d)).toBeNull();
      expect(d.notified).toEqual([[DESIGN_NOT_USED_TITLE, DESIGN_REFUSAL_TEXT.template_unavailable]]);
    }
  });

  it('when its colours cannot be printed', async () => {
    const d = deps({ fetchTemplateRow: vi.fn(async () => ({ ...ROW, tokens: { colors: { surface: '#FFFFFF' } } })) });
    expect(await drawnDesignFor('strategy_rationale', d)).toBeNull();
    expect(d.notified).toEqual([[DESIGN_NOT_USED_TITLE, DESIGN_REFUSAL_TEXT.palette_incomplete]]);
  });
});

describe('the read', () => {
  it("asks for exactly the columns the render routes read a design from — its tokens and lineage, never its pages", () => {
    const server = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/_shared/reports/templateDesignRead.ts'),
      'utf8',
    );
    const match = /const TEMPLATE_DESIGN_COLUMNS =\s*'([^']*)'\s*\+\s*'([^']*)';/.exec(server);
    expect(match).not.toBeNull();
    const columns = (list: string) => list.split(',').map((c) => c.trim()).filter(Boolean).sort();
    expect(columns(DRAWN_DESIGN_COLUMNS)).toEqual(columns(match![1] + match![2]));
    expect(DRAWN_DESIGN_COLUMNS).not.toMatch(/(^|,)\s*(schema|config)\s*(,|$)/);
  });

  it('never throws, whatever goes wrong', async () => {
    const d = deps({
      fetchSelections: vi.fn(async () => [{ id: 's1', report_type: 'borrowing_capacity', template_id: TEMPLATE }]),
      fetchTemplateRow: vi.fn(async () => ({ ...ROW, tokens: 'not an object' as never })),
    });
    await expect(drawnDesignFor('strategy_rationale', d)).resolves.toBeNull();
  });
});

describe('what a drawn document prints', () => {
  it('the Client Property Analysis never invents an analysis when the reply cannot be read', () => {
    // It used to print a score and a grade computed from the yield, stock
    // strengths and risks, and a ten-year projection at 5% as the model's
    // assessment of the property. A reply that cannot be read now fails.
    const source = readFileSync(
      resolve(__dirname, '../../../components/clients/PropertyReportGenerator.tsx'),
      'utf8',
    );
    const onParseFailure = source.slice(source.indexOf('} catch (parseError) {'), source.indexOf('setReportData({'));
    expect(onParseFailure).toContain("throw new Error('the analysis could not be read. Try again.');");
    expect(onParseFailure).not.toMatch(/analysis\s*=|investmentScore:|investmentGrade:|strengths:|tenYearProjection:/);
  });
});
