import {
  useState,
  useEffect,
  useRef,
  useMemo,
  type CSSProperties,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageComposer,
  renderFormattedMessage,
} from "@/components/conversations/MessageComposer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useBrand } from "@/branding/useBrand";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from '@/components/ui/search-input';
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  Search,
  Loader2,
  ArrowLeft,
  Phone,
  Mail,
  MessageCircle,
  Camera,
  ThumbsUp,
  Globe,
  RefreshCw,
  ChevronDown,
  ExternalLink,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Clock3,
  UserRound,
  AlertTriangle,
  Inbox,
  FilterX,
  Sparkles,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GHLExportDialog } from "@/components/shared/GHLExportDialog";
import { format, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { DashboardThemeFrame } from "@/components/layout/DashboardThemeFrame";
import { isCorrespondence, summariseWithheldEntries, withheldEntriesSentence } from "@/lib/ghl/conversationEntry";

// ── Channel helpers ──────────────────────────────────────────
/**
 * The channel a stored value names.
 *
 * `UNKNOWN_CHANNEL` rather than `"sms"` for an absent or unrecognised value.
 * The default used to be SMS, so every thread GoHighLevel had not labelled was
 * drawn as an SMS thread — badge, avatar, bubble colour and the Send-via
 * control alike. The 19 Sep 2026 clone audit reported that twice: an email
 * tagged SMS in the header, and a client listed under the SMS filter who had
 * never been sent one.
 *
 * "We do not know" is a real answer and it is rendered as one; a caller that
 * must pick a channel to SEND on picks it explicitly.
 */
export const UNKNOWN_CHANNEL = 'unknown';

function normalizeChannel(ch: string | undefined | null): string {
  if (!ch) return UNKNOWN_CHANNEL;
  const lower = ch.trim().toLowerCase();
  const map: Record<string, string> = {
    type_phone: "sms",
    phone: "sms",
    sms: "sms",
    type_sms: "sms",
    type_sms_reaction: "sms",
    type_email: "email",
    email: "email",
    mail: "email",
    "2": "email",
    type_whatsapp: "whatsapp",
    whatsapp: "whatsapp",
    whats_app: "whatsapp",
    "3": "whatsapp",
    type_instagram: "instagram",
    instagram: "instagram",
    type_facebook: "facebook",
    facebook: "facebook",
    type_live_chat: "live_chat",
    live_chat: "live_chat",
    livechat: "live_chat",
    type_call: "sms",
    type_activity_contact: "activity",
    type_activity_opportunity: "activity",
    type_activity_appointment: "activity",
  };
  return map[lower] || lower || UNKNOWN_CHANNEL;
}

/**
 * What this thread is actually on, read from the correspondence in it.
 *
 * A conversation carries ONE stored `channel_type` and many messages, and the
 * two disagree: the audit's screenshot shows an email thread badged SMS. The
 * messages are the evidence, so the most recent correspondence wins and the
 * stored column is the fallback for a thread whose messages have not loaded.
 */
function threadChannel(
  conversation: { channel_type?: string | null } | null | undefined,
  correspondence: readonly { channel_type?: string | null }[],
): string {
  for (let i = correspondence.length - 1; i >= 0; i -= 1) {
    const channel = normalizeChannel(correspondence[i]?.channel_type);
    if (channel !== UNKNOWN_CHANNEL) return channel;
  }
  return normalizeChannel(conversation?.channel_type);
}

const channelIcons: Record<string, any> = {
  sms: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  instagram: Camera,
  facebook: ThumbsUp,
  live_chat: Globe,
  [UNKNOWN_CHANNEL]: MessageSquare,
};

const channelColors: Record<string, string> = {
  sms: "bg-info/10 text-info border-info/35 shadow-[0_0_24px_rgba(59,130,246,0.16)]",
  email:
    "bg-accent/10 text-accent-foreground border-accent/35 shadow-[0_0_24px_rgba(139,92,246,0.16)]",
  whatsapp:
    "bg-success/10 text-success border-success/35 shadow-[0_0_26px_rgba(16,185,129,0.18)]",
  instagram:
    "bg-accent/10 text-accent-foreground border-accent/35 shadow-[0_0_24px_rgba(236,72,153,0.16)]",
  facebook:
    "bg-accent/10 text-accent-foreground border-accent/35 shadow-[0_0_24px_rgba(99,102,241,0.16)]",
  live_chat:
    "bg-accent/10 text-accent-foreground border-accent/35 shadow-[0_0_24px_rgba(168,85,247,0.16)]",
  // Deliberately neutral: an unrecorded channel must not borrow another's colour.
  [UNKNOWN_CHANNEL]: "bg-muted/40 text-muted-foreground border-border",
};

// Avatar bubble uses opaque endpoints so the parent row's read/unread tint
// (gold unread highlight) does not bleed through and shift the bubble color.
const avatarBackgrounds: Record<string, string> = {
  sms: "from-info/30 via-info/16 to-card dark:to-background",
  email: "from-accent/30 via-accent/16 to-card dark:to-background",
  whatsapp: "from-success/32 via-success/17 to-card dark:to-background",
  instagram: "from-accent/30 via-accent/16 to-card dark:to-background",
  facebook: "from-accent/30 via-info/16 to-card dark:to-background",
  live_chat: "from-accent/30 via-info/15 to-card dark:to-background",
};

const getContactInitials = (name?: string | null) => {
  const label = (name || "").trim();
  if (
    !label ||
    ["unknown", "unknown contact", "unlinked contact"].includes(
      label.toLowerCase(),
    )
  )
    return "?";
  const parts = label.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
};

// ── Types ────────────────────────────────────────────────────
interface ConversationRow {
  id: string;
  ghl_conversation_id: string;
  channel_type: string;
  last_message_body: string | null;
  last_message_date: string | null;
  last_message_direction: string | null;
  unread_count: number;
  client_id: string | null;
  ghl_contact_id: string | null;
  available_channels?: string[] | null;
  // joined
  client_name?: string;
  client_email?: string | null;
}

interface Message {
  id: string;
  ghl_message_id: string;
  direction: string;
  body: string | null;
  content_type?: string | null;
  channel_type?: string | null;
  message_status: string | null;
  ghl_date_added: string | null;
  attachment_urls: string[] | null;
  sender_name: string | null;
  error_message?: string | null;
  client_request_id?: string | null;
}

interface ExportJobStatus {
  jobId: string;
  status:
    | "starting"
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled";
  fileFormat: "csv" | "xlsx";
  totalItems: number;
  processedItems: number;
  totalMessages: number;
  signedUrl?: string | null;
  fileSizeBytes?: number | null;
  errorSummary?: string | null;
}

// ── Sync helper ──────────────────────────────────────────────
/**
 * Audit item 37 — "Sync could not complete. Request timed out."
 *
 * That sentence is the browser's own abort, not an answer from the server.
 * `invokeSecureFunction` defaults to 60 seconds and this passed no override,
 * while `supabase/config.toml` declares `request_timeout = 120` for
 * `sync-ghl-conversations`. The server was permitted twice as long as the
 * client would wait, so a sync running its declared budget was reported as a
 * failure at the halfway mark — while it carried on and finished.
 *
 * It is not a fast function by design: it paces itself at 500ms between
 * contacts and 300ms between message fetches, because GoHighLevel rate-limits.
 * Sixty seconds was never going to be enough, and the fix is for the caller to
 * wait as long as the function is allowed rather than for the function to
 * hurry.
 *
 * `ghlSyncTimeout.spec.ts` reads the declared value out of `config.toml` and
 * fails if the two drift apart again.
 */
const GHL_SYNC_TIMEOUT_MS = 120_000;

/**
 * Audit 3 item 15 — the same "Request timed out" came back.
 *
 * Raising the client's budget to the declared 120s was right and was not
 * enough: the function walks EVERY client with a GoHighLevel contact id,
 * pausing 500ms between contacts because GHL rate-limits, so its runtime
 * grows with the tenant and no single request can ever be long enough. The
 * function now stops while it still has time to answer and reports how far it
 * got; this drives it to the end, one leg at a time.
 *
 * Each leg is a fresh request with its own 120s budget, so the browser never
 * aborts. The loop is bounded so a server that stopped advancing cannot spin
 * here for ever.
 */
async function triggerGhlSync(onProgress?: (done: number, total: number) => void) {
  const MAX_LEGS = 40;
  let cursor: number | null = 0;
  let conversations = 0;
  let messages = 0;

  for (let leg = 0; leg < MAX_LEGS; leg++) {
    const { data, error } = await invokeSecureFunction("sync-ghl-conversations", {
      mode: "incremental",
      cursor,
    }, { timeoutMs: GHL_SYNC_TIMEOUT_MS });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);

    conversations += data?.conversations_synced ?? 0;
    messages += data?.messages_synced ?? 0;

    // A server that predates the cursor answers without `done`; treat that as
    // a single complete run rather than looping against it for ever.
    if (data?.done !== false) return { ...data, conversations_synced: conversations, messages_synced: messages };

    const next = typeof data?.cursor === "number" ? data.cursor : null;
    if (next === null || next === cursor) {
      return { ...data, conversations_synced: conversations, messages_synced: messages };
    }
    cursor = next;
    onProgress?.(next, data?.total_contacts ?? 0);
  }
  return { success: true, conversations_synced: conversations, messages_synced: messages, done: false };
}

