import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  describeAuthError,
  invokeSecureFunction,
  isAuthFailureResponse,
  refreshAccessToken,
  resolveAuthBearer,
} from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { useAuth } from '@/hooks/useAuth';
import { MessageReportEditor } from '@/components/report-qa/MessageReportEditor';
import { convertPdfToImages } from '@/utils/pdfToImages';
import { extractPdfTextClientSide } from '@/lib/pdfClientExtractor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Upload,
  FileText,
  Send,
  Copy,
  MessageSquare,
  X,
  CheckCircle2,
  User,
  Bot,
  Mail,
  History,
  Plus,
  Trash2,
  GitCompare,
  Mic,
  MicOff,
  Pencil,
  Check,
  Search,
  Clock,
  Calendar,
  MoreVertical,
  Archive,
  Loader2,
  Pin,
  Pause,
  Play,
  Square,
  Download,
  AlertCircle,
  Share2,
  Users,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

// Feature components
import { useReportQAKeyboardShortcuts } from '@/hooks/useReportQAKeyboardShortcuts';
import { TypingIndicator } from '@/components/report-qa/TypingIndicator';
import { StreamingTypingIndicator } from '@/components/report-qa/StreamingTypingIndicator';
import { ConversationClientLinker } from '@/components/report-qa/ConversationClientLinker';
import { ConversationTags } from '@/components/report-qa/ConversationTags';
import { type Theme } from '@/components/report-qa/ChatThemeSelector';
import { ConversationExport } from '@/components/report-qa/ConversationExport';
import { ReportQaDownloadButton } from '@/components/report-qa/ReportQaDownloadButton';
import { MessageThreading, useMessageThreads } from '@/components/report-qa/MessageThreading';
import { AutoSummarize } from '@/components/report-qa/AutoSummarize';
import { PinConversation, usePinnedConversations } from '@/components/report-qa/PinConversation';
import { VoiceMessagePlayer } from '@/components/report-qa/VoiceMessagePlayer';
import { RecordingIndicator } from '@/components/report-qa/RecordingIndicator';
import { PDFAttachmentMessage } from '@/components/report-qa/PDFAttachmentMessage';
import { MessageDateSeparator, shouldShowDateSeparator } from '@/components/report-qa/MessageDateSeparator';
import { CharacterCount, FailedMessageIndicator } from '@/components/report-qa/ChatInputEnhancements';
import { PDFThumbnail, UploadProgressItem } from '@/components/report-qa/PDFThumbnail';
import { ReportSwitcher, ReportSearch } from '@/components/report-qa/ReportContextSearch';
import { FollowUpSuggestions } from '@/components/report-qa/FollowUpSuggestions';
import { TextToSpeech } from '@/components/report-qa/TextToSpeech';
import { CopyWithFeedback } from '@/components/report-qa/CopyWithFeedback';
import { LiveRegion, SkipToContent, useReducedMotion } from '@/components/report-qa/AccessibilityWrapper';
import { MobileReportsPanel, useSwipeGesture } from '@/components/report-qa/MobileReportsPanel';
import { ReportLibraryPicker, type PickedReport } from '@/components/report-qa/ReportLibraryPicker';
import { InPlaceEmailCompose } from '@/components/report-qa/InPlaceEmailCompose';
import { LiveModelBadge, LiveModelChipGroup, ModelUpgradeButton } from '@/components/agentModels';
import { useAgentSurface, type AgentAssignment } from '@/hooks/useAgentModels';
import { formatModelDisplay } from '@/lib/agentModels/modelDisplay';
import { ToolInvocations, type ToolInvocation } from '@/components/report-qa/ToolInvocations';
import { Citations, type DocumentCitation } from '@/components/report-qa/Citations';
import { ReportSnippetViewer } from '@/components/report-qa/ReportSnippetViewer';
import { BranchedFromIndicator } from '@/components/report-qa/BranchedFromIndicator';
import { PinnedAnswersStrip } from '@/components/report-qa/PinnedAnswersStrip';
import { ShareConversationDialog } from '@/components/report-qa/ShareConversationDialog';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';

interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  error?: string;
}

interface PDFAttachment {
  url: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  conversationId?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  audioUrl?: string; // For voice messages
  attachments?: PDFAttachment[]; // For PDF attachments
  modelProvider?: string | null; // Model Hub agent key / legacy provider for assistant messages
  modelVersion?: string | null; // Exact model id returned by the backend for historical accuracy
  citations?: string[]; // Perplexity URL citations (legacy)
  documentCitations?: DocumentCitation[]; // Paragraph-level deep-links into uploaded reports
  comparisonMode?: boolean; // True when answer compares ≥2 reports
  toolInvocations?: ToolInvocation[]; // Agent tools executed for this answer
  aiFollowups?: string[]; // Phase 2.4 — AI-generated follow-up suggestions
  sent_by?: string | null;
  sent_by_username?: string | null;
  pinned?: boolean; // Phase 5.5 — pinned answers
}

const REPORT_QA_SLOT_KEYS = ['report_qa', 'report_qa_fast', 'report_qa_deep', 'report_qa_search'] as const;
const REPORT_QA_SLOT_KEY_SET = new Set<string>(REPORT_QA_SLOT_KEYS);

function supportsAgentToolsForAssignment(assignment: AgentAssignment | null): boolean {
  if (!assignment) return true;
  const model = (assignment.model_id || '').toLowerCase();
  if (model.includes('sonar') || model.includes('perplexity')) return false;
  if (assignment.route === 'gateway' || assignment.route === 'openrouter') return true;
  return assignment.route === 'native' && (
    model.startsWith('gpt-') ||
    model.startsWith('o') ||
    model.startsWith('chatgpt')
  );
}

function ReportQAModelSlotSelector({
  selectedAgentKey,
  onAgentKeyChange,
  disabled,
}: {
  selectedAgentKey: string;
  onAgentKeyChange: (agentKey: string) => void;
  disabled?: boolean;
}) {
  const { slots, isLoading } = useAgentSurface('reportQa');
  const selected = slots.find((slot) => slot.agentKey === selectedAgentKey) ?? slots[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="report-qa-toolbar-control h-9 min-w-9 max-w-full gap-2 px-3 text-xs font-semibold shadow-sm sm:px-3.5"
          disabled={disabled || isLoading || slots.length === 0}
          title={`Active Aurixa Intelligence Hub slot: ${selected?.slotLabel ?? 'Loading'}`}
          aria-label={`Select active Aurixa Intelligence Hub model slot. Current slot: ${selected?.slotLabel ?? 'Loading'}`}
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: selected?.display.accent ?? 'currentColor' }}
          />
          <span className="hidden max-w-[12rem] truncate sm:inline">
            {selected ? `${selected.slotLabel} · ${selected.display.shortLabel}` : 'Loading…'}
          </span>
          <span className="sm:hidden">{selected?.slotLabel ?? 'Model'}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(22rem,calc(100vw-2rem))] border-primary/20 bg-popover/95 p-1.5 shadow-xl backdrop-blur">
        {slots.map((slot) => (
          <DropdownMenuItem
            key={slot.agentKey}
            onClick={() => onAgentKeyChange(slot.agentKey)}
            className={cn(
              'flex items-center gap-3 rounded-xl px-2.5 py-3',
              selectedAgentKey === slot.agentKey && 'bg-primary/10 text-primary',
            )}
          >
            <span
              aria-hidden
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: slot.display.accent }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{slot.slotLabel}</div>
              <div className="truncate text-xs text-muted-foreground">{slot.display.longLabel}</div>
            </div>
            {selectedAgentKey === slot.agentKey && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MessageModelBadge({ agentKey, modelId }: { agentKey?: string | null; modelId?: string | null }) {
  if (modelId) {
    const display = formatModelDisplay(modelId);
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] font-medium text-foreground/90 backdrop-blur-sm"
        style={{ borderColor: `${display.accent}55` }}
        title={display.longLabel}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: display.accent }} />
        <span className="max-w-[160px] truncate">{display.shortLabel}</span>
      </span>
    );
  }

  if (agentKey && REPORT_QA_SLOT_KEY_SET.has(agentKey)) {
    return <LiveModelBadge agentKey={agentKey} size="sm" showSlot />;
  }

  return null;
}

interface UploadedReport {
  name: string;
  content: string;
  uploadedAt: Date;
  fileSizeBytes?: number;
  totalPages?: number;
  imagesProcessed?: number;
}

interface SavedConversation {
  id: string;
  title: string;
  report_names: string[];
  report_contents?: string[];
  agent_mode?: boolean | null;
  client_id?: string | null;
  created_at: string;
  updated_at: string;
  shared?: boolean;
  shared_by?: string;
  permission?: string;
  handoff_note?: string;
  legacy?: boolean;
  branched_from_conversation_id?: string | null;
  branched_from_message_id?: string | null;
}

