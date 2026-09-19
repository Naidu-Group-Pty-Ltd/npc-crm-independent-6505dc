/**
 * Partner agreement TEMPLATES — one import surface.
 *
 * ## What this used to be
 *
 * This module was the entry point to a full contract lifecycle: a state
 * machine, partner portal access rules, issuance recipients, clause
 * annotations, document revisions, a cross-portal sync cursor and a delivery
 * receipt model. All of it existed to run the formation of an agreement
 * between two independent businesses *through the platform*.
 *
 * That has been retired — see `templateResource.pure.ts` for why. What remains
 * is the part that was always legitimate: the two locked templates, and enough
 * machinery to render a blank one as a document somebody can take away.
 *
 * Everything here is pure and browser-safe; the browser reaches it through the
 * `src/lib/agreements/` bridge re-export.
 */

import { FINANCE_REFERRAL_CONTENT } from './contentFinanceReferral.pure.ts';
import { STRATEGIC_REFERRAL_CONTENT } from './contentStrategicReferral.pure.ts';
import {
  applyAgreementContentOverrides,
  contentOverridesFromValues,
} from './contentOverrides.pure.ts';
import {
  additionalClausesFromValues,
  withAdditionalClauses,
} from './additionalClauses.pure.ts';
import type { AgreementTemplateContent, AgreementTemplateKey } from './types.pure.ts';

export * from './types.pure.ts';
export * from './fields.pure.ts';
export * from './contentOverrides.pure.ts';
export * from './additionalClauses.pure.ts';
export { STRATEGIC_REFERRAL_CONTENT } from './contentStrategicReferral.pure.ts';
export { FINANCE_REFERRAL_CONTENT } from './contentFinanceReferral.pure.ts';

/**
 * The platform's position: these are optional resources and nothing more.
 * Every surface that offers a template renders its wording from here, so the
 * Command Centre and the Finance Portal cannot say different things about what
 * downloading one means.
 */
export * from './templateResource.pure.ts';

/**
 * Which file each template IS. The platform ships the document its author
 * maintains rather than drawing its own — see `templateFiles.pure.ts`.
 */
export * from './templateFiles.pure.ts';

export function agreementTemplate(key: AgreementTemplateKey): AgreementTemplateContent {
  return key === 'strategic_property_referral' ? STRATEGIC_REFERRAL_CONTENT : FINANCE_REFERRAL_CONTENT;
}

/**
 * A template with any locally supplied values applied.
 *
 * Left over from the retired workflow, where a negotiated amendment was
 * applied to the locked template before it was rendered. Nothing renders a
 * template any more — the download is the document its author supplied — so
 * this has no production caller. It is kept because the amendment model
 * (`contentOverrides.pure.ts`, `additionalClauses.pure.ts`) is the part of the
 * retirement that would be hardest to reconstruct, and because deleting it is
 * a separate decision from integrating a document.
 */
export function agreementContentForValues(
  key: AgreementTemplateKey,
  values: Record<string, unknown> | null | undefined,
): AgreementTemplateContent {
  return withAdditionalClauses(
    applyAgreementContentOverrides(
      agreementTemplate(key),
      contentOverridesFromValues(values),
    ),
    additionalClausesFromValues(values),
  );
}

export const AGREEMENT_TEMPLATE_SUMMARIES: readonly {
  key: AgreementTemplateKey;
  title: string;
  issuedByLine: string;
  /** The relationship arrow, for the template card. */
  from: string;
  to: string;
  /** Who the referred clients flow from/to — makes direction unmistakable. */
  referralFlow: string;
}[] = [
  {
    key: 'strategic_property_referral',
    title: STRATEGIC_REFERRAL_CONTENT.title,
    issuedByLine: STRATEGIC_REFERRAL_CONTENT.issuedByLine,
    from: 'FINANCE PARTNER',
    to: 'BUYER\'S AGENCY / REAL ESTATE AGENCY',
    referralFlow: 'The finance partner refers clients to the buyer\'s agency / real estate agency for property services.',
  },
  {
    key: 'finance_referral_commission',
    title: FINANCE_REFERRAL_CONTENT.title,
    issuedByLine: FINANCE_REFERRAL_CONTENT.issuedByLine,
    from: 'BUYER\'S AGENCY / REAL ESTATE AGENCY',
    to: 'FINANCE PARTNER',
    referralFlow: 'The buyer\'s agency / real estate agency refers clients to the finance partner for credit services.',
  },
];

// ── What is inside a template, for the desk ──────────────────────────────────

/**
 * Headings are stored in the upper case the document once set them in; the
 * document its author now maintains sets them in sentence case, and a card
 * full of shouting reads as a warning rather than a contents list.
 *
 * Deliberately dumb: lower-case everything, capitalise the first letter, and
 * restore the handful of initialisms that are genuinely upper case. No
 * heuristics — `agreementTemplateContents.spec` checks every heading of both
 * templates against this, so a new section with a new initialism fails a test
 * rather than printing "Gst and rctis".
 */
const HEADING_INITIALISMS = ['ABN', 'ACL', 'ACN', 'AML', 'CTF', 'GST', 'RCTI', 'RCTIs', 'PEP'];

export function agreementHeadingCase(heading: string): string {
  const lowered = heading.toLocaleLowerCase('en-AU');
  const sentence = lowered.charAt(0).toLocaleUpperCase('en-AU') + lowered.slice(1);
  return HEADING_INITIALISMS.reduce(
    (text, word) => text.replace(new RegExp(`\\b${word}\\b`, 'gi'), word),
    sentence,
  );
}

export interface AgreementTemplateContentsEntry {
  /** The document's own section marker — `E`, `1`, `2A`, `4-6`, `A`, `B5`. */
  badge: string;
  heading: string;
  /** The header's second line, describing what the section covers. */
  detail: string | null;
  /** True for the pages the template itself says to remove before issue. */
  guidance: boolean;
}

/**
 * The template's sections, in document order.
 *
 * Read from the same locked modules that
 * `agreementTemplateFiles.spec.ts` checks the shipped document against, so
 * the desk cannot list a section the file people download does not contain.
 * The cover carries no header and is skipped — nobody needs "Cover" in a
 * contents list.
 */
export function agreementTemplateContents(
  key: AgreementTemplateKey,
): AgreementTemplateContentsEntry[] {
  return agreementTemplate(key).sections
    .filter((section) => section.header !== null)
    .map((section) => ({
      badge: section.header!.badge,
      heading: agreementHeadingCase(section.header!.heading),
      detail: section.header!.sub ?? section.header!.hint ?? null,
      guidance: section.audience === 'template_pack',
    }));
}