// ── Page Component ───────────────────────────────────────────
export default function Conversations() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { settings: brandSettings } = useBrand();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchTerm, setSearchTerm] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("id"),
  );
  const [replyText, setReplyText] = useState("");
  const [replyChannel, setReplyChannel] = useState<string>("sms");
  const [emailSubject, setEmailSubject] = useState("");
  const [selectedMailbox, setSelectedMailbox] = useState<string>("admin");
  const requestKeysRef = useRef<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExportingHistory, setIsExportingHistory] = useState(false);
  const [exportJobStatus, setExportJobStatus] =
    useState<ExportJobStatus | null>(null);

  // Resizable panel state
  const [convPanelWidth, setConvPanelWidth] = useState(390);
  const isDraggingConvRef = useRef(false);
  const dragStartXConvRef = useRef(0);
  const dragStartWidthConvRef = useRef(390);

  // ── Sync from GHL API then refetch local data ──
  const handleSyncAndRefresh = async () => {
    setIsSyncing(true);
    setSyncErrorMessage(null);
    try {
      await triggerGhlSync();
      await refetchConversations();
      if (selectedId) {
        queryClient.invalidateQueries({
          queryKey: ["conversation-messages", selectedId],
        });
      }
      toast.success("Conversations synced from GHL");
      setSyncErrorMessage(null);
    } catch (err: any) {
      console.error("GHL sync failed:", err);
      const message = err?.message || "Unknown sync error";
      setSyncErrorMessage(message);
      toast.error("Sync failed: " + message);
      // Still refetch local data
      await refetchConversations();
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Fetch ALL conversations via edge function ──
  const {
    data: conversations = [],
    isLoading: loadingConversations,
    error: conversationsError,
    refetch: refetchConversations,
  } = useQuery({
    queryKey: ["all-conversations"],
    queryFn: async () => {
      // Fetch all conversations through the secure edge function
      // The columns this page actually reads. It used to ask for `*` across
      // every conversation on the deployment — 1,000 rows of every column,
      // `last_message_body` included, on each mount and each window focus,
      // which is most of what "this page is super laggy" (19 Sep 2026 clone
      // audit) was paying for. `available_channels` feeds the channel filter
      // and `client_id` resolves the names below.
      const { data, error } = await invokeSecureFunction("get-client-data", {
        listMode: true,
        listOptions: {
          table: "ghl_conversations",
          select:
            "id, client_id, ghl_conversation_id, ghl_contact_id, channel_type, "
            + "last_message_body, last_message_date, last_message_direction, "
            + "unread_count, conversation_status, available_channels",
          orderBy: "last_message_date",
          order_asc: false,
        },
      });
      if (error) throw new Error(error.message);
      const convos = (data?.records || []) as any[];

      // Fetch client names for all unique client_ids
      const clientIds = [
        ...new Set(convos.map((c) => c.client_id).filter(Boolean)),
      ] as string[];
      let clientMap: Record<string, { name: string; email: string | null }> =
        {};
      if (clientIds.length > 0) {
        const { data: clientData, error: clientErr } =
          await invokeSecureFunction("get-client-data", {
            clientIds,
          });
        if (!clientErr && clientData?.clients) {
          clientData.clients.forEach((c: any) => {
            const cl = c.client || c;
            clientMap[c.id] = {
              name:
                [cl.primary_first_name, cl.primary_surname]
                  .filter(Boolean)
                  .join(" ") || "Unknown",
              email: cl.primary_email,
            };
          });
        }
      }

      return convos.map((c) => ({
        ...c,
        client_name: c.client_id
          ? clientMap[c.client_id]?.name || "Unknown"
          : "Unlinked Contact",
        client_email: c.client_id ? clientMap[c.client_id]?.email : null,
      })) as ConversationRow[];
    },
  });

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId],
  );

  // ── Fetch messages for selected conversation ──
  const {
    data: messages = [],
    isLoading: loadingMessages,
    error: messagesError,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ["conversation-messages", selectedId],
    queryFn: async () => {
      if (!selectedId) return [];
      const { data, error } = await invokeSecureFunction("get-client-data", {
        listMode: true,
        listOptions: {
          table: "ghl_conversation_messages",
          filters: { conversation_id: selectedId },
          orderBy: "ghl_date_added",
          order_asc: true,
        },
      });
      if (error) throw new Error(error.message);
      return (data?.records || []) as Message[];
    },
    enabled: !!selectedId,
  });

  // ── Correspondence only ──
  // `/conversations/{id}/messages` returns a thread's ENTRIES, and GHL puts its
  // own activity records among them — "Opportunity updated", an appointment
  // title, "DnD enabled by customer", a call with no body at all. They are not
  // correspondence and must not be drawn as it; `isCorrespondence` is the one
  // place that decides, shared with the sync that writes them. Nothing is
  // deleted: the rows stay, and 465 of this deployment's threads hold NOTHING
  // else, which is why the empty state below reads the filtered list and says
  // what is being withheld rather than drawing an empty scroller.
  //
  // Declared HERE, directly under the query it derives from, and NOT beside the
  // grouping that consumes it. Two effects below name it in a dependency array,
  // and a dependency array is an ordinary expression evaluated during render —
  // so a `const` declared after them is read inside its temporal dead zone and
  // throws `ReferenceError: Cannot access 'correspondence' before
  // initialization` on every render, taking the whole page to the error
  // boundary. It shipped that way once. Keep this above the first reader.
  const correspondence = useMemo(
    () => messages.filter((msg) => isCorrespondence(msg.channel_type)),
    [messages],
  );
  const withheldNotice = useMemo(
    () => withheldEntriesSentence(
      summariseWithheldEntries(messages.map((msg) => msg.channel_type)),
    ),
    [messages],
  );

  // ── Mailboxes ──
  const { data: mailboxes = [] } = useQuery({
    queryKey: ["mailboxes-conversations-page"],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction("get-client-data", {
        listMode: true,
        listOptions: {
          table: "custom_users",
          select: "id, email, personal_mailbox",
        },
      });
      if (error) throw new Error(error.message);
      return (data?.records || []).filter((u: any) => u.personal_mailbox) || [];
    },
    enabled: replyChannel === "email",
  });

  // ── Send reply ──
  const sendMutation = useMutation({
    mutationFn: async ({
      conversationId,
      message,
      channel,
      subject,
      idempotencyKey,
    }: {
      conversationId: string;
      message: string;
      channel: "sms" | "whatsapp" | "email";
      subject?: string;
      idempotencyKey: string;
    }) => {
      if (channel === "email") {
        const email = selectedConversation?.client_email;
        if (!email) throw new Error("Client does not have an email address");
        const { data, error } = await invokeSecureFunction("send-email-reply", {
          to: email,
          subject:
            subject ||
            `Message from ${brandSettings.companyName || "Dashboard"}`,
          body: message,
          mailboxSource: selectedMailbox,
          senderMailboxId: selectedMailbox === "personal" ? user?.id : undefined,
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        // The thread reads `ghl_conversation_messages` and nothing else, while
        // an email reply goes out through Outlook — which writes nothing there.
        // So the message appeared optimistically, the refetch replaced the
        // cache with the server's rows, and it vanished: "I sent an email to
        // Arvin Raj, there's no history of it in the chat window". Recording it
        // is what makes the history real.
        //
        // The id is prefixed so it can never be mistaken for a GoHighLevel one,
        // and the write cannot fail the send — the email has already gone.
        try {
          await invokeSecureFunction("manage-client-data", {
            operation: "create",
            table: "ghl_conversation_messages",
            data: {
              conversation_id: conversationId,
              ghl_message_id: `local-email-${idempotencyKey}`,
              direction: "outbound",
              channel_type: "email",
              body: subject ? `${subject}\n\n${message}` : message,
              message_status: "sent",
              ghl_date_added: new Date().toISOString(),
            },
          });
        } catch (persistError) {
          console.error("[Conversations] sent email not recorded in thread:", persistError);
          toast.warning("Email sent, but it could not be added to the conversation history.");
        }
        return data;
      }
      const { data, error } = await invokeSecureFunction("send-ghl-message", {
        conversationId,
        message,
        channel,
        idempotencyKey,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data, variables) => {
      setReplyText("");
      setEmailSubject("");
      if (selectedId) delete requestKeysRef.current[selectedId];
      toast.success("Message sent");
      // Optimistically add the sent message to the cache so it appears immediately
      queryClient.setQueryData(
        ["conversation-messages", selectedId],
        (old: Message[] | undefined) => {
          if (!old) return old;
          const optimisticMsg: Message = {
            id: `optimistic-${Date.now()}`,
            ghl_message_id: `opt-${Date.now()}`,
            body: variables.message,
            direction: "outbound",
            channel_type: variables.channel,
            content_type: null,
            ghl_date_added: new Date().toISOString(),
            message_status: "sent",
            client_request_id: variables.idempotencyKey,
            attachment_urls: null,
            sender_name: null,
          };
          return [...old, optimisticMsg];
        },
      );
      // Also refetch to get the real server data
      queryClient.invalidateQueries({
        queryKey: ["conversation-messages", selectedId],
      });
      refetchConversations();
    },
    onError: (err: any, variables) => {
      const messageId = `failed-${variables.idempotencyKey}`;
      queryClient.setQueryData(
        ["conversation-messages", selectedId],
        (old: Message[] | undefined) => {
          const failed: Message = {
            id: messageId,
            ghl_message_id: messageId,
            body: variables.message,
            direction: "outbound",
            channel_type: variables.channel,
            content_type: null,
            ghl_date_added: new Date().toISOString(),
            message_status: "failed",
            error_message: err?.message || "Message could not be sent.",
            client_request_id: variables.idempotencyKey,
            attachment_urls: null,
            sender_name: null,
          };
          return [...(old || []).filter((item) => item.client_request_id !== variables.idempotencyKey), failed];
        },
      );
      toast.error(err?.message || "Message could not be sent.");
    },
  });

  // ── Realtime subscription ──
  useEffect(() => {
    const channel = supabase
      .channel("conversations-page-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ghl_conversations" },
        () => {
          refetchConversations();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ghl_conversation_messages",
        },
        (payload) => {
          if (
            selectedId &&
            (payload.new as any).conversation_id === selectedId
          ) {
            queryClient.invalidateQueries({
              queryKey: ["conversation-messages", selectedId],
            });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedId]);

  /**
   * What this thread is on, from the messages in it.
   *
   * Computed once and used for the header badge, the avatar and the default
   * reply channel, so those three cannot say different things — and so none of
   * them says "SMS" about an email thread because the stored column happens to
   * be unset.
   */
  const activeChannel = useMemo(
    () => threadChannel(selectedConversation, correspondence),
    [selectedConversation, correspondence],
  );

  // ── When conversation changes ──
  useEffect(() => {
    if (selectedConversation) {
      // A thread whose channel we cannot read still has to be replied to on
      // something, and SMS is the product's default outbound channel — but it
      // is chosen here, deliberately, rather than arriving as the answer to
      // "what channel is this?"
      setReplyChannel(["sms", "email", "whatsapp"].includes(activeChannel) ? (activeChannel as 'sms' | 'email' | 'whatsapp') : "sms");
      setEmailSubject("");
      setReplyText("");
    }
    // Seeded on the thread and on the first reading of its channel; not on
    // every message that arrives afterwards, which would move the control
    // under the operator mid-reply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, activeChannel]);

  // ── Auto-scroll messages ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [correspondence]);

  // ── Deep-link from notification ──
  useEffect(() => {
    const id = searchParams.get("id");
    if (id && id !== selectedId) setSelectedId(id);
  }, [searchParams]);

  // ── Filter conversations ──
  const filteredConversations = useMemo(() => {
    let list = conversations;
    if (channelFilter !== "all") {
      list = list.filter(
        (c) =>
          normalizeChannel(c.channel_type) === channelFilter ||
          c.available_channels?.some(
            (channel) => normalizeChannel(channel) === channelFilter,
          ),
      );
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (c) =>
          c.client_name?.toLowerCase().includes(term) ||
          c.last_message_body?.toLowerCase().includes(term),
      );
    }
    return list;
  }, [conversations, channelFilter, searchTerm]);

  // ── Group messages by date ──
  const groupedMessages = useMemo(() => {
    const groups: { label: string; messages: Message[] }[] = [];
    let currentLabel = "";
    correspondence.forEach((msg) => {
      const d = msg.ghl_date_added ? new Date(msg.ghl_date_added) : new Date();
      let label: string;
      if (isToday(d)) label = "Today";
      else if (isYesterday(d)) label = "Yesterday";
      else label = format(d, "EEEE, dd MMMM yyyy");
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });
    return groups;
  }, [correspondence]);

  const formatConversationDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";
    if (isToday(d)) return format(d, "h:mm a");
    if (isYesterday(d)) return "Yesterday";
    return format(d, "dd/MM/yy");
  };

  // ── Full message history export (server-side, async) ──
  // Spawns a background edge worker that paginates everything (no 1000-row
  // cap), builds the file, uploads to storage, returns a signed URL.
  // The browser only polls a small status row.
  const exportFullMessageHistory = async (fileFormat: "csv" | "xlsx") => {
    if (filteredConversations.length === 0) {
      toast.error("No conversations in current view to export");
      return;
    }
    setIsExportingHistory(true);
    setExportJobStatus({
      jobId: "starting",
      status: "starting",
      fileFormat,
      totalItems: filteredConversations.length,
      processedItems: 0,
      totalMessages: 0,
    });
    const toastId = toast.loading(
      `Starting export of ${filteredConversations.length} conversations...`,
    );
    try {
      // 1. Kick off the job
      const conversationIds = filteredConversations.map((c) => c.id);
      const { data: startData, error: startErr } =
        await invokeSecureFunction<any>(
          "start-conversations-export",
          { conversation_ids: conversationIds, file_format: fileFormat },
          { timeoutMs: 30000 },
        );
      if (startErr)
        throw new Error(startErr.message || "Failed to start export");
      const jobId = (startData as any)?.job_id;
      if (!jobId) throw new Error("No job_id returned from server");
      setExportJobStatus((prev) =>
        prev ? { ...prev, jobId, status: "pending" } : null,
      );

      // 2. Poll status (up to 10 minutes)
      const pollIntervalMs = 2500;
      const maxAttempts = Math.ceil((10 * 60 * 1000) / pollIntervalMs);
      let lastProcessed = -1;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));

        let job: any = null;
        try {
          const { data, error } = await invokeSecureFunction<any>(
            "get-client-data",
            {
              listMode: true,
              listOptions: {
                table: "export_jobs",
                filters: { id: jobId },
                limit: 1,
              },
            },
            { timeoutMs: 15000 },
          );
          if (error) throw new Error(error.message);
          job = ((data as any)?.records || [])[0];
        } catch (e: any) {
          console.warn("[exportFullMessageHistory] poll error:", e?.message);
          continue;
        }

        if (!job) continue;

        const lastServerUpdate =
          job.updated_at || job.started_at || job.created_at;
        const staleMs = lastServerUpdate
          ? Date.now() - new Date(lastServerUpdate).getTime()
          : 0;
        if (
          (job.status === "pending" || job.status === "processing") &&
          staleMs > 3 * 60 * 1000
        ) {
          throw new Error(
            "Export worker stopped responding. Please retry the export.",
          );
        }

        setExportJobStatus({
          jobId,
          status: job.status,
          fileFormat,
          totalItems: job.total_items || filteredConversations.length,
          processedItems: job.processed_items || 0,
          totalMessages: job.total_messages || 0,
          signedUrl: job.signed_url,
          fileSizeBytes: job.file_size_bytes,
          errorSummary: job.error_summary,
        });

        if (job.processed_items !== lastProcessed) {
          lastProcessed = job.processed_items;
          toast.loading(
            `Processed ${job.processed_items}/${job.total_items} conversations` +
              (job.total_messages ? ` · ${job.total_messages} messages` : ""),
            { id: toastId },
          );
        }

        if (job.status === "completed") {
          if (!job.signed_url)
            throw new Error(
              "Export completed but no download URL was provided",
            );
          const a = document.createElement("a");
          a.href = job.signed_url;
          a.download = "";
          a.target = "_blank";
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          const sizeMB = job.file_size_bytes
            ? (job.file_size_bytes / (1024 * 1024)).toFixed(2)
            : null;
          toast.success(
            `Export ready · ${job.total_messages} messages from ${job.processed_items} conversations` +
              (sizeMB ? ` (${sizeMB} MB)` : ""),
            { id: toastId, duration: 8000 },
          );
          setExportJobStatus((prev) =>
            prev ? { ...prev, status: "completed" } : null,
          );
          return;
        }

        if (job.status === "failed")
          throw new Error(job.error_summary || "Export worker failed");
        if (job.status === "cancelled") throw new Error("Export was cancelled");
      }

      throw new Error(
        "Export timed out after 10 minutes. Check the export jobs table for status.",
      );
    } catch (err: any) {
      console.error("Full history export failed:", err);
      setExportJobStatus((prev) =>
        prev
          ? {
              ...prev,
              status: "failed",
              errorSummary: err?.message || "Unknown error",
            }
          : null,
      );
      toast.error(`Export failed: ${err?.message || "Unknown error"}`, {
        id: toastId,
      });
    } finally {
      setIsExportingHistory(false);
    }
  };

  const ghlExportFields = [
    { key: "first_name", label: "First Name" },
    { key: "last_name", label: "Last Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "tags", label: "Tags" },
    { key: "source", label: "Source" },
    { key: "contact_id", label: "Contact ID" },
    { key: "conversation_id", label: "Conversation ID" },
    { key: "channel", label: "Channel" },
    { key: "last_message", label: "Last Message" },
    { key: "last_message_date", label: "Last Message Date" },
    { key: "unread_count", label: "Unread Count" },
  ];
  const ghlExportRecords = filteredConversations.map((conversation) => {
    const [firstName = "", ...rest] = (conversation.client_name || "").split(
      " ",
    );
    return {
      first_name: firstName,
      last_name: rest.join(" "),
      email: conversation.client_email || "",
      phone: "",
      tags: "Conversation Export",
      source: "GHL Conversations",
      contact_id: conversation.ghl_contact_id || "",
      conversation_id: conversation.ghl_conversation_id || "",
      channel: normalizeChannel(conversation.channel_type),
      last_message: conversation.last_message_body || "",
      last_message_date: conversation.last_message_date
        ? format(
            new Date(conversation.last_message_date),
            "yyyy-MM-dd HH:mm:ss",
          )
        : "",
      unread_count: String(conversation.unread_count || 0),
    };
  });

  const handleSelectConversation = async (conv: ConversationRow) => {
    setSelectedId(conv.id);
    setSearchParams({ id: conv.id });

    // Mark as read: reset unread_count to 0
    if (conv.unread_count > 0) {
      try {
        await invokeSecureFunction("manage-client-data", {
          table: "ghl_conversations",
          operation: "update",
          id: conv.id,
          data: { unread_count: 0 },
        });
        // Optimistically update the local cache
        queryClient.setQueryData(
          ["all-conversations"],
          (old: ConversationRow[] | undefined) =>
            (old || []).map((c) =>
              c.id === conv.id ? { ...c, unread_count: 0 } : c,
            ),
        );
      } catch (err) {
        console.error("Failed to mark conversation as read:", err);
      }
    }
  };

  const handleBack = () => {
    setSelectedId(null);
    setSearchParams({});
  };

  const handleSendReply = () => {
    if (!replyText.trim() || !selectedConversation) return;
    if (replyChannel === "email" && !emailSubject.trim()) {
      toast.error("Please enter an email subject");
      return;
    }
    const idempotencyKey = requestKeysRef.current[selectedConversation.id] || crypto.randomUUID();
    requestKeysRef.current[selectedConversation.id] = idempotencyKey;
    sendMutation.mutate({
      conversationId: selectedConversation.ghl_conversation_id,
      message: replyText.trim(),
      channel: replyChannel as "sms" | "whatsapp" | "email",
      idempotencyKey,
      ...(replyChannel === "email" && emailSubject.trim()
        ? { subject: emailSubject.trim() }
        : {}),
    });
  };

  const retryMessage = (message: Message) => {
    if (!selectedConversation || message.message_status !== "failed" || !message.body) return;
    const channel = normalizeChannel(message.channel_type) as "sms" | "whatsapp" | "email";
    const idempotencyKey = message.client_request_id || crypto.randomUUID();
    requestKeysRef.current[selectedConversation.id] = idempotencyKey;
    sendMutation.mutate({
      conversationId: selectedConversation.ghl_conversation_id,
      message: message.body,
      channel,
      idempotencyKey,
    });
  };

  const exportProgressPercent = exportJobStatus?.totalItems
    ? Math.min(
        100,
        Math.round(
          (exportJobStatus.processedItems / exportJobStatus.totalItems) * 100,
        ),
      )
    : 0;
  const exportSizeMB = exportJobStatus?.fileSizeBytes
    ? (exportJobStatus.fileSizeBytes / (1024 * 1024)).toFixed(2)
    : null;
  const exportStateStyles =
    exportJobStatus?.status === "completed"
      ? {
          panel:
            "border-success/30 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_34%),linear-gradient(135deg,rgba(6,78,59,0.32),rgba(9,9,11,0.88))] shadow-success/30",
          iconWrap:
            "border-success/35 bg-success/12 text-success shadow-[0_0_22px_rgba(16,185,129,0.22)]",
          icon: "text-success",
          title: "text-success-foreground",
          meta: "text-success-foreground/75",
          progressTrack: "bg-success/50",
          progressFill:
            "bg-gradient-to-r from-success via-success to-info shadow-[0_0_18px_rgba(45,212,191,0.45)]",
        }
      : exportJobStatus?.status === "failed"
        ? {
            panel:
              "border-destructive/30 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.16),transparent_34%),linear-gradient(135deg,rgba(127,29,29,0.28),rgba(9,9,11,0.9))] shadow-destructive/30",
            iconWrap:
              "border-destructive/35 bg-destructive/12 text-destructive shadow-[0_0_22px_rgba(239,68,68,0.20)]",
            icon: "text-destructive",
            title: "text-destructive-foreground",
            meta: "text-destructive-foreground/80",
            progressTrack: "bg-destructive/50",
            progressFill: "bg-destructive/30",
          }
        : {
            panel:
              "border-brand-300/30 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.20),transparent_34%),linear-gradient(135deg,rgba(120,53,15,0.30),rgba(9,9,11,0.9))] shadow-brand-950/30",
            iconWrap:
              "border-brand-200/35 bg-brand-300/12 text-brand-200 shadow-[0_0_24px_rgba(245,158,11,0.24)]",
            icon: "text-brand-200",
            title: "text-brand-50",
            meta: "text-brand-100/75",
            progressTrack: "bg-brand-950/45",
            progressFill:
              "bg-gradient-to-r from-brand-300 via-warning to-brand-200 shadow-[0_0_18px_rgba(251,191,36,0.45)]",
          };

  // Keep both panes available at every breakpoint; smaller screens stack panes with internal scrolling.
  const showList = true;

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <DashboardThemeFrame
      as="main"
      variant="page"
      className="flex h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] min-h-0 max-w-none flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_30%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--background))_45%,hsl(var(--muted)/0.18))] p-2 text-foreground md:p-4"
    >
      {/* Page header */}
      <DashboardThemeFrame as="header" variant="hero" className="relative z-10 flex shrink-0 flex-col gap-4 overflow-hidden border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.88),hsl(var(--background)/0.78)_48%,hsl(var(--primary)/0.12))] px-4 py-4 shadow-2xl shadow-sm dark:shadow-black/35 md:flex-row md:items-center md:justify-between md:px-5">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/70 to-transparent" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-40 w-40 rounded-full bg-brand-300/10 blur-3xl" />
        <div className="relative flex min-w-0 flex-1 items-center gap-3">
          {isMobile && selectedId && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Back to all conversations"
              className="h-10 w-10 shrink-0 rounded-full p-0 text-foreground dark:text-foreground hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={handleBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-brand-200/30 bg-[radial-gradient(circle_at_30%_20%,rgba(251,191,36,0.32),rgba(245,158,11,0.10)_55%,rgba(0,0,0,0.25))] shadow-[0_0_36px_rgba(234,179,8,0.18)]">
            <MessageSquare className="h-5 w-5 text-brand-200" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground dark:text-white md:text-3xl">
                Conversations
              </h1>
              {!loadingConversations && (
                <Badge
                  variant="secondary"
                  className="rounded-full border border-brand-200/30 bg-brand-300/10 px-3 py-1 text-xs font-semibold text-brand-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_22px_rgba(234,179,8,0.12)]"
                >
                  <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-success/30 shadow-[0_0_10px_rgba(110,231,183,0.8)]" />
                  {conversations.length} total
                </Badge>
              )}
            </div>
            <p className="hidden text-sm text-muted-foreground dark:text-muted-foreground sm:block">
              Premium CRM communications centre
            </p>
          </div>
        </div>
        <div className="relative flex w-full flex-wrap items-center gap-2.5 sm:w-auto md:justify-end [&>button]:min-h-10 [&>button]:flex-1 sm:[&>button]:flex-none">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={isExportingHistory}
                className={cn(
                  "h-10 rounded-full px-4 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:translate-y-0 disabled:cursor-not-allowed",
                  isExportingHistory
                    ? "border-brand-200/45 bg-brand-500/15 text-brand-50 shadow-brand-950/30 disabled:opacity-100"
                    : "border-brand-200/25 bg-background/75 dark:bg-background/75 text-foreground dark:text-foreground hover:border-brand-200/65 hover:bg-brand-300/10 hover:text-brand-50 hover:shadow-[0_0_30px_rgba(245,158,11,0.18)] disabled:opacity-60",
                )}
              >
                {isExportingHistory ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand-200" />
                ) : (
                  <ExternalLink className="mr-2 h-4 w-4" />
                )}
                {isExportingHistory ? "Exporting…" : "Export"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64 border-brand-200/15 bg-background/95 dark:bg-background/95 text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/45 backdrop-blur-xl"
            >
              <DropdownMenuItem
                onClick={() => setShowExportDialog(true)}
                className="rounded-lg focus:bg-brand-300/10 focus:text-brand-100"
              >
                Conversation summary (GHL contacts)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => exportFullMessageHistory("xlsx")}
                disabled={isExportingHistory}
                className="rounded-lg focus:bg-brand-300/10 focus:text-brand-100"
              >
                Full message history (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => exportFullMessageHistory("csv")}
                disabled={isExportingHistory}
                className="rounded-lg focus:bg-brand-300/10 focus:text-brand-100"
              >
                Full message history (.csv)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "group h-10 rounded-full px-4 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:translate-y-0 disabled:cursor-not-allowed",
              isSyncing || loadingConversations
                ? "border-brand-200/45 bg-brand-500/15 text-brand-50 shadow-[0_0_28px_rgba(245,158,11,0.16)] disabled:opacity-100"
                : "border-success/25 bg-success/30 text-success shadow-[0_0_24px_rgba(16,185,129,0.08)] hover:border-brand-200/55 hover:bg-brand-300/10 hover:text-brand-50 hover:shadow-[0_0_30px_rgba(245,158,11,0.16)] disabled:opacity-65",
            )}
            onClick={handleSyncAndRefresh}
            disabled={isSyncing || loadingConversations}
          >
            <span
              className={cn(
                "mr-2 flex h-5 w-5 items-center justify-center rounded-full border",
                isSyncing || loadingConversations
                  ? "border-brand-200/35 bg-brand-300/15 shadow-[0_0_18px_rgba(251,191,36,0.24)]"
                  : "border-success/25 bg-success/10",
              )}
            >
              {isSyncing || loadingConversations ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand-200" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 text-success transition-transform group-hover:scale-110" />
              )}
            </span>
            {isSyncing
              ? "Syncing…"
              : loadingConversations
                ? "Loading…"
                : "Sync"}
          </Button>
        </div>
      </DashboardThemeFrame>

      {exportJobStatus && (
        <div
          className={cn(
            "mt-3 shrink-0 overflow-hidden rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-xl",
            exportStateStyles.panel,
          )}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {exportJobStatus.status === "completed" ? (
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full border",
                      exportStateStyles.iconWrap,
                    )}
                  >
                    <CheckCircle2
                      className={cn("h-4 w-4", exportStateStyles.icon)}
                    />
                  </span>
                ) : exportJobStatus.status === "failed" ? (
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full border",
                      exportStateStyles.iconWrap,
                    )}
                  >
                    <XCircle
                      className={cn("h-4 w-4", exportStateStyles.icon)}
                    />
                  </span>
                ) : (
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full border",
                      exportStateStyles.iconWrap,
                    )}
                  >
                    <Loader2
                      className={cn(
                        "h-4 w-4 animate-spin",
                        exportStateStyles.icon,
                      )}
                    />
                  </span>
                )}
                <span className={cn("font-semibold", exportStateStyles.title)}>
                  {exportJobStatus.status === "completed"
                    ? "Conversation export ready"
                    : exportJobStatus.status === "failed"
                      ? "Conversation export failed"
                      : `Exporting full message history (${exportJobStatus.fileFormat.toUpperCase()})`}
                </span>
              </div>
              <p className={cn("truncate text-xs", exportStateStyles.meta)}>
                {exportJobStatus.status === "failed"
                  ? exportJobStatus.errorSummary
                  : `${exportJobStatus.processedItems}/${exportJobStatus.totalItems} conversations · ${exportJobStatus.totalMessages} messages`}
                {exportSizeMB ? ` · ${exportSizeMB} MB` : ""}
              </p>
              {exportJobStatus.status !== "completed" &&
                exportJobStatus.status !== "failed" && (
                  <div
                    className={cn(
                      "h-2 w-full max-w-xl overflow-hidden rounded-full border border-border dark:border-white/10 shadow-inner",
                      exportStateStyles.progressTrack,
                    )}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500 ease-out",
                        exportStateStyles.progressFill,
                      )}
                      style={{ width: `${exportProgressPercent}%` }}
                    />
                  </div>
                )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {exportJobStatus.status === "completed" &&
                exportJobStatus.signedUrl && (
                  <Button
                    size="sm"
                    className="rounded-full bg-success/30 text-success hover:bg-success/20"
                    asChild
                  >
                    <a
                      href={exportJobStatus.signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Download
                    </a>
                  </Button>
                )}
              {(exportJobStatus.status === "completed" ||
                exportJobStatus.status === "failed") && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full text-foreground dark:text-foreground hover:bg-white/10 hover:text-white"
                  onClick={() => setExportJobStatus(null)}
                >
                  Dismiss
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {syncErrorMessage && (
        <div className="mt-3 shrink-0 overflow-hidden rounded-2xl border border-brand-200/25 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_34%),linear-gradient(135deg,rgba(69,26,3,0.32),rgba(9,9,11,0.9))] px-4 py-3 shadow-xl shadow-sm dark:shadow-black/25 backdrop-blur-xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-200/35 bg-brand-300/12 text-brand-100 shadow-[0_0_22px_rgba(245,158,11,0.18)]">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-50">
                  Sync could not complete
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-brand-100/70">
                  {syncErrorMessage}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground dark:text-muted-foreground">
                  Your current conversation data remains visible. Retry when the
                  CRM connection is available.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full border-brand-200/35 bg-brand-300/10 text-brand-50 hover:bg-brand-300/15"
                onClick={handleSyncAndRefresh}
                disabled={isSyncing || loadingConversations}
              >
                <RefreshCw
                  className={cn(
                    "mr-1.5 h-3.5 w-3.5",
                    isSyncing && "animate-spin",
                  )}
                />
                Retry sync
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-muted-foreground dark:text-foreground hover:bg-white/10 hover:text-white"
                onClick={() => setSyncErrorMessage(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

      <GHLExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        title="Export conversations for GHL"
        description="Map the conversation list into GHL-compatible headers and export as CSV or XLSX."
        fields={ghlExportFields}
        records={ghlExportRecords}
        fileBaseName={`ghl-conversations-export-${format(new Date(), "yyyy-MM-dd")}`}
        sheetName="Conversations"
        onExported={(exportFormat, count) =>
          toast.success(
            `Exported ${count} conversations to ${exportFormat.toUpperCase()}`,
          )
        }
      />

      {/* Main content area */}
      <DashboardThemeFrame
        as="section"
        variant="section"
        className="mt-2 flex min-h-0 flex-1 basis-0 flex-col gap-2 overflow-hidden rounded-[2rem] border-border dark:border-white/10 bg-[linear-gradient(135deg,hsl(var(--background)/0.92),hsl(var(--card)/0.72))] p-1.5 shadow-2xl shadow-sm dark:shadow-black/40 lg:flex-row lg:gap-0"
        onMouseMove={(e) => {
          if (!isDraggingConvRef.current) return;
          const delta = e.clientX - dragStartXConvRef.current;
          const newWidth = Math.min(
            560,
            Math.max(300, dragStartWidthConvRef.current + delta),
          );
          setConvPanelWidth(newWidth);
        }}
        onMouseUp={() => {
          isDraggingConvRef.current = false;
        }}
        onMouseLeave={() => {
          isDraggingConvRef.current = false;
        }}
      >
        {/* ─── LEFT PANEL: Conversation List ─── */}
        {showList && (
          <div
            className={cn(
              "flex h-[36%] min-h-[15rem] w-full shrink-0 flex-col overflow-hidden rounded-[1.55rem] lg:h-full lg:min-h-0 lg:w-[var(--conversation-panel-width)] border border-border dark:border-white/12 bg-[radial-gradient(circle_at_20%_0%,rgba(245,158,11,0.10),transparent_28%),linear-gradient(180deg,rgba(24,24,27,0.98),rgba(9,9,11,0.92)_48%,rgba(3,3,5,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_-1px_0_0_rgba(255,255,255,0.035),0_22px_60px_rgba(0,0,0,0.34)]",
            )}
            style={
              {
                "--conversation-panel-width": `${convPanelWidth}px`,
              } as CSSProperties
            }
          >
            {/* Search & filter */}
            <div className="shrink-0 space-y-3.5 border-b border-brand-100/10 bg-[linear-gradient(180deg,rgba(9,9,11,0.98),rgba(24,24,27,0.74))] p-4 shadow-[inset_0_-1px_0_rgba(255,255,255,0.045),0_10px_30px_rgba(0,0,0,0.22)]">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground dark:text-muted-foreground">
                <span className="font-semibold uppercase tracking-[0.22em] text-brand-100/70">
                  Inbox
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200/18 bg-[linear-gradient(135deg,rgba(251,191,36,0.10),rgba(255,255,255,0.035))] px-2.5 py-1 font-semibold text-brand-100/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-success/30 shadow-[0_0_10px_rgba(110,231,183,0.75)]" />
                  {filteredConversations.length} shown
                </span>
              </div>
              <div className="relative group">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center">
                  <Search className="h-4 w-4 text-muted-foreground dark:text-muted-foreground transition-colors duration-200 group-focus-within:text-brand-300" />
                </div>
                <SearchInput
                  value={searchTerm}
                  onValueChange={setSearchTerm}
                  placeholder="Search conversations..."
                  aria-label="Search conversations by contact or message"
                  hideIcon
                  className="h-11 rounded-2xl border-brand-100/10 bg-[linear-gradient(135deg,rgba(0,0,0,0.62),rgba(39,39,42,0.38))] pl-11 pr-4 text-sm font-medium text-foreground dark:text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.055),inset_0_-10px_22px_rgba(0,0,0,0.20)] outline-none transition-all duration-200 placeholder:font-normal placeholder:text-muted-foreground dark:placeholder:text-muted-foreground hover:border-brand-100/24 hover:bg-black/65 focus-visible:border-brand-300/70 focus-visible:ring-2 focus-visible:ring-brand-300/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
              </div>
              <div className="flex flex-wrap gap-1.5 rounded-2xl border border-border dark:border-white/10 bg-background/35 dark:bg-black/35 p-1.5 shadow-inner shadow-sm dark:shadow-black/30">
                {["all", "sms", "email", "whatsapp"].map((ch) => (
                  <Button
                    key={ch}
                    variant={channelFilter === ch ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "min-h-8 flex-1 basis-[calc(50%-0.375rem)] rounded-xl px-3 text-xs font-semibold tracking-wide transition-all duration-200 sm:basis-auto sm:flex-none focus-visible:ring-2 focus-visible:ring-brand-300/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      channelFilter === ch
                        ? "border border-brand-200/60 bg-gradient-to-b from-brand-300 to-brand-500 text-black shadow-[0_0_24px_rgba(245,158,11,0.25),inset_0_1px_0_rgba(255,255,255,0.45)] hover:from-brand-200 hover:to-brand-400"
                        : "border border-transparent bg-card/45 dark:bg-background/45 text-muted-foreground/85 dark:text-foreground/85 hover:border-brand-300/35 hover:bg-brand-300/10 hover:text-brand-100",
                    )}
                    onClick={() => setChannelFilter(ch)}
                    aria-pressed={channelFilter === ch}
                    aria-label={`Filter conversations by ${ch === "all" ? "all channels" : ch}`}
                  >
                    {ch === "all"
                      ? "All"
                      : ch === "sms"
                        ? "SMS"
                        : ch === "whatsapp"
                          ? "WhatsApp"
                          : "Email"}
                  </Button>
                ))}
              </div>
            </div>

            {/* Conversation list */}
            <ScrollArea
              aria-label="Conversation list"
              className="min-h-0 flex-1 basis-0 overscroll-contain bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.055),transparent_34%)] [scrollbar-color:rgba(161,161,170,0.72)_rgba(9,9,11,0.72)] [scrollbar-width:thin] [&_[data-orientation=vertical]]:w-3 [&_[data-orientation=vertical]]:border-l-white/5 [&_[data-radix-scroll-area-thumb]]:bg-gradient-to-b [&_[data-radix-scroll-area-thumb]]:from-brand-200/70 [&_[data-radix-scroll-area-thumb]]:via-muted/80 [&_[data-radix-scroll-area-thumb]]:to-background/80 [&_[data-radix-scroll-area-thumb]]:shadow-[0_0_14px_rgba(245,158,11,0.18)]"
            >
              {loadingConversations ? (
                <div className="space-y-3.5 p-4">
                  <div className="mb-1 flex items-center gap-2 rounded-2xl border border-brand-200/15 bg-brand-300/[0.045] px-3 py-2 text-xs font-medium text-brand-100/80">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Preparing your CRM inbox…
                  </div>
                  {[...Array(6)].map((_, i) => (
                    <div
                      key={i}
                      className="relative overflow-hidden rounded-2xl border border-border dark:border-white/[0.07] bg-[linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.02))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    >
                      <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/[0.055] to-transparent" />
                      <div className="relative flex items-center gap-3">
                        <Skeleton className="h-12 w-12 shrink-0 rounded-2xl bg-card/10 dark:bg-white/10" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-3.5 w-36 bg-card/10 dark:bg-white/10" />
                          <Skeleton className="h-3 w-full bg-card/10 dark:bg-white/10" />
                          <Skeleton className="h-3 w-2/3 bg-card/10 dark:bg-white/10" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : conversationsError ? (
                <div className="mx-3 mt-4 flex flex-col items-center justify-center rounded-3xl border border-destructive/20 bg-[radial-gradient(circle_at_top,rgba(244,63,94,0.12),transparent_34%),rgba(255,255,255,0.025)] px-5 py-14 text-center shadow-inner shadow-sm dark:shadow-black/20">
                  <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-semibold text-destructive-foreground">
                    Unable to load conversations
                  </p>
                  <p className="mt-2 max-w-[22rem] text-xs leading-5 text-destructive-foreground/65">
                    Conversation data could not be refreshed. Your workflow has
                    not been changed.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-4 rounded-full border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15"
                    onClick={() => refetchConversations()}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Retry
                  </Button>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="mx-3 mt-4 flex flex-col items-center justify-center rounded-3xl border border-brand-200/14 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.14),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018))] px-5 py-14 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_18px_46px_rgba(0,0,0,0.20)] text-center text-muted-foreground dark:text-muted-foreground">
                  <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-100/20 bg-brand-300/10 text-brand-100/80">
                    {conversations.length === 0 ? (
                      <Inbox className="h-5 w-5" />
                    ) : channelFilter !== "all" ? (
                      <FilterX className="h-5 w-5" />
                    ) : (
                      <Search className="h-5 w-5" />
                    )}
                  </span>
                  <p className="text-sm font-semibold text-foreground dark:text-foreground">
                    {conversations.length === 0
                      ? "No conversations yet"
                      : channelFilter !== "all"
                        ? "No conversations for this channel"
                        : "No search results"}
                  </p>
                  <p className="mt-2 max-w-[22rem] text-xs leading-5 text-muted-foreground dark:text-muted-foreground">
                    {conversations.length === 0
                      ? "Synced CRM conversations will appear here without adding sample data."
                      : channelFilter !== "all"
                        ? "Try another channel or reset filters to review the full inbox."
                        : "Try a different contact name or message keyword."}
                  </p>
                  {(searchTerm || channelFilter !== "all") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-4 rounded-full border-brand-200/25 bg-brand-300/10 text-brand-50 hover:bg-brand-300/15"
                      onClick={() => {
                        setSearchTerm("");
                        setChannelFilter("all");
                      }}
                    >
                      Reset filters
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5 p-3">
                  {filteredConversations.map((conv) => {
                    const normalized = normalizeChannel(conv.channel_type);
                    const Icon = channelIcons[normalized] || MessageSquare;
                    const isActive = conv.id === selectedId;

                    return (
                      <button
                        key={conv.id}
                        className={cn(
                          "group relative flex min-h-[5.6rem] w-full cursor-pointer items-center gap-4 overflow-hidden rounded-[1.55rem] border border-border bg-card/55 px-4 py-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_14px_30px_rgba(0,0,0,0.14)] outline-none transition-all duration-200 before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-full before:bg-primary before:opacity-0 before:transition-opacity after:absolute after:inset-x-6 after:-bottom-[6px] after:h-px after:bg-gradient-to-r after:from-transparent after:via-white/[0.08] after:to-transparent last:after:hidden focus-visible:border-primary/65 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:-translate-y-0.5 hover:border-border hover:bg-muted/70 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_38px_rgba(0,0,0,0.28)]",
                          isActive
                            ? "border-primary/65 bg-primary/12 shadow-[inset_4px_0_0_hsl(var(--primary)),0_0_0_1px_hsl(var(--primary)/0.12),0_20px_42px_hsl(var(--primary)/0.13)] before:opacity-100"
                            : "",
                          conv.unread_count > 0 &&
                            !isActive &&
                            "border-primary/30 bg-card/70 shadow-[inset_3px_0_0_hsl(var(--primary)/0.85),0_16px_34px_hsl(var(--primary)/0.08)] before:opacity-100",
                        )}
                        onClick={() => handleSelectConversation(conv)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelectConversation(conv);
                          }
                        }}
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        aria-label={`Open conversation with ${conv.client_name || "Unknown contact"}${conv.unread_count > 0 ? `, ${conv.unread_count} unread` : ""}`}
                        title={`${conv.client_name || "Unknown contact"}${conv.last_message_body ? ` — ${conv.last_message_body}` : " — No messages yet"}`}
                      >
                        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-100/25 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                        <div
                          className={cn(
                            "relative flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.35rem] border border-border dark:border-white/10 bg-gradient-to-br shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_16px_34px_rgba(0,0,0,0.28)] ring-1 ring-border dark:ring-white/[0.045] transition-all duration-200 before:absolute before:inset-1 before:rounded-[1.05rem] before:border before:border-white/[0.055] before:bg-white/[0.025] group-hover:scale-105 group-hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_18px_36px_rgba(245,158,11,0.10)]",
                            avatarBackgrounds[normalized] ||
                              "from-muted/30 via-muted/16 to-card dark:to-background",
                          )}
                        >
                          <span className="relative z-10 text-base font-bold tracking-[-0.03em] text-foreground dark:text-white drop-shadow">
                            {getContactInitials(conv.client_name)}
                          </span>
                          <span
                            className={cn(
                              "absolute -bottom-1.5 -right-1.5 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-border/90 bg-background dark:bg-background shadow-[0_8px_18px_rgba(0,0,0,0.36)] ring-1 ring-border dark:ring-white/10",
                              channelColors[normalized] || "text-foreground dark:text-foreground",
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="absolute inset-0 rounded-[1.35rem] bg-gradient-to-br from-white/12 to-transparent opacity-60" />
                        </div>
                        <div className="relative min-w-0 flex-1 space-y-1">
                          <div className="flex items-start justify-between gap-3">
                            <span
                              className={cn(
                                "flex min-w-0 items-center gap-2 truncate text-[0.95rem] leading-5 tracking-[-0.01em] text-foreground dark:text-foreground transition-colors group-hover:text-white",
                                conv.unread_count > 0
                                  ? "font-bold"
                                  : "font-semibold",
                              )}
                              title={conv.client_name || "Unknown contact"}
                            >
                              {conv.unread_count > 0 && (
                                <span
                                  aria-hidden
                                  className="relative flex h-2 w-2 shrink-0"
                                >
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-300 opacity-70" />
                                  <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-300 shadow-[0_0_10px_rgba(251,191,36,0.9)]" />
                                </span>
                              )}
                              <span className="min-w-0 truncate">{conv.client_name}</span>
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                                conv.unread_count > 0
                                  ? "border-brand-200/40 bg-brand-300/10 text-brand-100"
                                  : "border-border dark:border-white/[0.07] bg-background/20 dark:bg-black/20 text-muted-foreground dark:text-muted-foreground group-hover:border-brand-200/20 group-hover:text-brand-100/80",
                              )}
                            >
                              {formatConversationDate(conv.last_message_date)}
                            </span>
                          </div>
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <p
                              className={cn(
                                "min-w-0 truncate text-[0.8rem] leading-5 transition-colors",
                                conv.unread_count > 0
                                  ? "font-medium text-foreground dark:text-foreground"
                                  : "text-muted-foreground/85 dark:text-muted-foreground/85 group-hover:text-foreground/90",
                              )}
                              title={
                                conv.last_message_body || "No messages yet"
                              }
                            >
                              {conv.last_message_direction === "outbound" && (
                                <span className="text-brand-100/55">You: </span>
                              )}
                              <span
                                className={cn(
                                  !conv.last_message_body &&
                                    "rounded-full border border-dashed border-border dark:border-white/10 bg-white/[0.035] px-2 py-0.5 italic text-muted-foreground/90 dark:text-muted-foreground/90",
                                )}
                              >
                                {conv.last_message_body || "No messages yet"}
                              </span>
                            </p>
                            {conv.unread_count > 0 && (
                              <span
                                className="relative flex shrink-0 items-center"
                                aria-label={`${conv.unread_count} unread`}
                              >
                                <span className="absolute inset-0 -m-0.5 rounded-full bg-brand-300/40 blur-[6px] animate-pulse" aria-hidden />
                                <Badge className="relative h-6 min-w-[26px] justify-center rounded-full border border-brand-200/50 bg-gradient-to-br from-brand-200 via-brand-300 to-brand-400 px-2 text-[10px] font-extrabold leading-none text-black tabular-nums shadow-[0_0_18px_rgba(251,191,36,0.55),inset_0_1px_0_rgba(255,255,255,0.55)]">
                                  {conv.unread_count > 99 ? "99+" : conv.unread_count}
                                </Badge>
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* Resizable Drag Handle */}
        {showList && (
          <div
            className="group relative mx-1 hidden w-2 flex-shrink-0 cursor-col-resize lg:block rounded-full bg-gradient-to-b from-white/5 via-white/10 to-white/5 transition-all hover:bg-brand-400/15"
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingConvRef.current = true;
              dragStartXConvRef.current = e.clientX;
              dragStartWidthConvRef.current = convPanelWidth;
            }}
          >
            <div className="absolute inset-y-6 left-1/2 w-1 -translate-x-1/2 rounded-full bg-card/15 dark:bg-white/15 shadow-[0_0_18px_rgba(255,255,255,0.08)] transition-colors group-hover:bg-brand-300/60" />
          </div>
        )}

        {/* ─── RIGHT PANEL: Thread View ─── */}
        <div
          className={cn(
            "flex h-[64%] min-h-[26rem] min-w-0 flex-1 flex-col lg:h-full overflow-hidden rounded-[1.55rem] border border-border dark:border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(234,179,8,0.10),transparent_30%),linear-gradient(180deg,rgba(24,24,27,0.84),rgba(9,9,11,0.92))] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
            !selectedId && "items-center justify-center p-6",
          )}
        >
          {!selectedId ? (
            <div className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-[1.35rem] p-4 sm:p-8">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(251,191,36,0.10),transparent_30%),radial-gradient(circle_at_12%_50%,rgba(250,204,21,0.07),transparent_18%),linear-gradient(135deg,rgba(255,255,255,0.035),transparent_38%,rgba(255,255,255,0.025))]" />
              <div className="pointer-events-none absolute left-3 top-1/2 hidden -translate-y-1/2 items-center gap-2 rounded-full border border-brand-200/10 bg-background/20 dark:bg-black/20 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-brand-100/35 shadow-inner shadow-sm dark:shadow-black/30 lg:flex">
                <ArrowLeft className="h-3.5 w-3.5" />
                Inbox
              </div>
              <div className="pointer-events-none absolute inset-x-12 top-10 h-px bg-gradient-to-r from-transparent via-brand-100/16 to-transparent" />
              <div className="relative w-full max-w-md overflow-hidden rounded-[2.25rem] border border-brand-200/18 bg-[linear-gradient(145deg,rgba(24,24,27,0.86),rgba(9,9,11,0.74)_52%,rgba(0,0,0,0.70))] p-8 text-center text-muted-foreground dark:text-muted-foreground shadow-[0_28px_90px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl sm:p-10">
                <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/70 to-transparent" />
                <div className="pointer-events-none absolute -right-16 -top-16 h-36 w-36 rounded-full bg-brand-300/10 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-20 left-1/2 h-32 w-56 -translate-x-1/2 rounded-full bg-white/[0.035] blur-3xl" />
                <div className="relative mx-auto mb-4 flex w-fit items-center gap-2 rounded-full border border-brand-200/15 bg-brand-300/[0.065] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-brand-100/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <Sparkles className="h-3 w-3" />
                  CRM workspace
                </div>
                <div className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-brand-100/22 bg-[radial-gradient(circle_at_35%_25%,rgba(254,243,199,0.18),rgba(245,158,11,0.09)_45%,rgba(24,24,27,0.66))] shadow-[0_0_55px_rgba(234,179,8,0.16),inset_0_1px_0_rgba(255,255,255,0.16)] ring-1 ring-border dark:ring-white/[0.055]">
                  <div className="absolute inset-2 rounded-[1.3rem] border border-border dark:border-white/[0.055] bg-background/10 dark:bg-black/10" />
                  <MessageSquare
                    className="relative h-9 w-9 text-brand-100/78 drop-shadow-[0_0_18px_rgba(251,191,36,0.22)]"
                    strokeWidth={1.7}
                  />
                </div>
                <p className="text-lg font-semibold tracking-[-0.02em] text-foreground dark:text-foreground sm:text-xl">
                  Select a conversation
                </p>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground/90 dark:text-muted-foreground/90">
                  Choose from the list to view messages
                </p>
                <div className="mx-auto mt-6 flex w-fit items-center gap-2 rounded-full border border-border dark:border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-medium text-brand-100/55 shadow-inner shadow-sm dark:shadow-black/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-300/70 shadow-[0_0_14px_rgba(251,191,36,0.65)]" />
                  Your message workspace is ready
                </div>
              </div>
            </div>
            ) : selectedConversation ? (

              <>
                {/* Thread header with client context */}
                <div className="relative shrink-0 overflow-hidden border-b border-brand-100/10 bg-[linear-gradient(135deg,rgba(9,9,11,0.96),rgba(24,24,27,0.90)_58%,rgba(120,53,15,0.12))] px-4 py-4 shadow-[0_14px_38px_rgba(0,0,0,0.24)] md:px-5">
                  <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/55 to-transparent" />
                  <div className="pointer-events-none absolute -right-12 -top-16 h-32 w-32 rounded-full bg-brand-300/10 blur-3xl" />
                  <div className="relative flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 flex-1 items-start gap-3.5">
                      {!isMobile && (
                        <div className={cn('relative flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.35rem] border border-border dark:border-white/10 bg-gradient-to-br shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_16px_34px_rgba(0,0,0,0.30)] ring-1 ring-border dark:ring-white/[0.045]', avatarBackgrounds[activeChannel] || 'from-muted/30 via-muted/16 to-card dark:to-background')}>
                          <span className="relative z-10 text-base font-bold tracking-[-0.03em] text-foreground dark:text-white drop-shadow">{getContactInitials(selectedConversation.client_name)}</span>
                          <span className={cn('absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-border/90 bg-background dark:bg-background shadow-[0_8px_18px_rgba(0,0,0,0.36)] ring-1 ring-border dark:ring-white/10', channelColors[activeChannel] || 'text-foreground dark:text-foreground')}>
                            {(() => { const I = channelIcons[activeChannel] || MessageSquare; return <I className="h-3.5 w-3.5" />; })()}
                          </span>
                          <span className="absolute inset-0 rounded-[1.35rem] bg-gradient-to-br from-white/12 to-transparent opacity-60" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Badge className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]', channelColors[activeChannel] || 'border-border dark:border-white/10 bg-white/[0.04] text-foreground dark:text-foreground')}>
                            {activeChannel === UNKNOWN_CHANNEL ? 'channel not recorded' : activeChannel.replace('_', ' ')}
                          </Badge>
                          <Badge variant="outline" className="rounded-full border-success/25 bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-success">
                            <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-success/30 shadow-[0_0_10px_rgba(110,231,183,0.75)]" />
                            {selectedConversation.unread_count > 0 ? `${selectedConversation.unread_count} unread` : 'Current'}
                          </Badge>
                          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border dark:border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] font-medium text-muted-foreground dark:text-muted-foreground">
                            <ShieldCheck className="h-3 w-3 shrink-0 text-brand-100/60" />
                            <span className="truncate">GHL source</span>
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="break-words text-xl font-semibold leading-tight tracking-[-0.035em] text-foreground dark:text-white md:text-2xl" title={selectedConversation.client_name || 'Unknown contact'}>{selectedConversation.client_name}</p>
                          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground dark:text-muted-foreground">
                            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 px-2.5 py-1">
                              <Mail className="h-3 w-3 shrink-0 text-muted-foreground dark:text-muted-foreground" />
                              <span className="truncate">{selectedConversation.client_email || 'No email on file'}</span>
                            </span>
                            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 px-2.5 py-1">
                              <Clock3 className="h-3 w-3 shrink-0 text-muted-foreground dark:text-muted-foreground" />
                              <span className="truncate">Last activity {formatConversationDate(selectedConversation.last_message_date) || 'not available'}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                      {selectedConversation.client_id && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-full border-brand-200/25 bg-background/70 dark:bg-background/70 px-3 text-xs font-semibold text-brand-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-brand-200/55 hover:bg-brand-300/10 hover:text-brand-50"
                          onClick={() => window.open(`/clients?clientId=${selectedConversation.client_id}`, '_blank')}
                        >
                          <UserRound className="mr-1.5 h-3.5 w-3.5" />
                          View Client <ExternalLink className="ml-1.5 h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 shrink-0 rounded-full border border-border dark:border-white/10 bg-white/[0.035] p-0 text-muted-foreground dark:text-foreground hover:border-brand-200/35 hover:bg-brand-300/10 hover:text-brand-50"
                        onClick={() => queryClient.invalidateQueries({ queryKey: ['conversation-messages', selectedId] })}
                        aria-label="Refresh selected conversation messages"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>



              {/* Messages */}
              <ScrollArea
                aria-label="Selected conversation message thread"
                className="min-h-0 flex-1 basis-0 overscroll-contain bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.035),transparent_38%)] [scrollbar-color:rgba(161,161,170,0.72)_rgba(9,9,11,0.72)] [scrollbar-width:thin] [&_[data-orientation=vertical]]:w-3 [&_[data-orientation=vertical]]:border-l-white/5 [&_[data-radix-scroll-area-thumb]]:bg-gradient-to-b [&_[data-radix-scroll-area-thumb]]:from-brand-200/70 [&_[data-radix-scroll-area-thumb]]:via-muted/80 [&_[data-radix-scroll-area-thumb]]:to-background/80 [&_[data-radix-scroll-area-thumb]]:shadow-[0_0_14px_rgba(245,158,11,0.18)]"
              >
                <div className="mx-auto w-full max-w-5xl px-4 py-5 md:px-6">
                  {loadingMessages ? (
                    <div className="mx-auto max-w-3xl space-y-4 py-8">
                      <div className="mx-auto mb-2 flex w-fit items-center gap-2 rounded-full border border-brand-200/15 bg-brand-300/[0.06] px-3 py-2 text-xs font-medium text-brand-100/80">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading message thread…
                      </div>
                      {[...Array(5)].map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "flex",
                            i % 2 ? "justify-end" : "justify-start",
                          )}
                        >
                          <div className="w-[min(30rem,78%)] rounded-3xl border border-border dark:border-white/[0.07] bg-white/[0.035] p-3.5 shadow-lg">
                            <Skeleton className="mb-2 h-3 w-24 bg-card/10 dark:bg-white/10" />
                            <Skeleton className="h-3 w-full bg-card/10 dark:bg-white/10" />
                            <Skeleton className="mt-2 h-3 w-2/3 bg-card/10 dark:bg-white/10" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : messagesError ? (
                    <div className="mx-auto mt-8 flex max-w-md flex-col items-center justify-center rounded-3xl border border-destructive/20 bg-[radial-gradient(circle_at_top,rgba(244,63,94,0.12),transparent_34%),rgba(255,255,255,0.025)] px-6 py-12 text-center shadow-inner shadow-sm dark:shadow-black/20">
                      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
                        <AlertTriangle className="h-5 w-5" />
                      </span>
                      <p className="text-sm font-semibold text-destructive-foreground">
                        Unable to load messages
                      </p>
                      <p className="mt-2 text-xs leading-5 text-destructive-foreground/65">
                        This conversation is selected, but the message thread
                        could not be fetched.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-4 rounded-full border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15"
                        onClick={() => refetchMessages()}
                      >
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        Retry messages
                      </Button>
                    </div>
                  ) : correspondence.length === 0 ? (
                    <div className="mx-auto mt-8 flex max-w-md flex-col items-center justify-center rounded-3xl border border-border dark:border-white/[0.09] bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.10),transparent_34%),rgba(255,255,255,0.025)] px-6 py-12 text-center text-muted-foreground dark:text-muted-foreground shadow-inner shadow-sm dark:shadow-black/20">
                      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-100/20 bg-brand-300/10 text-brand-100/80">
                        <MessageSquare className="h-5 w-5" />
                      </span>
                      <p className="text-sm font-semibold text-foreground dark:text-foreground">
                        No messages in this conversation
                      </p>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground dark:text-muted-foreground">
                        When this contact sends or receives CRM messages, the
                        thread will appear here.
                      </p>
                      {withheldNotice && (
                        <p className="mt-3 text-xs leading-5 text-muted-foreground dark:text-muted-foreground">
                          {withheldNotice}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {groupedMessages.map((group) => (
                        <div key={group.label}>
                          <div className="my-4 flex items-center gap-2">
                            <Separator className="flex-1 bg-gradient-to-r from-transparent via-brand-100/16 to-white/5" />
                            <span className="whitespace-nowrap rounded-full border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-100/60 shadow-inner shadow-sm dark:shadow-black/20">
                              {group.label}
                            </span>
                            <Separator className="flex-1 bg-gradient-to-r from-white/5 via-brand-100/16 to-transparent" />
                          </div>
                          <div className="space-y-2">
                            {group.messages.map((msg) => {
                              const isOutbound = msg.direction === "outbound";
                              const msgChannel = normalizeChannel(
                                msg.channel_type ||
                                  selectedConversation?.channel_type ||
                                  "",
                              );

                              // Channel-specific outbound bubble treatments tuned for the dark CRM workspace
                              const getOutboundBubbleClass = () => {
                                switch (msgChannel) {
                                  case "sms":
                                    return "rounded-br-md border-info/40 bg-[linear-gradient(135deg,rgba(59,130,246,0.55),rgba(30,64,175,0.85))] text-white shadow-[0_12px_34px_rgba(37,99,235,0.22)]";
                                  case "whatsapp":
                                    return "rounded-br-md border-success/40 bg-[linear-gradient(135deg,rgba(16,185,129,0.55),rgba(6,95,70,0.85))] text-white shadow-[0_12px_34px_rgba(16,185,129,0.22)]";
                                  case "email":
                                    return "rounded-br-md border-brand-200/40 bg-[linear-gradient(135deg,rgba(245,158,11,0.55),rgba(120,53,15,0.85))] text-white shadow-[0_12px_34px_rgba(245,158,11,0.22)]";
                                  default:
                                    // Neutral. Painting an unrecorded channel
                                    // in SMS blue is how an email came to look
                                    // like a text message.
                                    return "rounded-br-md border-border bg-[linear-gradient(135deg,rgba(82,82,91,0.55),rgba(39,39,42,0.85))] text-white shadow-[0_12px_34px_rgba(0,0,0,0.22)]";
                                }
                              };

                              const getTimestampClass = () => {
                                if (!isOutbound) return "text-muted-foreground";
                                switch (msgChannel) {
                                  case "sms":
                                    return "text-white/75";
                                  case "whatsapp":
                                    return "text-white/75";
                                  case "email":
                                    return "text-white/75";
                                  default:
                                    return "text-white/75";
                                }
                              };

                              return (
                                <div
                                  key={msg.id}
                                  className={cn(
                                    "flex",
                                    isOutbound
                                      ? "justify-end"
                                      : "justify-start",
                                  )}
                                >
                                  <div
                                    className={cn(
                                      "max-w-[82%] rounded-2xl border px-3.5 py-2 text-sm shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200/35 hover:shadow-[0_16px_34px_rgba(0,0,0,0.28),0_0_24px_rgba(245,158,11,0.10)] md:max-w-[72%]",
                                      isOutbound
                                        ? getOutboundBubbleClass()
                                        : "rounded-bl-md border-border dark:border-white/10 bg-[linear-gradient(135deg,rgba(39,39,42,0.96),rgba(9,9,11,0.92))] text-foreground dark:text-foreground shadow-[0_12px_30px_rgba(0,0,0,0.22)]",
                                    )}
                                  >
                                    {/*
                                      Which channel this message came on.

                                      The outbound bubble's colour already said
                                      it and the inbound one said nothing, so
                                      under the "All" filter an email and an
                                      SMS from a client were the same charcoal
                                      box — the 19 Sep 2026 clone audit's "no
                                      color difference … to distinguish which is
                                      email and which is SMS". A word beside the
                                      icon rather than colour alone, because
                                      colour is not readable by everyone and is
                                      not readable at all on the inbound side.
                                    */}
                                    <p className={cn(
                                      'mb-0.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em]',
                                      isOutbound ? 'opacity-80' : 'opacity-70',
                                    )}>
                                      {(() => {
                                        const I = channelIcons[msgChannel] || MessageSquare;
                                        return <I className="h-2.5 w-2.5 shrink-0" />;
                                      })()}
                                      <span>
                                        {msgChannel === UNKNOWN_CHANNEL
                                          ? 'channel not recorded'
                                          : msgChannel.replace('_', ' ')}
                                      </span>
                                      {!isOutbound && msg.sender_name && (
                                        <span className="ml-1 truncate normal-case tracking-normal">
                                          · {msg.sender_name}
                                        </span>
                                      )}
                                    </p>
                                    {msg.body && (
                                      <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                                        {renderFormattedMessage(
                                          msg.body,
                                          msg.channel_type ||
                                            selectedConversation?.channel_type ||
                                            "sms",
                                        )}
                                      </p>
                                    )}
                                    {msg.attachment_urls &&
                                      msg.attachment_urls.length > 0 && (
                                        <div className="mt-1.5 space-y-1">
                                          {msg.attachment_urls.map((url, i) => (
                                            <a
                                              key={i}
                                              href={url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-xs underline block truncate"
                                            >
                                              Attachment {i + 1}
                                            </a>
                                          ))}
                                        </div>
                                      )}
                                    <p
                                      className={cn(
                                        "text-[10px] mt-1",
                                        getTimestampClass(),
                                      )}
                                    >
                                      {msg.ghl_date_added &&
                                        format(
                                          new Date(msg.ghl_date_added),
                                          "h:mm a",
                                        )}
                                      {msg.message_status &&
                                        msg.message_status !== "delivered" && (
                                          <span className="ml-1.5">
                                            · {msg.message_status}
                                          </span>
                                        )}
                                    </p>
                                    {msg.message_status === "failed" && (
                                      <Button
                                        type="button"
                                        variant="link"
                                        size="sm"
                                        className="mt-1 h-auto px-0 text-xs font-semibold text-destructive-foreground underline-offset-4 hover:underline"
                                        onClick={() => retryMessage(msg)}
                                        disabled={sendMutation.isPending}
                                      >
                                        Retry {msgChannel === "whatsapp" ? "WhatsApp" : msgChannel === "sms" ? "SMS" : "email"}
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Reply composer */}
              <div className="shrink-0 max-h-[min(36vh,20rem)] overflow-y-auto space-y-2.5 border-t border-brand-100/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.78),rgba(9,9,11,0.96))] px-4 py-2.5 shadow-[0_-18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-100/50">
                    Send via
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label="Choose reply channel"
                        className="min-h-9 gap-1.5 rounded-full border-brand-300/20 bg-background/35 dark:bg-black/35 px-2.5 text-xs text-brand-100 transition-all hover:border-brand-200/45 hover:bg-brand-400/10 hover:shadow-[0_0_18px_rgba(245,158,11,0.14)] focus-visible:ring-2 focus-visible:ring-brand-300/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        {(() => {
                          const I = channelIcons[replyChannel] || MessageSquare;
                          return <I className="h-3 w-3" />;
                        })()}
                        <span className="capitalize">
                          {replyChannel === "sms"
                            ? "SMS"
                            : replyChannel === "whatsapp"
                              ? "WhatsApp"
                              : "Email"}
                        </span>
                        <ChevronDown className="h-3 w-3 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="min-w-[140px] border-brand-200/15 bg-background/95 dark:bg-background/95 text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/45 backdrop-blur-xl"
                    >
                      <DropdownMenuItem
                        onClick={() => setReplyChannel("sms")}
                        className="gap-2 rounded-lg text-xs focus:bg-brand-300/10 focus:text-brand-100"
                      >
                        <Phone className="h-3.5 w-3.5" /> SMS
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setReplyChannel("email")}
                        className="gap-2 rounded-lg text-xs focus:bg-brand-300/10 focus:text-brand-100"
                      >
                        <Mail className="h-3.5 w-3.5" /> Email
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setReplyChannel("whatsapp")}
                        className="gap-2 rounded-lg text-xs focus:bg-brand-300/10 focus:text-brand-100"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/*
                  Mailbox and subject on ONE row.

                  They were two stacked rows, each of them a single line of
                  controls, and the composer is `shrink-0` above a `flex-1`
                  message list — so choosing email took about 80px off the
                  history every time. That is the 19 Sep 2026 clone audit's
                  "when switch to send via email, the chat history becomes too
                  small". They wrap back to two rows when the pane is narrow.
                */}
                {replyChannel === "email" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={selectedMailbox}
                      onValueChange={setSelectedMailbox}
                    >
                      <SelectTrigger
                        aria-label="Select email reply mailbox"
                        className="h-9 w-auto min-w-[10rem] shrink-0 rounded-full border-brand-100/15 bg-background/35 dark:bg-black/35 text-xs text-foreground dark:text-foreground focus-visible:ring-2 focus-visible:ring-brand-300/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin" className="text-xs">
                          Admin Mailbox
                        </SelectItem>
                        {mailboxes.map((mb) => (
                          <SelectItem
                            key={mb.id}
                            value="personal"
                            className="text-xs"
                          >
                            Personal — {mb.personal_mailbox}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Email subject..."
                      aria-label="Email subject"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="h-9 min-w-[12rem] flex-1 rounded-full border-brand-100/12 bg-background/35 dark:bg-black/35 text-sm text-foreground dark:text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus-visible:border-brand-300/50 focus-visible:ring-brand-300/25"
                    />
                  </div>
                )}

                <MessageComposer
                  value={replyText}
                  onChange={setReplyText}
                  onSend={handleSendReply}
                  isSending={sendMutation.isPending}
                  disabled={
                    !replyText.trim() ||
                    (replyChannel === "email" && !emailSubject.trim())
                  }
                  channel={replyChannel as "sms" | "email" | "whatsapp"}
                  placeholder={`Type your ${replyChannel === "sms" ? "SMS" : replyChannel === "whatsapp" ? "WhatsApp" : "email"} message...`}
                  rows={replyChannel === "email" ? 2 : 2}
                />
              </div>
            </>
          ) : null}
        </div>
      </DashboardThemeFrame>
    </DashboardThemeFrame>
  );
}