export default function ReportQA() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { canEdit: canEditQA, canDelete: canDeleteQA } = useModulePermissions('report_qa');
  const { canEdit: canManageAgentModels } = useModulePermissions('integrations');
  const [uploadedReports, setUploadedReports] = useState<UploadedReport[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [conversationId, setConversationIdState] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const activeStreamRef = useRef<{ conversationId: string; controller: AbortController } | null>(null);
  const conversationLoadRequestRef = useRef(0);
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailBcc, setEmailBcc] = useState('');
  const [emailSubject, setEmailSubject] = useState('Investment Report Summary');
  const [emailContent, setEmailContent] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [selectedSenderMailbox, setSelectedSenderMailbox] = useState('');
  const [availableMailboxes, setAvailableMailboxes] = useState<{id: string; username: string; personal_mailbox: string | null}[]>([]);
  const [isLoadingMailboxes, setIsLoadingMailboxes] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [accumulatedTranscript, setAccumulatedTranscript] = useState('');
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isEditingMainTitle, setIsEditingMainTitle] = useState(false);
  // The model selector + live chips + chat tools row is tall; letting the
  // operator fold it away hands that height straight to the conversation.
  const [chatToolsExpanded, setChatToolsExpanded] = useState(true);
  const [mainTitleEdit, setMainTitleEdit] = useState('');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [conversationLoadError, setConversationLoadError] = useState<string | null>(null);
  const [restoringConversationId, setRestoringConversationId] = useState<string | null>(null);
  const [conversationRestoreError, setConversationRestoreError] = useState<string | null>(null);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleSaveError, setTitleSaveError] = useState<string | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const historyListRef = useRef<HTMLDivElement | null>(null);
  const [shareDialogConversation, setShareDialogConversation] = useState<{ id: string; title: string } | null>(null);

  const setActiveConversationId = useCallback((nextConversationId: string | null) => {
    conversationIdRef.current = nextConversationId;
    setConversationIdState(nextConversationId);
  }, []);

  const abortActiveStream = useCallback((reason: string) => {
    const active = activeStreamRef.current;
    if (!active || active.controller.signal.aborted) return;
    console.info(`[ReportQA] Aborting active stream: ${reason}`);
    active.controller.abort();
  }, []);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // New feature states
  const [chatTheme] = useState<Theme | null>(null);
  const [conversationTags, setConversationTags] = useState<Map<string, string[]>>(new Map());
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pendingAudioUrl, setPendingAudioUrl] = useState<string | null>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [messageEditorOpen, setMessageEditorOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [showEmailCopilotModal, setShowEmailCopilotModal] = useState(false);
  const [pendingPDFAttachment, setPendingPDFAttachment] = useState<PDFAttachment | null>(null);
  const [isValidatingPDF, setIsValidatingPDF] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [pdfValidationError, setPdfValidationError] = useState<string | null>(null);
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('report_qa');
  const [showInPlaceEmailCompose, setShowInPlaceEmailCompose] = useState(false);
  const [emailContext, setEmailContext] = useState<{
    title: string;
    reportNames: string;
    messageCount: number;
    sampleQuestions: string[];
    generatedAt: string;
  } | null>(null);

  // Phase 1 UX improvements
  const [streamingContent, setStreamingContent] = useState('');
  // Tool invocations emitted by the agent loop for the currently-streaming
  // assistant message. Reset before each send; flushed onto the final
  // ChatMessage when the stream completes.
  const [streamingToolInvocations, setStreamingToolInvocations] = useState<ToolInvocation[]>([]);
  const [failedMessage, setFailedMessage] = useState<{ content: string; audioUrl?: string } | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const MAX_MESSAGE_LENGTH = 12000;
  const MAX_CHAT_HISTORY_MESSAGES = 30;
  const MAX_HISTORY_MESSAGE_CHARS = 10000;
  const SUMMARY_THRESHOLD = 12; // Summarize older messages beyond this count

  // Phase 2 UX improvements
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [selectedReportNames, setSelectedReportNames] = useState<string[]>([]);

  // Phase 5 UX improvements
  const [liveTranscript, setLiveTranscript] = useState('');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [showReportsPanel, setShowReportsPanel] = useState(true);
  // Visibility of citation chips & snippet tooltips. Stored locally so the
  // preference survives reloads without changing what we persist on the
  // conversation — `documentCitations` remain on each message so toggling
  // back on (or restoring a saved chat) re-hydrates without a refetch.
  const [showCitations, setShowCitations] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('reportqa_show_citations') !== '0';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('reportqa_show_citations', showCitations ? '1' : '0');
  }, [showCitations]);
  // Agent mode: per-conversation toggle that enables tool-calling (calculators,
  // live data, scenario modeling). Persisted on the conversation row so it
  // survives reload. Disabled when the active Model Hub route does not expose
  // OpenAI-compatible tool calls.
  const [agentMode, setAgentMode] = useState<boolean>(false);
  const { slots: reportQaModelSlots } = useAgentSurface('reportQa');
  const selectedReportQaSlot = useMemo(
    () => reportQaModelSlots.find((slot) => slot.agentKey === selectedAgentKey) ?? reportQaModelSlots[0] ?? null,
    [reportQaModelSlots, selectedAgentKey],
  );
  const agentModeSupported = supportsAgentToolsForAssignment(selectedReportQaSlot?.assignment ?? null);
  const effectiveAgentMode = agentMode && agentModeSupported;

  const selectedReports = useMemo(
    () => uploadedReports.filter((report) => selectedReportNames.includes(report.name)),
    [uploadedReports, selectedReportNames],
  );
  const selectedReportCount = selectedReports.length;
  const selectedReportStorageKey = conversationId ? `reportqa:selectedReports:${conversationId}` : null;

  useEffect(() => {
    setSelectedReportNames((prev) => {
      const availableNames = uploadedReports.map((report) => report.name);
      if (availableNames.length === 0) return [];
      if (prev.length === 0) return availableNames;
      return prev.filter((name) => availableNames.includes(name));
    });
  }, [uploadedReports]);

  useEffect(() => {
    if (!selectedReportStorageKey || typeof window === 'undefined') return;
    window.localStorage.setItem(selectedReportStorageKey, JSON.stringify(selectedReportNames));
  }, [selectedReportNames, selectedReportStorageKey]);

  const [snippetViewer, setSnippetViewer] = useState<{
    open: boolean;
    reportName: string | null;
    reportContent: string | null;
    citation: DocumentCitation | null;
  }>({ open: false, reportName: null, reportContent: null, citation: null });

  const openCitationInViewer = useCallback(
    (citation: DocumentCitation) => {
      // Match by exact name first; fall back to a case-insensitive / stem match
      // so renamed-but-equivalent files (e.g. "Report.pdf" vs "report.PDF") work.
      const target =
        uploadedReports.find((r) => r.name === citation.document_name) ??
        uploadedReports.find(
          (r) => r.name.toLowerCase() === citation.document_name?.toLowerCase(),
        ) ??
        uploadedReports.find((r) =>
          r.name.toLowerCase().includes(
            (citation.document_name ?? '').toLowerCase().replace(/\.pdf$/i, ''),
          ),
        );

      setSnippetViewer({
        open: true,
        reportName: target?.name ?? citation.document_name ?? 'Report',
        reportContent: target?.content ?? null,
        citation,
      });
    },
    [uploadedReports],
  );

  // Scroll a specific message into view (used by the Pinned-answers jump strip).
  const scrollToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(`qa-msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-primary/60', 'ring-offset-2', 'ring-offset-background');
    setTimeout(() => {
      el.classList.remove('ring-2', 'ring-primary/60', 'ring-offset-2', 'ring-offset-background');
    }, 1600);
  }, []);

  // Lazy loading for chat history
  const [totalMessageCount, setTotalMessageCount] = useState(0);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const MESSAGES_PER_PAGE = 50;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
      return;
    }
    chatEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  // Custom hooks
  const { addReply, getReplies } = useMessageThreads();
  const { getPinnedIds, togglePin, isPinned } = usePinnedConversations();
  const reducedMotion = useReducedMotion();

  // Accessibility - live region announcements
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  // Get last assistant message for follow-up suggestions
  const lastAssistantMessage = messages.filter(m => m.role === 'assistant').pop()?.content || '';

  // Copy last response handler
  const handleCopyLastResponse = useCallback(() => {
    if (lastAssistantMessage) {
      navigator.clipboard.writeText(lastAssistantMessage);
      toast({
        title: 'Copied',
        description: 'Last response copied to clipboard',
      });
    }
  }, [lastAssistantMessage, toast]);

  // Scroll to bottom handler
  const handleScrollToBottom = useCallback(() => {
    scrollChatToBottom('smooth');
  }, [scrollChatToBottom]);

  // Toggle reports panel
  const handleToggleReportsPanel = useCallback(() => {
    setShowReportsPanel(prev => !prev);
  }, []);

  // Keyboard shortcuts
  useReportQAKeyboardShortcuts({
    onNewChat: handleNewChat,
    onOpenHistory: () => setShowHistory(true),
    onCloseDialogs: () => {
      setShowHistory(false);
      setShowEmailModal(false);
    },
    onFocusInput: () => inputRef.current?.focus(),
    onCopyLastResponse: handleCopyLastResponse,
    onScrollToBottom: handleScrollToBottom,
    onToggleReportsPanel: handleToggleReportsPanel,
  });

  // Load saved conversations and pinned IDs on mount
  useEffect(() => {
    loadSavedConversations();
    setPinnedIds(getPinnedIds());
    // Load tags from localStorage
    try {
      const stored = localStorage.getItem('qa-conversation-tags');
      if (stored) setConversationTags(new Map(JSON.parse(stored)));
    } catch {}
  }, []);

  // Keep the active turn inside the chat viewport without scrolling the page
  // shell. `scrollIntoView` could move every scrollable ancestor (including the
  // dashboard), while streaming text did not trigger the old messages-only
  // effect at all.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollChatToBottom(reducedMotion ? 'auto' : 'smooth');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [failedMessage, isProcessing, messages, reducedMotion, scrollChatToBottom, streamingContent]);

  // Auto-resize textarea when inputMessage changes (e.g., from transcription)
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 112) + 'px';
    }
  }, [inputMessage]);

  const loadSavedConversations = async () => {
    setIsLoadingConversations(true);
    setConversationLoadError(null);
    try {
      console.log('[ReportQA] Loading saved conversations...');
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'get-conversations',
      });

      if (error) {
        console.error('[ReportQA] Error loading conversations:', error);
        throw error;
      }

      const ownConversations = (data?.conversations || []).map((c: any) => ({ ...c, shared: false }));
      const sharedConversations = (data?.shared_conversations || []).map((c: any) => ({ ...c, shared: true }));
      // Legacy conversations predate ownership tracking; superadmins receive
      // them from the backend so pre-migration history stays reachable.
      const legacyConversations = (data?.legacy_conversations || []).map((c: any) => ({ ...c, shared: false, legacy: true }));
      const allConversations = [...ownConversations, ...sharedConversations, ...legacyConversations];
      console.log('[ReportQA] Loaded conversations:', allConversations.length, `(${sharedConversations.length} shared, ${legacyConversations.length} legacy)`);
      setSavedConversations(allConversations);
    } catch (error) {
      console.error('[ReportQA] Failed to load conversations:', error);
      setConversationLoadError('Unable to retrieve conversation history. Please try again.');
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const handleSaveTitle = async (targetConversationId: string, newTitle: string) => {
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle) {
      setTitleSaveError('Conversation title cannot be blank.');
      toast({
        title: 'Title not saved',
        description: 'Conversation title cannot be blank.',
        variant: 'destructive',
      });
      return;
    }

    const previousTitle = savedConversations.find(c => c.id === targetConversationId)?.title || getCurrentTitle();
    setIsSavingTitle(true);
    setTitleSaveError(null);

    try {
      // Use secure edge function for update (service_role required due to RLS)
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'update-conversation',
        conversationId: targetConversationId,
        title: trimmedTitle,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to update');

      setSavedConversations(prev =>
        prev.map(c => c.id === targetConversationId ? { ...c, title: trimmedTitle, updated_at: new Date().toISOString() } : c)
      );
      setEditingConversationId(null);
      setIsEditingMainTitle(false);

      toast({
        title: 'Title updated',
        description: 'Conversation title has been saved',
      });
    } catch (error) {
      console.error('Failed to update title:', error);
      setSavedConversations(prev => prev.map(c => c.id === targetConversationId ? { ...c, title: previousTitle } : c));
      setMainTitleEdit(previousTitle);
      setTitleSaveError('Failed to save conversation title. Please try again.');
      toast({
        title: 'Failed to update title',
        description: 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setIsSavingTitle(false);
    }
  };

  // Get current conversation title
  const getCurrentTitle = () => {
    if (!conversationId) return 'New Chat';
    const conv = savedConversations.find(c => c.id === conversationId);
    return conv?.title || 'New Chat';
  };

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.type.includes('pdf')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a PDF file',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload a file smaller than 50MB',
        variant: 'destructive',
      });
      return;
    }

    if (uploadedReports.some(r => r.name === file.name)) {
      toast({
        title: 'Already uploaded',
        description: 'This report has already been added',
        variant: 'destructive',
      });
      return;
    }

    // Add progress item
    const progressItem: UploadProgress = {
      fileName: file.name,
      progress: 0,
      status: 'uploading'
    };
    setUploadProgress(prev => [...prev, progressItem]);

    try {
      const updateProgress = (progress: number, status: UploadProgress['status']) => {
        setUploadProgress(prev =>
          prev.map(p => p.fileName === file.name ? { ...p, progress, status } : p)
        );
      };

      updateProgress(10, 'processing');

      // --- Client-side text extraction using PDF parser ---
      // This runs entirely in the browser, no edge function timeouts
      const result = await extractPdfTextClientSide(file, (current, total) => {
        const pct = 10 + Math.round((current / Math.max(total, 1)) * 80);
        updateProgress(Math.min(pct, 90), 'processing');
      });

      let extractedText = result.text;

      // Fall back to server OCR when the text layer is thin (scanned PDF) OR
      // unreadable. A broken font encoding produces plenty of characters, so a
      // length check alone let mojibake through to the QA model as if it were
      // the report's real content.
      if (extractedText.length < 500 || result.likelyNeedsOcr) {
        console.log(`[ReportQA] Client text layer unusable (${extractedText.length} chars, needsOcr=${result.likelyNeedsOcr}), trying server-side OCR...`);
        updateProgress(85, 'processing');

        let pageImages: Array<{ pageNumber: number; base64: string; width: number; height: number; mimeType: string }> = [];
        try {
          const conv = await convertPdfToImages(file, (current, total) => {
            const pct = 85 + Math.round((current / Math.max(total, 1)) * 5);
            updateProgress(Math.min(pct, 90), 'processing');
          });

          if (conv.success) {
            pageImages = conv.images
              .slice(0, 24)
              .map((img) => ({
                pageNumber: img.pageNumber,
                base64: img.base64,
                width: img.width,
                height: img.height,
                // Use the real encoding — mislabelling a JPEG as PNG made the
                // vision provider reject every page.
                mimeType: img.mimeType,
              }));
          } else if (conv.error) {
            console.warn('[ReportQA] Rasterisation reported an error:', conv.error);
          }
        } catch (err) {
          console.warn('PDF page image pre-render failed:', err);
        }

        if (pageImages.length > 0) {
          // Send pages in small batches. A whole flattened report rendered at
          // print quality is tens of megabytes, so the previous single request
          // (PDF bytes + 8 full-page images) was rejected before it ever reached
          // the function — which surfaced as "could not extract text".
          const BATCH_SIZE = 3;
          const ocrChunks: string[] = [];
          let lastOcrError: string | null = null;

          for (let i = 0; i < pageImages.length; i += BATCH_SIZE) {
            const batch = pageImages.slice(i, i + BATCH_SIZE);
            const { data, error } = await invokeSecureFunction('report-qa', {
              // Raster OCR is deliberately conversation-independent: a user
              // must be able to read a flattened PDF before the first chat is
              // created. `extract` is a storage mutation and correctly
              // requires an existing writable conversation.
              action: 'ocr-pages',
              fileName: file.name,
              pageImages: batch,
            });

            if (error) {
              lastOcrError = error.message || 'OCR request failed';
              console.warn(`[ReportQA] OCR batch ${i / BATCH_SIZE + 1} failed:`, error);
              // Keep whatever earlier batches produced rather than aborting.
              break;
            }
            if (data?.success && typeof data.extractedText === 'string' && data.extractedText.trim()) {
              ocrChunks.push(data.extractedText.trim());
            } else if (data?.error) {
              lastOcrError = data.error;
            }

            const done = Math.min(i + BATCH_SIZE, pageImages.length);
            updateProgress(90 + Math.round((done / pageImages.length) * 9), 'processing');
          }

          const ocrText = ocrChunks.join('\n\n');
          if (ocrText.length > extractedText.length) {
            extractedText = `[Document: ${file.name}]\n[Pages OCR'd: ${Math.min(pageImages.length, ocrChunks.length * 3)}]\n\n${ocrText}`;
          } else if (lastOcrError && extractedText.length < 50) {
            throw new Error(`This PDF has no readable text layer and OCR failed: ${lastOcrError}`);
          }
        } else if (extractedText.length < 50) {
          throw new Error('This PDF has no readable text layer and its pages could not be rendered for OCR. Please re-export it as a text-based PDF.');
        }
      }

      if (!extractedText || extractedText.length < 50) {
        throw new Error('Could not extract meaningful text from this PDF. It may be a scanned document or image-only PDF.');
      }

      updateProgress(100, 'complete');

      const newReport: UploadedReport = {
        name: file.name,
        content: extractedText,
        uploadedAt: new Date(),
        fileSizeBytes: file.size,
        totalPages: result.totalPages,
        imagesProcessed: 0,
      };

      setUploadedReports(prev => [...prev, newReport]);
      setSelectedReportNames(prev => prev.includes(newReport.name) ? prev : [...prev, newReport.name]);

      setTimeout(() => {
        setUploadProgress(prev => prev.filter(p => p.fileName !== file.name));
      }, 1500);

      toast({
        title: 'Report uploaded',
        description: `${file.name} added (${result.extractedPages}/${result.totalPages} pages). ${uploadedReports.length + 1} report(s) loaded.`,
      });

      setIsUploading(false);
    } catch (error) {
      console.error('Upload error:', error);
      setUploadProgress(prev =>
        prev.map(p => p.fileName === file.name
          ? { ...p, status: 'error', error: error instanceof Error ? error.message : 'Upload failed' }
          : p
        )
      );
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Failed to process the report',
        variant: 'destructive',
      });
      setIsUploading(false);
    }
  }, [toast, uploadedReports]);

  const handleLibraryAdd = useCallback((picks: PickedReport[]) => {
    if (!picks.length) return;
    const existing = new Set(uploadedReports.map((r) => r.name));
    const additions: UploadedReport[] = picks
      .filter((p) => !existing.has(p.name))
      .map((p) => ({
        name: p.name,
        content: p.content,
        uploadedAt: new Date(),
        fileSizeBytes: new Blob([p.content]).size,
        totalPages: undefined,
        imagesProcessed: 0,
      }));
    if (additions.length === 0) return;
    const nextReports = [...uploadedReports, ...additions];
    setUploadedReports(nextReports);
    setSelectedReportNames((prev) => [
      ...prev,
      ...additions.map((report) => report.name).filter((name) => !prev.includes(name)),
    ]);
    // Persist library picks onto the saved conversation the same way
    // removeReport does — otherwise they exist only in local state and
    // silently vanish when the conversation is reopened.
    if (conversationId) {
      setSavedConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                report_names: nextReports.map((report) => report.name),
                report_contents: nextReports.map((report) => report.content),
                updated_at: new Date().toISOString(),
              }
            : conversation,
        ),
      );
      void invokeSecureFunction('report-qa', {
        action: 'update-conversation',
        conversationId,
        reportNames: nextReports.map((report) => report.name),
        reportContents: nextReports.map((report) => report.content),
      }).then(({ data, error }) => {
        if (error || !data?.success) {
          console.error('Failed to save library reports to conversation:', error || data?.error);
        }
      });
    }
  }, [uploadedReports, conversationId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => handleFileUpload(file));
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDropzoneKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  }, []);

  const removeReport = useCallback(async (name: string) => {
    const nextReports = uploadedReports.filter((report) => report.name !== name);
    const removedReport = uploadedReports.find((report) => report.name === name);
    const previousSelectedReportNames = selectedReportNames;

    setUploadedReports(nextReports);
    setSelectedReportNames((prev) => prev.filter((selectedName) => selectedName !== name));
    setSavedConversations((prev) =>
      conversationId
        ? prev.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  report_names: nextReports.map((report) => report.name),
                  report_contents: nextReports.map((report) => report.content),
                  updated_at: new Date().toISOString(),
                }
              : conversation,
          )
        : prev,
    );

    if (!conversationId) {
      toast({
        title: 'Report removed',
        description: `${name} has been removed from this chat.`,
      });
      return;
    }

    try {
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'update-conversation',
        conversationId,
        reportNames: nextReports.map((report) => report.name),
        reportContents: nextReports.map((report) => report.content),
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to remove report');

      toast({
        title: 'Report removed',
        description: `${name} has been removed from this chat.`,
      });
    } catch (error) {
      console.error('Failed to remove report from conversation:', error);
      if (removedReport) {
        setUploadedReports(uploadedReports);
        setSelectedReportNames(previousSelectedReportNames);
        setSavedConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  report_names: uploadedReports.map((report) => report.name),
                  report_contents: uploadedReports.map((report) => report.content),
                }
              : conversation,
          ),
        );
      }
      toast({
        title: 'Report not removed',
        description: 'Unable to update this conversation. Please try again.',
        variant: 'destructive',
      });
    }
  }, [conversationId, selectedReportNames, toast, uploadedReports]);

  const startNewConversation = async (): Promise<string | null> => {
    try {
      const title = uploadedReports.length > 1
        ? `Comparison: ${uploadedReports.map(r => r.name.replace('.pdf', '')).join(' vs ')}`
        : uploadedReports.length === 1
          ? `Q&A: ${uploadedReports[0].name}`
          : `Open Chat: ${new Date().toLocaleDateString('en-AU')}`;

      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'create-conversation',
        reportNames: uploadedReports.map(r => r.name),
        reportContents: uploadedReports.map(r => r.content),
        title,
      });

      if (error) throw error;

      const newConversationId = data.conversation.id;
      setActiveConversationId(newConversationId);
      setMessages([]);
      loadSavedConversations();

      // Trigger RAG indexing (blocking until complete - prevents race condition)
      if (uploadedReports.length > 0) {
        console.log(`[ReportQA] Triggering RAG indexing for conversation ${newConversationId}...`);
        setIsIndexing(true);
        try {
          const { data: indexData, error: indexError } = await invokeSecureFunction('report-qa', {
            action: 'index-reports',
            conversationId: newConversationId,
          });
          if (indexError) {
            console.error('[ReportQA] RAG indexing failed:', indexError);
          } else {
            console.log(`[ReportQA] RAG indexing complete:`, indexData);
          }
        } catch (err) {
          console.error('[ReportQA] RAG indexing error:', err);
        } finally {
          setIsIndexing(false);
        }
      }

      // Log conversation created
      logActivityDirect({
        actionType: 'qa_conversation_created',
        entityType: 'qa_conversation',
        entityId: newConversationId,
        entityName: title,
        metadata: { report_count: uploadedReports.length }
      });

      toast({
        title: 'Conversation started',
        description: uploadedReports.length > 0
          ? 'Indexing reports for intelligent retrieval...'
          : 'Your chat will be saved automatically',
      });

      return newConversationId;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      return null;
    }
  };

  const parseStoredMessageContent = (content: unknown): string => {
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === 'string') return parsed;
          if (parsed && typeof parsed === 'object') {
            const candidate = (parsed as { content?: unknown; text?: unknown; message?: unknown }).content
              ?? (parsed as { text?: unknown }).text
              ?? (parsed as { message?: unknown }).message;
            if (typeof candidate === 'string') return candidate;
          }
        } catch {
          // Stored markdown can legitimately look JSON-ish; keep the original string.
        }
      }
      return content;
    }

    if (content && typeof content === 'object') {
      const candidate = (content as { content?: unknown; text?: unknown; message?: unknown }).content
        ?? (content as { text?: unknown }).text
        ?? (content as { message?: unknown }).message;
      if (typeof candidate === 'string') return candidate;
    }

    return '';
  };

  const getStoredMessageTime = (message: any): number => {
    const candidate = message?.created_at || message?.inserted_at || message?.timestamp;
    const parsed = new Date(candidate || Date.now()).getTime();
    return Number.isNaN(parsed) ? Date.now() : parsed;
  };

  const normaliseStoredMessages = (storedMessages: any[]): ChatMessage[] => {
    const seen = new Set<string>();

    return storedMessages
      .map((m): ChatMessage | null => {
        if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;

        const id = String(m.id || `${m.conversation_id || 'message'}-${m.created_at || Date.now()}-${seen.size}`);
        if (seen.has(id)) return null;
        seen.add(id);

        const timestamp = new Date(m.created_at || m.inserted_at || Date.now());

        return {
          id,
          role: m.role,
          content: parseStoredMessageContent(m.content),
          timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
          audioUrl: m.audio_url || undefined,
          attachments: Array.isArray(m.attachments) ? m.attachments : undefined,
          sent_by: m.sent_by || null,
          sent_by_username: m.sent_by_username || null,
          modelProvider: m.model_provider || m.modelProvider || null,
          modelVersion: m.model_version || m.modelVersion || null,
          citations: Array.isArray(m.url_citations) ? m.url_citations : undefined,
          documentCitations: Array.isArray(m.citations) ? m.citations : Array.isArray(m.documentCitations) ? m.documentCitations : undefined,
          comparisonMode: !!m.comparison_mode,
          toolInvocations: Array.isArray(m.tool_invocations) && m.tool_invocations.length > 0 ? m.tool_invocations : undefined,
          aiFollowups: Array.isArray(m.ai_followups) ? m.ai_followups : undefined,
          pinned: !!m.pinned,
        };
      })
      .filter((message): message is ChatMessage => !!message)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  };

  const loadConversation = async (conv: SavedConversation) => {
    if (restoringConversationId) return;

    abortActiveStream('switch-conversation');
    setIsProcessing(false);
    const loadRequestId = ++conversationLoadRequestRef.current;
    setRestoringConversationId(conv.id);
    setConversationRestoreError(null);
    setLiveAnnouncement(`Loading conversation ${conv.title}`);

    try {
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'load-conversation',
        conversationId: conv.id,
        limit: MESSAGES_PER_PAGE,
        offset: 0,
      });

      if (error) throw error;
      if (!data?.conversation) throw new Error('Conversation metadata was not returned.');

      const conversation = data.conversation;
      const totalMsgCount = data.totalMessages || data.messages?.length || 0;
      let messagesToSet = Array.isArray(data.messages) ? data.messages : [];

      if (totalMsgCount > messagesToSet.length) {
        const restoredPages: any[] = [];
        const pageSize = 500;
        for (let offset = 0; offset < totalMsgCount; offset += pageSize) {
          const { data: pageData, error: pageError } = await invokeSecureFunction('report-qa', {
            action: 'load-conversation',
            conversationId: conv.id,
            limit: Math.min(pageSize, totalMsgCount - offset),
            offset,
          });
          if (pageError) throw pageError;
          if (Array.isArray(pageData?.messages)) restoredPages.push(...pageData.messages);
        }
        if (restoredPages.length > 0) messagesToSet = restoredPages;
      }

      messagesToSet = [...messagesToSet].sort((a, b) => getStoredMessageTime(a) - getStoredMessageTime(b));

      const reportNames = Array.isArray(conversation.report_names) ? conversation.report_names : conv.report_names || [];
      const reportContents = Array.isArray(conversation.report_contents) ? conversation.report_contents : conv.report_contents || [];
      const restoredMessages = normaliseStoredMessages(messagesToSet);
      const restoredAgentKey = [...restoredMessages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.modelProvider)?.modelProvider;

      if (loadRequestId !== conversationLoadRequestRef.current) {
        // A newer conversation load started while this request was in flight.
        return;
      }

      setActiveConversationId(conv.id);
      setTotalMessageCount(totalMsgCount);
      setHasOlderMessages(false);
      setInputMessage('');
      setFailedMessage(null);
      setStreamingContent('');
      setStreamingToolInvocations([]);
      setPendingAudioUrl(null);
      setShowInPlaceEmailCompose(false);
      setEmailContext(null);
      setAgentMode(Boolean(conversation.agent_mode));
      if (restoredAgentKey && REPORT_QA_SLOT_KEY_SET.has(restoredAgentKey)) setSelectedAgentKey(restoredAgentKey);
      const restoredReports = reportNames.map((name: string, idx: number) => ({
        name,
        content: reportContents[idx] || '',
        uploadedAt: new Date(conversation.created_at || conv.created_at),
      }));
      let restoredSelectedNames = restoredReports.map((report) => report.name);
      if (typeof window !== 'undefined') {
        try {
          const stored = window.localStorage.getItem(`reportqa:selectedReports:${conv.id}`);
          const parsed = stored ? JSON.parse(stored) : null;
          if (Array.isArray(parsed)) {
            const available = new Set(restoredReports.map((report) => report.name));
            const validStored = parsed.filter((name): name is string => typeof name === 'string' && available.has(name));
            if (validStored.length > 0) restoredSelectedNames = validStored;
          }
        } catch (storageError) {
          console.warn('[ReportQA] Failed to restore selected report context', storageError);
        }
      }
      setSelectedReportNames(restoredSelectedNames);
      setUploadedReports(restoredReports);
      if (conversationIdRef.current === conv.id) {
        setMessages(restoredMessages);
      }
      if (import.meta.env.DEV && restoredMessages.length !== messagesToSet.length) {
        console.warn('[ReportQA] Some stored messages were skipped during restoration because they were invalid or unsupported.', {
          conversationId: conv.id,
          returned: messagesToSet.length,
          restored: restoredMessages.length,
        });
      }
      setSavedConversations(prev => prev.map(c => c.id === conv.id ? {
        ...c,
        title: conversation.title || conv.title,
        report_names: reportNames,
        client_id: conversation.client_id ?? c.client_id ?? null,
        updated_at: conversation.updated_at || c.updated_at,
        agent_mode: conversation.agent_mode ?? c.agent_mode ?? null,
        report_contents: reportContents,
      } : c));
      setShowHistory(false);
      setLiveAnnouncement(`Conversation ${conversation.title || conv.title} loaded`);
      requestAnimationFrame(() => scrollChatToBottom('auto'));


      toast({ title: 'Conversation loaded', description: conversation.title || conv.title });
    } catch (error) {
      if (loadRequestId !== conversationLoadRequestRef.current) return;
      console.error('Failed to load conversation:', error);
      const message = error instanceof Error ? error.message : 'Could not load the selected conversation';
      setConversationRestoreError(message);
      setLiveAnnouncement('Conversation failed to load');
      toast({ title: 'Failed to load', description: message, variant: 'destructive' });
    } finally {
      if (loadRequestId === conversationLoadRequestRef.current) {
        setRestoringConversationId(null);
      }
    }
  };

  const refreshConversationMessagesFromSupabase = async (targetConversationId: string, expectedMinimumMessages = 0) => {
    const pageSize = 500;
    const { data, error } = await invokeSecureFunction('report-qa', {
      action: 'load-conversation',
      conversationId: targetConversationId,
      limit: pageSize,
      offset: 0,
    });

    if (error) throw error;
    const totalMsgCount = data?.totalMessages || data?.messages?.length || 0;
    let storedMessages = Array.isArray(data?.messages) ? data.messages : [];

    if (totalMsgCount > storedMessages.length) {
      const restoredPages: any[] = [...storedMessages];
      for (let offset = storedMessages.length; offset < totalMsgCount; offset += pageSize) {
        const { data: pageData, error: pageError } = await invokeSecureFunction('report-qa', {
          action: 'load-conversation',
          conversationId: targetConversationId,
          limit: Math.min(pageSize, totalMsgCount - offset),
          offset,
        });
        if (pageError) throw pageError;
        if (Array.isArray(pageData?.messages)) restoredPages.push(...pageData.messages);
      }
      storedMessages = restoredPages;
    }

    const restoredMessages = normaliseStoredMessages(storedMessages);
    if (restoredMessages.length >= expectedMinimumMessages) {
      if (conversationIdRef.current !== targetConversationId) return false;
      setMessages(restoredMessages);
      setTotalMessageCount(totalMsgCount || restoredMessages.length);
      setHasOlderMessages(false);
      return true;
    }

    console.warn('[ReportQA] Persistence verification returned fewer messages than expected; preserving local transcript.', {
      conversationId: targetConversationId,
      expectedMinimumMessages,
      restored: restoredMessages.length,
      totalMsgCount,
    });
    return false;
  };

  const loadOlderMessages = async () => {
    if (!conversationId || isLoadingOlder || !hasOlderMessages) return;

    setIsLoadingOlder(true);
    try {
      const currentCount = messages.length;
      const totalRemaining = totalMessageCount - currentCount;
      const nextBatch = Math.min(MESSAGES_PER_PAGE, totalRemaining);
      const offset = totalRemaining - nextBatch;

      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'load-conversation',
        conversationId,
        limit: nextBatch,
        offset: Math.max(0, offset),
      });

      if (error) throw error;

      const olderMessages = normaliseStoredMessages(Array.isArray(data.messages) ? data.messages : []);

      // Prepend older messages, deduplicating by id
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newMessages = olderMessages.filter((m: any) => !existingIds.has(m.id));
        return [...newMessages, ...prev];
      });

      setHasOlderMessages(offset > 0);
    } catch (error) {
      console.error('Failed to load older messages:', error);
      toast({
        title: 'Error',
        description: 'Failed to load older messages',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const buildChatHistoryForRequest = (history: ChatMessage[]) => {
    // Send up to MAX_CHAT_HISTORY_MESSAGES recent messages
    const recentHistory = history.slice(-MAX_CHAT_HISTORY_MESSAGES);

    const formatted = recentHistory.map((msg) => ({
      role: msg.role,
      content:
        msg.content.length > MAX_HISTORY_MESSAGE_CHARS
          ? `${msg.content.slice(0, MAX_HISTORY_MESSAGE_CHARS)}\n\n[Message truncated for context window]`
          : msg.content,
    }));

    // If there are older messages beyond the window, flag for server-side summarization
    const needsSummary = history.length > SUMMARY_THRESHOLD;

    return { formatted, needsSummary, totalMessages: history.length };
  };

  const handleSendMessage = async (retryContent?: string, retryAudioUrl?: string) => {
    const messageContent = retryContent || inputMessage.trim();
    const audioUrl = retryAudioUrl || pendingAudioUrl;

    if (!messageContent || isProcessing) return;
    if (messageContent.length > MAX_MESSAGE_LENGTH) {
      toast({
        title: 'Message too long',
        description: `Please shorten your message to ${MAX_MESSAGE_LENGTH} characters or less.`,
        variant: 'destructive',
      });
      return;
    }

    if (uploadedReports.length > 0 && selectedReports.length === 0) {
      toast({
        title: 'Select a report',
        description: 'Choose at least one ready report to ground the answer.',
        variant: 'destructive',
      });
      return;
    }

    let activeConversationId = conversationId;
    if (!activeConversationId) {
      activeConversationId = await startNewConversation();
      if (!activeConversationId) {
        toast({
          title: 'Error',
          description: 'Failed to start conversation. Please try again.',
          variant: 'destructive',
        });
        return;
      }
    }
    const turnConversationId = activeConversationId;
    abortActiveStream('new-message');
    const streamController = new AbortController();
    activeStreamRef.current = { conversationId: turnConversationId, controller: streamController };

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
      audioUrl: audioUrl || undefined,
      sent_by: user?.id || null,
      sent_by_username: user?.username || null,
    };

    if (!retryContent) {
      setMessages(prev => [...prev, userMessage]);
      setInputMessage('');
      // Clear accumulated transcript after sending
      setAccumulatedTranscript('');
    }
    setPendingAudioUrl(null);
    setFailedMessage(null);
    setIsProcessing(true);
    setStreamingContent('');
    setStreamingToolInvocations([]);

    try {
      // Use streaming for better UX. URL and key come from the shared module
      // (see @/integrations/supabase/env) rather than being inlined here.
      const SUPABASE_KEY = SUPABASE_ANON_KEY;

      // Ground retrieval and fallback context only in the reports selected for this chat.
      const reportsToUse = selectedReports;

      const { formatted: chatHistoryForRequest, needsSummary, totalMessages } = buildChatHistoryForRequest(messages);

      const requestPayload = JSON.stringify({
        action: 'chat',
        // Send report contents as fallback in case RAG indexing hasn't completed
        reportContents: reportsToUse.map(r => r.content),
        reportNames: reportsToUse.map(r => r.name),
        selectedReportNames: reportsToUse.map(r => r.name),
        question: messageContent,
        chatHistory: chatHistoryForRequest,
        conversationId: activeConversationId,
        stream: true,

        agentKey: selectedAgentKey,
        modelProvider: selectedAgentKey,
        needsConversationSummary: needsSummary,
        totalMessageCount: totalMessages,
        agentMode: effectiveAgentMode,
      });

      // WP-11B/C cookie-only: the chat streams, so it cannot go through
      // `invokeSecureFunction` (that helper reads the whole body as JSON). It
      // still follows the same authentication contract: the access-token JWT
      // Bearer is useful while fresh, but the authoritative staff session is
      // the HttpOnly `__Host-session_token` cookie.
      //
      // Omitting credentials here was the failure: every JSON action worked via
      // the cookie, while chat depended solely on a short-lived tab JWT and told
      // a still-signed-in user to sign in again. Include the cookie; report-qa's
      // CSRF guard validates the exact first-party Origin before mutation.
      const sendChatRequest = (bearerToken: string) =>
        fetch(`${SUPABASE_URL}/functions/v1/report-qa`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${bearerToken}`,
          },
          credentials: 'include',
          body: requestPayload,
          signal: streamController.signal,
        });

      const { token: bearerToken, authenticated } = await resolveAuthBearer({ refreshIfMissing: true });
      let response = await sendChatRequest(bearerToken);

      if (!response.ok) {
        // The body can only be read once, so read it here and decide from the
        // text — a retry re-sends the request and gets a fresh body of its own.
        const readFailure = async (res: Response) => {
          const rawText = await res.text().catch(() => '');
          try {
            const payload = JSON.parse(rawText);
            return String(payload?.error?.message || payload?.error || payload?.message || `HTTP ${res.status}`);
          } catch {
            return rawText.trim() || `HTTP ${res.status}`;
          }
        };

        let errorMessage = await readFailure(response);

        // Skipped when the resolver already came back empty-handed: the cookie
        // was asked a moment ago and had nothing to give.
        if (authenticated && isAuthFailureResponse(response.status, errorMessage)) {
          const refreshed = await refreshAccessToken();
          if (refreshed) {
            response = await sendChatRequest(refreshed);
            if (!response.ok) errorMessage = await readFailure(response);
          }
        }

        if (!response.ok) {
          // A session that cannot be refreshed is a person who has to sign in
          // again, and saying so beats handing them the server's word for it.
          throw new Error(describeAuthError(errorMessage) ?? errorMessage);
        }
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Stream the response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      let streamMeta: { citations?: DocumentCitation[]; comparisonMode?: boolean; stream_id?: string; modelProvider?: string; modelAgentKey?: string; modelVersion?: string; followups?: string[] } = {};
      // Tool invocations accumulate from `_tool` SSE events emitted by the
      // agent loop. Keyed by invocation id so a `started` chip can be
      // updated in place when its `completed` event arrives.
      const toolMap = new Map<string, ToolInvocation>();
      const flushToolsToStreaming = () => {
        setStreamingToolInvocations(Array.from(toolMap.values()));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process line by line
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            // Capture metadata event (citations + comparison mode) emitted before tokens
            if (parsed?._meta) {
              streamMeta = {
                citations: parsed._meta.citations,
                comparisonMode: parsed._meta.comparisonMode,
                stream_id: parsed._meta.stream_id,
                modelProvider: parsed._meta.modelProvider,
                modelAgentKey: parsed._meta.modelAgentKey,
                modelVersion: parsed._meta.modelVersion,
              };
              continue;
            }
            // Agent tool-call transparency events
            if (parsed?._tool) {
              const t = parsed._tool;
              const existing = toolMap.get(t.id) || { id: t.id, name: t.name, arguments: undefined };
              const merged: ToolInvocation = {
                ...existing,
                ...t,
              };
              toolMap.set(t.id, merged);
              flushToolsToStreaming();
              continue;
            }
            if (parsed?._followups && Array.isArray(parsed._followups)) {
              streamMeta.followups = parsed._followups.filter((s: any) => typeof s === 'string');
              continue;
            }
            if (parsed?._error) {
              console.warn('[ReportQA] Agent loop error event:', parsed._error);
              continue;
            }
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              if (conversationIdRef.current === turnConversationId) {
                setStreamingContent(fullContent);
              }
            }
          } catch {
            // Re-buffer partial JSON
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

      const finalToolInvocations = Array.from(toolMap.values());

      // Create the final assistant message
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: fullContent || 'I couldn\'t generate a response. Please try again.',
        timestamp: new Date(),
        modelProvider: streamMeta.modelAgentKey || streamMeta.modelProvider || selectedAgentKey,
        modelVersion: streamMeta.modelVersion || null,
        documentCitations: streamMeta.citations,
        comparisonMode: streamMeta.comparisonMode,
        toolInvocations: finalToolInvocations.length > 0 ? finalToolInvocations : undefined,
        aiFollowups: streamMeta.followups,
      };

      if (conversationIdRef.current !== turnConversationId) return;

      setMessages(prev => [...prev, assistantMessage]);
      setStreamingContent('');
      setStreamingToolInvocations([]);
      const expectedPersistedMessages = Math.max(messages.length + (retryContent ? 1 : 2), 2);
      setTimeout(() => {
        if (conversationIdRef.current !== turnConversationId) return;
        refreshConversationMessagesFromSupabase(turnConversationId, expectedPersistedMessages).catch((refreshError) => {
          console.warn('[ReportQA] Failed to verify persisted conversation after send:', refreshError);
        });
      }, 350);

      // Log question asked
      logActivityDirect({
        actionType: 'qa_question_asked',
        entityType: 'qa_conversation',
        entityId: turnConversationId,
        metadata: { question_length: messageContent.length }
      });

      if (messages.length === 0) {
        setTimeout(() => loadSavedConversations(), 1000);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('Chat error:', error);
      setStreamingContent('');
      setFailedMessage({ content: messageContent, audioUrl: audioUrl || undefined });
      toast({
        title: 'Failed to send message',
        description: error instanceof Error ? error.message : 'Click retry to try again.',
        variant: 'destructive',
      });
    } finally {
      const isCurrentStream = activeStreamRef.current?.controller === streamController;
      if (isCurrentStream) {
        activeStreamRef.current = null;
      }
      if (isCurrentStream && conversationIdRef.current === turnConversationId) {
        setIsProcessing(false);
      }
    }
  };

  // Retry failed message
  const handleRetryMessage = () => {
    if (failedMessage) {
      setIsRetrying(true);
      handleSendMessage(failedMessage.content, failedMessage.audioUrl).finally(() => {
        setIsRetrying(false);
      });
    }
  };

  const handleCopyResponse = (content: string) => {
    navigator.clipboard.writeText(content);
    toast({
      title: 'Copied',
      description: 'Response copied to clipboard',
    });
  };

  const fetchMailboxesForEmail = async () => {
    setIsLoadingMailboxes(true);
    try {
      // Use secure edge function for fetching mailboxes (service_role required due to RLS)
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'get-mailboxes',
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch mailboxes');

      const mailboxes = data.mailboxes || [];
      setAvailableMailboxes(mailboxes);

      if (mailboxes.length > 0 && !selectedSenderMailbox) {
        setSelectedSenderMailbox(mailboxes[0].personal_mailbox || '');
      }
    } catch (error) {
      console.error('Error fetching mailboxes:', error);
    } finally {
      setIsLoadingMailboxes(false);
    }
  };

  const handleOpenEmailModal = (content: string) => {
    setEmailContent(content);
    setEmailSubject(`Investment Report Summary - ${uploadedReports.map(r => r.name.replace('.pdf', '')).join(', ')}`);
    setShowEmailModal(true);
    fetchMailboxesForEmail();
  };

  const handleSendEmail = async () => {
    if (!emailTo || !emailContent) {
      toast({
        title: 'Missing Information',
        description: 'Please enter recipient email and message content.',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedSenderMailbox) {
      toast({
        title: 'Missing Sender',
        description: 'Please select a sender mailbox.',
        variant: 'destructive',
      });
      return;
    }

    setIsSendingEmail(true);
    try {
      // Parse CC emails
      const ccEmails = emailCc
        .split(',')
        .map(e => e.trim())
        .filter(e => e.length > 0);

      // Parse BCC emails
      const bccEmails = emailBcc
        .split(',')
        .map(e => e.trim())
        .filter(e => e.length > 0);

      const { data, error } = await invokeSecureFunction('send-email-reply', {
        to: emailTo.trim(),
        subject: emailSubject,
        body: emailContent,
        cc: ccEmails.length > 0 ? ccEmails : undefined,
        bcc: bccEmails.length > 0 ? bccEmails : undefined,
        senderMailbox: selectedSenderMailbox,
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Email sent',
        description: `Summary sent to ${emailTo}`,
      });
      setShowEmailModal(false);
      // Reset form
      setEmailTo('');
      setEmailCc('');
      setEmailBcc('');
      setSelectedSenderMailbox('');
      setShowCcBcc(false);
    } catch (error) {
      console.error('Email error:', error);
      toast({
        title: 'Failed to send',
        description: error instanceof Error ? error.message : 'Could not send email',
        variant: 'destructive',
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Maximum recording duration: 8 minutes (480 seconds)
  const MAX_RECORDING_DURATION = 480;
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const liveTranscriptTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current = mediaRecorder;
      // Don't reset audio chunks if we're resuming from a paused state
      if (!isPaused) {
        audioChunksRef.current = [];
        setLiveTranscript('');
        setRecordingDuration(0);
      }
      setIsPaused(false);

      // Start duration timer with auto-stop at max duration
      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => {
          const newDuration = prev + 1;
          // Auto-stop at max duration
          if (newDuration >= MAX_RECORDING_DURATION) {
            finalizeRecording();
            toast({
              title: 'Maximum recording reached',
              description: 'Recording stopped after 8 minutes. Transcribing...',
            });
          }
          return newDuration;
        });
      }, 1000);

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);

          // Live transcription preview every 10 seconds (20 chunks × 500ms) to reduce API spam
          // Only do live preview for recordings under 2 minutes to save resources
          if (audioChunksRef.current.length % 20 === 0 && audioChunksRef.current.length <= 240) {
            // Debounce live transcription to prevent overlapping calls
            if (liveTranscriptTimeoutRef.current) {
              clearTimeout(liveTranscriptTimeoutRef.current);
            }
            liveTranscriptTimeoutRef.current = setTimeout(async () => {
              try {
                // Only transcribe last 30 seconds for preview (60 chunks)
                const recentChunks = audioChunksRef.current.slice(-60);
                const partialBlob = new Blob(recentChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onloadend = async () => {
                  const base64 = (reader.result as string).split(',')[1];
                  const { data } = await invokeSecureFunction('report-qa', {
                    action: 'transcribe', audio: base64,
                    ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
                  });
                  if (data?.success && data?.text) {
                    setLiveTranscript(data.text);
                  }
                };
                reader.readAsDataURL(partialBlob);
              } catch {
                // Silent fail for live preview
              }
            }, 500);
          }
        }
      };

      mediaRecorder.onstop = async () => {
        // Clean up timers
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
          durationIntervalRef.current = null;
        }
        if (liveTranscriptTimeoutRef.current) {
          clearTimeout(liveTranscriptTimeoutRef.current);
          liveTranscriptTimeoutRef.current = null;
        }

        // Only stop tracks if we're finalizing (not pausing)
        if (!isPaused && streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        // Only transcribe if finalizing (not pausing)
        if (!isPaused && audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          console.log(`[Recording] Final audio size: ${(audioBlob.size / 1024 / 1024).toFixed(2)} MB, chunks: ${audioChunksRef.current.length}`);
          await transcribeAudio(audioBlob);
          setLiveTranscript('');
          setRecordingDuration(0);
        }
      };

      // Request data every 500ms for chunking
      mediaRecorder.start(500);
      setIsRecording(true);
      setLiveAnnouncement('Recording started - up to 8 minutes');
    } catch (error) {
      console.error('Microphone error:', error);
      toast({
        title: 'Microphone access denied',
        description: 'Please allow microphone access to use voice input',
        variant: 'destructive',
      });
    }
  };

  // Pause recording - keeps audio chunks and duration intact
  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.stop();

      // Stop the stream tracks while paused
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      // Clear the duration timer but keep the duration value
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      setIsPaused(true);
      setIsRecording(false);
      setLiveAnnouncement('Recording paused');
      toast({
        title: 'Recording paused',
        description: 'Click resume to continue recording',
      });
    }
  };

  // Resume recording - continues from where it left off
  const resumeRecording = async () => {
    if (isPaused) {
      // Start a new recording session but keep existing chunks
      await startRecording();
    }
  };

  // Finalize and transcribe - this is the actual "stop"
  const finalizeRecording = () => {
    if (mediaRecorderRef.current && (isRecording || isPaused)) {
      setIsPaused(false);

      if (isRecording) {
        // If currently recording, stop the recorder (triggers onstop)
        mediaRecorderRef.current.stop();
      } else if (isPaused && audioChunksRef.current.length > 0) {
        // If paused, manually transcribe since recorder is already stopped
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        console.log(`[Recording] Final audio size: ${(audioBlob.size / 1024 / 1024).toFixed(2)} MB, chunks: ${audioChunksRef.current.length}`);
        transcribeAudio(audioBlob);
        setLiveTranscript('');
        setRecordingDuration(0);
      }

      setIsRecording(false);
      setLiveAnnouncement('Recording stopped, transcribing...');
    }
  };

  // Legacy stopRecording for backward compatibility - now calls finalizeRecording
  const stopRecording = () => {
    finalizeRecording();
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsTranscribing(true);

    // Create audio URL for playback
    const audioUrl = URL.createObjectURL(audioBlob);
    setPendingAudioUrl(audioUrl);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(audioBlob);
      const base64Audio = await base64Promise;

      // Ensure a conversation exists and send its id with the request.
      // Deployed backends that scope 'transcribe' to a conversation reject
      // requests without one (surfacing as "Transcription failed" in a new
      // chat); newer backends simply ignore the extra field.
      let transcribeConversationId = conversationIdRef.current;
      if (!transcribeConversationId) {
        try {
          transcribeConversationId = await startNewConversation();
        } catch (convErr) {
          console.warn('[ReportQA] Could not pre-create conversation for transcription:', convErr);
        }
      }

      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'transcribe',
        audio: base64Audio,
        ...(transcribeConversationId ? { conversationId: transcribeConversationId } : {}),
      });

      if (error) throw error;

      if (data.success && data.text) {
        // Append to accumulated transcript instead of replacing
        const newTranscript = accumulatedTranscript
          ? `${accumulatedTranscript} ${data.text}`.trim()
          : data.text;
        setAccumulatedTranscript(newTranscript);
        setInputMessage(newTranscript);

        // Clear accumulated transcript and chunks after successful transcription
        audioChunksRef.current = [];
      } else {
        throw new Error('No transcription result');
      }
    } catch (error: any) {
      console.error('Transcription error:', error);
      // Clear pending audio on error
      setPendingAudioUrl(null);
      const detail = error?.message && error.message !== 'Not found'
        ? error.message
        : 'Could not convert voice to text. Please try again.';
      toast({
        title: 'Transcription failed',
        description: detail,
        variant: 'destructive',
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  // Clear accumulated transcript when starting fresh or sending message
  const clearAccumulatedTranscript = () => {
    setAccumulatedTranscript('');
    audioChunksRef.current = [];
  };

  const clearAll = () => {
    abortActiveStream('clear-all');
    conversationLoadRequestRef.current += 1;
    setRestoringConversationId(null);
    setUploadedReports([]);
    setMessages([]);
    setActiveConversationId(null);
    setIsProcessing(false);
  };

  function handleNewChat() {
    abortActiveStream('new-chat');
    conversationLoadRequestRef.current += 1;
    setRestoringConversationId(null);
    setUploadedReports([]);
    setMessages([]);
    setActiveConversationId(null);
    setTotalMessageCount(0);
    setHasOlderMessages(false);
    setIsProcessing(false);
    toast({
      title: 'New chat started',
      description: 'Upload reports or start chatting',
    });
  }

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // Use secure edge function for delete (service_role required due to RLS)
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'delete-conversation',
        conversationId: convId,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to delete');

      // Log conversation deleted
      const deletedConv = savedConversations.find(c => c.id === convId);
      logActivityDirect({
        actionType: 'qa_conversation_deleted',
        entityType: 'qa_conversation',
        entityId: convId,
        entityName: deletedConv?.title
      });

      setSavedConversations(prev => prev.filter(c => c.id !== convId));
      if (conversationId === convId) {
        handleNewChat();
      }

      toast({
        title: 'Conversation deleted',
        description: 'The conversation has been removed',
      });
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      toast({
        title: 'Failed to delete',
        description: 'Could not delete the conversation',
        variant: 'destructive',
      });
    }
  };

  // Handle pin toggle
  const handleTogglePin = (convId: string) => {
    const newPinned = togglePin(convId);
    setPinnedIds(newPinned);
    toast({
      title: isPinned(convId) ? 'Unpinned' : 'Pinned',
      description: isPinned(convId) ? 'Conversation unpinned' : 'Conversation pinned to top',
    });
  };

  // Handle conversation tags
  const handleAddTag = (tag: string) => {
    if (!conversationId) return;
    setConversationTags(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(conversationId) || [];
      if (!existing.includes(tag)) {
        newMap.set(conversationId, [...existing, tag]);
        localStorage.setItem('qa-conversation-tags', JSON.stringify([...newMap]));
      }
      return newMap;
    });
  };

  const handleRemoveTag = (tag: string) => {
    if (!conversationId) return;
    setConversationTags(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(conversationId) || [];
      newMap.set(conversationId, existing.filter(t => t !== tag));
      localStorage.setItem('qa-conversation-tags', JSON.stringify([...newMap]));
      return newMap;
    });
  };

  // Handle message threading
  const handleReply = async (messageId: string, reply: string) => {
    addReply(messageId, reply, 'user');
    // Send the reply as a new message with context
    const originalMessage = messages.find(m => m.id === messageId);
    if (originalMessage) {
      setInputMessage(`Regarding "${originalMessage.content.substring(0, 50)}...": ${reply}`);
    }
  };

  // Generate PDF and add to chat as attachment
  const handleGeneratePDFAttachment = async () => {
    if (!conversationId || messages.length === 0) {
      toast({
        title: 'Cannot generate PDF',
        description: 'Start a conversation first',
        variant: 'destructive',
      });
      return;
    }

    setIsGeneratingPDF(true);
    try {
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'generate-qa-pdf',
        conversationId,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp.toISOString(),
        })),
        reportNames: uploadedReports.map(r => r.name.replace('.pdf', '')),
        title: getCurrentTitle(),
      });

      if (error) throw error;

      if (data.success && data.attachment) {
        // Add the message with attachment to the chat
        const attachmentMessage: ChatMessage = {
          id: data.messageId || `attachment-${Date.now()}`,
          role: 'assistant',
          content: `📄 I've generated a PDF summary of our conversation. You can download it or send it via email using the options below.`,
          timestamp: new Date(),
          attachments: [data.attachment],
        };

        setMessages(prev => [...prev, attachmentMessage]);

        toast({
          title: 'PDF Generated',
          description: 'Your conversation has been exported to PDF',
        });
      }
    } catch (error) {
      console.error('PDF generation error:', error);
      toast({
        title: 'PDF Generation Failed',
        description: error instanceof Error ? error.message : 'Could not generate PDF',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  // Handle sending PDF via Email Copilot
  const handleSendPDFViaEmail = async (attachment: PDFAttachment) => {
    setPendingPDFAttachment(attachment);
    setPdfValidationError(null);
    setShowEmailCopilotModal(true);

    // Validate that the PDF URL is still accessible
    setIsValidatingPDF(true);
    try {
      const response = await fetch(attachment.url, { method: 'HEAD' });
      if (!response.ok) {
        setPdfValidationError('PDF file may have expired or is no longer accessible. Try generating a new PDF.');
      }
    } catch (error) {
      console.error('PDF validation error:', error);
      setPdfValidationError('Unable to verify PDF accessibility. The file may still work.');
    } finally {
      setIsValidatingPDF(false);
    }
  };

  // Navigate to Email Copilot with the attachment pre-filled and dynamic draft
  const handleConfirmEmailCopilot = () => {
    if (pendingPDFAttachment) {
      // Build conversation summary for email draft
      const reportNames = uploadedReports.map(r => r.name.replace('.pdf', '')).join(', ');
      const messageCount = messages.length;
      const userQuestions = messages.filter(m => m.role === 'user').slice(0, 3).map(m => m.content.substring(0, 100));

      // Create a dynamic email context object
      const emailContext = {
        attachment: pendingPDFAttachment,
        conversationContext: {
          title: getCurrentTitle(),
          reportNames,
          messageCount,
          sampleQuestions: userQuestions,
          generatedAt: new Date().toISOString(),
        }
      };

      // Store the enhanced context in localStorage for Email Copilot
      localStorage.setItem('qa_pdf_attachment', JSON.stringify(emailContext));
      // Navigate to Email Copilot
      window.location.href = '/email-copilot?attachment=qa_pdf';
    }
    setShowEmailCopilotModal(false);
    setPendingPDFAttachment(null);
    setPdfValidationError(null);
  };

  // Filter conversations based on search query
  const filteredConversations = useMemo(() => savedConversations.filter(conv => {
    if (!historySearchQuery.trim()) return true;
    const query = historySearchQuery.toLowerCase();
    return (
      conv.title.toLowerCase().includes(query) ||
      conv.report_names.some(name => name.toLowerCase().includes(query))
    );
  }), [savedConversations, historySearchQuery]);

  useEffect(() => {
    const viewport = historyListRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    viewport?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [historySearchQuery]);

  // Sort conversations with pinned first
  const sortedConversations = useMemo(() => [...filteredConversations].sort((a, b) => {
    const aPinned = pinnedIds.includes(a.id);
    const bPinned = pinnedIds.includes(b.id);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  }), [filteredConversations, pinnedIds]);

  // Group conversations by date
  const groupConversationsByDate = (conversations: SavedConversation[]) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const groups: { [key: string]: SavedConversation[] } = {
      'Pinned': [],
      'Today': [],
      'Yesterday': [],
      'This Week': [],
      'Older': [],
    };

    conversations.forEach(conv => {
      if (pinnedIds.includes(conv.id)) {
        groups['Pinned'].push(conv);
        return;
      }
      const convDate = new Date(conv.updated_at);
      if (convDate.toDateString() === today.toDateString()) {
        groups['Today'].push(conv);
      } else if (convDate.toDateString() === yesterday.toDateString()) {
        groups['Yesterday'].push(conv);
      } else if (convDate > lastWeek) {
        groups['This Week'].push(conv);
      } else {
        groups['Older'].push(conv);
      }
    });

    return groups;
  };

  // Get current theme styles
  const getMessageBgClass = (role: 'user' | 'assistant') => {
    if (!chatTheme || chatTheme.id === 'default') {
      return role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted';
    }
    return role === 'user' ? chatTheme.userBg : chatTheme.assistantBg;
  };

  const getAccentClass = () => {
    if (!chatTheme || chatTheme.id === 'default') {
      return 'bg-primary/10';
    }
    return chatTheme.accent;
  };

  const hasUploadError = uploadProgress.some((item) => item.status === 'error');
  const isUploadComplete = uploadedReports.length > 0 && uploadProgress.every((item) => item.status !== 'uploading' && item.status !== 'processing');

  return (
    <>
      <SkipToContent targetId="chat-main" />
      <LiveRegion message={liveAnnouncement} />
      <DashboardThemeFrame
        as="main"
        variant="page"
        className="report-qa-premium report-qa-density-shell flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto overflow-x-hidden p-2 pb-14 sm:gap-2.5 sm:p-3 sm:pb-16 md:h-[calc(100dvh-5.25rem)] md:max-h-[calc(100dvh-5.25rem)] md:gap-2.5 md:overflow-hidden md:p-3 md:pb-0 xl:h-[calc(100dvh-5.75rem)] xl:max-h-[calc(100dvh-5.75rem)]"
        aria-label="Aurixa Intelligence Hub Chat"
      >
      {/* Header - compact on mobile */}
      <DashboardThemeFrame as="header" variant="hero" className="report-qa-hero flex shrink-0 flex-col items-stretch justify-between gap-2 px-3 py-2 sm:px-4 sm:py-2.5 md:flex-row md:items-center md:gap-3 md:px-5 md:py-2.5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="report-qa-eyebrow inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em]">
              <Sparkles className="h-3 w-3" />
              AI Report Intelligence
            </span>
            <h1 className="text-lg sm:text-xl md:text-[1.5rem] font-bold text-foreground truncate tracking-tight">Aurixa Intelligence Hub</h1>
          </div>
          <p className="report-qa-subtitle max-w-2xl text-[11px] leading-[1.35] text-muted-foreground sm:text-xs">
            Upload investment reports and ask questions to generate summaries, comparisons and citation-backed insights.
          </p>
        </div>
        <div className="report-qa-header-actions flex flex-wrap items-center gap-2 sm:gap-2.5 md:justify-end">
          <Button onClick={handleNewChat} className="report-qa-new-chat h-9 gap-1.5 rounded-xl px-3 text-xs font-semibold sm:h-10 sm:px-4 sm:text-sm" size="sm">
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New Chat</span>
          </Button>
          <Button ref={historyButtonRef} variant="outline" onClick={() => setShowHistory(true)} className="report-qa-history-button h-9 gap-1.5 rounded-xl px-3 text-xs font-semibold sm:h-10 sm:px-4 sm:text-sm" size="sm">
            <History className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">History</span>
            {savedConversations.length > 0 && (
              <Badge variant="secondary" className="report-qa-history-badge ml-0.5 h-5 min-w-5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums sm:h-5 sm:px-1.5 sm:text-xs">
                {savedConversations.length}
              </Badge>
            )}
          </Button>
          {messages.length > 0 && conversationId && (
            <Button
              variant="ghost"
              onClick={handleGeneratePDFAttachment}
              className="gap-1.5 h-8 text-xs text-muted-foreground sm:h-9 sm:text-sm"
              disabled={isGeneratingPDF}
              size="sm"
              title="Generate the pdf-lib transcript and post it into this chat (legacy layout)"
            >
              {isGeneratingPDF ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Transcript (legacy layout)</span>
            </Button>
          )}
          {/*
            The typeset document leads; the transcript button above is the
            named legacy choice. It still calls `generate-qa-pdf` and still
            posts its pdf-lib document into the chat — a different document
            from the structured report, which is why it stays a choice rather
            than being folded — while this one produces the typeset document
            through WeasyPrint and can post the same attachment shape, so the
            in-place email composer reaches either.
          */}
          {messages.length > 0 && conversationId && (
            <ReportQaDownloadButton
              conversationId={conversationId}
              className="h-8 text-xs sm:h-9 sm:text-sm"
              onAttached={() => {
                // Reload so the attachment message the route wrote appears in
                // the thread, the same way the legacy button's does.
                const open = savedConversations.find((c) => c.id === conversationId);
                if (open) void loadConversation(open);
              }}
            />
          )}
          {uploadedReports.length > 0 && (
            <Button variant="outline" onClick={clearAll} className="gap-1.5 h-8 text-xs sm:h-9 sm:text-sm" size="sm">
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear All</span>
            </Button>
          )}
        </div>
      </DashboardThemeFrame>

      <div className="report-qa-workspace-grid grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-y-auto overflow-x-hidden pr-1 sm:gap-3 md:gap-4 lg:grid-cols-[minmax(18rem,30%)_minmax(0,70%)] lg:overflow-hidden lg:pr-0 xl:grid-cols-[minmax(19rem,29%)_minmax(0,71%)] xl:gap-5">
        {/* Upload Section - stacked on smaller screens, side-by-side on desktop */}
        {showReportsPanel && (
        <DashboardThemeFrame as="section" variant="section" className="report-qa-panel report-qa-reports-panel flex max-h-[42dvh] flex-col overflow-hidden min-h-[16rem] p-0 md:max-h-[44dvh] lg:col-span-1 lg:max-h-none lg:min-h-0">
          <CardHeader className="report-qa-reports-header px-3 py-2.5 pb-2.5 sm:px-4 sm:py-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex min-w-0 items-center gap-2 text-base tracking-tight">
                  <span className="report-qa-reports-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-xl">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="truncate">Reports</span>
                  {uploadedReports.length > 0 && (
                    <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {uploadedReports.length}
                    </span>
                  )}
                </CardTitle>
                <ReportLibraryPicker
                  onAdd={handleLibraryAdd}
                  existingNames={uploadedReports.map((r) => r.name)}
                  disabled={isUploading}
                  className="report-qa-library-button h-8 shrink-0 rounded-lg px-3 text-xs font-semibold"
                />
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Add PDFs or saved reports to ground the assistant in source material.
              </p>
            </div>
          </CardHeader>
          {/* overflow-y-auto at every width: with lg:overflow-hidden the
              reports section could be flex-squeezed below its content and its
              text painted over the Loaded Reports section below it. */}
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3 sm:px-4 sm:pb-4">
            <div className="report-qa-panel-section space-y-2">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                <span>Document intake</span>
                <span className={cn(
                  "rounded-full border px-2 py-0.5 normal-case tracking-normal",
                  hasUploadError
                    ? "border-destructive/25 bg-destructive/10 text-destructive"
                    : uploadProgress.some((item) => item.status === 'uploading' || item.status === 'processing')
                      ? "border-warning/25 bg-warning/10 text-warning"
                      : "border-success/25 bg-success/10 text-success"
                )}>
                  {hasUploadError
                    ? 'Needs attention'
                    : uploadProgress.some((item) => item.status === 'uploading' || item.status === 'processing')
                      ? 'Processing'
                      : 'Ready'}
                </span>
              </div>
            {/* Premium Upload Zone */}
            <div
              className={cn(
                "report-qa-dropzone group w-full rounded-[1.15rem] border-2 border-dashed px-4 py-4 text-center transition-all cursor-pointer sm:px-5 sm:py-5",
                isDragOver ? 'is-drag-over border-primary' : 'border-primary/45 hover:border-primary/75',
                isUploading && 'is-processing pointer-events-none',
                isUploadComplete && !isUploading && !hasUploadError && 'is-ready',
                hasUploadError && 'is-error'
              )}
              role="button"
              tabIndex={isUploading ? -1 : 0}
              aria-label="Upload PDF reports. Press Enter or Space to choose files."
              aria-busy={isUploading}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={handleDropzoneKeyDown}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  files.forEach(file => handleFileUpload(file));
                }}
              />
              {isUploading ? (
                <div className="flex flex-col items-center justify-center gap-2">
                  <span className="report-qa-upload-icon flex h-11 w-11 items-center justify-center rounded-2xl sm:h-12 sm:w-12">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  </span>
                  <p className="text-sm font-semibold text-foreground sm:text-base">Processing report…</p>
                  <p className="max-w-[16rem] text-xs leading-5 text-muted-foreground">Extracting content for AI retrieval</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2">
                  <span className="report-qa-upload-icon flex h-11 w-11 items-center justify-center rounded-2xl sm:h-12 sm:w-12">
                    {hasUploadError ? (
                      <AlertCircle className="h-7 w-7 text-destructive transition-transform group-hover:-translate-y-0.5 sm:h-8 sm:w-8" />
                    ) : isUploadComplete ? (
                      <CheckCircle2 className="h-7 w-7 text-success transition-transform group-hover:-translate-y-0.5 sm:h-8 sm:w-8" />
                    ) : (
                      <Upload className="h-7 w-7 text-primary transition-transform group-hover:-translate-y-0.5 sm:h-8 sm:w-8" />
                    )}
                  </span>
                  <p className="text-sm font-semibold text-foreground sm:text-base">
                    {isDragOver
                      ? 'Drop PDF reports here'
                      : hasUploadError
                        ? 'Review upload error below'
                        : isUploadComplete
                          ? 'Report ready — add another PDF'
                          : 'Drop PDFs here or click to upload'}
                  </p>
                  <p className="max-w-[17rem] text-xs leading-5 text-muted-foreground">
                    {hasUploadError
                      ? 'Errors remain visible so you can retry with a valid PDF.'
                      : isUploadComplete
                        ? 'Loaded reports are available as source context.'
                        : 'PDF reports stay connected to this chat workspace'}
                  </p>
                </div>
              )}
            </div>
            </div>

            {uploadedReports.length === 0 && uploadProgress.length === 0 && (
              <div className="report-qa-empty-docs rounded-2xl border p-3">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-foreground">No report selected yet</p>
                    <p className="text-[11px] leading-4 text-muted-foreground">
                      Upload a PDF or pick from the library to unlock source-grounded Q&A, summaries and comparisons.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Upload Progress */}
            {uploadProgress.length > 0 && (
              <div className="space-y-2">
                {uploadProgress.map((item) => (
                  <UploadProgressItem
                    key={item.fileName}
                    fileName={item.fileName}
                    progress={item.progress}
                    status={item.status}
                    error={item.error}
                    onDismiss={() => setUploadProgress((prev) => prev.filter((p) => p.fileName !== item.fileName))}
                  />
                ))}
              </div>
            )}

            {/* Reports in this chat — primary flexible list. The min-height
                guarantees roughly three report rows stay visible, so a
                multi-report chat is not reduced to a one-row peephole. */}
            <div className="report-qa-loaded-reports flex min-h-0 shrink-0 flex-col gap-2 lg:min-h-[13rem] lg:flex-1 lg:basis-0 lg:shrink">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  <span>Reports in this chat</span>
                  <span className="normal-case tracking-normal text-primary">{selectedReports.length > 1 ? `${selectedReports.length} in context` : selectedReports.length === 1 ? '1 selected' : 'Select reports'}</span>
                </div>
                {uploadedReports.length > 0 ? (
                  <ScrollArea className="report-qa-report-list -mx-1 min-h-0 flex-1 px-1" aria-label="Reports in this chat">
                    <div className="space-y-1.5">
                    {uploadedReports.map((report, index) => {
                    const isSelected = selectedReportNames.includes(report.name);
                    const sizeKB = report.fileSizeBytes
                      ? report.fileSizeBytes < 1024 * 1024
                        ? `${Math.round(report.fileSizeBytes / 1024)} KB`
                        : `${(report.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB`
                      : `${Math.round(report.content.length / 1024)} KB`;
                    return (
                      <div
                        key={report.name}
                        role="checkbox"
                        aria-checked={isSelected}
                        tabIndex={0}
                        aria-label={`${isSelected ? 'Deselect' : 'Select'} ${report.name} for AI grounding`}
                        onClick={() => setSelectedReportNames(prev => isSelected ? prev.filter(name => name !== report.name) : [...prev, report.name])}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedReportNames(prev => isSelected ? prev.filter(name => name !== report.name) : [...prev, report.name]);
                          }
                        }}
                        className={cn(
                          "group report-qa-report-item flex items-center gap-2.5 rounded-xl border p-2.5 cursor-pointer transition-all",
                          isSelected
                            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                            : "border-border/60 hover:border-primary/40 hover:bg-muted/40"
                        )}
                      >
                        <div className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                          isSelected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                        )}>
                          {isSelected ? <CheckCircle2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate" title={report.name}>
                            {report.name.replace(/\.pdf$/i, '')}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            <span className="font-medium text-success dark:text-success">Ready</span>
                            <span> · {report.totalPages ?? '—'} pages · {sizeKB}</span>
                            {isSelected && <span className="ml-1.5 text-primary font-medium">· Selected</span>}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 shrink-0 gap-1.5 rounded-lg border border-border/60 bg-background/60 px-2 text-[11px] text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
                          aria-label={`Remove ${report.name} from this chat`}
                          title="Remove report from this chat"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeReport(report.name);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="hidden 2xl:inline">Remove</span>
                        </Button>
                      </div>
                    );
                  })}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="flex items-center justify-center rounded-xl border border-dashed border-border/60 px-3 py-3 text-center text-[11px] leading-4 text-muted-foreground lg:min-h-[5rem] lg:flex-1">
                    Reports you upload or pick from the library will appear here for selection and removal.
                  </div>
                )}
              </div>

            {/* Comparison Badge */}
            {selectedReports.length > 1 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-xl border border-primary/20">
                <GitCompare className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-primary font-medium">{selectedReports.length} reports in context — answers can draw on any of them, comparisons included</span>
              </div>
            )}

            {/* Loaded reports search — secondary action anchored below chat reports */}
            <div className="report-qa-panel-section space-y-2 shrink-0">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  <span>Loaded Reports</span>
                  <span className="normal-case tracking-normal text-primary">{uploadedReports.length} loaded</span>
                </div>
                <ReportSearch
                  reports={uploadedReports}
                  onResultClick={(reportIndex) => {
                    setSelectedReportNames([uploadedReports[reportIndex].name]);
                    toast({
                      title: 'Report selected',
                      description: `Focused on ${uploadedReports[reportIndex].name}`,
                    });
                  }}
                />
              </div>
          </CardContent>
        </DashboardThemeFrame>
        )}


        {/* Chat Section */}
        <DashboardThemeFrame as="section" variant="section" className={cn("report-qa-panel report-qa-chat-panel flex flex-col overflow-hidden min-h-0 min-w-0 p-0", showReportsPanel ? "" : "lg:col-span-2")}>
          <CardHeader className="report-qa-chat-header shrink-0 px-3 py-2.5 pb-2.5 sm:px-4 sm:py-3 sm:pb-2.5">
            {/* Mobile: stacked title row above toolbar controls */}
            <div className="flex flex-col gap-2 sm:hidden">
              <div className="flex min-w-0 items-center gap-2">
                {!showReportsPanel && (
                <Button variant="ghost" size="icon" className="h-11 w-11 flex-shrink-0" onClick={handleToggleReportsPanel}>
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              )}
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="report-qa-chat-title-icon flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl">
                  <MessageSquare className="h-4 w-4" />
                </span>
                {isEditingMainTitle && conversationId ? (
                  <div className="flex min-w-0 items-center gap-1 flex-1">
                    <Input
                      value={mainTitleEdit}
                      onChange={(e) => setMainTitleEdit(e.target.value)}
                      className="h-7 min-w-0 flex-1 text-xs"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveTitle(conversationId, mainTitleEdit);
                        if (e.key === 'Escape') setIsEditingMainTitle(false);
                      }}
                    />
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleSaveTitle(conversationId, mainTitleEdit)}>
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight cursor-pointer"
                    title={getCurrentTitle()}
                    onClick={() => {
                      if (conversationId) {
                        setMainTitleEdit(getCurrentTitle());
                        setIsEditingMainTitle(true);
                      }
                    }}
                  >
                    {getCurrentTitle()}
                  </span>
                )}
              </div>
              </div>
              <div className="report-qa-toolbar flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/40 px-2 py-1">
                <ReportQAModelSlotSelector
                  selectedAgentKey={selectedAgentKey}
                  onAgentKeyChange={setSelectedAgentKey}
                  disabled={isProcessing}
                />
                <LiveModelChipGroup surfaceId="reportQa" size="sm" showSlot className="sm:hidden" />
              {/* Beside the overflow menu, not inside it: ConversationExport is
                  a menu of its own and carries the template picker's dialog —
                  nested in this menu's content, the inner menu could not open
                  and the dialog unmounted with it. */}
              <ConversationExport
                messages={messages}
                title={getCurrentTitle()}
                reportNames={uploadedReports.map(r => r.name)}
                conversationId={conversationId}
              />
              {/* Mobile overflow menu for all toolbar actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-11 w-11 flex-shrink-0" aria-label="Open chat actions menu">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {conversationId && (
                    <>
                      <DropdownMenuItem onClick={() => handleTogglePin(conversationId)}>
                        <Pin className="h-3.5 w-3.5 mr-2" />
                        {pinnedIds.includes(conversationId) ? 'Unpin' : 'Pin'} Chat
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem asChild>
                    <div className="p-0">
                      <AutoSummarize
                        messages={messages.map(m => ({ role: m.role, content: m.content }))}
                        reportNames={uploadedReports.map(r => r.name)}
                        conversationId={conversationId}
                        disabled={messages.length < 2}
                      />
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </div>
            </div>

            {/* Desktop/tablet: conversation information row above toolbar controls */}
            <div className="hidden sm:flex sm:flex-col gap-2">
              <div className="flex min-w-0 items-center gap-2 pt-1">
                {!showReportsPanel && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleToggleReportsPanel} title="Show reports panel (⌘B)">
                    <FileText className="h-4 w-4" />
                  </Button>
                )}
                <span className="report-qa-chat-title-icon flex h-9 w-9 items-center justify-center rounded-xl">
                  <MessageSquare className="h-5 w-5" />
                </span>
                {isEditingMainTitle && conversationId ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Input
                      value={mainTitleEdit}
                      onChange={(e) => setMainTitleEdit(e.target.value)}
                      className="h-8 min-w-0 flex-1 text-sm"
                      autoFocus
                      aria-label="Edit conversation title"
                      disabled={isSavingTitle}
                      onBlur={() => { if (conversationId && mainTitleEdit.trim() && mainTitleEdit.trim() !== getCurrentTitle()) handleSaveTitle(conversationId, mainTitleEdit); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveTitle(conversationId, mainTitleEdit);
                        if (e.key === 'Escape') { setMainTitleEdit(getCurrentTitle()); setIsEditingMainTitle(false); setTitleSaveError(null); }
                      }}
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isSavingTitle} aria-label="Save conversation title" onMouseDown={(e) => e.preventDefault()} onClick={() => handleSaveTitle(conversationId, mainTitleEdit)}>{isSavingTitle ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}</Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isSavingTitle} aria-label="Cancel title edit" onMouseDown={(e) => e.preventDefault()} onClick={() => { setMainTitleEdit(getCurrentTitle()); setIsEditingMainTitle(false); setTitleSaveError(null); }}><X className="h-3 w-3" /></Button>
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0 text-sm font-semibold text-muted-foreground">Q&A:</span>
                    <CardTitle
                      className="report-qa-chat-title min-w-0 flex-1 truncate text-lg tracking-tight"
                      title={getCurrentTitle()}
                      onClick={() => { if (conversationId) { setMainTitleEdit(getCurrentTitle()); setIsEditingMainTitle(true); } }}
                    >
                      {getCurrentTitle()}
                    </CardTitle>
                    {conversationId && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Edit conversation title" onClick={() => { setMainTitleEdit(getCurrentTitle()); setIsEditingMainTitle(true); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                    {isSavingTitle && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Saving title" />}
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 rounded-lg border border-border/50 bg-background/40 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setChatToolsExpanded((v) => !v)}
                  aria-expanded={chatToolsExpanded}
                  aria-controls="report-qa-chat-tools"
                  title={chatToolsExpanded ? 'Hide the model and chat tools to give the conversation more room' : 'Show the model and chat tools'}
                >
                  {chatToolsExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  Model &amp; tools
                </Button>
              </div>

              {titleSaveError && <p className="pl-11 text-xs text-destructive" role="alert">{titleSaveError}</p>}
              {chatToolsExpanded && (
              <div id="report-qa-chat-tools" className="report-qa-toolbar flex min-w-0 flex-wrap items-center justify-start gap-1 rounded-xl border border-border/50 bg-background/40 px-2 py-1 sm:justify-start">
                <ReportQAModelSlotSelector selectedAgentKey={selectedAgentKey} onAgentKeyChange={setSelectedAgentKey} disabled={isProcessing} />
                <Separator orientation="vertical" className="mx-1 hidden h-7 bg-primary/20 md:block" />
                <div className="hidden min-w-0 items-center gap-2 md:flex" aria-label="Live model assignments for Aurixa Intelligence Hub">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Live</span>
                  <LiveModelChipGroup surfaceId="reportQa" size="sm" />
                  {canManageAgentModels && <ModelUpgradeButton surfaceId="reportQa" />}
                </div>
                <Separator orientation="vertical" className="mx-1 hidden h-7 bg-primary/20 md:block" />
                {conversationId && (
                  <>
                    <ConversationClientLinker
                      conversationId={conversationId}
                      initialClientId={savedConversations.find(c => c.id === conversationId)?.client_id ?? null}
                      onClientChange={(cid) => setSavedConversations(prev => prev.map(c => c.id === conversationId ? { ...c, client_id: cid } : c))}
                    />
                    <PinConversation conversationId={conversationId} isPinned={pinnedIds.includes(conversationId)} onTogglePin={handleTogglePin} />
                    <ConversationTags tags={conversationTags.get(conversationId) || []} onAddTag={handleAddTag} onRemoveTag={handleRemoveTag} />
                  </>
                )}
                <ConversationExport messages={messages} title={getCurrentTitle()} reportNames={uploadedReports.map(r => r.name)} conversationId={conversationId} />
                <AutoSummarize messages={messages.map(m => ({ role: m.role, content: m.content }))} reportNames={uploadedReports.map(r => r.name)} conversationId={conversationId} disabled={messages.length < 2} />
                {conversationId && <Badge variant="outline" className="ml-1 whitespace-nowrap border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] text-primary">Auto-saving</Badge>}
              </div>
              )}
            </div>
            <CardDescription className="report-qa-chat-subtitle hidden pl-11 text-xs sm:block">
              {selectedReports.length > 1
                ? `Answering across ${selectedReports.length} selected reports — ask about any of them, or ask for a comparison`
                : selectedReports.length === 1
                  ? `Ask questions about ${selectedReports[0].name.replace(/\.pdf$/i, '')}`
                  : 'Select at least one report to ask grounded questions'}
            </CardDescription>

            {conversationId && (conversationTags.get(conversationId) || []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1 sm:mt-2">
                <ConversationTags tags={conversationTags.get(conversationId) || []} onAddTag={handleAddTag} onRemoveTag={handleRemoveTag} compact />
              </div>
            )}
          </CardHeader>
          <CardContent id="chat-main" className="report-qa-chat-content flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2 sm:px-3 sm:pb-3">
            {/* Messages */}
            <ScrollArea ref={scrollAreaRef} className={cn("report-qa-message-area mb-2 min-h-0 flex-1 basis-0 pr-1 sm:mb-2 sm:pr-2", messages.length === 0 && !restoringConversationId && "report-qa-message-area-empty")} aria-label="Aurixa Intelligence Hub conversation" role="log" aria-live="polite" aria-busy={!!restoringConversationId}>
              {conversationRestoreError && (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{conversationRestoreError}</span>
                </div>
              )}
              {/* Load older messages button */}
              {hasOlderMessages && messages.length > 0 && (
                <div className="flex justify-center py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadOlderMessages}
                    disabled={isLoadingOlder}
                    className="text-xs text-muted-foreground"
                  >
                    {isLoadingOlder ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Loading older messages…</>
                    ) : (
                      <>↑ Load older messages ({totalMessageCount - messages.length} remaining)</>
                    )}
                  </Button>
                </div>
              )}
              {restoringConversationId ? (
                <div className="report-qa-empty-state flex min-h-[12rem] items-center justify-center p-3 text-center sm:min-h-[15rem] sm:p-4" role="status">
                  <div className="report-qa-empty-card space-y-3">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                    <div className="space-y-1">
                      <p className="report-qa-empty-title">Loading conversation…</p>
                      <p className="report-qa-empty-helper">Restoring the saved questions, answers, and report context.</p>
                    </div>
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div className="report-qa-empty-state flex min-h-[12rem] items-center justify-center p-3 text-center sm:min-h-[15rem] sm:p-4">
                  <div className="report-qa-empty-card space-y-3">
                    <div className="report-qa-empty-icon-wrap" aria-hidden="true">
                      <MessageSquare className="report-qa-empty-icon" />
                    </div>
                    <div className="space-y-2">
                      <p className="report-qa-empty-title">
                        {uploadedReports.length > 0
                          ? selectedReports.length > 1
                            ? 'Ask across the selected reports — anything from one of them, or a comparison'
                            : selectedReports.length === 1
                              ? 'Ask a question about the selected report'
                              : 'Select at least one report to start asking questions'
                          : 'Upload reports to start asking questions'}
                      </p>
                      <p className="report-qa-empty-helper">
                        {uploadedReports.length > 0
                          ? 'Use the chat below to surface insights, clarify details, and turn report data into next steps.'
                          : 'Drop a PDF into the report panel, then Aurixa will keep the chat grounded in the uploaded report.'}
                      </p>
                    </div>
                    {uploadedReports.length === 0 && (
                      <div className="report-qa-empty-upload-cue" aria-hidden="true">
                        <Upload className="h-3.5 w-3.5" />
                        <span>Start with the upload area</span>
                      </div>
                    )}
                    {/* Mobile upload button - only shown on small screens */}
                    <div className="lg:hidden space-y-3">
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4" />
                        Upload PDF Report
                      </Button>
                      {uploadedReports.length > 0 && (
                        <div className="flex flex-wrap justify-center gap-2">
                          {uploadedReports.map((report) => (
                            <Badge key={report.name} variant="secondary" className="gap-1 text-xs">
                              <FileText className="h-3 w-3" />
                              {report.name.replace('.pdf', '').substring(0, 20)}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeReport(report.name);
                                }}
                                className="ml-1 hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
              <div className="report-qa-message-stack w-full space-y-3 pb-6 sm:space-y-5 sm:pb-8">
                  {(() => {
                    const currentConv = savedConversations.find((c) => c.id === conversationId);
                    const parentConv = currentConv?.branched_from_conversation_id
                      ? savedConversations.find((c) => c.id === currentConv.branched_from_conversation_id)
                      : null;
                    const pinnedMessages = messages
                      .filter((m) => m.role === 'assistant' && m.pinned)
                      .map((m) => ({ id: m.id, content: m.content }));
                    return (
                      <>
                        {parentConv && (
                          <BranchedFromIndicator
                            parentTitle={parentConv.title}
                            onOpenParent={() => loadConversation(parentConv)}
                          />
                        )}
                        <PinnedAnswersStrip pinned={pinnedMessages} onJump={scrollToMessage} />
                      </>
                    );
                  })()}
                  {messages.map((message, index) => {
                    const previousMessage = index > 0 ? messages[index - 1] : null;
                    const showDateSep = shouldShowDateSeparator(
                      message.timestamp,
                      previousMessage?.timestamp || null
                    );

                    return (
                      <div key={message.id} id={`qa-msg-${message.id}`} className="report-qa-message-row w-full scroll-mt-24 rounded-lg transition-shadow">
                        {showDateSep && <MessageDateSeparator date={message.timestamp} />}
                        <div className={cn(
                          "report-qa-message-frame flex gap-2 sm:gap-3 w-full",
                          message.role === 'user' ? 'justify-end' : 'justify-start'
                        )}>
                          {message.role === 'assistant' && (
                            <div className={cn("report-qa-message-avatar hidden sm:flex h-8 w-8 rounded-full items-center justify-center flex-shrink-0", getAccentClass())}>
                              <Bot className="h-4 w-4 text-primary" />
                            </div>
                          )}
                          <div
                            className={cn(
                              "report-qa-message-bubble min-w-0 max-w-[92%] rounded-2xl p-3 shadow-sm sm:p-4",
                              message.role === 'user' ? 'qa-chat-bubble-user' : 'qa-chat-bubble-assistant',
                              getMessageBgClass(message.role)
                            )}
                            role="article"
                            aria-label={`${message.role === 'user' ? 'You' : 'Assistant'} said`}
                          >
                            <div className="report-qa-message-meta flex items-center gap-2 mb-2">
                              {message.role === 'user' && message.sent_by_username && (
                                <span className="text-xs font-medium opacity-80">
                                  {message.sent_by_username}
                                </span>
                              )}
                              <span className="text-xs opacity-60">
                                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span className="text-xs opacity-40 hidden sm:inline">
                                {message.timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                              </span>
                              {message.role === 'assistant' && (message.modelVersion || message.modelProvider) && (
                                <MessageModelBadge agentKey={message.modelProvider} modelId={message.modelVersion} />
                              )}
                            </div>
                            {message.role === 'assistant' ? (
                              <div className="report-qa-assistant-content qa-markdown text-sm break-words overflow-hidden [overflow-wrap:anywhere]">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    strong: ({ children, ...props }) => {
                                      const text = String(children);
                                      const stepMatch = text.match(/^(Step\s*\d+):?(.*)$/i);
                                      if (stepMatch) {
                                        const stepNumber = stepMatch[1];
                                        const remainder = stepMatch[2];
                                        return (
                                          <>
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/15 text-primary border border-primary/20 mr-1.5">
                                              {stepNumber}
                                            </span>
                                            {remainder && <strong {...props}>{remainder}</strong>}
                                          </>
                                        );
                                      }
                                      return <strong {...props}>{children}</strong>;
                                    },
                                  }}
                                >
                                  {message.content}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <div className="report-qa-user-content space-y-2">
                                {message.audioUrl && (
                                  <VoiceMessagePlayer
                                    audioUrl={message.audioUrl}
                                    compact
                                    waveColor="rgba(255, 255, 255, 0.4)"
                                    progressColor="rgba(255, 255, 255, 0.8)"
                                  />
                                )}
                                <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
                              </div>
                            )}
                            {/* PDF Attachments */}
                            {message.attachments && message.attachments.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {message.attachments.map((attachment, idx) => (
                                  <PDFAttachmentMessage
                                    key={idx}
                                    attachment={attachment}
                                    onSendViaEmail={handleSendPDFViaEmail}
                                  />
                                ))}
                              </div>
                            )}
                            {message.role === 'assistant' && !message.attachments?.length && (
                              <>
                                {showCitations && (message.documentCitations?.length || message.comparisonMode) && (
                                  <Citations
                                    className="report-qa-citations"
                                    documents={message.documentCitations}
                                    comparisonMode={message.comparisonMode}
                                    onDocumentClick={openCitationInViewer}
                                  />
                                )}
                                {message.toolInvocations && message.toolInvocations.length > 0 && (
                                  <ToolInvocations invocations={message.toolInvocations} />
                                )}
                                <div className="report-qa-message-actions space-y-2 mt-3 pt-3 border-t border-border/50">
                                <div className="flex flex-wrap gap-1 sm:gap-2">
                                  <CopyWithFeedback content={message.content} />
                                  <TextToSpeech text={message.content} />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-1.5 sm:px-2 text-xs"
                                    onClick={() => handleOpenEmailModal(message.content)}
                                  >
                                    <Mail className="h-3 w-3 sm:mr-1" />
                                    <span className="hidden sm:inline">Email</span>
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-1.5 sm:px-2 text-xs gap-1.5"
                                    onClick={() => {
                                      setEditingMessage(message);
                                      setMessageEditorOpen(true);
                                    }}
                                  >
                                    <Download className="h-3 w-3" />
                                    <span className="hidden sm:inline">PDF</span>
                                  </Button>
                                </div>
                                <MessageThreading
                                  messageId={message.id}
                                  messageContent={message.content}
                                  onReply={handleReply}
                                  replies={getReplies(message.id)}
                                />
                                {/* Follow-up suggestions for the last message */}
                                {index === messages.length - 1 && (
                                  <FollowUpSuggestions
                                    lastAssistantMessage={message.content}
                                    aiSuggestions={message.aiFollowups}
                                    reportContext={
                                      selectedReports.length > 1 ? 'comparison' :
                                      selectedReports.length === 1 ? 'single' : 'none'
                                    }
                                    onSelect={(suggestion) => setInputMessage(suggestion)}
                                  />
                                )}
                                </div>
                              </>
                            )}
                          </div>
                          {message.role === 'user' && (
                            <div className="report-qa-message-avatar report-qa-message-avatar-user hidden sm:flex h-8 w-8 rounded-full bg-secondary items-center justify-center flex-shrink-0">
                              <User className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {isProcessing && (
                    <StreamingTypingIndicator
                      className="report-qa-streaming-state"
                      isMultiReport={selectedReports.length > 1}
                      streamingContent={streamingContent}
                    />
                  )}
                  {failedMessage && !isProcessing && (
                    <FailedMessageIndicator
                      content={failedMessage.content}
                      onRetry={handleRetryMessage}
                      isRetrying={isRetrying}
                    />
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Recording indicator with live transcription - show when recording or paused */}
            {(isRecording || isPaused) && (
              <RecordingIndicator
                isRecording={isRecording}
                isPaused={isPaused}
                liveTranscript={liveTranscript}
                duration={recordingDuration}
                maxDuration={MAX_RECORDING_DURATION}
                accumulatedText={accumulatedTranscript}
                className="mb-2 shrink-0"
              />
            )}

            {/* Pending audio preview */}
            {pendingAudioUrl && !isRecording && (
              <div className="mb-2 shrink-0 rounded-lg border bg-muted/50 p-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">Voice message ready</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setPendingAudioUrl(null)}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Remove
                  </Button>
                </div>
                <VoiceMessagePlayer audioUrl={pendingAudioUrl} compact />
              </div>
            )}

            {/* Indexing indicator */}
            {isIndexing && (
              <div className="flex shrink-0 items-center gap-3 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2.5 text-sm text-foreground">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
                <span className="font-medium">Indexing reports for intelligent retrieval… <span className="font-normal text-muted-foreground">Chat will be available shortly.</span></span>
              </div>
            )}

            {/* Input */}
            <div className="report-qa-composer shrink-0 space-y-1.5 overflow-hidden border-t pt-2.5">
              <div className="flex flex-wrap items-end gap-1.5 sm:flex-nowrap sm:gap-2">
                <Textarea
                  ref={inputRef}
                  placeholder={
                    uploadedReports.length === 0
                      ? 'Ask anything or upload a report for context...'
                      : selectedReportCount > 1
                        ? 'Ask about any of the selected reports, or ask for a comparison...'
                        : selectedReportCount === 1
                          ? 'Ask a question about the selected report...'
                          : 'Select at least one report to ask a grounded question...'
                  }
                  value={inputMessage}
                  onChange={(e) => {
                    setInputMessage(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 112) + 'px';
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  disabled={isProcessing || isRecording || isTranscribing || isIndexing || (uploadedReports.length > 0 && selectedReportCount === 0)}
                  className="report-qa-composer-input min-h-[44px] max-h-24 min-w-0 flex-[1_1_100%] resize-none overflow-y-auto rounded-xl px-3 py-2.5 text-sm leading-5 sm:flex-1"
                  aria-label="Prompt message input"
                  rows={1}
                />
              {/* Recording controls */}
              {isRecording ? (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={pauseRecording}
                    disabled={isProcessing || isTranscribing}
                    title="Pause recording"
                    className="report-qa-composer-control report-qa-composer-control-secondary h-11 w-11 flex-shrink-0"
                  >
                    <Pause className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={finalizeRecording}
                    disabled={isProcessing || isTranscribing}
                    title="Stop and transcribe"
                    className="report-qa-composer-control h-11 w-11 flex-shrink-0"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                </>
              ) : isPaused ? (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={resumeRecording}
                    disabled={isProcessing || isTranscribing}
                    title="Resume recording"
                    className="report-qa-composer-control report-qa-composer-control-secondary h-11 w-11 flex-shrink-0 border-warning/30 text-warning hover:bg-warning/10"
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={finalizeRecording}
                    disabled={isProcessing || isTranscribing}
                    title="Stop and transcribe"
                    className="report-qa-composer-control h-11 w-11 flex-shrink-0"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <Button
                  variant={isTranscribing ? "outline" : "outline"}
                  size="icon"
                  onClick={startRecording}
                  disabled={isProcessing || isTranscribing}
                  title="Start voice input"
                  aria-label="Start voice input"
                  className="report-qa-composer-control report-qa-mic-button h-9 w-9 flex-shrink-0 sm:h-10 sm:w-10"
                >
                  {isTranscribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </Button>
              )}
                <Button
                  onClick={() => handleSendMessage()}
                  disabled={!inputMessage.trim() || isProcessing || isRecording || isIndexing || inputMessage.length > MAX_MESSAGE_LENGTH || (uploadedReports.length > 0 && selectedReportCount === 0)}
                  className="report-qa-composer-control report-qa-send-button h-9 w-9 flex-shrink-0 rounded-xl sm:h-10 sm:w-10"
                  title="Send message"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <CharacterCount current={inputMessage.length} max={MAX_MESSAGE_LENGTH} />
            </div>
          </CardContent>
        </DashboardThemeFrame>
      </div>

      {/* Mobile Reports Panel - floating button for managing uploaded reports on mobile */}
      <MobileReportsPanel reportCount={uploadedReports.length}>
        <div className="space-y-4">
          {/* Upload area */}
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              isDragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
            )}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={handleDropzoneKeyDown}
            role="button"
            tabIndex={isUploading ? -1 : 0}
            aria-label="Upload PDF reports. Press Enter or Space to choose files."
            aria-busy={isUploading}
          >
            {isUploading ? (
              <div className="space-y-2">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Processing...</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Tap to upload PDF reports
                </p>
              </div>
            )}
          </div>

          {/* Upload Progress */}
          {uploadProgress.length > 0 && (
            <div className="space-y-2">
              {uploadProgress.map((item) => (
                <UploadProgressItem
                  key={item.fileName}
                  fileName={item.fileName}
                  progress={item.progress}
                  status={item.status}
                  error={item.error}
                />
              ))}
            </div>
          )}

          {/* Uploaded Reports */}
          {uploadedReports.length > 0 && (
            <div className="space-y-2">
              {uploadedReports.map((report, index) => (
                <PDFThumbnail
                  key={report.name}
                  fileName={report.name}
                  content={report.content}
                  uploadedAt={report.uploadedAt}
                  fileSizeBytes={report.fileSizeBytes}
                  totalPages={report.totalPages}
                  isActive={selectedReportNames.includes(report.name)}
                  onClick={() => setSelectedReportNames(prev =>
                    prev.includes(report.name)
                      ? prev.filter(name => name !== report.name)
                      : [...prev, report.name]
                  )}
                  onRemove={() => {
                    removeReport(report.name);
                    setSelectedReportNames(prev => prev.filter(name => name !== report.name));
                  }}
                />
              ))}
            </div>
          )}

          {/* Comparison Badge */}
          {selectedReports.length > 1 && (
            <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg">
              <GitCompare className="h-4 w-4 text-primary" />
              <span className="text-sm text-primary">Comparison mode active for {selectedReports.length} selected reports</span>
            </div>
          )}
        </div>
      </MobileReportsPanel>

      <ReportSnippetViewer
        open={snippetViewer.open}
        onOpenChange={(open) =>
          setSnippetViewer((prev) => ({ ...prev, open }))
        }
        reportName={snippetViewer.reportName}
        reportContent={snippetViewer.reportContent}
        citation={snippetViewer.citation}
      />

      {/* History Dialog - Enhanced */}
      <Dialog open={showHistory} onOpenChange={(open) => {
        setShowHistory(open);
        if (!open) {
          setHistorySearchQuery('');
          historyButtonRef.current?.focus();
        }
      }}>
        <DialogContent className="grid h-[92dvh] max-h-[92dvh] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[88dvh] sm:w-[min(92vw,48rem)] sm:max-w-3xl sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b bg-gradient-to-br from-primary/10 via-background to-background px-5 pb-4 pr-14 pt-5 sm:px-6 sm:pr-14 sm:pt-6">
            <DialogTitle className="flex items-center gap-3 text-xl">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
                <History className="h-5 w-5" />
              </span>
              <span>
                Conversation History
                <span className="mt-1 block text-xs font-medium text-muted-foreground">
                  {savedConversations.length} saved Q&A session{savedConversations.length !== 1 ? 's' : ''}
                </span>
              </span>
            </DialogTitle>
            <DialogDescription className="pt-2">
              Search and load previous Q&A conversations (⌘K)
            </DialogDescription>
          </DialogHeader>

          {/* Search Input */}
          <div className="relative shrink-0 border-b bg-muted/20 px-5 py-4 sm:px-6">
            <Search className="absolute left-8 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground sm:left-9" />
            <Input
              placeholder="Search conversations by title or report name..."
              aria-label="Search conversation history"
              value={historySearchQuery}
              onChange={(e) => setHistorySearchQuery(e.target.value)}
              className="h-10 rounded-xl bg-background pl-9 pr-9 shadow-sm"
              autoFocus
            />
            {historySearchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-6 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full sm:right-7"
                aria-label="Clear conversation history search"
                onClick={() => setHistorySearchQuery('')}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>

          <ScrollArea ref={historyListRef} className="min-h-0 overflow-hidden px-3 py-3 [--scrollbar-size:10px] sm:px-4">
            {isLoadingConversations ? (
              <div className="mx-auto my-10 flex max-w-sm flex-col items-center rounded-2xl border border-dashed bg-muted/20 p-8 text-center">
                <Loader2 className="mb-3 h-12 w-12 animate-spin text-primary/70" />
                <p className="font-medium text-foreground">Loading conversations</p>
                <p className="mt-1 text-sm text-muted-foreground">Retrieving your saved Q&A sessions...</p>
              </div>
            ) : conversationLoadError ? (
              <div className="mx-auto my-10 max-w-sm rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
                <AlertCircle className="mx-auto mb-3 h-12 w-12 text-destructive/70" />
                <p className="font-medium text-foreground">Could not load conversations</p>
                <p className="mt-1 text-sm text-muted-foreground">{conversationLoadError}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={loadSavedConversations}>
                  Retry
                </Button>
              </div>
            ) : savedConversations.length === 0 ? (
              <div className="mx-auto my-10 max-w-sm rounded-2xl border border-dashed bg-muted/20 p-8 text-center">
                <Archive className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="font-medium text-foreground">No conversations yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Start a new chat to create your first conversation
                </p>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="mx-auto my-10 max-w-sm rounded-2xl border border-dashed bg-muted/20 p-8 text-center">
                <Search className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="font-medium text-foreground">No results found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Try a different search term
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {Object.entries(groupConversationsByDate(sortedConversations)).map(([group, convs]) =>
                  convs.length > 0 && (
                    <div key={group} className="space-y-2">
                      <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/75">
                        {group === 'Pinned' ? (
                          <Pin className="h-3 w-3 text-primary" />
                        ) : (
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                        )}
                        <span className={cn(
                          "text-xs font-medium uppercase tracking-wide",
                          group === 'Pinned' ? 'text-primary' : 'text-muted-foreground'
                        )}>
                          {group}
                        </span>
                        <Separator className="flex-1" />
                      </div>
                      {convs.map((conv) => (
                        <div
                          key={conv.id}
                          className={cn(
                            "report-qa-history-row group cursor-pointer rounded-xl border bg-card p-3 shadow-sm transition-all hover:border-primary/30 hover:bg-primary/5 hover:shadow-md focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 sm:p-4",
                            conversationId === conv.id && "border-primary bg-primary/10 shadow-md ring-1 ring-primary/15",
                            pinnedIds.includes(conv.id) && "border-primary/40"
                          )}
                        >
                          {editingConversationId === conv.id ? (
                            <div className="flex items-center gap-2">
                              <Input
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveTitle(conv.id, editingTitle);
                                  if (e.key === 'Escape') setEditingConversationId(null);
                                }}
                                className="h-7 text-sm"
                                autoFocus
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => handleSaveTitle(conv.id, editingTitle)}
                              >
                                <Check className="h-4 w-4 text-success" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => setEditingConversationId(null)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <div
                              role="button"
                              tabIndex={0}
                              className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                              aria-label={`Load conversation ${conv.title}`}
                              aria-disabled={!!restoringConversationId}
                              onClick={() => { if (!restoringConversationId) loadConversation(conv); }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  if (!restoringConversationId) loadConversation(conv);
                                }
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    {pinnedIds.includes(conv.id) && (
                                      <Pin className="h-3 w-3 text-primary fill-current flex-shrink-0" />
                                    )}
                                    <p className="truncate text-sm font-semibold leading-5 text-foreground sm:text-base" title={conv.title}>{conv.title}</p>
                                    {restoringConversationId === conv.id && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-label="Loading conversation" />}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 mt-1">
                                    <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px] font-semibold">
                                      {conv.report_names.length} report{conv.report_names.length !== 1 ? 's' : ''}
                                    </Badge>
                                    {conv.shared && (
                                      <Badge variant="outline" className="h-5 rounded-full border-primary/30 px-2 text-[10px] font-semibold text-primary">
                                        <Users className="mr-1 h-2.5 w-2.5" />
                                        {conv.shared_by ? `Shared by ${conv.shared_by}` : 'Shared'}
                                      </Badge>
                                    )}
                                    {conv.legacy && (
                                      <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-semibold text-muted-foreground">
                                        Legacy
                                      </Badge>
                                    )}
                                    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                      <Clock className="h-2.5 w-2.5" />
                                      {new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  {/* Show tags in history */}
                                  {(conversationTags.get(conv.id) || []).length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                      <ConversationTags
                                        tags={conversationTags.get(conv.id) || []}
                                        onAddTag={() => {}}
                                        onRemoveTag={() => {}}
                                        compact
                                      />
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <PinConversation
                                    conversationId={conv.id}
                                    isPinned={pinnedIds.includes(conv.id)}
                                    onTogglePin={handleTogglePin}
                                    compact
                                  />
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingConversationId(conv.id);
                                        setEditingTitle(conv.title);
                                      }}>
                                        <Pencil className="h-3.5 w-3.5 mr-2" />
                                        Rename
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation();
                                        handleTogglePin(conv.id);
                                      }}>
                                        <Pin className="h-3.5 w-3.5 mr-2" />
                                        {pinnedIds.includes(conv.id) ? 'Unpin' : 'Pin'}
                                      </DropdownMenuItem>
                                      {!conv.shared && (
                                        <DropdownMenuItem onClick={(e) => {
                                          e.stopPropagation();
                                          setShareDialogConversation({ id: conv.id, title: conv.title });
                                        }}>
                                          <Share2 className="h-3.5 w-3.5 mr-2" />
                                          Share with team
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                              {/* Report names preview */}
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {conv.report_names.slice(0, 2).map((name, idx) => (
                                  <span key={idx} title={name.replace('.pdf', '')} className="max-w-full truncate rounded-full border bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground sm:max-w-[190px]">
                                    {name.replace('.pdf', '')}
                                  </span>
                                ))}
                                {conv.report_names.length > 2 && (
                                  <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                                    +{conv.report_names.length - 2} more
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
          </ScrollArea>

          {/* Footer with count */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3 text-xs text-muted-foreground sm:px-6">
              <span>
                {filteredConversations.length} of {savedConversations.length} conversation{savedConversations.length !== 1 ? 's' : ''}
                {pinnedIds.length > 0 && ` • ${pinnedIds.length} pinned`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 shrink-0 text-xs"
                aria-label="Start a new Aurixa Intelligence Hub chat"
                onClick={handleNewChat}
              >
                <Plus className="h-3 w-3 mr-1" />
                New Chat
              </Button>
            </div>
        </DialogContent>
      </Dialog>

      {/* Share conversation with teammates */}
      <ShareConversationDialog
        conversationId={shareDialogConversation?.id ?? null}
        conversationTitle={shareDialogConversation?.title}
        open={!!shareDialogConversation}
        onOpenChange={(open) => { if (!open) setShareDialogConversation(null); }}
        onShared={loadSavedConversations}
      />

      {/* Email Dialog */}
      <Dialog open={showEmailModal} onOpenChange={(open) => {
        setShowEmailModal(open);
        if (!open) {
          setShowCcBcc(false);
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Send Summary via Email
            </DialogTitle>
            <DialogDescription>
              Send this summary directly to a prospect
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Sender Mailbox */}
            <div className="space-y-2">
              <Label>From *</Label>
              <Select value={selectedSenderMailbox} onValueChange={setSelectedSenderMailbox} disabled={isLoadingMailboxes}>
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingMailboxes ? "Loading mailboxes..." : "Select sender mailbox"} />
                </SelectTrigger>
                <SelectContent>
                  {availableMailboxes.map((mailbox) => (
                    <SelectItem key={mailbox.id} value={mailbox.personal_mailbox || ''}>
                      {mailbox.personal_mailbox} ({mailbox.username})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recipient */}
            <div className="space-y-2">
              <Label htmlFor="email-to">To *</Label>
              <Input
                id="email-to"
                type="email"
                placeholder="recipient@example.com"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
              />
            </div>

            {/* CC/BCC Toggle */}
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowCcBcc(!showCcBcc)}
            >
              {showCcBcc ? '− Hide CC/BCC' : '+ Add CC/BCC'}
            </button>

            {/* CC/BCC Fields */}
            {showCcBcc && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email-cc">CC</Label>
                  <Input
                    id="email-cc"
                    type="text"
                    placeholder="cc@example.com (comma-separated)"
                    value={emailCc}
                    onChange={(e) => setEmailCc(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email-bcc">BCC</Label>
                  <Input
                    id="email-bcc"
                    type="text"
                    placeholder="bcc@example.com (comma-separated)"
                    value={emailBcc}
                    onChange={(e) => setEmailBcc(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Subject */}
            <div className="space-y-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
              />
            </div>

            {/* Content */}
            <div className="space-y-2">
              <Label htmlFor="email-content">Message *</Label>
              <Textarea
                id="email-content"
                rows={8}
                value={emailContent}
                onChange={(e) => setEmailContent(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendEmail}
              disabled={!emailTo || !emailContent || !selectedSenderMailbox || isSendingEmail}
            >
              {isSendingEmail ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Email
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Copilot Confirmation Modal */}
      <Dialog open={showEmailCopilotModal} onOpenChange={(open) => {
        setShowEmailCopilotModal(open);
        if (!open) {
          setPendingPDFAttachment(null);
          setPdfValidationError(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Send PDF via Email Copilot
            </DialogTitle>
            <DialogDescription>
              You'll be redirected to Email Copilot with this PDF ready to send.
            </DialogDescription>
          </DialogHeader>

          {pendingPDFAttachment && (
            <div className="space-y-4">
              {/* PDF File Preview */}
              <div className="p-4 bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-primary/10 rounded-lg">
                    <FileText className="h-8 w-8 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{pendingPDFAttachment.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {(pendingPDFAttachment.fileSize / 1024).toFixed(1)} KB • Generated {new Date(pendingPDFAttachment.createdAt).toLocaleTimeString('en-AU')}
                    </p>
                  </div>
                  {isValidatingPDF ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : pdfValidationError ? (
                    <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
                      Warning
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-success border-success/30 bg-success/10">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Ready
                    </Badge>
                  )}
                </div>
              </div>

              {/* Email Preview */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Email Subject Preview</Label>
                <div className="p-3 bg-muted/50 rounded-md text-sm">
                  {uploadedReports.length > 0
                    ? `Property Analysis: ${uploadedReports.map(r => r.name.replace('.pdf', '')).join(', ').substring(0, 50)}${uploadedReports.map(r => r.name.replace('.pdf', '')).join(', ').length > 50 ? '...' : ''}`
                    : `Q&A Conversation Export - ${pendingPDFAttachment.fileName}`
                  }
                </div>
              </div>

              {/* Context info */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {messages.length} messages
                </div>
                <div className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  {uploadedReports.length} report{uploadedReports.length !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Validation warning */}
              {pdfValidationError && (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
                  <p className="text-xs text-warning">{pdfValidationError}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowEmailCopilotModal(false);
                setPendingPDFAttachment(null);
                setPdfValidationError(null);
              }}
              className="sm:mr-auto"
            >
              Cancel
            </Button>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button
                variant="secondary"
                onClick={handleConfirmEmailCopilot}
                disabled={isValidatingPDF}
                className="flex-1 sm:flex-none"
              >
                {isValidatingPDF ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Validating...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Open Email Copilot
                  </>
                )}
              </Button>
              <Button
                onClick={() => {
                  // Build context for in-place compose
                  const reportNames = uploadedReports.map(r => r.name.replace('.pdf', '')).join(', ');
                  const messageCount = messages.length;
                  const userQuestions = messages.filter(m => m.role === 'user').slice(0, 3).map(m => m.content.substring(0, 100));

                  setEmailContext({
                    title: getCurrentTitle(),
                    reportNames,
                    messageCount,
                    sampleQuestions: userQuestions,
                    generatedAt: new Date().toISOString(),
                  });

                  setShowEmailCopilotModal(false);
                  setShowInPlaceEmailCompose(true);
                }}
                disabled={isValidatingPDF || !!pdfValidationError}
                className="flex-1 sm:flex-none"
              >
                <Send className="h-4 w-4 mr-2" />
                Send Now
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* In-Place Email Compose Modal */}
      <InPlaceEmailCompose
        open={showInPlaceEmailCompose}
        onOpenChange={(open) => {
          setShowInPlaceEmailCompose(open);
          if (!open) {
            setPendingPDFAttachment(null);
            setEmailContext(null);
          }
        }}
        attachment={pendingPDFAttachment}
        context={emailContext || undefined}
        onSuccess={() => {
          toast({
            title: 'Email Sent Successfully',
            description: 'Your Q&A conversation PDF has been delivered.',
          });
        }}
      />

      {editingMessage && (
        <MessageReportEditor
          isOpen={messageEditorOpen}
          onClose={() => {
            setMessageEditorOpen(false);
            setEditingMessage(null);
          }}
          content={editingMessage.content}
          messageId={editingMessage.id}
          conversationId={conversationId}
          title={uploadedReports.length > 1
            ? 'Property Comparison Summary'
            : uploadedReports.length === 1
              ? 'Investment Report Summary'
              : 'Property Investment Analysis'}
          reportNames={uploadedReports.map(r => r.name.replace('.pdf', ''))}
        />
      )}
      </DashboardThemeFrame>
    </>
  );
}
