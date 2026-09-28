/**
 * Which report types may be drawn through a template's own pages, and what a
 * chosen template does for the rest (`templateParity.pure.ts`).
 *
 * The owner's rule (26 Sep 2026): a template changes how a document looks and
 * nothing else. On 26 Sep 2026 none of the nine non-Investment report types
 * carried the same information through a template's pages as through its
 * standard document, so each keeps its own pages and wears the chosen
 * template as its DESIGN (`standardDesign.ts`). This file holds the register
 * to three things:
 *
 *   - **Only Investment is released today**, and a report type joins only by
 *     editing the one register, never by a surface deciding for itself.
 *   - **Every format the chooser offers is accounted for**: released, or held
 *     and drawn in the chosen design. A format added to the adapter registry
 *     is held until it is released, because the register fails closed.
 *   - **The words are plain**: what a choice does — the report's own pages, in
 *     the chosen typefaces, colours, cover and table style. No internal term
 *     reaches the person.
 */
import { describe, expect, it } from 'vitest';
import {
  isTemplateDeliveryHeld,
  TEMPLATE_DESIGN_NOTICE,
  TEMPLATE_RELEASED_REPORT_TYPES,
  templateDesignExplanation,
} from '../../../../supabase/functions/_shared/reports/templateParity.pure';
import { normaliseReportType } from '../../../../supabase/functions/_shared/reports/reportTemplateSelection.pure';
import { listReportFormats } from '../reportFormats';

describe('the release register', () => {
  it('releases the Investment tiers and nothing else, today', () => {
    expect([...TEMPLATE_RELEASED_REPORT_TYPES]).toEqual(['investment']);
  });

  it('names report types by their canonical key only', () => {
    for (const key of TEMPLATE_RELEASED_REPORT_TYPES) expect(normaliseReportType(key)).toBe(key);
  });

  it('releases Investment under every spelling it is stored under', () => {
    for (const alias of ['investment', 'investment_compass', 'compass', 'investment_report', 'property_investment', 'INVESTMENT']) {
      expect(isTemplateDeliveryHeld(alias), alias).toBe(false);
    }
  });

  it('holds every other format the chooser offers, under every spelling', () => {
    const offered = listReportFormats().map((f) => f.reportType);
    expect(offered).toContain('investment');
    for (const type of offered.filter((t) => t !== 'investment')) {
      expect(isTemplateDeliveryHeld(type), type).toBe(true);
    }
    for (const alias of ['cash_flow', 'formara', 'clientdetails', 'commercial_industrial', 'borrowing']) {
      expect(isTemplateDeliveryHeld(alias), alias).toBe(true);
    }
  });

  it('fails closed: a spelling it does not know is held, not released', () => {
    for (const unknown of ['', null, undefined, 'a_format_added_tomorrow']) {
      expect(isTemplateDeliveryHeld(unknown), String(unknown)).toBe(true);
    }
  });
});

describe('what a person is told', () => {
  const words = [
    TEMPLATE_DESIGN_NOTICE.title,
    TEMPLATE_DESIGN_NOTICE.description,
    templateDesignExplanation('Portfolio Performance Review'),
  ];

  it('says what a choice does: the report\'s own pages, in the chosen design', () => {
    expect(TEMPLATE_DESIGN_NOTICE.title).toMatch(/design/);
    // The promise that matters to the reader: nothing the standard document
    // prints is lost, whichever design is chosen.
    expect(TEMPLATE_DESIGN_NOTICE.description).toMatch(/every figure the standard document carries/);
    expect(TEMPLATE_DESIGN_NOTICE.description).toMatch(/typefaces.*colours.*cover/);
    expect(templateDesignExplanation('Portfolio Performance Review'))
      .toMatch(/^Portfolio Performance Review reports keep their own pages/);
    // And where it does not reach: the legacy layouts are drawn as they were.
    expect(templateDesignExplanation('Portfolio Performance Review'))
      .toMatch(/"legacy layout" is drawn as it always was, without the design\.$/);
  });

  it('never says a choice is waiting, held back or not applied — it is applied', () => {
    for (const text of words) {
      expect(text).not.toMatch(/for now|on hold|applies as soon as|standard layout/i);
    }
  });

  it('speaks the reader\'s language, not the system\'s', () => {
    for (const text of words) {
      expect(text).not.toMatch(/parity|register|adapter|binding|master|schema|held\b|_/i);
    }
  });
});
