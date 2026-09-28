import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, ExternalLink, Globe, Mail, MessageSquare, Phone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BuilderConversationThread } from '@/components/listings/BuilderStockConversation';
import { useNotificationsOptional } from '@/contexts/NotificationsContext';
import { useBuilderStockMarketplaceFlag } from '@/hooks/useBuilderStockMarketplaceFlag';
import { cn } from '@/lib/utils';
import {
  builderStockPropertyPath, conversationAccessLost, marketplaceStockImageUrl, useBuilderPortalActivations,
  useMarkActivationAcknowledgementsRead, useMyBuilderConversations, type ActivatedPropertyRow, type ActivationStatus,
} from '@/lib/marketplaceBuilderStock';

/**
 * PORTALS → BUILDER PORTAL (docs/builder-portal/52).
 *
 * Two routable tabs. Activated Properties is one row per activation: the
 * property, the builder company's own public contact details, who activated
 * it and who acknowledged it, and its status. It links to the property page
 * (which is not redrawn here) and — only where the server says the reader is
 * in it — to the activation's conversation. Messaging lists the conversations
 * the reader is in and shows the one selected. Every fact is decided by the
 * server; nothing here hides something the reader was sent.
 */

type Tab = 'activated' | 'messaging';

const STATUS_LABEL: Record<ActivationStatus, string> = {
  awaiting_acknowledgement: 'Awaiting acknowledgement',
  acknowledged: 'Acknowledged',
  withdrawn: 'Withdrawn',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-AU') : null);

/**
 * The page exists only where the server says Builder Stock is on: a direct
 * visit is refused here as well as the entry being left out of navigation,
 * and the server refuses every call behind it while the flag is off.
 */
export default function BuilderPortal() {
  const flag = useBuilderStockMarketplaceFlag();
  if (flag.loading) return <div className="p-4 md:p-6"><Skeleton className="h-32 w-full" /></div>;
  if (!flag.enabled) {
    return (
      <div className="space-y-2 p-4 md:p-6">
        <h1 className="text-2xl font-semibold text-foreground">Builder Portal</h1>
        <p className="text-sm text-muted-foreground">Builder Stock is not switched on for this workspace.</p>
      </div>
    );
  }
  return <BuilderPortalContent />;
}

function BuilderPortalContent() {
  const params = useParams<{ tab?: string; conversationId?: string }>();
  const navigate = useNavigate();
  const tab: Tab = params.tab === 'messaging' ? 'messaging' : 'activated';

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <Building2 className="h-6 w-6" aria-hidden /> Builder Portal
        </h1>
        <p className="text-sm text-muted-foreground">
          The properties this workspace has activated with builders, and your private conversations about them.
        </p>
      </header>
      <Tabs value={tab} onValueChange={(value) => navigate(`/admin/builder-portal/${value}`)}>
        <TabsList>
          <TabsTrigger value="activated">Activated Properties</TabsTrigger>
          <TabsTrigger value="messaging">Messaging</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'activated' ? <ActivatedProperties /> : <Messaging conversationId={params.conversationId ?? null} />}
    </div>
  );
}

function ActivatedProperties() {
  const query = useBuilderPortalActivations();
  const notifications = useNotificationsOptional();
  // Seeing the list is seeing the acknowledgements: the badge clears, but
  // only once the list has actually been read and drawn. A failed or pending
  // read shows the reader nothing, so it clears nothing.
  // `isSuccess` alone describes a cached list from an earlier visit; the badge
  // clears only once a read made for THIS visit has succeeded and nothing is
  // still being fetched, so a newer acknowledgement is never cleared unseen.
  const listShown = query.isSuccess && query.isFetchedAfterMount && !query.isFetching;
  // Only what this list could show is marked read: the server's own read time
  // is the cutoff, so an acknowledgement that arrived after it stays unread.
  // The server marks every one up to it (older than the bell's fifty too); the
  // bell's own copies follow at once.
  const asOf = listShown ? query.data?.as_of ?? null : null;
  const { mutate: markAllRead } = useMarkActivationAcknowledgementsRead();
  useEffect(() => {
    if (asOf) markAllRead(asOf);
  }, [asOf, markAllRead]);
  useEffect(() => {
    if (!notifications || !asOf) return;
    const cutoff = Date.parse(asOf);
    for (const n of notifications.notifications) {
      const at = n.timestamp instanceof Date ? n.timestamp.getTime() : Date.parse(String(n.timestamp));
      if (!n.read && n.type === 'builder_activation_acknowledged' && Number.isFinite(at) && at <= cutoff) {
        notifications.markAsRead(n.id);
      }
    }
  }, [notifications, asOf]);

  if (query.isLoading) return <Skeleton className="h-32 w-full" />;
  // A refusal withdraws what was read; a transient failure of a background
  // refresh keeps it, because it is still true and may only be behind.
  const refused = !!query.error && conversationAccessLost(query.error);
  if (query.error && (refused || !query.data)) {
    return (
      <p className="text-sm text-muted-foreground">
        {refused
          ? 'Activated properties are not available to you.'
          : 'Activated properties could not be loaded just now. They will try again shortly.'}
      </p>
    );
  }
  const staleNotice = query.error ? (
    <p role="status" className="text-sm text-muted-foreground">
      This list could not be refreshed just now, so it may be behind. It will try again shortly.
    </p>
  ) : null;
  const rows = query.data?.activations ?? [];
  if (!rows.length) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        {staleNotice}
        <p>No property has been activated with a builder yet.</p>
        <p>
          A property appears here once you activate one of a builder&apos;s properties for a client, from{' '}
          <Link to="/listings?section=builder-stock" className="text-primary underline underline-offset-4">
            Builder Stock
          </Link>{' '}
          in Listings. When the builder acknowledges it, its private conversation opens under Messaging.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {staleNotice}
      {rows.map((row) => <ActivationRow key={row.activation_key} row={row} />)}
    </div>
  );
}

