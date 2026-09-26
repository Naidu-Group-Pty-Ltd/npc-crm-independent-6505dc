/**
 * The contact block a formatted property comparison closes on.
 *
 * `format-comparison-report` asks a model to write the report and tells it,
 * word for word, which contact details to finish on. Those details were the
 * prime's own — its name placeholder, its phone, its mailbox and its website —
 * written into the prompt, so every clone's comparison closed by sending the
 * clone's client to the house. The owner's rule (26 Sep 2026): the house's
 * identity is the prime's alone, and "everything from a white labeling
 * component" is the clone's.
 *
 * So the prime keeps the block exactly as it was, byte for byte, and a clone
 * gets its own: the issuer the one resolver answers (`issuerIdentity.pure.ts`)
 * and the contact values the clone stored, never one that names the house.
 * Where a clone has named nobody and stored nothing, there is nobody to
 * contact, and the report is told to close without the section rather than
 * invent one.
 */
import {
  issuerContactDetails,
  resolveReportIssuer,
  type IssuerDeployment,
} from './issuerIdentity.pure.ts';

/** The prime's closing block, verbatim as the prompt has always carried it. */
export const PRIME_COMPARISON_CONTACT_SECTION = `## MANDATORY CLOSING SECTION:

### Contact Information
**Property Consulting**
- **Phone:** 0433 005 110
- **Email:** admin@npcservices.com.au
- **Website:** npcservices.com.au`;

export interface ComparisonContactInput {
  /** `global_report_settings.contact_details`. */
  contact?: Record<string, unknown> | null;
  /** `whitelabel_settings.company_name`. */
  brandName?: unknown;
}

const clean = (value: unknown): string =>
  (typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim() : '');

/** The closing block this deployment's comparison report is told to write. */
export function comparisonContactSection(
  input: ComparisonContactInput,
  deployment: IssuerDeployment,
): string {
  if (deployment.prime) return PRIME_COMPARISON_CONTACT_SECTION;
  const issuer = resolveReportIssuer(
    { companyName: input.contact?.company_name, brandName: input.brandName },
    deployment,
  );
  const own = issuerContactDetails(input.contact ?? {}, issuer, deployment) as Record<string, unknown>;
  const rows = ([['Phone', own.phone], ['Email', own.email], ['Website', own.website]] as const)
    .map(([label, value]) => [label, clean(value)] as const)
    .filter(([, value]) => value !== '')
    .map(([label, value]) => `- **${label}:** ${value}`);
  if (issuer.kind === 'platform' && rows.length === 0) {
    return `## CLOSING SECTION:

Do NOT include a contact information section. No contact details are held for this report.`;
  }
  return [
    '## MANDATORY CLOSING SECTION:',
    '',
    '### Contact Information',
    `**${clean(issuer.name)}**`,
    ...rows,
  ].join('\n');
}
