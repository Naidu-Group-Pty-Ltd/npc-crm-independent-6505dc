import { ShieldCheck } from 'lucide-react';

import { hasAmlCapability, type AmlCapability } from '@/lib/aml/permissions';
import type { AmlRole } from '@/hooks/useAmlAccess';
import type { NavItemDef } from './registry';

/**
 * The AML/CTF Compliance navigation entry — defined ONCE.
 *
 * ── Why it is not in `NAVIGATION_ITEMS` ───────────────────────────────
 * Every other entry is gated by its `moduleKey` through the capability
 * resolver. This one is not: it is gated by the `aml_ctf` feature flag AND
 * the user's assigned AML role, which is a different question answered by a
 * different endpoint (`aml-access`). Injecting it into the registry would
 * mean teaching the resolver a second gating system.
 *
 * ── Why it is not written where it is drawn ───────────────────────────
 * Because it was, twice, and there are four navigation surfaces.
 *
 * The desktop sidebar built this entry inline. The command palette built its
 * own copy — same URL, a different title ("AML / CTF Compliance" against
 * "AML/CTF Compliance"). `MobileSidebar` and the bottom bar render the shared
 * registry and nothing else, so they never had it at all: on a phone the
 * whole AML/CTF module had no door. The route worked if you typed it; there
 * was nothing to tap. Reported from a phone as "the AML/CTF Compliance page
 * is not populating", and it had been that way since the entry was added.
 *
 * So the decision lives here, every surface asks, and
 * `navigationSurfaces.test.ts` fails if a surface that renders navigation
 * does not.
 */
export const AML_NAV_GROUP_TITLE = 'AML/CTF Compliance';

/** The capabilities any one of which is enough to see the module at all. */
const AML_NAV_CAPABILITIES: AmlCapability[] = [
  'aml.view',
  'aml.investigate',
  'aml.report',
  'aml.configure',
];

/**
 * The item itself.
 *
 * All sub-surfaces (Cases, Screening, AUSTRAC, Configuration, …) are in-page
 * tabs inside `/admin/aml` via `AmlLayout`, so the module is one entry rather
 * than a group of them — on a phone especially, where the shell already folds
 * its own two tab rows into Selects.
 */
export const AML_NAV_ITEM: NavItemDef = {
  title: AML_NAV_GROUP_TITLE,
  url: '/admin/aml',
  icon: ShieldCheck,
  moduleKey: '__aml__',
  group: AML_NAV_GROUP_TITLE,
  keywords: ['aml', 'ctf', 'compliance', 'kyc', 'austrac', 'screening', 'passport'],
  activePatterns: ['/admin/aml'],
};

/** What a navigation surface needs to know about AML access. */
export interface AmlNavAccess {
  loading: boolean;
  flagEnabled: boolean;
  hasAnyRole: boolean;
  roles: Set<AmlRole>;
}

/**
 * The entry, or nothing.
 *
 * Fails closed: while the answer is still loading, and on every reading that
 * does not carry both the flag and a capability, this is null. A navigation
 * entry is a claim that a page will open, and drawing one that the guard then
 * refuses is worse than drawing none.
 */
export function amlNavEntry(access: AmlNavAccess): NavItemDef | null {
  if (access.loading || !access.flagEnabled || !access.hasAnyRole) return null;
  const allowed = AML_NAV_CAPABILITIES.some((c) => hasAmlCapability(access.roles, c));
  return allowed ? AML_NAV_ITEM : null;
}
