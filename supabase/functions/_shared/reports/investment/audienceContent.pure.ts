/**
 * Who a document is written for — the one place that decides what that
 * changes.
 *
 * The owner, 23 Sep 2026: advisers, brokers and buyer's agents serve two
 * markets, "either an investor or alternatively a owner-occupied client", and
 * a report should be "reflective of that specifically". `tierContent.pure.ts`
 * decides what each TIER contains — which question the document answers.
 * This decides the other axis: the same question, answered for a person who
 * will let the property or a person who will live in it.
 *
 * ## Three audiences
 *
 *  * **Investor** is every document this platform has produced to date, and
 *    choosing it changes nothing: `applyAudienceToMarkdown` returns the body
 *    byte-identical and the projection publishes exactly what it did.
 *  * **Owner-occupier** leads with living in the home — a composed section
 *    placed after the document's opening — and withholds what describes the
 *    property AS A LETTING: its rent, what the rent returns, what letting it
 *    costs, and the few sections whose whole subject is that.
 *  * **Both** keeps everything and adds the owner-occupier's section, for an
 *    adviser who has not yet been told which the client is.
 *
 * ## Three rules
 *
 * **The audience decides what is PUBLISHED, never what is COMPUTED.** No
 * figure is recalculated, re-based or re-labelled for an owner-occupier: a
 * figure that describes a letting is withheld whole, and a figure that is
 * true for both — the price, the loan, the repayment, the rates — is printed
 * as the record holds it. An owner-occupier's cash flow is a different model
 * (no rent, a home's insurance rather than a landlord's, land tax exempt on a
 * principal place of residence), and presenting the investor's with the rent
 * struck out would be a third number nobody computed.
 *
 * **A mixed section is never cut into.** A section is removed only when its
 * subject is the letting return and nothing else — the rental assessment, the
 * tenant and vacancy chapter, the investor suitability profile, the holding
 * strategy. Everything else stays whole, because a paragraph about rent inside
 * a chapter about demand is still that chapter, and prose is never scrubbed.
 * Two headings that resolve to the tenant chapter speak to a buyer as well
 * (`Tenant & Buyer Profile`, `…Occupier Personas`) and are kept by name.
 *
 * **Placement follows the document's own shape.** The owner-occupier's
 * section is set at the level the document writes its sections at — H1 on
 * 842 of 1,199 stored reports, H2 on the rest (`detectSectionLevel`) — and
 * after its opening run (the verdict, the snapshot, the strategic read),
 * because a reader who will live in the home should meet it before the
 * chapters, not after the recommendation.
 *
 * Deno-compatible: siblings only.
 */
import {
  detectSectionLevel,
  isSubHeadingByNumbering,
  normaliseHeading,
  sectionIdForHeading,
  type SectionId,
} from './sectionRegistry.pure.ts';
import { TIER_CONTENT, contentPolicyFor } from './tierContent.pure.ts';

export const REPORT_AUDIENCES = ['investor', 'owner_occupier', 'both'] as const;
export type ReportAudience = (typeof REPORT_AUDIENCES)[number];

/** Every document produced before the audience existed was an investor's. */
export const DEFAULT_REPORT_AUDIENCE: ReportAudience = 'investor';

/** An audience from anything a caller or a payload holds; unrecognised is the default. */
export function readReportAudience(value: unknown): ReportAudience {
  return (REPORT_AUDIENCES as readonly unknown[]).includes(value)
    ? value as ReportAudience
    : DEFAULT_REPORT_AUDIENCE;
}

/** What an audience changes. */
export interface AudiencePolicy {
  audience: ReportAudience;
  /**
   * Rent, yield, cash-on-cash, the net position, the vacancy allowance and
   * the costs of letting (management, a landlord's insurance, land tax) are
   * published.
   */
  lettingFigures: boolean;
  /** Sections whose whole subject is the letting return are carried. */
  lettingSections: boolean;
  /** The composed owner-occupier's section is placed in the document. */
  ownerOccupierSection: boolean;
}

export const AUDIENCE_POLICY: Readonly<Record<ReportAudience, AudiencePolicy>> = {
  investor: { audience: 'investor', lettingFigures: true, lettingSections: true, ownerOccupierSection: false },
  owner_occupier: { audience: 'owner_occupier', lettingFigures: false, lettingSections: false, ownerOccupierSection: true },
  both: { audience: 'both', lettingFigures: true, lettingSections: true, ownerOccupierSection: true },
};

