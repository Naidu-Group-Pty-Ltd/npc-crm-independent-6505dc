/**
 * Agreement Centre — additional clauses (special conditions).
 *
 * ## Why this exists
 *
 * `contentOverrides.pure.ts` lets a party AMEND wording the template already
 * carries. It cannot help when the negotiation needs something the template has
 * no slot for at all — a retention arrangement, a carve-out, a named exclusivity
 * period. Until now that meant leaving the product, which is exactly how a legal
 * instrument ends up assembled in Word and diverging from the register.
 *
 * So an agreement may carry its own **additional clauses**: free-authored,
 * numbered `S1`, `S2`, … and printed as their own section immediately before
 * EXECUTION, where a special-conditions annexure belongs. They are:
 *
 *  - stored with the agreement's field values (`ADDITIONAL_CLAUSES_VALUE_KEY`),
 *    so the version row's frozen `field_values` freezes them with everything
 *    else — a re-download of an executed version cannot lose them or acquire
 *    later ones;
 *  - injected by the one shared transform every renderer already goes through
 *    (`agreementContentForValues`), so the digital view, the WeasyPrint PDF and
 *    the DOCX print the identical text without any renderer knowing about them;
 *  - never written into the template modules, so `templateContentHash` still
 *    answers "which supplied wording did this build ship".
 *
 * Text is carried VERBATIM. Nothing here rewrites, reflows, sentence-cases or
 * appends to what a person typed; the only transformations are (a) trimming the
 * outer whitespace of the whole block and (b) splitting on blank lines to number
 * paragraphs. A paragraph's characters are never altered.
 *
 * PURE. Shared verbatim by the edge functions and the browser bridge.
 */

import type {
  AgreementSectionDef,
  AgreementTemplateContent,
} from './types.pure.ts';

/** Reserved key inside `AgreementFieldValues` carrying the clause list. */
export const ADDITIONAL_CLAUSES_VALUE_KEY = '__additional_clauses';

/** `schedule_extras` key the list is stored under on `partner_agreements`. */
export const ADDITIONAL_CLAUSES_EXTRA_KEY = 'additional_clauses';

/** The id of the injected section — anchor, jump link, validation target. */
export const ADDITIONAL_CLAUSES_SECTION_ID = 'additional_terms';

export interface AgreementAdditionalClause {
  /** Stable id so reordering/editing cannot re-key another clause. */
  id: string;
  /** Optional heading; the number is supplied by the renderer. */
  heading: string;
  /** The clause body. Blank lines separate numbered paragraphs. */
  text: string;
}

/** Read an unknown store into a clean, ordered clause list. */
export function coerceAdditionalClauses(raw: unknown): AgreementAdditionalClause[] {
  if (!Array.isArray(raw)) return [];
  const out: AgreementAdditionalClause[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const record = entry as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (!text) return; // an empty special condition is not a clause
    const heading = typeof record.heading === 'string' ? record.heading.trim() : '';
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `ac-${index + 1}`;
    out.push({ id, heading, text });
  });
  return out;
}

/** The additional clauses carried by a set of field values. */
export function additionalClausesFromValues(
  values: Record<string, unknown> | null | undefined,
): AgreementAdditionalClause[] {
  return coerceAdditionalClauses(values?.[ADDITIONAL_CLAUSES_VALUE_KEY]);
}

/** Paragraphs of one clause — blank-line separated, characters untouched. */
export function additionalClauseParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}

/**
 * The section a clause list prints as. Exported so a caller can preview the
 * numbering without building a whole document.
 */
export function additionalClausesSection(
  clauses: readonly AgreementAdditionalClause[],
): AgreementSectionDef {
  return {
    id: ADDITIONAL_CLAUSES_SECTION_ID,
    audience: 'always',
    header: {
      badge: 'S',
      heading: 'Additional Terms',
      hint: 'Special conditions agreed by the parties',
      sub: 'These conditions form part of this Agreement and prevail over any inconsistent clause above',
    },
    blocks: [
      {
        kind: 'clauses',
        clauses: clauses.map((clause, index) => {
          const number = `S${index + 1}`;
          const paragraphs = additionalClauseParagraphs(clause.text);
          return {
            number,
            heading: clause.heading || 'Special Condition',
            subclauses: paragraphs.map((paragraph, p) => ({
              number: paragraphs.length === 1 ? number : `${number}.${p + 1}`,
              text: paragraph,
            })),
          };
        }),
      },
    ],
  };
}

/**
 * Insert the additional-terms section immediately before EXECUTION (or at the
 * end when a template has no execution section). Empty list → the content is
 * returned untouched and referentially identical.
 */
export function withAdditionalClauses(
  content: AgreementTemplateContent,
  clauses: readonly AgreementAdditionalClause[] | null | undefined,
): AgreementTemplateContent {
  if (!clauses || clauses.length === 0) return content;
  const section = additionalClausesSection(clauses);
  const at = content.sections.findIndex((existing) => existing.id === 'execution');
  const sections = [...content.sections];
  if (at < 0) sections.push(section); else sections.splice(at, 0, section);
  return { ...content, sections };
}
