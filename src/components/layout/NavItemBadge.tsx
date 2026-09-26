import { useActivationAcknowledgementCount } from '@/lib/marketplaceBuilderStock';
import type { NavItemDef } from '@/lib/navigation/registry';

/**
 * The unread count beside a navigation entry.
 *
 * `builder_activations` is the reader's unread builder acknowledgements
 * (docs/builder-portal/52), counted by the server for the session's user only.
 * It is not read from the bell's feed: that holds only the newest fifty
 * notifications, so an older acknowledgement the reader has still not seen
 * would drop out of the count. A count that could not be read draws nothing.
 */
export function NavItemBadge({ kind }: { kind: NonNullable<NavItemDef['badge']> }) {
  const query = useActivationAcknowledgementCount(kind === 'builder_activations');
  const count = query.data?.count ?? 0;
  if (!count) return null;
  return (
    <span
      className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground"
      aria-label={`${count} new`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