export function audiencePolicyFor(value: unknown): AudiencePolicy {
  return AUDIENCE_POLICY[readReportAudience(value)];
}

/** How the audience is named to the person choosing it. */
export const AUDIENCE_LABEL: Readonly<Record<ReportAudience, string>> = {
  investor: 'Investor',
  owner_occupier: 'Owner-occupier',
  both: 'Both',
};

/** One line, under the choice, saying what it does to the document. */
export const AUDIENCE_DESCRIPTION: Readonly<Record<ReportAudience, string>> = {
  investor: 'The report as generated: rent, yield, cash flow and the investment case.',
  owner_occupier: 'Leads with living in the home, and leaves out rent, yield, cash flow and the investor-only chapters. The investment grade stays unless scoring is switched off below.',
  both: 'The investment case, with a section on living in the home added after the opening.',
};

// ─── What a letting is, in the projection's own keys ────────────────────────

/**
 * `financials.*` keys that describe the property as a letting. Withheld for an
 * owner-occupier, whole — see rule 1.
 *
 * The insurance is the LANDLORD's (`annualCosts.landlordInsurance`), and the
 * total is the eight investor components including management, letting fees
 * and land tax, so neither is a figure a home buyer would pay.
 */
export const LETTING_FIGURE_KEYS = [
  'weeklyRent', 'annualRent', 'annualRentAtOccupancy', 'annualRentAtOccupancyLabel',
  'annualVacancyAllowance', 'weeklyVacancyAllowance',
  'grossYield', 'netYield', 'cashOnCash', 'weeklyNet', 'annualNet',
  'annualManagement', 'weeklyManagement', 'annualInsurance', 'weeklyInsurance',
  'annualCosts',
] as const;

/** `assumptions.*` keys that are a letting's. */
export const LETTING_ASSUMPTION_KEYS = ['occupancyWeeks', 'vacancy'] as const;

/** Score dimensions whose own explanation is a letting's arithmetic. */
export const LETTING_DETAIL_DIMENSIONS: readonly string[] = ['yieldScore'];

// ─── What a letting section is ──────────────────────────────────────────────

/** Sections whose whole subject is the letting return. */
export const LETTING_SECTION_IDS: readonly SectionId[] = ['rentalYield', 'tenantDemand', 'suitability', 'holdingStrategy'];

/**
 * Headings that resolve to a letting section and speak to a buyer as well.
 * Kept whole for every audience — see rule 2.
 */
export const MIXED_LETTING_HEADINGS: readonly string[] = [
  'Tenant & Buyer Profile',
  'Tenant Demand and Occupier Personas',
];
const MIXED = new Set(MIXED_LETTING_HEADINGS.map(normaliseHeading));

/** True when a section heading names a section an owner-occupier's copy leaves out. */
export function isLettingSectionHeading(heading: string): boolean {
  if (isSubHeadingByNumbering(heading)) return false;
  const id = sectionIdForHeading(heading);
  if (!id || !LETTING_SECTION_IDS.includes(id)) return false;
  return !MIXED.has(normaliseHeading(heading));
}

/**
 * The sections a document opens with. The owner-occupier's section is placed
 * after the run of these at the head of the document.
 */
export const OPENING_SECTION_IDS: readonly SectionId[] = ['identity', 'keyFigures', 'verdict', 'propertyIdentity', 'strategicRead'];

// ─── Applying it to the body ────────────────────────────────────────────────

/** A composed section, as its composer returns it: the words, never the `#`s. */
export interface AudienceSection {
  heading: string;
  body: string;
}

