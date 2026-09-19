/**
 * Which guide sections a workspace is allowed to see.
 *
 * A clone on Launch should not be reading the Finance Portal guide. Beyond
 * being noise, it is a support problem: someone follows a walkthrough for a
 * screen that is not in their sidebar, concludes the product is broken, and
 * raises a ticket. Documentation is part of the product surface, so it gets
 * gated the same way the product does.
 *
 * The mapping is deliberately explicit rather than derived from the section id.
 * Section ids are chosen for URLs and anchors; module slugs come from the
 * pricing sheet. They coincide often enough to be tempting and differ often
 * enough to be wrong — `marketing-analytics` is sold as `marketing`,
 * `report-qa` is sold as `intelligence-hub`.
 *
 * Gating direction: an unknown plan shows everything. That matches
 * `planEntitlements.ts` and it is the right asymmetry — showing a section
 * someone cannot use is an annoyance, hiding one they paid for is a fault.
 */

import { planIncludesModule, isKnownPlan } from './pricing/planEntitlements';

/**
 * Guide section id → pricing-catalogue module slug.
 *
 * Sections absent from this map are UNIVERSAL: platform basics every plan has
 * (getting started, settings, notifications, troubleshooting). Absence means
 * "always show", so a new section is visible by default and a deliberate act
 * is required to hide it — the safe direction for documentation.
 */
export const SECTION_MODULE_SLUGS: Readonly<Record<string, string>> = {
  // ── Tier-gated feature modules ──
  'email-copilot': 'email-copilot',
  'report-qa': 'intelligence-hub',
  'cash-flow-analysis': 'cashflow-comparisons',
  'borrowing-capacity': 'borrowing-capacity',
  'call-logs': 'call-logs',
  'deal-pipeline': 'deal-pipeline',
  agreements: 'agreements',
  'marketing-analytics': 'marketing',
  'api-usage': 'api-usage',
  integrations: 'integrations',
  'ai-agent': 'aurixa-agent',

  // ── Sections added when the guide was brought up to date ──
  'aml-ctf': 'aml-ctf',
  'finance-portal': 'finance-portal',
  'commercial-industrial': 'commercial-industrial',
  'market-updates': 'market-updates',
  'model-hub': 'model-hub',
  'lender-intelligence': 'lenders',
};

/**
 * Sections that document a capability with no single pricing slug but which
 * still should not be shown to every plan. Keyed to the module whose absence
 * makes the section meaningless.
 *
 * The portals are the case in point: a Solicitor Portal guide is useless to a
 * workspace with no legal partners, and the Builder Portal is administered
 * from the same Scale-tier admin surface as the Finance Portal.
 */
export const SECTION_PROXY_MODULES: Readonly<Record<string, string>> = {
  'solicitor-portal': 'finance-portal',
  'builder-portal': 'finance-portal',
  'partner-network': 'finance-portal',
  'quantitative-reports': 'commercial-industrial',
  'pdf-import': 'intelligence-hub',
};

export type EntitlementContext = {
  planSlug: string | null | undefined;
  /** Add-ons held. Undefined means Mission Control did not say. */
  addonSlugs?: readonly string[] | null;
  /**
   * The reader is a platform superadministrator. They reach every available
   * module through the operator override, so hiding the documentation for a
   * screen they can open is the same broken-product impression this gate
   * exists to prevent — just pointed at the operator instead of the customer.
   */
  isPlatformOperator?: boolean;
};

/**
 * Whether a section should be rendered for this workspace.
 *
 * Unmapped sections are always visible. Everything else defers to the same
 * `planIncludesModule` gate the sidebar uses, so the guide and the navigation
 * can never disagree about what exists — which is the failure this is meant to
 * prevent, not a nice-to-have.
 */
export function isSectionEntitled(sectionId: string, ctx: EntitlementContext): boolean {
  if (ctx.isPlatformOperator) return true;
  if (!isKnownPlan(ctx.planSlug)) return true;

  const slug = SECTION_MODULE_SLUGS[sectionId] ?? SECTION_PROXY_MODULES[sectionId];
  if (!slug) return true; // universal section

  return planIncludesModule(ctx.planSlug, slug, ctx.addonSlugs);
}

/** Filter any section-shaped list down to what this workspace may see. */
export function filterEntitledSections<T extends { id: string }>(
  sections: readonly T[],
  ctx: EntitlementContext,
): T[] {
  return sections.filter((s) => isSectionEntitled(s.id, ctx));
}

/**
 * Sections hidden from this workspace, with the module that would unlock them.
 *
 * Returned so the page can say "3 more guides are available on Growth" rather
 * than silently rendering a shorter list. A customer noticing a feature exists
 * is a sales conversation; a customer noticing documentation vanished is a
 * support ticket.
 */
export function lockedSections<T extends { id: string; title: string }>(
  sections: readonly T[],
  ctx: EntitlementContext,
): Array<{ id: string; title: string; moduleSlug: string }> {
  if (ctx.isPlatformOperator) return [];
  if (!isKnownPlan(ctx.planSlug)) return [];
  return sections
    .filter((s) => !isSectionEntitled(s.id, ctx))
    .map((s) => ({
      id: s.id,
      title: s.title,
      moduleSlug: SECTION_MODULE_SLUGS[s.id] ?? SECTION_PROXY_MODULES[s.id] ?? '',
    }));
}
