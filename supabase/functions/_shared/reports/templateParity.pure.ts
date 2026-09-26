/**
 * Which report types may be drawn through a template's own pages today, and
 * what a template does for the rest.
 *
 * ## The owner's rule
 *
 * A template changes how a document LOOKS and nothing else. For every report
 * type other than the five Investment tiers, the information a document
 * carries must be exactly the information the report's standard document
 * carries, whatever template was chosen (owner, 26 Sep 2026).
 *
 * ## Why nine of the ten never reach a template's pages
 *
 * On 26 Sep 2026 each non-Investment report type's standard document and its
 * template document were rendered from the same real record, on all 50
 * masters, and what each printed was compared. None of the nine carried the
 * same information. Three examples, each verified in code:
 *
 *   - Report Q&A printed the conversation's FIRST answer whichever answer was
 *     chosen, and its transcript carried the first answer alone.
 *   - The 10 Year Cash Flow printed after-tax figures beneath a master that
 *     says "No tax position is modelled".
 *   - Client Details never printed the primary contact's email or mobile.
 *
 * `docs/reports/TEMPLATE_PARITY.md` lists every difference found. A master's
 * page sequence is a second statement of what a report says, and two
 * statements drift.
 *
 * ## What a template does for a held report type
 *
 * It supplies the DESIGN, and the report's own route draws every page in it:
 * the chosen template's typefaces, colourway, cover ground, and how tables and
 * section headings are ruled (`templateDesign.pure.ts`, asked for by
 * `standardDesign.ts`). The information is the standard document's by
 * construction, and `templateDesignParity.spec.ts` proves it for every report
 * type and every design. So "held" means held from a template's PAGES — never
 * from the person's choice, which is honoured on every document.
 *
 * ## Released means proven
 *
 * A report type joins `TEMPLATE_RELEASED_REPORT_TYPES` only once its parity
 * check passes in CI: the standard document's content, found in the template
 * document's, for the same record, on every master. Investment is released
 * because the owner's rule sets its tiers apart. Their template path is the
 * one the report was built for, and its content is governed by
 * `tierContent.pure.ts` and `audienceContent.pure.ts`.
 *
 * One register, read by the one function every delivery path calls
 * (`tryTemplateDocument`) and the one that asks a route for a design
 * (`standardDesignFor`), so no surface can release a report type by itself.
 */
import { normaliseReportType } from './reportTemplateSelection.pure.ts';

/**
 * Report types whose template path is released. Canonical keys only — every
 * spelling is normalised before it is looked up.
 */
export const TEMPLATE_RELEASED_REPORT_TYPES: readonly string[] = Object.freeze(['investment']);

/**
 * Whether a report type is drawn by its own route, in the chosen template's
 * design, rather than through a template's own pages.
 *
 * Anything not released is held, an empty or unrecognised type included: a
 * register that answers "not held" for a spelling it does not know is one
 * that a new alias releases by accident. Only a released report type ever
 * reaches a template's pages.
 */
export function isTemplateDeliveryHeld(reportType?: string | null): boolean {
  return !TEMPLATE_RELEASED_REPORT_TYPES.includes(normaliseReportType(reportType));
}

/** What the chooser says about a held report type, before anything is chosen. */
export const TEMPLATE_DESIGN_NOTICE = Object.freeze({
  title: 'Your template sets this report’s design',
  description:
    'The pages and everything printed on them are this report’s own, so every figure the '
    + 'standard document carries is in it. The template you choose sets the typefaces, the '
    + 'colours, the cover and how tables and headings are ruled.',
});

/** The same, for the chooser, where the report type is named. */
export function templateDesignExplanation(formatLabel: string): string {
  // The second sentence is said because several of these report types still
  // offer a "(legacy layout)" download beside their own, and that one is drawn
  // as it always was: a choice that quietly does not reach a document is one
  // the person did not knowingly make.
  return `${formatLabel} reports keep their own pages, with everything the standard document `
    + 'prints, and take their design from the template you choose: its typefaces, colours, '
    + 'cover and table style. A download marked "legacy layout" is drawn as it always was, '
    + 'without the design.';
}