export interface AudienceApplication {
  markdown: string;
  /** Headings removed because their whole subject is the letting return. */
  removed: string[];
  /** Whether the owner-occupier's section was placed. */
  placed: boolean;
  /** The heading it was placed before, or null where it closed the document. */
  placedBefore: string | null;
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * The body a document of this audience carries.
 *
 * `section` is the composed owner-occupier's section, or null where the record
 * supports none — then an owner-occupier's copy still leaves the letting out,
 * and nothing is placed.
 */
export function applyAudienceToMarkdown(
  markdown: string | null | undefined,
  audience: unknown,
  section: AudienceSection | null,
): AudienceApplication {
  const source = markdown ?? '';
  const policy = audiencePolicyFor(audience);
  const placing = policy.ownerOccupierSection && !!section && section.body.trim() !== '';
  const unchanged: AudienceApplication = { markdown: source, removed: [], placed: false, placedBefore: null };
  if (!source || (policy.lettingSections && !placing)) return unchanged;

  const { level } = detectSectionLevel(source);

  // ── 1. The letting sections leave an owner-occupier's copy, whole ────────
  const kept: string[] = [];
  const removed: string[] = [];
  let skippingAt: number | null = null;
  let inFence = false;
  for (const line of source.split('\n')) {
    const fence = FENCE.test(line);
    const m = !inFence && !fence ? HEADING.exec(line) : null;
    if (fence) inFence = !inFence;
    if (m) {
      const depth = m[1].length;
      if (skippingAt !== null && depth <= skippingAt) skippingAt = null;
      if (skippingAt === null && !policy.lettingSections && depth === level && isLettingSectionHeading(m[2])) {
        skippingAt = depth;
        removed.push(m[2]);
        continue;
      }
    }
    if (skippingAt === null) kept.push(line);
  }

  if (!placing) {
    return { markdown: removed.length ? kept.join('\n') : source, removed, placed: false, placedBefore: null };
  }

  // ── 2. The owner-occupier's section, after the opening run ──────────────
  let insertAt = -1;
  let provenanceAt = -1;
  let seen = 0;
  let sawOpening = false;
  inFence = false;
  for (let i = 0; i < kept.length; i++) {
    const line = kept[i];
    const fence = FENCE.test(line);
    const m = !inFence && !fence ? HEADING.exec(line) : null;
    if (fence) inFence = !inFence;
    if (!m || m[1].length !== level || isSubHeadingByNumbering(m[2])) continue;
    const id = sectionIdForHeading(m[2]);
    // An unrecognised heading at the section level belongs to the section
    // above it (`partitionByRegistry`'s rule), so it opens nothing here.
    if (!id) continue;
    seen += 1;
    if (id === 'provenance' && provenanceAt < 0) provenanceAt = i;
    if (OPENING_SECTION_IDS.includes(id)) {
      sawOpening = true;
      continue;
    }
    // A document that opens on no recognised opening section takes the
    // owner-occupier's section after its first one.
    if (!sawOpening && seen === 1) continue;
    insertAt = i;
    break;
  }
  if (insertAt < 0) insertAt = provenanceAt;

  const block = [`${'#'.repeat(level)} ${section!.heading.trim()}`, '', section!.body.trim(), ''];
  const out = insertAt < 0 ? [...kept] : kept.slice(0, insertAt);
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  if (out.length) out.push('');
  out.push(...block);
  if (insertAt >= 0) out.push(...kept.slice(insertAt));
  const placedBefore = insertAt >= 0 ? (HEADING.exec(kept[insertAt])?.[2] ?? null) : null;
  return { markdown: out.join('\n').replace(/\n+$/, '') + (source.endsWith('\n') ? '\n' : ''), removed, placed: true, placedBefore };
}

// ─── What the cover says the document is for ────────────────────────────────

/**
 * The owner-occupier's wording where a tier's own speaks of a return.
 *
 * Only two do: the Financial Analysis promises "what it returns", and the
 * Compass's companion note sends the reader to "yield … cash flow". Every
 * other tier's wording is true of both audiences and is left as it is.
 */
const OWNER_OCCUPIER_WORDING: Readonly<Record<string, { standfirst?: string; companionNote?: string }>> = {
  compass: {
    companionNote: 'Purchase costs, the loan and the ten-year projection are set out in the Financial Analysis Report for this property.',
  },
  financial: {
    standfirst: 'What it costs to buy and hold, and how the position moves over ten years.',
  },
};

/** The standfirst and companion note a tier's document carries for this audience. */
export function audienceWording(
  tier: string | null | undefined,
  audience: unknown,
): { standfirst: string; companionNote: string | null } {
  const policy = contentPolicyFor(tier);
  const own = { standfirst: policy.standfirst, companionNote: policy.companionNote };
  if (audiencePolicyFor(audience).lettingFigures) return own;
  // The tier as `contentPolicyFor` resolved it, so an alias and an unknown
  // word land where they land everywhere else.
  const key = Object.keys(TIER_CONTENT).find((k) => TIER_CONTENT[k] === policy) ?? 'compass';
  const wording = OWNER_OCCUPIER_WORDING[key] ?? {};
  return {
    standfirst: wording.standfirst ?? own.standfirst,
    companionNote: wording.companionNote ?? own.companionNote,
  };
}