function ActivationRow({ row }: { row: ActivatedPropertyRow }) {
  const place = [row.lot_number ? `Lot ${row.lot_number}` : null, row.address, row.suburb].filter(Boolean).join(', ');
  const website = row.builder_website && /^https?:\/\//i.test(row.builder_website) ? row.builder_website : null;
  return (
    <Card role="article" aria-label={place || 'Activated property'}>
      <CardContent className="flex flex-col gap-4 p-4 md:flex-row">
        <ActivationPhoto imageId={row.primary_image_id} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{place || 'Property'}</p>
              {row.house_design ? <p className="text-sm text-muted-foreground">Design: {row.house_design}</p> : null}
            </div>
            <Badge variant={row.status === 'acknowledged' ? 'default' : row.status === 'withdrawn' ? 'outline' : 'secondary'}>
              {STATUS_LABEL[row.status]}
            </Badge>
          </div>

          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Builder</p>
              <p className="font-medium text-foreground">{row.builder_name ?? 'Builder'}</p>
              {row.builder_email ? (
                <a className="flex items-center gap-1.5 text-primary underline-offset-2 hover:underline" href={`mailto:${row.builder_email}`}>
                  <Mail className="h-3.5 w-3.5" aria-hidden />{row.builder_email}
                </a>
              ) : null}
              {row.builder_phone ? (
                <a className="flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
                  href={`tel:${row.builder_phone.replace(/[^0-9+]/g, '')}`}>
                  <Phone className="h-3.5 w-3.5" aria-hidden />{row.builder_phone}
                </a>
              ) : null}
              {website ? (
                <a className="flex items-center gap-1.5 text-primary underline-offset-2 hover:underline" href={website}
                  target="_blank" rel="noopener noreferrer" aria-label={`Website: ${website.replace(/^https?:\/\//i, '')}`}>
                  <Globe className="h-3.5 w-3.5" aria-hidden />{website.replace(/^https?:\/\//i, '')}
                </a>
              ) : null}
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Activation</p>
              <p className="text-muted-foreground">
                Activated by <span className="text-foreground">{row.activated_by ?? 'a former user'}</span>
                {row.activated_at ? <> · {when(row.activated_at)}</> : null}
              </p>
              {row.acknowledged_at ? (
                <p className="text-muted-foreground">
                  {/* An acknowledgement made before names were sent names nobody. */}
                  {row.acknowledged_by
                    ? <>Acknowledged by <span className="text-foreground">{row.acknowledged_by}</span>{' · '}{when(row.acknowledged_at)}</>
                    : <>Acknowledged on {when(row.acknowledged_at)}</>}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
              to={builderStockPropertyPath(row.stock_item_id)}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> View property
            </Link>
            {row.conversation_id ? (
              <Link className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
                to={`/admin/builder-portal/messaging/${row.conversation_id}`}>
                <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Open conversation
              </Link>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivationPhoto({ imageId }: { imageId: string | null }) {
  // The URL is kept with the image it was signed for: when the server
  // withdraws or replaces the image, the old photograph is no longer shown.
  const [signed, setSigned] = useState<{ imageId: string; url: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    if (imageId) {
      marketplaceStockImageUrl(imageId)
        .then((url) => { if (live) setSigned({ imageId, url }); })
        .catch(() => undefined);
    }
    return () => { live = false; };
  }, [imageId]);
  const url = imageId && signed?.imageId === imageId ? signed.url : null;
  return (
    <div className="h-28 w-full shrink-0 overflow-hidden rounded-md bg-muted md:w-40">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
    </div>
  );
}

function Messaging({ conversationId }: { conversationId: string | null }) {
  const query = useMyBuilderConversations();
  const conversations = query.data?.conversations ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <nav aria-label="Your conversations" className="space-y-2">
        {query.isLoading ? <Skeleton className="h-24 w-full" /> : null}
        {!query.isLoading && query.error && !query.data ? (
          <p role="status" className="text-sm text-muted-foreground">
            {conversationAccessLost(query.error)
              ? 'Your conversations are not available to you.'
              : 'Your conversations could not be loaded just now. They will try again shortly.'}
          </p>
        ) : null}
        {!query.isLoading && !query.error && !conversations.length ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              No conversations yet. When a builder acknowledges an activation, the person who activated it and the builder
              who acknowledged it can message each other here, and either can add a colleague.
            </p>
            <p>
              Activate a property from{' '}
              <Link to="/listings?section=builder-stock" className="text-primary underline underline-offset-4">
                Builder Stock
              </Link>
              , or see which activations are waiting on a builder under{' '}
              <Link to="/admin/builder-portal/activated" className="text-primary underline underline-offset-4">
                Activated Properties
              </Link>
              .
            </p>
          </div>
        ) : null}
        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.conversation_id}>
              <Link
                to={`/admin/builder-portal/messaging/${c.conversation_id}`}
                aria-current={c.conversation_id === conversationId ? 'page' : undefined}
                className={cn('block rounded-md border px-3 py-2 text-sm',
                  c.conversation_id === conversationId ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}
              >
                <span className="block font-medium text-foreground">
                  {[c.lot_number ? `Lot ${c.lot_number}` : null, c.address].filter(Boolean).join(', ') || 'Property'}
                </span>
                <span className="block text-xs text-muted-foreground">{c.builder_name ?? 'Builder'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-label="Conversation">
        {conversationId
          ? <BuilderConversationThread conversationId={conversationId} />
          : conversations.length
            ? <p className="text-sm text-muted-foreground">Choose a conversation.</p>
            : null}
      </section>
    </div>
  );
}
