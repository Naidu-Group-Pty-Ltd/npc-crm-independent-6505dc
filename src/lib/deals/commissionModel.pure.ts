/**
 * How a deal earns the agency its commission.
 *
 * ## The defect this exists for
 *
 * The client Deals tab has a section called **Commission / invoice**, described
 * as "Build progress payments, generated documents and invoice-adjacent files".
 * On a house-and-land deal it shows the per-stage payment tracker. On every
 * other deal type it showed one sentence:
 *
 *     No build progress payment schedule applies to this deal type.
 *
 * That is true and it is also a dead end. An existing-property purchase earns
 * an agent fee, and a refinance earns an upfront commission and a trail — the
 * section that owns the subject was telling the reader there was nothing here,
 * while the figure itself sat in a different column under Financial Controls.
 * The audit reported it as "there is currently no agent fee/commission
 * tracking", twice, across two audits.
 *
 * ## Why it is a module
 *
 * The rule was written inline in two components as `deal.deal_type ===
 * 'house_and_land'` and `isRefinance || deal.deal_type === 'existing_property'`
 * — two expressions of one question, in two files, already disagreeing about
 * which types earn what. Naming it once means the section that DISPLAYS the
 * commission and the panel that EDITS it cannot drift apart about whether a
 * deal has one.
 */

/** The three deal types the tracker supports. */
export type DealTypeLike = 'existing_property' | 'house_and_land' | 'refinance' | string | null | undefined;

export type CommissionModel =
  /** Paid stage by stage as the build draws down; tracked per payment row. */
  | 'per_build_stage'
  /** A single agent fee or upfront commission on the deal itself. */
  | 'agent_fee'
  /** This deal type earns the agency nothing directly. */
  | 'none';

export function commissionModelFor(dealType: DealTypeLike): CommissionModel {
  if (dealType === 'house_and_land') return 'per_build_stage';
  if (dealType === 'existing_property' || dealType === 'refinance') return 'agent_fee';
  return 'none';
}

/**
 * What the Commission / invoice section should call the figure.
 *
 * A refinance commission and an existing-property agent fee are the same
 * mechanism and different words in the business, and the Financial Controls
 * panel already draws that distinction — so it is made once, here, rather than
 * a second time beside every heading.
 */
export function agentFeeLabelFor(dealType: DealTypeLike): string {
  return dealType === 'refinance' ? 'Commission & clawback' : 'Agent fee / commission';
}

/**
 * Whether a trail commission and a clawback window apply.
 *
 * They are a refinance concept: an existing-property agent fee is paid once
 * and is not clawed back, so showing an empty clawback row against one would
 * invent an obligation that does not exist.
 */
export function hasTrailAndClawback(dealType: DealTypeLike): boolean {
  return dealType === 'refinance';
}

/**
 * The facts a single agent fee carries, for the surfaces that show one.
 *
 * Deliberately structural rather than the `Deal` type: the client's Deals tab
 * and the pipeline's Commission Dashboard read differently-shaped rows out of
 * two different queries, and both need the same answer.
 */
export interface AgentFeeDealLike {
  deal_type: DealTypeLike;
  commission_estimate?: number | null;
  commission_received?: boolean | null;
  commission_received_date?: string | null;
}

export interface AgentFeeEntry {
  /** What this deal type calls the figure. */
  label: string;
  /** The fee, or null when nobody has recorded one. Never 0 as a stand-in. */
  amount: number | null;
  received: boolean;
  /** The day it arrived — null whenever `received` is false. */
  receivedDate: string | null;
}

/**
 * The one agent-fee commission entry a deal contributes, or `null`.
 *
 * A house-and-land deal answers `null` because its commission is already
 * counted per build payment; contributing a second entry here would
 * double-count it in "Total Received", which is worse than not showing it.
 *
 * `receivedDate` is suppressed while `received` is false, so a flag that was
 * cleared cannot leave a date behind claiming the money arrived.
 */
export function agentFeeEntry(deal: AgentFeeDealLike): AgentFeeEntry | null {
  if (commissionModelFor(deal.deal_type) !== 'agent_fee') return null;

  const raw = deal.commission_estimate;
  const amount = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  // Every deal written before the columns existed reads null/undefined here,
  // and that is "not received" rather than unknown.
  const received = deal.commission_received === true;

  return {
    label: agentFeeLabelFor(deal.deal_type),
    amount,
    received,
    receivedDate: received ? (deal.commission_received_date ?? null) : null,
  };
}

/**
 * The write that records — or un-records — receipt of an agent fee.
 *
 * The flag and the date are set and cleared together, always. They were two
 * independent columns on `build_progress_payments` and three call sites each
 * remembered to pair them by hand; this is the same pair with the rule in one
 * place, so no surface can leave a date standing against a cleared flag.
 *
 * `today` is passed in rather than read here so the function stays pure and a
 * test can pin the value.
 */
export function agentFeeReceiptPatch(
  received: boolean,
  today: string,
): { commission_received: boolean; commission_received_date: string | null } {
  return {
    commission_received: received,
    commission_received_date: received ? today : null,
  };
}
