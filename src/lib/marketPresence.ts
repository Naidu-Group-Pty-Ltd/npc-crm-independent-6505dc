import type { PropertyListing } from '@/lib/airtable';

/**
 * Where a listing stands in the market, as a single legible signal.
 *
 * The intake table has no "off market" column, so this is derived — and the
 * derivation is the industry's own definition, not a guess. Every record here
 * arrived by email to the buyers-agent mailbox. The ones that also carry a
 * public campaign link are advertised stock: **on market**. The ones that carry
 * no public link anywhere are being circulated quietly to buyers' agents before
 * (or instead of) a campaign: that is what **off market** means, and it is the
 * reason a marketplace like this one exists. Off market is a selling point, not
 * a data gap, and the UI treats it that way.
 *
 * Lifecycle statuses from the record override the on/off derivation, because
 * "sold" answers a different, more urgent question than "was it advertised".
 */
export type MarketPresence =
  | 'on-market'
  | 'off-market'
  | 'coming-soon'
  | 'under-offer'
  | 'sold'
  | 'leased';

export interface MarketPresenceBadge {
  presence: MarketPresence;
  /** Short label for the card pill. */
  label: string;
  /** One sentence for tooltips and the detail page — says how we know. */
  explanation: string;
}

function norm(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function marketPresence(
  listing: Pick<PropertyListing, 'listingStatus' | 'url' | 'intent'> & { webLinks?: string | null },
): MarketPresenceBadge {
  const status = norm(listing.listingStatus);
  const isRent = norm(listing.intent) === 'rent';

  if (status.includes('sold')) {
    return { presence: 'sold', label: 'Sold', explanation: 'The agent has marked this listing as sold.' };
  }
  if (status.includes('leased')) {
    return { presence: 'leased', label: 'Leased', explanation: 'The agent has marked this listing as leased.' };
  }
  if (status.includes('under offer') || status.includes('under contract')) {
    return {
      presence: 'under-offer',
      label: 'Under offer',
      explanation: 'An offer has been accepted; the sale has not yet settled.',
    };
  }
  if (status.includes('coming soon')) {
    return {
      presence: 'coming-soon',
      label: 'Coming soon',
      explanation: 'The agent has flagged this listing ahead of its public campaign.',
    };
  }

  // The load-bearing distinction. A public campaign URL means the property is
  // being advertised; its absence on a listing an agent emailed us directly
  // means it is being offered off market.
  const hasPublicLink =
    /^https?:\/\//.test(String(listing.url ?? '')) ||
    /^https?:\/\//.test(String(listing.webLinks ?? ''));

  if (hasPublicLink) {
    return {
      presence: 'on-market',
      label: isRent ? 'For rent' : 'On market',
      explanation: 'This property has a public listing campaign.',
    };
  }
  return {
    presence: 'off-market',
    label: 'Off market',
    explanation:
      'Sent to us directly by the agent with no public campaign — offered off market to buyers’ agents.',
  };
}

/**
 * Semantic-token classes per presence. These are intentionally high-contrast,
 * solid badges — they must remain legible on top of busy property photographs
 * and across light/dark themes.
 */
export const MARKET_PRESENCE_TONE: Record<MarketPresence, string> = {
  'on-market': 'bg-success text-success-foreground border-success shadow-sm',
  'off-market': 'bg-brand text-brand-foreground border-brand shadow-sm',
  'coming-soon': 'bg-info text-info-foreground border-info shadow-sm',
  'under-offer': 'bg-warning text-warning-foreground border-warning shadow-sm',
  sold: 'bg-muted text-muted-foreground border-border shadow-sm',
  leased: 'bg-muted text-muted-foreground border-border shadow-sm',
};
