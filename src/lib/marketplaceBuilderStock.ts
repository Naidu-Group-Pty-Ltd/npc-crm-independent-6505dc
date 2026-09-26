/**
 * Command Centre — Builder Stock query layer for the Property Marketplace.
 *
 * Every call goes through `invokeSecureFunction`, which carries the internal
 * HttpOnly session cookie and the CSRF-safe carriers the rest of the dashboard
 * uses. Nothing here reads `builder_stock_*` directly: those tables have no
 * `authenticated` policy, on purpose — the module permission and the feature
 * flag are both enforced inside the edge function, and a direct client read
 * would bypass both.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useAuthUserIdOptional } from '@/hooks/useAuth';
import type { BuilderStockItem, BuilderStockSelection } from '@/lib/builderStock';
import type { MirrorSource } from '../../supabase/functions/_shared/builderStock/mirrorAvailability.pure';
import type { PropertyDetail } from '../../supabase/functions/_shared/builderStock/propertyDetail.pure';
import type { ConversationMessageView } from '../../supabase/functions/_shared/builderStock/agencyMessages.pure';

export const marketplaceStockKeys = {
  root: () => ['marketplace', 'builder-stock'] as const,
  items: (filters: MarketplaceStockFilters) =>
    ['marketplace', 'builder-stock', 'items', filters] as const,
  builders: () => ['marketplace', 'builder-stock', 'builders'] as const,
  selections: (clientId: string) =>
    ['marketplace', 'builder-stock', 'selections', clientId] as const,
  clientSearch: (search: string) =>
    ['marketplace', 'builder-stock', 'client-search', search] as const,
};

export interface MarketplaceStockFilters {
  search: string;
  organisationId: string;
  availability: string;
  state: string;
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  records: T[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
  /**
   * What the workspace can say about the Builders Network link this mirror is
   * fed by. Absent on a deployment running ahead of the function, which
   * `readStockEmptyState` reads as `unknown` rather than as "no link".
   */
  source?: MirrorSource;
  /** Organisations holding a disclosed commercial placement on this result set. */
  promoted_organisations?: string[];
  /**
   * Whether this page is ordered by merit.
   *
   * `false` means the ranking migration has not reached this deployment, so
   * the list is real and its ORDER carries no information. Absent means a
   * deployment running ahead of the function, which the surface reads as
   * "say nothing" rather than as unranked.
   */
  ranked?: boolean;
}

export interface MarketplaceBuilder {
  id: string;
  legal_name: string;
  trading_name: string | null;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>('builder-stock-marketplace', body);
  const message = error?.message || (data as { error?: string } | null)?.error;
  if (message) {
    const failure = new Error(message) as Error & { code?: string; status?: number };
    failure.code = (data as { code?: string } | null)?.code ?? error?.code;
    failure.status = error?.status;
    throw failure;
  }
  return data as T;
}

export function useMarketplaceBuilderStock(
  filters: MarketplaceStockFilters,
  enabled: boolean,
) {
  return useQuery({
    queryKey: marketplaceStockKeys.items(filters),
    enabled,
    queryFn: () => invoke<Paginated<BuilderStockItem>>({
      operation: 'list_stock',
      search: filters.search,
      organisation_id: filters.organisationId,
      availability_status: filters.availability,
      state: filters.state,
      page: filters.page,
      page_size: filters.pageSize,
    }),
  });
}

export function useMarketplaceBuilders(enabled: boolean) {
  return useQuery({
    queryKey: marketplaceStockKeys.builders(),
    enabled,
    queryFn: () => invoke<{ records: MarketplaceBuilder[] }>({ operation: 'list_builders' }),
  });
}

export interface MarketplaceClientOption {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  primary_email: string | null;
}

export function useMarketplaceClientSearch(search: string, enabled: boolean) {
  return useQuery({
    queryKey: marketplaceStockKeys.clientSearch(search),
    enabled,
    queryFn: () => invoke<{ records: MarketplaceClientOption[] }>({
      operation: 'search_clients', search,
    }),
  });
}

