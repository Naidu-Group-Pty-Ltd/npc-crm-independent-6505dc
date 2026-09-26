import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, LogOut, Send, UserPlus } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  arrivalScrollTarget, conversationAccessLost, mergeConversationPages, scrollLogToEnd, scrollMessageIntoView,
  useEarlierConversationMessages,
  useConversationInvitees, useInviteConversationParticipant, useLeaveConversation, useMyBuilderConversations,
  useParticipantConversation, useRetryConversationMessage, useSendConversationMessage,
  type ConversationMessageView, type DeliveryState, type ParticipantView,
} from '@/lib/marketplaceBuilderStock';

/**
 * One activation's private conversation with its builder
 * (docs/builder-portal/51, 52).
 *
 * Carried over the signed Builders Network. Only the conversation's
 * participants are given it: the server answers anyone else with a refusal and
 * nothing of the conversation, and this component then shows nothing of it
 * either. The thread is read every few seconds while the page is visible —
 * polling is the whole transport on this side — and is drawn in the order it
 * was written, with the actual sender on every message. What the Command
 * Centre sent shows whether the builder has it; a message that did not arrive
 * stays visible and its writer can send it again. Each message is written with
 * one idempotency key, reused if the same send is repeated.
 *
 * A participant may add a colleague and may leave. Nobody can remove anybody.
 * Every one of those acts is decided by the server, which says through
 * `can_send` / `can_invite` / `can_leave` what it would allow.
 */

const DELIVERY_LABELS: Record<DeliveryState, string> = {
  queued: 'Sending',
  delivered: 'Delivered',
  failed: 'Not delivered',
};

/**
 * `confirmation_timeout` is not a refusal: the message reached the builder and
 * no receipt came back in time, so the builder may well hold it. It is named
 * as unconfirmed, never as "not delivered".
 */
const deliveryLabel = (state: DeliveryState, failureReason: string | null) =>
  state === 'failed' && failureReason === 'confirmation_timeout' ? 'Not confirmed' : DELIVERY_LABELS[state];

const when = (iso: string) => new Date(iso).toLocaleString('en-AU');

/**
 * The property page's card: the viewer's own conversations about this
 * property, one per activation they are in. Anyone else's is not listed.
 */
export function BuilderStockConversations({ stockItemId, builderName }: { stockItemId: string; builderName: string | null }) {
  const mine = useMyBuilderConversations(stockItemId);
  const conversations = mine.data?.conversations ?? [];
  if (mine.isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Messages with {builderName ?? 'the builder'}</CardTitle></CardHeader>
        <CardContent>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your conversations…
          </p>
        </CardContent>
      </Card>
    );
  }
  // A list that could not be read says so; only a successful empty read is
  // the statement that the viewer is in no conversation here.
  if (mine.error && !mine.data) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Messages with {builderName ?? 'the builder'}</CardTitle></CardHeader>
        <CardContent>
          <p role="status" className="text-sm text-muted-foreground">
            {conversationAccessLost(mine.error)
              ? 'Your conversations about this property are not available to you.'
              : 'Your conversations about this property could not be loaded just now. They will try again shortly.'}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (!conversations.length) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Messages with {builderName ?? 'the builder'}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Each activation has its own private conversation, opened when the builder acknowledges it. Only the people in
            it can read it.
          </p>
          <p>
            You are not in a conversation about this property.{' '}
            <Link className="underline underline-offset-2" to="/admin/builder-portal/activated">See Activated Properties</Link>.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {conversations.map((c) => (
        <BuilderConversationThread key={c.conversation_id} conversationId={c.conversation_id} builderName={builderName} />
      ))}
    </div>
  );
}

/**
 * Keyed by the conversation, so a draft and its idempotency key belong to the
 * conversation they were written in: moving to another one starts a clean
 * composer, and text written for one builder can never be sent to another.
 */
export function BuilderConversationThread(props: { conversationId: string; builderName?: string | null }) {
  return <ConversationThread key={props.conversationId} {...props} />;
}

