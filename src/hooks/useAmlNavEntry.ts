import { useMemo } from 'react';

import { useAmlAccess } from '@/hooks/useAmlAccess';
import { amlNavEntry, type AmlNavAccess } from '@/lib/navigation/amlEntry';
import type { NavItemDef } from '@/lib/navigation/registry';

/**
 * The AML/CTF Compliance navigation entry for whoever is signed in.
 *
 * One hook for all four navigation surfaces — the desktop sidebar, the mobile
 * sidebar, the bottom bar's "More" sheet and the command palette. See
 * `lib/navigation/amlEntry.ts` for why the decision is not written at each of
 * them, and what it cost when it was.
 */
export function useAmlNavEntry(): NavItemDef | null {
  const access = useAmlAccess();
  const { loading, flagEnabled, hasAnyRole, roles } = access;
  return useMemo(
    () => amlNavEntry({ loading, flagEnabled, hasAnyRole, roles } satisfies AmlNavAccess),
    [loading, flagEnabled, hasAnyRole, roles],
  );
}
