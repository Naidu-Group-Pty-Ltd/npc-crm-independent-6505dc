/**
 * MountOnFirstOpen — defers mounting (and code-loading, when children are
 * React.lazy components) of a dialog until the first time it is opened, then
 * keeps it mounted so internal state survives close/re-open and exit
 * animations keep working.
 *
 * Used by TemplateBuilderEdit (rehaul Phase 2) so its ~20 heavy dialogs are
 * code-split out of the editor chunk and contribute zero mount/render cost
 * until actually used.
 */
import { Suspense, useEffect, useState, type ReactNode } from 'react';

export function MountOnFirstOpen({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  if (!mounted) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}
