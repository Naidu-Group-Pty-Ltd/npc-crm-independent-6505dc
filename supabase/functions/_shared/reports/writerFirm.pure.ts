/**
 * Which business the report writer is told it works for.
 *
 * ## The defect
 *
 * Every report writer opens its prompt with a persona — "You are an expert
 * Australian property investment analyst for <company>", "a trusted property
 * investment advisor at <company>" — and every one took <company> from Report
 * Settings (`getBrandConfig`). On the prime that is NPC's own name, and it is
 * right. On a clone it was whatever that row held. A row seeded from the
 * prime's still says Naidu Property Consulting Services, so a clone's report
 * was written by a model told it worked for another business. Market
 * Intelligence then printed that business's name in the document itself: a
 * heading "How <company> Would Approach This" and a call to action. A clone
 * that had named nobody got the placeholder "Property Consulting".
 *
 * ## The rule
 *
 * The writer works for the business the document is issued under
 * (`resolveReportIssuer`), so the prose and the cover cannot name two
 * businesses.
 *
 *  - **On the prime nothing changes.** The writer is told exactly the name it
 *    was always told, and nothing new is read.
 *  - **On a clone the writer works for the clone's own business**: its report
 *    contact name, then its Branding page name. Never the house, whatever a
 *    row says.
 *  - **Where a clone has named nobody, the writer works for no business.** The
 *    document is then issued under the platform, and the platform is not an
 *    adviser: the disclaimer printed on that document says the analysis was
 *    not prepared by Aurixa Systems and that Aurixa Systems is not a buyer's
 *    agent. A persona "advisor at Aurixa Systems" would have the prose say the
 *    opposite of the page it is printed on. So `firm` is `null`, and every
 *    persona drops its "for <company>" clause instead of naming anybody.
 */

import {
  resolveReportIssuer,
  type IssuerDeployment,
  type IssuerInput,
} from './issuerIdentity.pure.ts';

export interface ReportWriterIdentity {
  deployment: IssuerDeployment;
  /**
   * The business the writer works for, as the prompts name it. `null` only on
   * a clone whose documents are issued under the platform, where the writer
   * speaks for no business. Never null on the prime.
   */
  firm: string | null;
  /** The name the document is issued under: what the masthead prints. */
  issuerName: string;
}

/**
 * The writer's identity on this deployment.
 *
 * `companyName` is Report Settings' company name as `getBrandConfig` answers
 * it (a placeholder where the row is empty); `brandName` is the Branding
 * page's, read on a clone alone.
 */
export function reportWriterIdentity(
  input: IssuerInput,
  deployment: IssuerDeployment,
): ReportWriterIdentity {
  if (deployment.prime) {
    // The name the prime's writers have always been given, exactly as given.
    const name = typeof input.companyName === 'string' ? input.companyName : '';
    return { deployment, firm: name, issuerName: name };
  }
  const issuer = resolveReportIssuer(input, deployment);
  return {
    deployment,
    firm: issuer.kind === 'workspace' ? issuer.name : null,
    issuerName: issuer.name,
  };
}

/**
 * ` for <firm>` or ` at <firm>` — or nothing, where the writer works for no
 * business. On the prime this is the clause every persona already carried.
 */
export function firmClause(firm: string | null, preposition: 'for' | 'at'): string {
  return firm === null ? '' : ` ${preposition} ${firm}`;
}

/** `a` or `an`, for the word that follows. */
export function indefiniteArticle(nextWord: string): 'a' | 'an' {
  return /^[aeiou]/i.test(nextWord.trim()) ? 'an' : 'a';
}

const TOKEN = String.raw`\{\{brand_name\}\}`;

/**
 * A sentence whose subject is the firm — "{{brand_name}} is a strategic
 * property advisory that operates above the noise … ." It says who the writer
 * works for, and says nothing once there is nobody.
 */
const FIRM_SENTENCE = new RegExp(
  String.raw`(^|[.!?]\s+)${TOKEN}(?:'s)?\s[^.!?\n]*[.!?](?=\s|$)[ \t]*`,
  'gm',
);

/**
 * The firm as the object of a preposition, with the appositive describing it:
 * " for {{brand_name}}", " at {{brand_name}}", " for {{brand_name}}, a
 * strategic property advisory". The clause goes and the sentence closes over
 * it: "writing premium client reports. Produce …".
 */
const FIRM_PHRASE = new RegExp(
  String.raw`\s(?:for|at|with|from|by|of)\s${TOKEN}`
  + String.raw`(?:,\s+an?\s+[^,.;:\n]*?\b(?:advisory(?:\s+(?:firm|company|practice|business))?|firm|practice|consultancy|company|business)\b)?`,
  'g',
);

/** The firm as a modifier after an article: "an {{brand_name}} Market Intelligence Report". */
const FIRM_MODIFIER = new RegExp(String.raw`\b([Aa])n?\s+${TOKEN}\s+(?=(\S+))`, 'g');

/** The firm's possessive: "{{brand_name}}'s tone". */
const FIRM_POSSESSIVE = new RegExp(String.raw`${TOKEN}'s\b`, 'g');

const FIRM_TOKEN = new RegExp(TOKEN, 'g');

/**
 * A prompt template with the firm taken out of it, for a writer that works for
 * no business.
 *
 * The built-in templates name the firm in four ways, and each is taken out the
 * way the sentence can lose it: a sentence about the firm goes whole, a "for
 * <firm>" clause goes with its appositive, an "an <firm> Report" becomes "a
 * Report", and a possessive names the business generically. Anything else — a
 * superadmin's own override written some other way — is filled with a phrase
 * that names nobody, never with a name.
 */
export function withoutFirmToken(template: string): string {
  return template
    .replace(FIRM_SENTENCE, (_m, lead: string) => lead)
    .replace(FIRM_PHRASE, '')
    .replace(FIRM_MODIFIER, (_m, a: string, next: string) => {
      const article = indefiniteArticle(next);
      return `${a === 'A' ? article.charAt(0).toUpperCase() + article.slice(1) : article} `;
    })
    .replace(FIRM_POSSESSIVE, "the business's")
    .replace(FIRM_TOKEN, 'the business providing this report');
}

/**
 * A template's `{{brand_name}}` filled for this writer: with the firm's name
 * exactly as before, or taken out where the writer works for no business.
 */
export function fillFirmToken(template: string, firm: string | null): string {
  return firm === null ? withoutFirmToken(template) : template.replace(FIRM_TOKEN, firm);
}