export function useMarketplaceStockSelections(clientId: string, enabled: boolean) {
  return useQuery({
    queryKey: marketplaceStockKeys.selections(clientId),
    enabled,
    queryFn: () => invoke<Paginated<BuilderStockSelection>>({
      operation: 'list_selections', client_id: clientId, page: 1, page_size: 50,
    }),
  });
}

/**
 * Select a builder property for a client.
 *
 * The request names only the property and the client. Which builder supplied
 * it and by which of their users are resolved server-side from the property's
 * own mirror row — the two-way link is a set of foreign keys the browser
 * never gets to choose.
 *
 * Supplying a picture on the builder's behalf used to live beside this and is
 * gone with the portal's image pipeline (network extraction Phase 7): imagery
 * is managed on the Builders Network, and the marketplace serves what the
 * network delivers.
 */
export function useSelectBuilderStockForClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { stockItemId: string; clientId: string; notes?: string }) =>
      invoke<{ record: BuilderStockSelection; already_selected?: boolean }>({
        operation: 'select_for_client',
        stock_item_id: input.stockItemId,
        client_id: input.clientId,
        notes: input.notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketplaceStockKeys.root() });
    },
  });
}

export function useSetStockSelectionStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { selectionId: string; status: string }) =>
      invoke<{ record: BuilderStockSelection }>({
        operation: 'set_selection_status',
        selection_id: input.selectionId,
        status: input.status,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketplaceStockKeys.root() });
    },
  });
}

/** A short-lived signed URL for one stored builder-stock image. */
export async function marketplaceStockImageUrl(imageId: string): Promise<string | null> {
  try {
    const result = await invoke<{ url?: string }>({ operation: 'image_url', image_id: imageId });
    return result.url ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// One property — the page a card, a map pin or a link opens.
// ---------------------------------------------------------------------------

export type {
  PropertyActivation as MarketplaceStockActivation,
  PropertyDocument as MarketplaceStockDocument,
  PropertyPhoto as MarketplaceStockPhoto,
} from '../../supabase/functions/_shared/builderStock/propertyDetail.pure';

/**
 * What `get_stock_item` answers: the card's own record, plus the property's
 * photographs and documents as the Builders Network published them, and its
 * activation record. `clients_visible` is false when the server withheld
 * client names from this reader.
 */
export interface MarketplaceStockDetail extends PropertyDetail {
  record: BuilderStockItem;
}

/** The address a builder property is opened at. One spelling, used everywhere. */
export function builderStockPropertyPath(stockItemId: string): string {
  return `/listings/builder-stock/${encodeURIComponent(stockItemId)}`;
}

export function useMarketplaceStockItem(stockItemId: string, enabled = true) {
  return useQuery({
    queryKey: [...marketplaceStockKeys.root(), 'item', stockItemId] as const,
    enabled: enabled && !!stockItemId,
    // A property that is not there is an answer, not a transient fault.
    retry: (count, error) => !/not found/i.test((error as Error)?.message ?? '') && count < 2,
    queryFn: () => invoke<MarketplaceStockDetail & { success?: boolean }>({
      operation: 'get_stock_item', stock_item_id: stockItemId,
    }),
  });
}

// ---------------------------------------------------------------------------
// The builder conversation on a property page.
// ---------------------------------------------------------------------------

export type { ConversationMessageView, DeliveryState } from '../../supabase/functions/_shared/builderStock/agencyMessages.pure';

export type {
  ActivatedPropertyRow, ActivationStatus, ConversationClosedReason, ConversationSummary, ParticipantView,
} from '../../supabase/functions/_shared/builderStock/privateConversations.pure';
import type {
  ActivatedPropertyRow, ConversationClosedReason, ConversationSummary, ParticipantView,
} from '../../supabase/functions/_shared/builderStock/privateConversations.pure';

/**
 * One activation's private conversation, as its participant reads it
 * (docs/builder-portal/52). Only a current participant is ever given one; for
 * anyone else the server answers 403 `not_a_participant` and nothing of it.
 */
export interface BuilderConversation {
  conversation_id: string;
  stock_item_id?: string;
  address?: string | null;
  lot_number?: string | null;
  builder_name?: string | null;
  open: boolean;
  closed_reason?: ConversationClosedReason | null;
  can_send: boolean;
  can_invite?: boolean;
  can_leave?: boolean;
  participants?: ParticipantView[];
  messages: ConversationMessageView[];
  /** Older messages exist before this page; ask again with `earlier_cursor`. */
  has_earlier?: boolean;
  earlier_cursor?: string | null;
}

/**
 * The thread as shown: earlier pages the reader asked for, and the newest
 * window the poll keeps current, one message once, in the order written.
 */
export function mergeConversationPages(
  earlier: readonly ConversationMessageView[], window: readonly ConversationMessageView[],
): ConversationMessageView[] {
  const byId = new Map<string, ConversationMessageView>();
  for (const message of earlier) byId.set(message.id, message);
  for (const message of window) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) =>
    (a.sent_at === b.sent_at ? (a.id < b.id ? -1 : 1) : (a.sent_at < b.sent_at ? -1 : 1)));
}