function ConversationThread({
  conversationId, builderName,
}: {
  conversationId: string;
  builderName?: string | null;
}) {
  const { toast } = useToast();
  const query = useParticipantConversation(conversationId);
  const send = useSendConversationMessage(conversationId);
  const retry = useRetryConversationMessage(conversationId);
  const [draft, setDraft] = useState('');
  const [clientMessageId, setClientMessageId] = useState(() => crypto.randomUUID());

  // A refusal withdraws what was read: history and composer are kept only
  // through failures that say nothing about who may read it.
  const accessLost = conversationAccessLost(query.error);
  const conversation = accessLost ? undefined : query.data;
  // The poll keeps the newest window current; earlier pages are added above
  // it when asked for, so the whole history can be read however long it is.
  const earlierPage = useEarlierConversationMessages(conversationId);
  // Once paging has begun, every newest window the poll brings is kept too:
  // the window moves on as messages arrive, and a message that slides out of
  // it lies after the earliest page's cursor, so no page would ever return it.
  const [earlier, setEarlier] = useState<{
    messages: ConversationMessageView[]; cursor: string | null; more: boolean; window: readonly ConversationMessageView[];
  } | null>(null);
  const pollWindow = conversation?.messages;
  if (earlier && pollWindow && earlier.window !== pollWindow) {
    // A window that shares nothing with the last one, with more before it,
    // means a whole window arrived unseen: the messages between are reached
    // by paging again from the new window, never skipped over.
    const kept = new Set(earlier.window.map((m) => m.id));
    const disjoint = kept.size > 0 && !!conversation?.has_earlier && !pollWindow.some((m) => kept.has(m.id));
    setEarlier(disjoint ? null : { ...earlier, messages: mergeConversationPages(earlier.messages, pollWindow), window: pollWindow });
  }
  const messages = conversation ? mergeConversationPages(earlier?.messages ?? [], conversation.messages ?? []) : [];
  const earlierCursor = earlier ? earlier.cursor : conversation?.earlier_cursor ?? null;
  const moreEarlier = earlier ? earlier.more : !!conversation?.has_earlier;
  const showEarlier = async () => {
    if (!earlierCursor || earlierPage.isPending) return;
    try {
      const page = await earlierPage.mutateAsync(earlierCursor);
      setEarlier((previous) => ({
        messages: mergeConversationPages([...(page.messages ?? []), ...(previous?.messages ?? [])], pollWindow ?? []),
        cursor: page.earlier_cursor ?? null,
        more: !!page.has_earlier && !!page.earlier_cursor,
        window: pollWindow ?? [],
      }));
    } catch (error) {
      toast({
        title: 'Earlier messages could not be loaded',
        description: error instanceof Error ? error.message : 'Try again shortly.',
        variant: 'destructive',
      });
    }
  };
  const who = builderName ?? conversation?.builder_name ?? 'the builder';
  const refusedAsOutsider = accessLost && (query.error as { code?: string } | null)?.code === 'not_a_participant';
  // Open at the newest message, and follow it as polls bring more in.
  const logRef = useRef<HTMLDivElement>(null);
  // Follow whatever a poll brings in, even a late message that sorts above
  // the newest one. The card is keyed by conversation, so a new one starts
  // with nothing seen and opens at the end.
  const seenIdsRef = useRef<string[] | null>(null);
  const idsKey = messages.map((message) => message.id).join(',');
  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    const target = arrivalScrollTarget(seenIdsRef.current, ids);
    seenIdsRef.current = ids;
    if (target === 'end') scrollLogToEnd(logRef.current);
    else if (target) scrollMessageIntoView(logRef.current, target);
  }, [idsKey]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    try {
      await send.mutateAsync({ clientMessageId, body });
      setDraft('');
      setClientMessageId(crypto.randomUUID());
    } catch (error) {
      toast({
        title: 'Your message was not sent',
        description: error instanceof Error ? error.message : 'Try again shortly.',
        variant: 'destructive',
      });
    }
  };

  const sendAgain = async (messageId: string) => {
    try {
      const answer = await retry.mutateAsync(messageId);
      // A message from an earlier page is not in the polled window the retry
      // refreshes, so what the server now says of it replaces the kept copy.
      const updated = answer?.message;
      if (updated) {
        setEarlier((previous) => (previous
          ? { ...previous, messages: previous.messages.map((m) => (m.id === updated.id ? updated : m)) }
          : previous));
      }
    } catch (error) {
      toast({
        title: 'That message could not be sent again',
        description: error instanceof Error ? error.message : 'Try again shortly.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Messages with {who}</CardTitle>
        {conversation?.address ? (
          <p className="text-sm text-muted-foreground">
            {[conversation.lot_number ? `Lot ${conversation.lot_number}` : null, conversation.address].filter(Boolean).join(', ')}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* A poll that fails after the thread was read keeps what was read:
            the history is still true, it may just be behind. */}
        {accessLost ? (
          <p className="text-sm text-muted-foreground">
            {refusedAsOutsider
              ? 'You are not in this conversation. Only its participants can read it.'
              : 'This conversation is no longer available to you.'}
          </p>
        ) : null}

        {conversation ? <People conversationId={conversationId} conversation={conversation} /> : null}

        {query.error && conversation ? (
          <p role="status" className="text-sm text-muted-foreground">
            The conversation could not be refreshed just now, so newer messages may be missing. It will try again shortly.
          </p>
        ) : null}

        {query.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the conversation…
          </p>
        ) : query.error && !conversation && !accessLost ? (
          <p className="text-sm text-muted-foreground">
            The conversation could not be loaded just now. It will try again shortly.
          </p>
        ) : messages.length ? (
          <>
          {moreEarlier && earlierCursor ? (
            <Button type="button" variant="outline" size="sm" onClick={showEarlier} disabled={earlierPage.isPending}>
              {earlierPage.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Show earlier messages
            </Button>
          ) : null}
          <div ref={logRef} role="log" aria-label={`Messages with ${who}`} aria-live="polite" className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {messages.map((message) => (
              <Message key={message.id} message={message} canRetry={!!conversation?.can_send && message.can_retry} onRetry={sendAgain} retrying={retry.isPending} />
            ))}
          </div>
          </>
        ) : conversation?.open ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {conversation.can_send
              ? `No messages yet. Anything you write here goes to ${who} about this property.`
              : 'No messages yet. You can read this conversation but cannot write to it here.'}
          </p>
        ) : null}

        {conversation && !conversation.open ? (
          <p className="text-sm text-muted-foreground">{closedCopy(conversation.closed_reason, who, messages.length > 0)}</p>
        ) : null}

        {conversation?.can_send ? (
          <div className="space-y-2">
            <Textarea
              aria-label="Message"
              placeholder={`Write to ${who}`}
              value={draft}
              maxLength={4000}
              onChange={(event) => {
                // Different text is a different message: the key a failed send
                // is repeated under belongs to the text it was sent with.
                setDraft(event.target.value);
                setClientMessageId(crypto.randomUUID());
              }}
              disabled={send.isPending}
              rows={3}
            />
            <div className="flex justify-end">
              <Button type="button" onClick={() => void submit()} disabled={send.isPending || !draft.trim()}>
                {send.isPending
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  : <Send className="mr-2 h-4 w-4" aria-hidden />}
                Send
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Message({
  message, canRetry, onRetry, retrying,
}: {
  message: ConversationMessageView;
  /** The message's own retry flag AND whether this reader may write here now. */
  canRetry: boolean;
  onRetry: (id: string) => void;
  retrying: boolean;
}) {
  const ours = message.side === 'command_centre';
  return (
    <article
      data-message-id={message.id}
      className={cn(
        'max-w-[85%] rounded-lg border px-3 py-2 text-sm',
        ours ? 'ml-auto border-primary/30 bg-primary/5' : 'mr-auto border-border bg-card',
      )}
    >
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{message.sender_display_name}</span>
        {' · '}{ours ? 'Your team' : 'Builder'}{' · '}{when(message.sent_at)}
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{message.body}</p>
      {message.delivery_state ? (
        <p className={cn('mt-1 flex items-center gap-2 text-xs',
          message.delivery_state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
          <span>{deliveryLabel(message.delivery_state, message.failure_reason)}</span>
          {canRetry ? (
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs"
              onClick={() => onRetry(message.id)} disabled={retrying}>
              Send again
            </Button>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}

/** Names why a conversation is closed and what happens next — never a step that would not open it. */
function closedCopy(reason: string | null | undefined, who: string, hasHistory: boolean): string {
  switch (reason) {
    case 'withdrawn':
      return 'This activation was withdrawn, so the conversation is closed. Its history stays with the people in it.';
    case 'connection_halted':
    case 'connection_paused':
      return `Messages with ${who} are paused while the connection is checked. Nothing already written is lost: queued messages go out once it is restored.`;
    case 'not_connected':
      return `${who} is not connected to this workspace, so messages cannot be sent.`;
    case 'delisted':
      return `${who} no longer lists this property, so the conversation is closed. Its history stays.`;
    default:
      return hasHistory
        ? 'This property is no longer activated here, so the conversation is closed. Its history stays.'
        : `Activate this property to message ${who} about it.`;
  }
}

/**
 * The people in the conversation, from both sides, and the two acts a
 * participant has: add a colleague, and leave. There is no way to remove
 * somebody else.
 */
function People({ conversationId, conversation }: {
  conversationId: string;
  conversation: { participants?: ParticipantView[]; can_invite?: boolean; can_leave?: boolean; open: boolean };
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const invitees = useConversationInvitees(conversationId, adding);
  const invite = useInviteConversationParticipant(conversationId);
  const leave = useLeaveConversation(conversationId);
  const participants = conversation.participants ?? [];

  const add = async (userId: string) => {
    try {
      await invite.mutateAsync(userId);
      setAdding(false);
    } catch (error) {
      toast({ title: 'That person was not added', description: error instanceof Error ? error.message : 'Try again shortly.', variant: 'destructive' });
    }
  };
  const doLeave = async () => {
    try {
      await leave.mutateAsync();
    } catch (error) {
      toast({ title: 'You have not left the conversation', description: error instanceof Error ? error.message : 'Try again shortly.', variant: 'destructive' });
    } finally {
      setConfirmLeave(false);
    }
  };

  return (
    <section className="space-y-2">
      <ul aria-label="Participants" className="flex flex-wrap gap-2">
        {participants.map((p) => (
          <li key={p.participant_ref} className="rounded-full border border-border px-2.5 py-0.5 text-xs">
            <span className="font-medium text-foreground">{p.display_name}</span>
            <span className="text-muted-foreground">{' · '}{p.side === 'builder' ? 'Builder' : p.is_me ? 'You' : 'Your team'}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {conversation.can_invite ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            <UserPlus className="mr-2 h-4 w-4" aria-hidden /> Add user
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmLeave(true)}
          disabled={conversation.can_leave === false || leave.isPending}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden /> Leave chat
        </Button>
        {conversation.can_leave === false ? (
          <span className="text-xs text-muted-foreground">
            Add a colleague before you leave: someone from your side stays in a live conversation.
          </span>
        ) : null}
      </div>
      {adding ? (
        <div className="rounded-md border border-border p-3">
          {invitees.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading colleagues…</p>
          ) : invitees.error && !invitees.data ? (
            <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Your colleagues could not be loaded just now.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void invitees.refetch?.()}>Try again</Button>
            </div>
          ) : (invitees.data ?? []).length ? (
            <ul className="space-y-1">
              {(invitees.data ?? []).map((person) => (
                <li key={person.user_id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{person.display_name}</span>
                  <Button type="button" size="sm" variant="secondary" disabled={invite.isPending}
                    aria-label={`Add ${person.display_name}`} onClick={() => void add(person.user_id)}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">There is nobody else who can be added.</p>
          )}
        </div>
      ) : null}
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              You will stop seeing it straight away. Its history stays for the people still in it, and a colleague can add
              you back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doLeave()}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
