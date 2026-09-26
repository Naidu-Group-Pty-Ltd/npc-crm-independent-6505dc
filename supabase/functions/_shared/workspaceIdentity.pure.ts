/**
 * Which business a deployment's own tools speak for: its AI assistants, and
 * the few labels the product itself puts in front of a client, a partner or a
 * member of staff.
 *
 * ## The defect
 *
 * The report writers were moved onto the deployment's identity in #2778
 * (`reports/writerFirm.pure.ts`). Nothing else that speaks was:
 *
 *  - The email copilot's seven prompts, the dashboard assistant and the user
 *    guide took the company name from Report Settings. A clone whose row still
 *    holds NPC's name drafted replies signed "Naidu Property Consulting
 *    Services Team".
 *  - Market Updates Q&A and the finance portal's copilot named NPC in their
 *    personas, as a literal, on every deployment.
 *  - On every clone, the solicitor portal told a solicitor to "Contact NPC to
 *    reopen it", a Command Centre message with no sender was signed "NPC
 *    Command Centre", a finance partner's ping was headed "[NPC ping — …]",
 *    the conversation export named "NPC Services" as its author, and every
 *    authenticator app listed a clone's staff under "NPC Property Dashboard".
 *
 * ## The rule
 *
 *  - **On the prime nothing changes.** Each site keeps the words it always
 *    had: Report Settings' name where it read one, its literal where it had
 *    one. A site that printed a literal reads nothing new.
 *  - **On a clone the business is the clone's own.** That is its Report
 *    Settings name, then its Branding page name, then the name Mission Control
 *    provisioned it under (`MISSION_CONTROL_AGENCY_NAME`). It is the order a
 *    clone's email already follows (`emailIdentity.pure.ts`). A placeholder is
 *    not a name, and the house's name is never the clone's, whichever row
 *    holds it (`isHouseTradingName`).
 *  - **Where a clone names nobody, nobody is named.** Not NPC, not the
 *    generic "Property Consulting" brand-config falls back to, and not Aurixa:
 *    the platform is not the business these tools work for. Every sentence
 *    below is written to read whole without a name.
 *
 * ## Why the provisioned name counts here and not on a document
 *
 * A document with nothing named is issued under the platform (the owner's
 * decision; `reports/issuerIdentity.pure.ts`). Its writer follows its issuer,
 * so the prose and the cover cannot disagree. A drafted email, an assistant
 * and a portal label are not documents. They belong to the workspace, and the
 * workspace's provisioned name is the one its mail is already sent under.
 *
 * Pure: no Deno, no network. `workspaceIdentity.ts` reads the settings and the
 * environment and hands the facts to `resolveWorkspaceIdentity`.
 */

import {
  isHouseTradingName,
  isNonIdentity,
  type IssuerDeployment,
} from './reports/issuerIdentity.pure.ts';

export interface WorkspaceIdentityInput {
  /** Report Settings' company name, as `getBrandConfig()` answers it (a placeholder where the row is empty). */
  companyName?: unknown;
  /** The Branding page's name (`whitelabel_settings.company_name`). Read on a clone alone. */
  brandName?: unknown;
  /** `MISSION_CONTROL_AGENCY_NAME`: the name Mission Control provisioned the workspace under. Read on a clone alone. */
  workspaceName?: unknown;
}

export interface WorkspaceIdentity {
  deployment: IssuerDeployment;
  /**
   * The business this deployment's tools speak for.
   *
   *  - Prime: what the site read before this module existed (Report Settings'
   *    name, exactly as read), or null where the site never read one. A prime
   *    site that printed a literal keeps its literal and reads nothing.
   *  - Clone: its own business, or null where it names none.
   */
  firm: string | null;
}

/** A configured name with its whitespace folded, or null where it is not a name. */
function nameOf(value: unknown): string | null {
  if (isNonIdentity(value)) return null;
  const name = String(value).replace(/\s+/g, ' ').trim();
  return isNonIdentity(name) ? null : name;
}

/**
 * The business this deployment's tools speak for. See the header.
 *
 * On the prime `companyName` is passed through exactly as given, placeholder
 * and all, because that is what the prime's sites have always said.
 */
export function resolveWorkspaceIdentity(
  input: WorkspaceIdentityInput,
  deployment: IssuerDeployment,
): WorkspaceIdentity {
  if (deployment.prime) {
    return { deployment, firm: typeof input.companyName === 'string' ? input.companyName : null };
  }
  for (const candidate of [input.companyName, input.brandName, input.workspaceName]) {
    const name = nameOf(candidate);
    if (name === null || isHouseTradingName(name)) continue;
    return { deployment, firm: name };
  }
  return { deployment, firm: null };
}

// ── Phrases: each reads whole with a name and without one ──────────────────