/** How often an open conversation re-reads itself. Polling is the transport's floor. */
export const BUILDER_CONVERSATION_POLL_MS = 10_000;

/**
 * A closed conversation is checked only this often: rarely enough to cost
 * nothing, often enough that an activation made elsewhere (another user,
 * another tab) reopens it without a reload.
 */
export const BUILDER_CONVERSATION_CLOSED_POLL_MS = 60_000;

/**
 * An open conversation is re-read every few seconds; a closed one only once a
 * minute. Activating from this page also invalidates the query, so it reopens
 * at once there.
 */
export function builderConversationPollInterval(data: { open?: boolean } | undefined): number {
  return data?.open === false ? BUILDER_CONVERSATION_CLOSED_POLL_MS : BUILDER_CONVERSATION_POLL_MS;
}

/**
 * Every private read is keyed by the signed-in user. The app's one
 * QueryClient outlives a sign-out, so a key that did not name the reader
 * would hand the next person to sign in on the same browser the previous
 * person's inbox, threads and activations from the cache.
 */
type Reader = string | null;
const privateRoot = (reader: Reader) => [...marketplaceStockKeys.root(), 'private', reader ?? 'signed-out'] as const;
const conversationKey = (reader: Reader, conversationId: string) =>
  [...privateRoot(reader), 'conversation', conversationId] as const;
const conversationListRoot = (reader: Reader) => [...privateRoot(reader), 'my-conversations'] as const;
const conversationListKey = (reader: Reader, stockItemId?: string) =>
  [...conversationListRoot(reader), stockItemId ?? 'all'] as const;
const activationsKey = (reader: Reader) => [...privateRoot(reader), 'portal-activations'] as const;
const acknowledgementCountKey = (reader: Reader) => [...privateRoot(reader), 'acknowledgement-count'] as const;

/**
 * A refusal says the reader may no longer see this conversation: signed out,
 * Listings access withdrawn, or the feature switched off. Unlike a transient
 * failure, what was read before must not stay on screen after it.
 */
export function conversationAccessLost(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, code } = error as { status?: number; code?: string };
  return status === 401 || status === 403 || code === 'builder_stock_disabled';
}

/**
 * A refusal is not retried: the query error is set only once retries are
 * spent, and until then the card would keep showing what the reader may no
 * longer see. Anything else is retried once, as every query in the app is.
 */
export function retryUnlessAccessLost(failureCount: number, error: unknown): boolean {
  return !conversationAccessLost(error) && failureCount < 1;
}

/**
 * The poll stops once a read is refused: every later poll would be refused
 * too, and each 403 counts towards the client's authentication breaker, so a
 * few of them could clear an otherwise valid session. Remounting the page
 * reads again.
 */
export function conversationRefetchInterval(state: { data?: { open?: boolean }; error?: unknown }): number | false {
  return conversationAccessLost(state.error) ? false : builderConversationPollInterval(state.data);
}

/**
 * The same rule for a list read on a fixed interval: poll every `ms` until a
 * read is refused, then stop.
 */
export function listRefetchInterval(ms: number) {
  return (query: { state: { error?: unknown } }): number | false =>
    (conversationAccessLost(query.state.error) ? false : ms);
}

/** Portals → Builder Portal → Activated Properties: one row per activation. */
export function useBuilderPortalActivations(enabled = true) {
  const reader = useAuthUserIdOptional();
  return useQuery({
    queryKey: activationsKey(reader),
    enabled,
    queryFn: () => invoke<{ activations: ActivatedPropertyRow[]; as_of?: string }>({ operation: 'list_builder_portal_activations' }),
    refetchInterval: listRefetchInterval(60_000),
    refetchIntervalInBackground: false,
    retry: retryUnlessAccessLost,
  });
}

/**
 * The reader's unread builder acknowledgements, counted by the server. The
 * bell holds only its newest fifty notifications, so counting there would
 * lose an older acknowledgement the reader has still not seen.
 */
export function useActivationAcknowledgementCount(enabled = true) {
  const reader = useAuthUserIdOptional();
  return useQuery({
    queryKey: acknowledgementCountKey(reader),
    enabled,
    queryFn: () => invoke<{ count: number }>({ operation: 'count_activation_acknowledgements' }),
    refetchInterval: listRefetchInterval(60_000),
    refetchIntervalInBackground: false,
    retry: retryUnlessAccessLost,
  });
}

/**
 * Seeing Activated Properties is seeing the acknowledgements it listed. `asOf`
 * is the list's own read time from the server, so one that arrived after the
 * list was read stays unread.
 */
export function useMarkActivationAcknowledgementsRead() {
  const reader = useAuthUserIdOptional();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (asOf: string) => invoke<{ success: boolean }>({ operation: 'mark_activation_acknowledgements_read', as_of: asOf }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: acknowledgementCountKey(reader) }),
  });
}

/** The conversations the reader is in now — all of them, or one property's. */
export function useMyBuilderConversations(stockItemId?: string, enabled = true) {
  const reader = useAuthUserIdOptional();
  return useQuery({
    queryKey: conversationListKey(reader, stockItemId),
    enabled,
    queryFn: () => invoke<{ conversations: ConversationSummary[] }>({
      operation: 'list_my_builder_conversations', ...(stockItemId ? { stock_item_id: stockItemId } : {}),
    }),
    refetchInterval: listRefetchInterval(30_000),
    refetchIntervalInBackground: false,
    retry: retryUnlessAccessLost,
  });
}

export function useParticipantConversation(conversationId: string, enabled = true) {
  const reader = useAuthUserIdOptional();
  return useQuery({
    queryKey: conversationKey(reader, conversationId),
    enabled: enabled && !!conversationId,
    queryFn: () => invoke<BuilderConversation>({
      operation: 'get_builder_conversation', conversation_id: conversationId,
    }),
    refetchInterval: (query) => conversationRefetchInterval(query.state),
    refetchIntervalInBackground: false,
    retry: retryUnlessAccessLost,
  });
}

/** One earlier page of a conversation's history, before the message `cursor` names. */
export function useEarlierConversationMessages(conversationId: string) {
  return useMutation({
    mutationFn: (cursor: string) => invoke<BuilderConversation>({
      operation: 'get_builder_conversation', conversation_id: conversationId, before_message_id: cursor,
    }),
  });
}