/** "<firm>, <description>", or "<description>" where nobody is named. For "an assistant for …". */
export function firmDescribed(firm: string | null, description: string): string {
  return firm === null ? description : `${firm}, ${description}`;
}

/** " <lead> <firm>" (" for Acme", " at Acme", " used by Acme"), or nothing. */
export function firmPhrase(firm: string | null, lead: string): string {
  return firm === null ? '' : ` ${lead} ${firm}`;
}

/** "<firm> " before a noun ("the Acme Property Dashboard"), or nothing. */
export function firmModifier(firm: string | null): string {
  return firm === null ? '' : `${firm} `;
}

/** A name's possessive: "Acme Realty's", "Acme Services'". */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

// ── The email copilot ─────────────────────────────────────────────────────

/**
 * Whose tone a drafted reply matches.
 *
 * The prime's prompt has always read "Match <name>' professional, courteous
 * tone", and it still does. A clone's name takes its proper possessive.
 */
export function copilotToneOwner(identity: WorkspaceIdentity): string {
  if (identity.deployment.prime) return `${identity.firm ?? ''}'`;
  return identity.firm === null ? "the business's" : possessive(identity.firm);
}

/** "<firm>'s outbound emails", as the prime has always written it, or "outbound emails". */
export function copilotOutboundEmails(identity: WorkspaceIdentity): string {
  if (identity.deployment.prime) return `${identity.firm ?? ''}'s outbound emails`;
  return identity.firm === null ? 'outbound emails' : `${possessive(identity.firm)} outbound emails`;
}

/**
 * How a drafted reply signs off. Where nobody is named the model is told not
 * to invent a business: left to itself it signs as whatever business it
 * thinks the email is about.
 */
export function copilotSignOff(firm: string | null): string {
  return firm === null
    ? 'Close with a courteous sign-off, and do not invent a company or team name'
    : `Sign off as "${firm} Team"`;
}

// ── Sites the prime has always given a literal ────────────────────────────
//
// Each returns the prime's literal on the prime, whatever `firm` holds, so a
// prime caller can pass an identity it read nothing to build.

/** Market Updates Q&A's persona, before the task it is given. */
export function marketAnalystOpening(identity: WorkspaceIdentity, task: string): string {
  if (identity.deployment.prime) return `You are the NPC Australian property-market intelligence analyst ${task}`;
  return identity.firm === null
    ? `You are an Australian property-market intelligence analyst ${task}`
    : `You are the Australian property-market intelligence analyst for ${identity.firm}, ${task}`;
}

/** The finance portal copilot's tone line for a Purchase File summary. */
export function purchaseFileSummaryTone(identity: WorkspaceIdentity): string {
  if (identity.deployment.prime) return 'Tone: factual, actionable, NPC-branded (no AI emojis or filler).';
  return identity.firm === null
    ? 'Tone: factual, actionable (no AI emojis or filler).'
    : `Tone: factual, actionable, ${identity.firm}-branded (no AI emojis or filler).`;
}

/** What a solicitor is told when they try to move a closed matter. */
export function closedMatterMessage(identity: WorkspaceIdentity): string {
  if (identity.deployment.prime) return 'This matter is closed. Contact NPC to reopen it.';
  return identity.firm === null
    ? 'This matter is closed. Contact the business that shared it with you to reopen it.'
    : `This matter is closed. Contact ${identity.firm} to reopen it.`;
}

/** The sender of a Command Centre message to a solicitor that names none. */
export function commandCentreSender(identity: WorkspaceIdentity): string {
  if (identity.deployment.prime) return 'NPC Command Centre';
  return identity.firm === null ? 'Command Centre' : `${identity.firm} Command Centre`;
}

/** The heading of a finance partner's ping to the Command Centre about a Purchase File. */
export function partnerPingHeading(identity: WorkspaceIdentity, purchaseFileRef: string): string {
  if (identity.deployment.prime) return `[NPC ping — PF ${purchaseFileRef}]`;
  return identity.firm === null
    ? `[Ping — PF ${purchaseFileRef}]`
    : `[${identity.firm} ping — PF ${purchaseFileRef}]`;
}

/**
 * The author a spreadsheet export names in its properties, or null where it
 * should name none. The platform is not claimed as the author of a
 * workspace's own records.
 */
export function exportAuthor(identity: WorkspaceIdentity): string | null {
  if (identity.deployment.prime) return 'NPC Services';
  return identity.firm;
}

/** The issuer an authenticator app lists this deployment's staff under. */
export function authenticatorIssuer(identity: WorkspaceIdentity): string {
  if (identity.deployment.prime) return 'NPC Property Dashboard';
  return identity.firm ?? 'Property Dashboard';
}