/**
 * Send one message. The caller mints `clientMessageId` once per message and
 * reuses it for any repeat of the same send, so a timeout is safe to retry.
 */
export function useSendConversationMessage(conversationId: string) {
  const reader = useAuthUserIdOptional();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { clientMessageId: string; body: string }) => invoke<{ message: ConversationMessageView | null }>({
      operation: 'send_builder_message', conversation_id: conversationId,
      client_message_id: input.clientMessageId, body: input.body,
    }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: conversationKey(reader, conversationId) }),
  });
}

export function useRetryConversationMessage(conversationId: string) {
  const reader = useAuthUserIdOptional();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => invoke<{ message: ConversationMessageView | null }>({
      operation: 'retry_builder_message', message_id: messageId,
    }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: conversationKey(reader, conversationId) }),
  });
}

/** Colleagues who may be added: the server decides who, from its own rows. */
export function useConversationInvitees(conversationId: string, enabled: boolean) {
  const reader = useAuthUserIdOptional();
  return useQuery({
    queryKey: [...conversationKey(reader, conversationId), 'invitees'] as const,
    enabled: enabled && !!conversationId,
    queryFn: async () => (await invoke<{ invitees: Array<{ user_id: string; display_name: string }> }>({
      operation: 'list_builder_conversation_invitees', conversation_id: conversationId,
    })).invitees,
    retry: retryUnlessAccessLost,
  });
}

export function useInviteConversationParticipant(conversationId: string) {
  const reader = useAuthUserIdOptional();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteeUserId: string) => invoke<{ result: string }>({
      operation: 'invite_builder_conversation_participant', conversation_id: conversationId, invitee_user_id: inviteeUserId,
    }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: conversationKey(reader, conversationId) }),
  });
}

/** Leave a conversation. It names only the person leaving. */
export function useLeaveConversation(conversationId: string) {
  const reader = useAuthUserIdOptional();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<{ result: string }>({
      operation: 'leave_builder_conversation', conversation_id: conversationId,
    }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: conversationListRoot(reader) });
      queryClient.invalidateQueries({ queryKey: activationsKey(reader) });
      queryClient.removeQueries({ queryKey: conversationKey(reader, conversationId) });
    },
  });
}

/**
 * Keeps a conversation log on its newest message: a thread longer than its
 * box opens at the end, and a message a poll brings in is not left below the
 * visible area.
 */
export function scrollLogToEnd(log: { scrollTop: number; scrollHeight: number } | null | undefined): void {
  if (log) log.scrollTop = log.scrollHeight;
}

/**
 * Where the log should move after a read. `null` before any read, or on a new
 * thread, opens at the end. A new last message follows the end. A message the
 * poll sorted ABOVE the newest one (it was written earlier and arrived late)
 * is brought into view itself, because following the end would leave it out
 * of sight with nothing saying it came. Otherwise the log stays where the
 * reader put it.
 */
export function arrivalScrollTarget(previousIds: readonly string[] | null, ids: readonly string[]): 'end' | string | null {
  if (previousIds === null) return 'end';
  const seen = new Set(previousIds);
  const arrived = ids.filter((id) => !seen.has(id));
  if (!arrived.length) return null;
  // A message that sorts above the newest one already seen is a late arrival,
  // and it wins even when the same poll also brought a new last message:
  // following the end would leave it above the reader, unseen.
  let lastSeenIndex = -1;
  ids.forEach((id, index) => { if (seen.has(id)) lastSeenIndex = index; });
  const late = arrived.find((id) => ids.indexOf(id) < lastSeenIndex);
  return late ?? 'end';
}

/** Brings one message of a log into view, by the id it is drawn with. */
export function scrollMessageIntoView(log: HTMLElement | null | undefined, messageId: string): void {
  const node = log?.querySelector?.(`[data-message-id="${CSS.escape(messageId)}"]`);
  node?.scrollIntoView?.({ block: 'nearest' });
}
