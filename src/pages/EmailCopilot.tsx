import { useState, useEffect, useRef } from 'react';
import { LiveModelBadge, ModelUpgradeButton } from '@/components/agentModels';

import { supabase } from '@/integrations/supabase/client';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { buildForwardedHtml, buildForwardedSubject } from '@/lib/email/forwardedMessage.pure';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { useEmailNotifications } from '@/hooks/useEmailNotifications';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNotifications } from '@/contexts/NotificationsContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import RichTextBody from '@/components/email/RichTextBody';
import EmailBodyView from '@/components/email/EmailBodyView';
import EmailAttachmentsList from '@/components/email/EmailAttachmentsList';
import { EmailClientAssignment } from '@/components/email/EmailClientAssignment';
import { AIReplyAssistant } from '@/components/email/AIReplyAssistant';
import { EmailIntelligencePanel, type EmailIntelligence } from '@/components/email/EmailIntelligencePanel';
import { ComposerTextarea } from '@/components/email/ComposerTextarea';
import { useEmailSnippets, SnippetManagerDialog } from '@/components/email/EmailSnippets';
import { ScheduleSendButton, useScheduledSends, ScheduledSendsDialog } from '@/components/email/ScheduleSend';
import { FollowUpReminderDialog } from '@/components/email/FollowUpReminderDialog';
import { RecipientSanityWarning, AttachmentSummary } from '@/components/email/RecipientSanityWarning';
import { AlertCircle, Archive, ArrowLeft, Bell, BellOff, Calendar, CheckCircle, ChevronDown, ChevronRight, ChevronUp, Clock, Copy, Download, Eye, FileIcon, FileText, Filter, Forward, History, Image as ImageIcon, Inbox, Link as LinkIcon, Loader2, Mail, Maximize2, MessageCircle, MessageSquare, Mic, MicOff, MoreVertical, Paperclip, Plus, RefreshCw, Reply, Search, Send, Settings, Sparkles, Star, Trash2, Upload, User, Volume2, VolumeX, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

interface EmailSummary {
  tldr: string;
  keyPoints: string[];
  requiredActions: string[];
  urgencyLevel: 'low' | 'medium' | 'high';
  // Tier 4 intelligence (merged into summary jsonb by `analyze` action)
  sentiment?: 'positive' | 'neutral' | 'negative' | 'angry';
  category?: 'inquiry' | 'complaint' | 'opportunity' | 'admin' | 'fyi' | 'scheduling' | 'document_request' | 'other';
  language?: string;
}

interface EmailAttachment {
  name: string;
  contentType: string;
  size: number;
  storageUrl?: string | null;
  storagePath?: string | null;
  storageBucket?: string | null;
}

interface Email {
  id: string;
  sender: string;
  subject: string;
  body: string;
  body_html?: string | null;
  received_at: string;
  summary: EmailSummary | null;
  draft_reply: string | null;
  urgency_level: 'low' | 'medium' | 'high' | null;
  linked_property_address: string | null;
  linked_report_id: string | null;
  status: 'unread' | 'read' | 'summarized' | 'drafted' | 'replied' | 'archived';
  created_at: string;
  to_recipients: string[];
  cc_recipients: string[];
  bcc_recipients: string[];
  attachments: EmailAttachment[];
  mailbox_source: 'admin' | 'personal';
  folder: 'inbox' | 'sent';
  client_id: string | null;
  client_name: string | null;
}

interface SentAttachment {
  name: string;
  contentType: string;
  size: number;
}

interface SentReply {
  id: string;
  original_email_id: string | null;
  recipient: string;
  subject: string;
  body: string;
  cc_recipients: string[];
  bcc_recipients: string[];
  attachments: SentAttachment[];
  sent_at: string;
  mailbox_source: 'admin' | 'personal';
}

const toSafeString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => toSafeString(item).trim())
    .filter(Boolean);
};

const toObjectArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

const isNonEmptyArray = (value: unknown): value is any[] => Array.isArray(value) && value.length > 0;

const normalizeUrgencyLevel = (value: unknown): EmailSummary['urgencyLevel'] => {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
};

const normalizeSentiment = (value: unknown): EmailSummary['sentiment'] | undefined => {
  return value === 'positive' || value === 'neutral' || value === 'negative' || value === 'angry' ? value : undefined;
};

const normalizeCategory = (value: unknown): EmailSummary['category'] | undefined => {
  const allowed = ['inquiry', 'complaint', 'opportunity', 'admin', 'fyi', 'scheduling', 'document_request', 'other'];
  return allowed.includes(toSafeString(value)) ? (value as EmailSummary['category']) : undefined;
};

const normalizeSummary = (summary: unknown): EmailSummary | null => {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  const source = summary as Record<string, unknown>;
  return {
    tldr: toSafeString(source.tldr ?? source.tl_dr ?? source.summary),
    keyPoints: toStringArray(source.keyPoints ?? source.key_points),
    requiredActions: toStringArray(source.requiredActions ?? source.required_actions),
    urgencyLevel: normalizeUrgencyLevel(source.urgencyLevel ?? source.urgency_level ?? source.urgency),
    sentiment: normalizeSentiment(source.sentiment),
    category: normalizeCategory(source.category),
    language: source.language ? toSafeString(source.language) : undefined,
  };
};

const normalizeEmailAttachments = (attachments: unknown): EmailAttachment[] => {
  if (!Array.isArray(attachments)) return [];
  return attachments.map((attachment: any) => ({
    name: toSafeString(attachment?.name, 'Attachment'),
    contentType: toSafeString(attachment?.contentType ?? attachment?.content_type, 'application/octet-stream'),
    size: Number(attachment?.size) || 0,
    storageUrl: toSafeString(attachment?.storageUrl ?? attachment?.storage_url) || null,
    storagePath: attachment?.storagePath ?? attachment?.storage_path ?? null,
    storageBucket: attachment?.storageBucket ?? attachment?.storage_bucket ?? null,
  }));
};

const normalizeSentAttachments = (attachments: unknown): SentAttachment[] => {
  if (!Array.isArray(attachments)) return [];
  return attachments.map((attachment: any) => ({
    name: toSafeString(attachment?.name, 'Attachment'),
    contentType: toSafeString(attachment?.contentType ?? attachment?.content_type, 'application/octet-stream'),
    size: Number(attachment?.size) || 0,
  }));
};

// Helper to extract sender name from email
function extractSenderName(sender: string | null | undefined): string {
  const safeSender = toSafeString(sender, 'Unknown');
  // If it looks like "Name <email@domain.com>", extract the name
  const match = safeSender.match(/^([^<]+)</);
  if (match) return match[1].trim();
  
  // If it's just an email, extract the part before @
  const emailMatch = safeSender.match(/^([^@]+)@/);
  if (emailMatch) {
    // Convert to title case
    return emailMatch[1]
      .split(/[._-]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }
  
  return safeSender;
}

// Helper to get initials from sender
function getSenderInitials(sender: string | null | undefined): string {
  const name = extractSenderName(sender);
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Helper to format date intelligently
function formatEmailDate(dateStr: string | null | undefined): string {
  const date = new Date(toSafeString(dateStr));
  if (Number.isNaN(date.getTime())) return '';
  if (isToday(date)) {
    return format(date, 'h:mm a');
  }
  if (isYesterday(date)) {
    return 'Yesterday';
  }
  return format(date, 'MMM d');
}

// Helper to format full date
function formatFullDate(dateStr: string | null | undefined): string {
  const date = new Date(toSafeString(dateStr));
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return format(date, "EEEE, MMMM d, yyyy 'at' h:mm a");
}

// Helper to format email body with proper paragraphs
function formatEmailBody(body: string | null | undefined): string {
  if (!body) return '';
  
  // Clean up excessive whitespace but preserve paragraph breaks
  return body
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function EmailCopilot() {
  const isMobile = useIsMobile();
  const { hasModuleAccess, canEdit: canEditModule, canDelete: canDeleteModule, loading: permissionsLoading } = usePermissions();
  const { user, loading: authLoading } = useAuth();
  // Direct writes to email_copilot_emails run under the deny-by-default RLS
  // (Phase 7): use the JWT-bearing client so auth.uid() is present. Reads
  // continue to flow through the service-role get-email-data function.
  const { supabase: authedSupabase } = useAuthenticatedSupabase();
  const isAuthReady = !authLoading && !!user;
  const { addNotification } = useNotifications();
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  /**
   * Audit item 42 — the email body sat in a small box.
   *
   * The panel is capped at `min(62dvh, 44rem)`, but everything above it — the
   * page header, the human-in-the-loop banner, the subject, From, To, Cc and
   * the date — leaves only a few lines of that on a short window, which is
   * what the report shows. This opens the SAME `EmailBodyView`, with the same
   * prose styling, in a dialog that uses the whole screen.
   */
  const [showBodyModal, setShowBodyModal] = useState(false);
  const [showSendConfirmModal, setShowSendConfirmModal] = useState(false);
  const [showEditDraftModal, setShowEditDraftModal] = useState(false);
  const [editableDraft, setEditableDraft] = useState('');
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [currentDraft, setCurrentDraft] = useState('');
  const [replyContext, setReplyContext] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  
  // Email compose state
  const [replyTo, setReplyTo] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyCc, setReplyCc] = useState('');
  const [replyBcc, setReplyBcc] = useState('');
  
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  // Notification settings
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('emailNotificationSound');
    return saved !== 'false';
  });
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(() => {
    const saved = localStorage.getItem('emailBrowserNotifications');
    return saved !== 'false';
  });
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);
  
  // View mode state (inbox vs sent)
  const [viewMode, setViewMode] = useState<'inbox' | 'sent'>('inbox');
  const [sentReplies, setSentReplies] = useState<SentReply[]>([]);
  const [selectedSentReply, setSelectedSentReply] = useState<SentReply | null>(null);
  
  // Threading state
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  
  // Resizable panel state
  const [listPanelWidth, setListPanelWidth] = useState(380);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(380);
  
  // New email form state
  const [newEmail, setNewEmail] = useState({
    sender: '',
    subject: '',
    body: '',
    received_at: new Date().toISOString().split('T')[0]
  });
  
  // Compose new email modal state
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [composeEmail, setComposeEmail] = useState({
    to: '',
    subject: '',
    body: '',
    cc: '',
    bcc: ''
  });
  const [isComposing, setIsComposing] = useState(false);
  
  // Attachment state for compose and reply
  const [replyAttachments, setReplyAttachments] = useState<File[]>([]);
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const composeFileInputRef = useRef<HTMLInputElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [loadingQuickReplies, setLoadingQuickReplies] = useState(false);
  
  // Drag and drop state
  const [replyDragActive, setReplyDragActive] = useState(false);
  const [composeDragActive, setComposeDragActive] = useState(false);
  
  // Forward modal state
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardTo, setForwardTo] = useState('');
  const [forwardCc, setForwardCc] = useState('');
  const [forwardBcc, setForwardBcc] = useState('');
  const [forwardBody, setForwardBody] = useState('');
  const [forwardAttachments, setForwardAttachments] = useState<File[]>([]);
  const [isForwarding, setIsForwarding] = useState(false);
  const forwardFileInputRef = useRef<HTMLInputElement>(null);
  const [forwardDragActive, setForwardDragActive] = useState(false);

  // QA PDF attachment state (when coming from Report QA)
  const [qaPDFAttachment, setQaPDFAttachment] = useState<{
    url: string;
    fileName: string;
    fileSize: number;
  } | null>(null);

  // Mailbox selection state
  const [personalMailbox, setPersonalMailbox] = useState<string | null>(null);
  const [isUserProfileLoaded, setIsUserProfileLoaded] = useState(false);
  const [selectedMailbox, setSelectedMailbox] = useState<'admin' | 'personal'>(() => {
    const saved = localStorage.getItem('emailCopilotMailbox');
    return (saved === 'personal') ? 'personal' : 'admin';
  });
  const [showMailboxSettings, setShowMailboxSettings] = useState(false);
  const hasAdminEmailAccess = hasModuleAccess('admin_email_access');

  // Tier 2/3: snippets, scheduled sends, follow-up reminders
  const { snippets, refresh: refreshSnippets } = useEmailSnippets();
  const { items: scheduledSends, refresh: refreshScheduled } = useScheduledSends();
  const [showSnippetManager, setShowSnippetManager] = useState(false);
  const [showScheduledList, setShowScheduledList] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);

  // Check for QA PDF attachment on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const attachmentParam = urlParams.get('attachment');
    
    if (attachmentParam === 'qa_pdf') {
      const storedData = localStorage.getItem('qa_pdf_attachment');
      if (storedData) {
        const processAttachment = async () => {
          try {
            const parsed = JSON.parse(storedData);
            
            // Check if it's the new enhanced format with conversationContext
            const attachment = parsed.attachment || parsed;
            const context = parsed.conversationContext;
            
            setQaPDFAttachment(attachment);
            
            // Open compose modal with the attachment info
            setShowComposeModal(true);
            
            // Compose dynamic email draft based on conversation context
            let emailSubject = `Q&A Conversation Export - ${attachment.fileName}`;
            let emailBody = `Please find attached the Q&A conversation export.\n\nBest regards`;
            
            if (context) {
              // Enhanced subject with report names
              emailSubject = context.reportNames 
                ? `Property Analysis: ${context.reportNames}`
                : `Q&A Conversation Export - ${context.title || attachment.fileName}`;
              
              // Build dynamic email body
              const bodyParts: string[] = [];
              bodyParts.push(`Hi,\n`);
              bodyParts.push(`Please find attached the Q&A conversation summary regarding ${context.reportNames || 'the property analysis'}.`);
              
              if (context.messageCount) {
                bodyParts.push(`\nThis document contains a comprehensive summary of our ${context.messageCount}-message discussion.`);
              }
              
              const sampleQuestions = toStringArray(context.sampleQuestions);
              if (sampleQuestions.length > 0) {
                bodyParts.push(`\nKey topics covered include:`);
                sampleQuestions.forEach((q: string) => {
                  bodyParts.push(`  • ${q}${q.length >= 100 ? '...' : ''}`);
                });
              }
              
              bodyParts.push(`\nPlease review at your earliest convenience and let me know if you have any questions.`);
              bodyParts.push(`\nBest regards`);
              
              emailBody = bodyParts.join('\n');
            }
            
            setComposeEmail(prev => ({
              ...prev,
              subject: emailSubject,
              body: emailBody
            }));
            
            // Actually fetch the PDF and add it to composeAttachments
            if (attachment.url) {
              try {
                toast.info('Downloading PDF...', { 
                  description: 'Preparing attachment for email',
                  id: 'pdf-download'
                });
                
                const response = await fetch(attachment.url);
                if (response.ok) {
                  const blob = await response.blob();
                  const file = new File([blob], attachment.fileName, { 
                    type: 'application/pdf' 
                  });
                  setComposeAttachments([file]);
                  
                  toast.success('PDF attached from Aurixa Intelligence Hub', {
                    description: `${attachment.fileName} (${(attachment.fileSize / 1024).toFixed(1)} KB)`,
                    id: 'pdf-download'
                  });
                } else {
                  console.error('Failed to fetch PDF:', response.status);
                  toast.warning('PDF metadata attached', {
                    description: 'Could not download the actual file. You may need to re-generate the PDF.',
                    id: 'pdf-download'
                  });
                }
              } catch (fetchError) {
                console.error('Error fetching PDF:', fetchError);
                toast.warning('PDF reference attached', {
                  description: 'Could not download the file. The PDF URL is saved but may need re-generation.',
                  id: 'pdf-download'
                });
              }
            } else {
              toast.success('PDF attached from Aurixa Intelligence Hub', {
                description: attachment.fileName
              });
            }
            
            // Clear from localStorage
            localStorage.removeItem('qa_pdf_attachment');
            // Clean URL
            window.history.replaceState({}, '', '/email-copilot');
          } catch (e) {
            console.error('Failed to parse QA attachment:', e);
            toast.error('Failed to load PDF attachment', {
              description: 'Please try sending from Aurixa Intelligence Hub again.'
            });
          }
        };
        
        processAttachment();
      }
    }
  }, []);

  // Handle deep-link to a specific email via ?emailId= query param
  useEffect(() => {
    if (emails.length === 0 || isLoading) return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const emailId = urlParams.get('emailId');
    if (!emailId) return;
    
    // Try to find in current mailbox
    const targetEmail = emails.find(e => e.id === emailId);
    if (targetEmail) {
      setSelectedEmail(targetEmail);
      if (isMobile) {
        setShowMobileDetail(true);
      }
      // Clean URL
      window.history.replaceState({}, '', '/email-copilot');
    } else {
      // Email might be in the other mailbox - switch and retry
      const otherMailbox = selectedMailbox === 'admin' ? 'personal' : 'admin';
      // Only attempt switch once (check if we already tried)
      const alreadySwitched = urlParams.get('_switched');
      if (!alreadySwitched) {
        setSelectedMailbox(otherMailbox);
        // Keep the emailId param but mark that we switched
        window.history.replaceState({}, '', `/email-copilot?emailId=${emailId}&_switched=1`);
      } else {
        // Couldn't find in either mailbox
        toast.error('Email not found', { description: 'The linked email could not be located.' });
        window.history.replaceState({}, '', '/email-copilot');
      }
    }
  }, [emails, isLoading, isMobile, selectedMailbox]);

  // Fetch user profile to get personal mailbox
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const { data } = await invokeSecureFunction('admin-user-management', {
          action: 'get_own_profile'
        });

        if (data?.success) {
          // Always sync state to backend value (including null when cleared)
          setPersonalMailbox(data.user?.personal_mailbox || null);
        }
      } catch (err) {
        console.error('Failed to fetch user profile:', err);
      } finally {
        setIsUserProfileLoaded(true);
      }
    };

    fetchUserProfile();
  }, []);

  // Prevent being stuck on "personal" when it isn't configured
  useEffect(() => {
    if (isUserProfileLoaded && selectedMailbox === 'personal' && !personalMailbox) {
      setSelectedMailbox('admin');
      toast.info('Personal mailbox is not configured. Switched to admin inbox.');
    }
  }, [isUserProfileLoaded, selectedMailbox, personalMailbox]);

  // Save mailbox preference
  useEffect(() => {
    localStorage.setItem('emailCopilotMailbox', selectedMailbox);
  }, [selectedMailbox]);

  // Email notifications hook - refetch emails when new ones arrive
  const { requestNotificationPermission } = useEmailNotifications({
    onNewEmail: () => {
      fetchEmails();
    },
    soundEnabled,
    browserNotificationsEnabled
  });

  // Save notification preferences
  useEffect(() => {
    localStorage.setItem('emailNotificationSound', String(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    localStorage.setItem('emailBrowserNotifications', String(browserNotificationsEnabled));
  }, [browserNotificationsEnabled]);

  const toggleSoundNotifications = () => {
    setSoundEnabled(!soundEnabled);
    toast.success(soundEnabled ? 'Sound notifications disabled' : 'Sound notifications enabled');
  };

  const toggleBrowserNotifications = async () => {
    if (!browserNotificationsEnabled) {
      const granted = await requestNotificationPermission();
      if (granted) {
        setBrowserNotificationsEnabled(true);
        toast.success('Browser notifications enabled');
      } else {
        toast.error('Browser notification permission denied');
      }
    } else {
      setBrowserNotificationsEnabled(false);
      toast.success('Browser notifications disabled');
    }
  };

  // When selecting an email, ensure we have the latest data from state
  const handleSelectEmail = (email: Email) => {
    const latestEmail = emails.find(e => e.id === email.id);
    const emailToSelect = latestEmail || email;
    setSelectedEmail(emailToSelect);
    if (isMobile) {
      setShowMobileDetail(true);
    }
    // Log email read
    if (emailToSelect.status === 'unread') {
      logActivityDirect({
        actionType: 'email_read',
        entityType: 'email',
        entityId: emailToSelect.id,
        entityName: emailToSelect.subject,
        metadata: { sender: emailToSelect.sender }
      });
    }
  };

  // Fetch the FULL email body when an email is selected (list endpoint only returns body_preview).
  const fullBodyFetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedEmail) return;
    if (fullBodyFetchedRef.current.has(selectedEmail.id)) return;
    const targetId = selectedEmail.id;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await invokeSecureFunction('get-email-data', {
          action: 'get',
          email_id: targetId,
        });
        if (cancelled || error || !data?.email) return;
        const full = data.email;
        fullBodyFetchedRef.current.add(targetId);
        const patch = {
          body: toSafeString(full.body ?? full.body_preview),
          body_html: full.body_html ?? null,
          attachments: normalizeEmailAttachments(full.attachments),
          summary: normalizeSummary(full.summary),
        };
        setSelectedEmail(prev => (prev && prev.id === targetId ? { ...prev, ...patch } : prev));
        setEmails(prev => prev.map(e => (e.id === targetId ? { ...e, ...patch } : e)));
      } catch (e) {
        console.error('[EmailCopilot] Failed to fetch full email body:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedEmail?.id]);

  // Fetch smart quick replies when an email is selected (and not already replied)
  useEffect(() => {
    setQuickReplies([]);
    if (!selectedEmail || selectedEmail.status === 'replied') return;
    let cancelled = false;
    setLoadingQuickReplies(true);
    (async () => {
      try {
        const key = getThreadKey(selectedEmail.subject);
        const thread = emails
          .filter(e => getThreadKey(e.subject) === key && e.id !== selectedEmail.id)
          .slice(0, 3)
          .map(e => ({ sender: e.sender, subject: e.subject, body: e.body, received_at: e.received_at }));
        const { data, error } = await invokeSecureFunction('email-copilot', {
          action: 'quick_replies',
          email: {
            sender: selectedEmail.sender,
            subject: selectedEmail.subject,
            body: selectedEmail.body,
            received_at: selectedEmail.received_at,
          },
          threadEmails: thread,
        });
        if (cancelled) return;
        if (error) throw error;
        const s: string[] = Array.isArray(data?.suggestions) ? data.suggestions : [];
        setQuickReplies(s);
      } catch (err) {
        console.warn('Quick replies failed', err);
      } finally {
        if (!cancelled) setLoadingQuickReplies(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmail?.id]);
  const handleMobileBack = () => {
    setShowMobileDetail(false);
    setSelectedEmail(null);
    setSelectedSentReply(null);
  };
  
  // Group emails by thread (based on subject similarity)
  const getThreadKey = (subject: string | null | undefined): string => {
    // Remove common reply/forward prefixes and normalize
    return toSafeString(subject, '(No Subject)')
      .replace(/^(re:|fwd?:|fw:)\s*/gi, '')
      .toLowerCase()
      .trim();
  };
  
  const groupEmailsByThread = (emailList: Email[]): Map<string, Email[]> => {
    const threads = new Map<string, Email[]>();
    
    emailList.forEach(email => {
      const threadKey = getThreadKey(email.subject);
      if (!threads.has(threadKey)) {
        threads.set(threadKey, []);
      }
      threads.get(threadKey)!.push(email);
    });
    
    // Sort emails within each thread by date (newest first)
    threads.forEach((emails, key) => {
      emails.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
    });
    
    return threads;
  };
  
  const toggleThread = (threadKey: string) => {
    const newExpanded = new Set(expandedThreads);
    if (newExpanded.has(threadKey)) {
      newExpanded.delete(threadKey);
    } else {
      newExpanded.add(threadKey);
    }
    setExpandedThreads(newExpanded);
  };

  const handleSyncOutlook = async () => {
    // Determine which mailbox to sync from
    if (selectedMailbox === 'personal' && !personalMailbox) {
      toast.error('Personal mailbox is not configured');
      setShowMailboxSettings(true);
      return;
    }

    const mailboxToSync = selectedMailbox === 'personal' && personalMailbox 
      ? personalMailbox 
      : null; // null means use default admin mailbox

    // Check permission if trying to sync admin mailbox
    if (selectedMailbox === 'admin' && !hasAdminEmailAccess) {
      toast.error('You do not have permission to access the admin email inbox');
      return;
    }

    setIsSyncing(true);
    try {
      // 200, not 50. The edge function follows `@odata.nextLink` now, so a
      // limit past one page is a real instruction rather than a number Graph
      // silently ignored.
      const { data, error } = await invokeSecureFunction('outlook-email-sync', {
        action: 'sync', limit: 200, mailbox: mailboxToSync
      });

      if (error) throw error;

      const mailboxLabel = selectedMailbox === 'personal' ? 'personal mailbox' : 'admin inbox';
      if ((data?.inserted || 0) > 0) {
        toast.success(`Synced ${data.inserted} new emails from ${mailboxLabel}`);
      } else {
        toast.info(`No new emails to sync from ${mailboxLabel}`);
      }
      fetchEmails();
    } catch (error) {
      console.error('Error syncing Outlook:', error);
      toast.error('Failed to sync emails from Outlook');
    } finally {
      setIsSyncing(false);
    }
  };

  /**
   * Walk the mailbox BACKWARDS until there is nothing older left.
   *
   * The admin inbox converges on its own — `email-sync-cron` runs a bounded
   * backfill step every five minutes — but a personal mailbox has no cron
   * behind it, so this is how one is brought up to date. Each call asks for
   * messages older than the oldest already stored, which means it resumes
   * from the database rather than from anything held here: closing the tab
   * loses nothing, and pressing it again after it finishes is a no-op.
   *
   * It loops because one call is budgeted to ~100s server-side, and it stops
   * on `complete` — a fact about what Graph offered, never about the budget —
   * so this terminates.
   */
  const handleImportHistory = async () => {
    const mailboxToSync = selectedMailbox === 'personal' && personalMailbox ? personalMailbox : null;
    if (selectedMailbox === 'admin' && !hasAdminEmailAccess) {
      toast.error('You do not have permission to access the admin email inbox');
      return;
    }

    setIsSyncing(true);
    let importedTotal = 0;
    try {
      // A ceiling on ROUNDS, not on messages: it is the guard against a server
      // that keeps answering `complete: false`, not a limit on how much
      // history a mailbox may have.
      for (let round = 0; round < 25; round++) {
        const { data, error } = await invokeSecureFunction('outlook-email-sync', {
          action: 'backfill', limit: 500, mailbox: mailboxToSync
        });
        if (error) throw error;

        importedTotal += data?.inserted || 0;
        toast.info(
          data?.complete
            ? `Imported ${importedTotal} historical email(s) — history is complete`
            : `Imported ${importedTotal} so far, still working...`,
        );
        fetchEmails();
        if (data?.complete) break;
        // Nothing new AND not complete means every message in this window was
        // already stored. The boundary still moved, so the next round asks
        // about older mail — but if it happens twice running there is nothing
        // left to gain by asking again.
        if ((data?.fetched || 0) === 0) break;
      }
    } catch (error) {
      console.error('Error importing email history:', error);
      toast.error('Failed to import email history');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearAllEmails = async () => {
    if (!confirm('Are you sure you want to clear all emails? This cannot be undone.')) {
      return;
    }
    
    setIsSyncing(true);
    try {
      const { data, error } = await invokeSecureFunction('outlook-email-sync', {
        action: 'clear'
      });

      if (error) throw error;

      toast.success('All emails cleared');
      setSelectedEmail(null);
      fetchEmails();
    } catch (error) {
      console.error('Error clearing emails:', error);
      toast.error('Failed to clear emails');
    } finally {
      setIsSyncing(false);
    }
  };

  // Re-fetch emails when mailbox changes (gated on auth readiness to avoid 401s on cold start)
  useEffect(() => {
    if (!isAuthReady) return;
    fetchEmails();
    fetchSentReplies();
    // Reset selection when switching mailboxes
    setSelectedEmail(null);
    setSelectedSentReply(null);
  }, [selectedMailbox, isAuthReady]);

  useEffect(() => {
    if (!isAuthReady) return;
    // Auto-sync from Outlook on page load (after auth is ready)
    handleSyncOutlook();
  }, [isAuthReady]);

  const fetchSentReplies = async () => {
    try {
      const { data, error } = await invokeSecureFunction('get-email-data', {
        action: 'list_replies',
        mailbox_source: selectedMailbox,
      });

      if (error) throw error;
      
      const typedReplies: SentReply[] = (Array.isArray(data?.replies) ? data.replies : []).map((reply: any) => ({
        id: toSafeString(reply?.id),
        original_email_id: reply?.original_email_id || null,
        recipient: toSafeString(reply?.recipient, 'Unknown'),
        subject: toSafeString(reply?.subject, '(No Subject)'),
        body: toSafeString(reply?.body),
        cc_recipients: toStringArray(reply?.cc_recipients),
        bcc_recipients: toStringArray(reply?.bcc_recipients),
        attachments: normalizeSentAttachments(reply?.attachments),
        sent_at: toSafeString(reply?.sent_at ?? reply?.created_at ?? new Date().toISOString()),
        mailbox_source: reply?.mailbox_source === 'personal' ? 'personal' : 'admin',
      }));
      
      setSentReplies(typedReplies);
    } catch (error) {
      console.error('Error fetching sent replies:', error);
    }
  };

  const [hasMoreEmails, setHasMoreEmails] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const mapEmailData = (email: any): Email => ({
    id: toSafeString(email?.id),
    sender: toSafeString(email?.sender ?? email?.from, 'Unknown'),
    subject: toSafeString(email?.subject, '(No Subject)'),
    body: toSafeString(email?.body ?? email?.body_preview),
    body_html: email?.body_html ?? null,
    received_at: toSafeString(email?.received_at ?? email?.created_at ?? new Date().toISOString()),
    summary: normalizeSummary(email?.summary),
    draft_reply: email?.draft_reply ? toSafeString(email.draft_reply) : null,
    urgency_level: email?.urgency_level === 'high' || email?.urgency_level === 'medium' || email?.urgency_level === 'low' ? email.urgency_level : null,
    linked_property_address: email?.linked_property_address || null,
    linked_report_id: email?.linked_report_id || null,
    status: (['unread', 'read', 'summarized', 'drafted', 'replied', 'archived'].includes(toSafeString(email?.status)) ? email.status : 'read') as Email['status'],
    created_at: toSafeString(email?.created_at ?? email?.received_at ?? new Date().toISOString()),
    to_recipients: toStringArray(email?.to_recipients),
    cc_recipients: toStringArray(email?.cc_recipients),
    bcc_recipients: toStringArray(email?.bcc_recipients),
    attachments: normalizeEmailAttachments(email?.attachments),
    mailbox_source: email?.mailbox_source === 'personal' ? 'personal' : 'admin',
    folder: email?.folder === 'sent' ? 'sent' : 'inbox',
    client_id: email?.client_id || null,
    client_name: email?.client_name || null,
  });

  const fetchEmails = async (attempt = 0) => {
    setIsLoading(true);
    try {
      const { data, error } = await invokeSecureFunction('get-email-data', {
        action: 'list',
        mailbox_source: selectedMailbox,
        limit: 500,
        offset: 0,
      });

      if (error) {
        // Auto-retry once for transient/auth-warmup failures (cold-start 401/5xx)
        const msg = (error.message || '').toLowerCase();
        const isTransient = msg.includes('auth') || msg.includes('unauthor') || msg.includes('http 5') || msg.includes('timed out') || msg.includes('network');
        if (isTransient && attempt < 2) {
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
          return fetchEmails(attempt + 1);
        }
        throw error;
      }
      
      const typedEmails: Email[] = (Array.isArray(data?.emails) ? data.emails : []).map(mapEmailData);
      
      setEmails(typedEmails);
      setHasMoreEmails(data?.hasMore === true);
      
      if (selectedEmail) {
        const updatedSelected = typedEmails.find(e => e.id === selectedEmail.id);
        if (updatedSelected) {
          setSelectedEmail(updatedSelected);
        }
      }
    } catch (error) {
      console.error('Error fetching emails:', error);
      toast.error('Failed to fetch emails');
    } finally {
      setIsLoading(false);
    }
  };

  const loadMoreEmails = async () => {
    setIsLoadingMore(true);
    try {
      const { data, error } = await invokeSecureFunction('get-email-data', {
        action: 'list',
        mailbox_source: selectedMailbox,
        limit: 500,
        offset: emails.length,
      });

      if (error) throw error;
      
      const moreEmails: Email[] = (Array.isArray(data?.emails) ? data.emails : []).map(mapEmailData);
      setEmails(prev => [...prev, ...moreEmails]);
      setHasMoreEmails(data?.hasMore === true);
    } catch (error) {
      console.error('Error loading more emails:', error);
      toast.error('Failed to load more emails');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleAddEmail = async () => {
    if (!newEmail.sender || !newEmail.subject || !newEmail.body) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const { data, error } = await invokeSecureFunction('email-copilot', {
        action: 'save_email',
        email: {
          sender: newEmail.sender,
          subject: newEmail.subject,
          body: newEmail.body,
          received_at: new Date(newEmail.received_at).toISOString()
        }
      });

      if (error) throw error;

      toast.success('Email added successfully');
      setShowAddModal(false);
      setNewEmail({ sender: '', subject: '', body: '', received_at: new Date().toISOString().split('T')[0] });
      fetchEmails();
    } catch (error) {
      console.error('Error adding email:', error);
      toast.error('Failed to add email');
    }
  };

  const handleSummarize = async () => {
    if (!selectedEmail) return;
    
    setIsSummarizing(true);
    try {
      const { data, error } = await invokeSecureFunction('email-copilot', {
        action: 'summarize',
        email: {
          sender: selectedEmail.sender,
          subject: selectedEmail.subject,
          body: selectedEmail.body,
          received_at: selectedEmail.received_at
        },
        emailId: selectedEmail.id
      });

      if (error) throw error;

      toast.success('Email summarized');

      // Update local state (skip refetch to avoid clobbering the freshly-written summary)
      const nextSummary = normalizeSummary(data?.summary) || {
        tldr: '',
        keyPoints: [],
        requiredActions: [],
        urgencyLevel: 'low' as const,
      };
      setSelectedEmail({
        ...selectedEmail,
        summary: nextSummary,
        urgency_level: nextSummary.urgencyLevel,
        status: 'summarized'
      });
      setEmails(prev => prev.map(e => e.id === selectedEmail.id ? {
        ...e,
        summary: nextSummary,
        urgency_level: nextSummary.urgencyLevel,
        status: 'summarized',
      } : e));
    } catch (error: any) {
      // Audit item 43 — this discarded the reason, so a rejected credential, an
      // exhausted balance and a rate limit all read as one sentence. The
      // Intelligence panel beside it already showed `e?.message`, which is why
      // Analyze and Translate reported "internal error" while Summarize said
      // nothing at all. Both say what happened now.
      console.error('Error summarizing:', error);
      toast.error(error?.message || 'Failed to summarize email');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleDraftReply = async (contextOverride?: string) => {
    if (!selectedEmail) return;
    
    setIsDrafting(true);
    try {
      const contextToUse = contextOverride ?? replyContext;
      
      const { data, error } = await invokeSecureFunction('email-copilot', {
        action: 'draft_reply',
        email: {
          sender: selectedEmail.sender,
          subject: selectedEmail.subject,
          body: selectedEmail.body,
          received_at: selectedEmail.received_at
        },
        emailId: selectedEmail.id,
        linkedPropertyAddress: selectedEmail.linked_property_address,
        replyContext: contextToUse || undefined
      });

      if (error) throw error;

      setCurrentDraft(data.draftReply);
      initializeReplyFields();
      setShowDraftModal(true);

      // Log reply generated
      logActivityDirect({
        actionType: 'email_reply_generated',
        entityType: 'email',
        entityId: selectedEmail.id,
        entityName: selectedEmail.subject,
        metadata: { sender: selectedEmail.sender }
      });
      
      // Update local state
      setSelectedEmail({
        ...selectedEmail,
        draft_reply: data.draftReply,
        status: 'drafted'
      });
      
      fetchEmails();
    } catch (error) {
      console.error('Error drafting reply:', error);
      toast.error('Failed to draft reply');
    } finally {
      setIsDrafting(false);
    }
  };

  // Voice recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      toast.info('Recording started - speak your reply context');
    } catch (error) {
      console.error('Error starting recording:', error);
      toast.error('Could not access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsTranscribing(true);
    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      
      const base64Audio = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });

      // Call OpenAI Whisper via edge function
      const { data, error } = await invokeSecureFunction('voice-to-text', {
        audio: base64Audio
      });

      if (error) throw error;

      if (data?.text) {
        setReplyContext(prev => prev ? `${prev} ${data.text}` : data.text);
        toast.success('Voice transcribed successfully');
      }
    } catch (error) {
      console.error('Error transcribing audio:', error);
      toast.error('Failed to transcribe voice');
    } finally {
      setIsTranscribing(false);
    }
  };

  // Extract recipient email from sender string
  const extractEmailAddress = (sender: string | null | undefined): string => {
    const safeSender = toSafeString(sender);
    const match = safeSender.match(/<([^>]+)>/);
    if (match) return match[1];
    if (safeSender.includes('@')) return safeSender.trim();
    return safeSender;
  };

  // Parse comma-separated emails
  /**
   * A typed recipient list, split on comma OR semicolon.
   *
   * Outlook writes semicolons, and somebody pasting a list out of it should
   * not have to know that this box wanted commas — a semicolon-separated paste
   * used to parse as one address containing several `@`s and reach nobody.
   * `send-email-reply` splits on the same two characters.
   */
  const parseEmailList = (emails: string): string[] => {
    const safeEmails = toSafeString(emails);
    if (!safeEmails.trim()) return [];
    return safeEmails.split(/[,;]/).map(e => e.trim()).filter(e => e.includes('@'));
  };

  /**
   * Seed the reply's addressing from the email being replied to — ONCE.
   *
   * This used to re-seed on every call, and `AIReplyAssistant` calls it every
   * time it produces a draft (`onInitialiseFields` after `onDraftChange`). So
   * an operator who filled in Cc and Bcc and then asked the assistant for a
   * draft had both fields silently overwritten with the original email's
   * recipients — the 19 Sep audit's "the email addresses that I filled in
   * earlier goes missing after the AI assisted draft is generated".
   *
   * Generating a draft writes the BODY; it has no opinion about who the
   * message goes to. Seeding is therefore keyed on the email being replied to:
   * the first call for a given email fills the fields, later calls for the same
   * email leave whatever is in them alone, and closing the composer (which
   * already clears Cc/Bcc) releases the key so the next reply seeds again.
   */
  const seededReplyForEmailId = useRef<string | null>(null);

  const initializeReplyFields = (isNewEmail: boolean = false) => {
    if (isNewEmail) {
      // For new compose (not a reply)
      seededReplyForEmailId.current = null;
      setReplyTo('');
      setReplySubject('');
      setReplyCc('');
      setReplyBcc('');
      return;
    }

    if (!selectedEmail) return;
    if (seededReplyForEmailId.current === selectedEmail.id) return;
    seededReplyForEmailId.current = selectedEmail.id;
    setReplyTo(extractEmailAddress(selectedEmail.sender));
    const subject = toSafeString(selectedEmail.subject).toLowerCase().startsWith('re:') 
      ? selectedEmail.subject 
      : `Re: ${selectedEmail.subject}`;
    setReplySubject(subject);
    
    // Carry forward CC/BCC from original email
    const ccFromOriginal = selectedEmail.cc_recipients?.length 
      ? selectedEmail.cc_recipients.join(', ') 
      : '';
    const bccFromOriginal = selectedEmail.bcc_recipients?.length 
      ? selectedEmail.bcc_recipients.join(', ') 
      : '';
    setReplyCc(ccFromOriginal);
    setReplyBcc(bccFromOriginal);
  };

  // Show send confirmation (with safety checks)
  const handleSendClick = () => {
    if (!currentDraft.trim()) {
      toast.error('Cannot send empty email');
      return;
    }
    // Audit item 45 — To takes a list now, like Cc and Bcc always have, so
    // the check is "did we get at least one address" rather than "does this
    // string contain an @". A typed list with one bad entry is named, because
    // silently dropping a recipient is how somebody does not get an email.
    const toEntries = replyTo.split(/[,;]/).map((e) => e.trim()).filter(Boolean);
    const validTo = toEntries.filter((e) => e.includes('@'));
    if (validTo.length === 0) {
      toast.error('Please enter a valid recipient email');
      return;
    }
    if (validTo.length < toEntries.length) {
      toast.error('One of the recipients is not a valid email address', {
        description: toEntries.filter((e) => !e.includes('@')).join(', '),
      });
      return;
    }
    // Missing-attachment guard
    const mentionsAttachment = /\b(see attached|please find attached|pfa|attached (please|herewith|is|are)|i('| ha)ve attached|attaching)\b/i.test(currentDraft);
    if (mentionsAttachment && replyAttachments.length === 0) {
      toast.warning('You mention an attachment but none is added', {
        description: 'Add a file or rephrase the body before sending.',
        action: { label: 'Send anyway', onClick: () => setShowSendConfirmModal(true) },
        duration: 6000,
      });
      return;
    }
    // Recipient sanity: large recipient list (BCC>10)
    const bccCount = parseEmailList(replyBcc).length;
    if (bccCount > 10) {
      toast.warning(`Sending to ${bccCount} BCC recipients`, {
        description: 'Double-check this is intended.',
        action: { label: 'Continue', onClick: () => setShowSendConfirmModal(true) },
        duration: 6000,
      });
      return;
    }
    setShowSendConfirmModal(true);
  };

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:application/pdf;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
    });
  };

  // Handle file selection for reply
  const handleReplyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const maxSize = 10 * 1024 * 1024; // 10MB limit per file
    
    const validFiles = files.filter(file => {
      if (file.size > maxSize) {
        toast.error(`${file.name} exceeds 10MB limit`);
        return false;
      }
      return true;
    });
    
    setReplyAttachments(prev => [...prev, ...validFiles]);
    if (replyFileInputRef.current) {
      replyFileInputRef.current.value = '';
    }
  };

  // Handle file selection for compose
  const handleComposeFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const maxSize = 10 * 1024 * 1024; // 10MB limit per file
    
    const validFiles = files.filter(file => {
      if (file.size > maxSize) {
        toast.error(`${file.name} exceeds 10MB limit`);
        return false;
      }
      return true;
    });
    
    setComposeAttachments(prev => [...prev, ...validFiles]);
    if (composeFileInputRef.current) {
      composeFileInputRef.current.value = '';
    }
  };

  // Remove attachment from reply
  const removeReplyAttachment = (index: number) => {
    setReplyAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Remove attachment from compose
  const removeComposeAttachment = (index: number) => {
    setComposeAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Remove attachment from forward
  const removeForwardAttachment = (index: number) => {
    setForwardAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Handle drag and drop for any attachment area
  const handleDragOver = (e: React.DragEvent, setDragActive: (active: boolean) => void) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent, setDragActive: (active: boolean) => void) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent, addFiles: (files: File[]) => void, setDragActive: (active: boolean) => void) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const files = Array.from(e.dataTransfer.files);
    const maxSize = 10 * 1024 * 1024; // 10MB limit per file
    
    const validFiles = files.filter(file => {
      if (file.size > maxSize) {
        toast.error(`${file.name} exceeds 10MB limit`);
        return false;
      }
      return true;
    });
    
    if (validFiles.length > 0) {
      addFiles(validFiles);
    }
  };

  // Handle file selection for forward
  const handleForwardFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const maxSize = 10 * 1024 * 1024;
    
    const validFiles = files.filter(file => {
      if (file.size > maxSize) {
        toast.error(`${file.name} exceeds 10MB limit`);
        return false;
      }
      return true;
    });
    
    setForwardAttachments(prev => [...prev, ...validFiles]);
    if (forwardFileInputRef.current) {
      forwardFileInputRef.current.value = '';
    }
  };

  // Open forward modal
  const handleOpenForward = async () => {
    if (!selectedEmail) return;
    
    // Build forward body with original message
    const forwardHeader = `\n\n---------- Forwarded message ----------\nFrom: ${selectedEmail.sender}\nDate: ${formatFullDate(selectedEmail.received_at)}\nSubject: ${selectedEmail.subject}\nTo: (original recipient)\n\n`;
    setForwardBody(forwardHeader + selectedEmail.body);
    setForwardTo('');
    setForwardCc('');
    setForwardBcc('');
    
    // If original email has attachments, we need to download and add them
    if (selectedEmail.attachments && selectedEmail.attachments.length > 0) {
      toast.info(`Loading ${selectedEmail.attachments.length} attachment(s)...`);
      const files: File[] = [];
      
      for (const att of selectedEmail.attachments) {
        try {
          const response = await fetch(att.storageUrl);
          const blob = await response.blob();
          const file = new File([blob], att.name, { type: att.contentType });
          files.push(file);
        } catch (error) {
          console.error('Error loading attachment:', error);
          toast.error(`Failed to load attachment: ${att.name}`);
        }
      }
      
      setForwardAttachments(files);
    } else {
      setForwardAttachments([]);
    }
    
    setShowForwardModal(true);
  };

  // Send forwarded email
  const handleSendForward = async () => {
    if (!selectedEmail || !forwardTo) return;
    
    setIsForwarding(true);
    
    try {
      const ccList = parseEmailList(forwardCc);
      const bccList = parseEmailList(forwardBcc);

      // Convert attachments to base64
      const attachmentsData = await Promise.all(
        forwardAttachments.map(async (file) => ({
          name: file.name,
          contentType: file.type || 'application/octet-stream',
          contentBytes: await fileToBase64(file)
        }))
      );

      const { data, error } = await invokeSecureFunction('send-email-reply', {
        to: parseEmailList(forwardTo),
        subject: buildForwardedSubject(selectedEmail.subject),
        // The original message travels WITH the note. It used to be dropped
        // entirely, so the recipient got the covering note and none of the
        // email being forwarded — no layout, no calls to action.
        body: buildForwardedHtml(forwardBody, selectedEmail),
        cc: ccList.length > 0 ? ccList : undefined,
        bcc: bccList.length > 0 ? bccList : undefined,
        attachments: attachmentsData.length > 0 ? attachmentsData : undefined,
        mailboxSource: selectedMailbox,
        senderMailboxId: selectedMailbox === 'personal' ? user?.id : undefined,
      });

      if (error) throw error;

      toast.success('Email forwarded successfully!');
      setShowForwardModal(false);
      setForwardAttachments([]);
      fetchSentReplies();
    } catch (error) {
      console.error('Error forwarding email:', error);
      toast.error('Failed to forward email');
    } finally {
      setIsForwarding(false);
    }
  };

  // Send email directly (for reply) — supports 10s Undo Send
  const handleSendEmail = async (opts?: { skipUndo?: boolean }) => {
    if (!selectedEmail || !currentDraft) return;
    setShowSendConfirmModal(false);

    // 10s undo window
    if (!opts?.skipUndo) {
      let cancelled = false;
      const targetEmail = selectedEmail;
      const snapshot = {
        to: replyTo, subject: replySubject, cc: replyCc, bcc: replyBcc,
        body: currentDraft, attachments: replyAttachments,
      };
      // Optimistically close the modal
      setShowDraftModal(false);
      toast('Sending in 10s…', {
        description: `To ${snapshot.to}`,
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            cancelled = true;
            // restore composer
            setSelectedEmail(targetEmail);
            setReplyTo(snapshot.to);
            setReplySubject(snapshot.subject);
            setReplyCc(snapshot.cc);
            setReplyBcc(snapshot.bcc);
            setCurrentDraft(snapshot.body);
            setReplyAttachments(snapshot.attachments);
            setShowDraftModal(true);
            toast.info('Send cancelled');
          },
        },
      });
      setTimeout(() => {
        if (!cancelled) handleSendEmail({ skipUndo: true });
      }, 10000);
      return;
    }

    setIsSendingEmail(true);
    
    try {
      const ccList = parseEmailList(replyCc);
      const bccList = parseEmailList(replyBcc);

      // Convert attachments to base64
      const attachmentsData = await Promise.all(
        replyAttachments.map(async (file) => ({
          name: file.name,
          contentType: file.type || 'application/octet-stream',
          contentBytes: await fileToBase64(file)
        }))
      );

      const { data, error } = await invokeSecureFunction('send-email-reply', {
        to: parseEmailList(replyTo),
        subject: replySubject,
        body: currentDraft,
        cc: ccList.length > 0 ? ccList : undefined,
        bcc: bccList.length > 0 ? bccList : undefined,
        originalEmailId: selectedEmail.id,
        attachments: attachmentsData.length > 0 ? attachmentsData : undefined,
        mailboxSource: selectedMailbox,
        senderMailboxId: selectedMailbox === 'personal' ? user?.id : undefined,
      });

      if (error) throw error;

      toast.success('Email sent successfully!');
      setShowDraftModal(false);
      setReplyContext('');
      setReplyCc('');
      setReplyBcc('');
      seededReplyForEmailId.current = null;
      setReplyAttachments([]);

      // Log reply sent
      logActivityDirect({
        actionType: 'email_reply_sent',
        entityType: 'email',
        entityId: selectedEmail.id,
        entityName: selectedEmail.subject,
        metadata: { recipient: replyTo }
      });

      // Add bell notification for email reply
      addNotification({
        type: 'email_reply_sent',
        title: 'Email Reply Sent',
        message: `Reply sent to ${replyTo} — ${selectedEmail.subject}`,
        entityId: selectedEmail.id
      });
      
      // Update email status to 'replied' so it shows badge and remains visible in thread
      await authedSupabase
        .from('email_copilot_emails')
        .update({ status: 'replied' })
        .eq('id', selectedEmail.id);
      
      fetchEmails();
      fetchSentReplies();
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error('Failed to send email');
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Send new composed email (not a reply)
  const handleSendComposedEmail = async () => {
    if (!composeEmail.to || !composeEmail.body) {
      toast.error('Please fill in recipient and message body');
      return;
    }
    
    setIsComposing(true);
    
    try {
      const ccList = parseEmailList(composeEmail.cc);
      const bccList = parseEmailList(composeEmail.bcc);

      // Convert regular attachments to base64
      const attachmentsData = await Promise.all(
        composeAttachments.map(async (file) => ({
          name: file.name,
          contentType: file.type || 'application/octet-stream',
          contentBytes: await fileToBase64(file)
        }))
      );

      // Handle QA PDF attachment from Aurixa Intelligence Hub (fetch from URL and convert to base64)
      if (qaPDFAttachment) {
        try {
          const pdfResponse = await fetch(qaPDFAttachment.url);
          if (pdfResponse.ok) {
            const pdfBlob = await pdfResponse.blob();
            const pdfBase64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = (reader.result as string).split(',')[1];
                resolve(base64);
              };
              reader.onerror = reject;
              reader.readAsDataURL(pdfBlob);
            });
            
            attachmentsData.push({
              name: qaPDFAttachment.fileName,
              contentType: 'application/pdf',
              contentBytes: pdfBase64
            });
          }
        } catch (pdfError) {
          console.error('Failed to fetch QA PDF attachment:', pdfError);
          toast.error('Failed to attach Q&A PDF. Sending email without it.');
        }
      }

      const { data, error } = await invokeSecureFunction('send-email-reply', {
        to: parseEmailList(composeEmail.to),
        subject: composeEmail.subject || '(No Subject)',
        body: composeEmail.body,
        cc: ccList.length > 0 ? ccList : undefined,
        bcc: bccList.length > 0 ? bccList : undefined,
        attachments: attachmentsData.length > 0 ? attachmentsData : undefined,
        mailboxSource: selectedMailbox,
        senderMailboxId: selectedMailbox === 'personal' ? user?.id : undefined,
      });

      if (error) throw error;

      toast.success('Email sent successfully!');
      
      // Add bell notification for composed email
      addNotification({
        type: 'email_reply_sent',
        title: 'Email Sent',
        message: `Email sent to ${composeEmail.to} — ${composeEmail.subject || '(No Subject)'}`
      });

      setShowComposeModal(false);
      setComposeEmail({ to: '', subject: '', body: '', cc: '', bcc: '' });
      setComposeAttachments([]);
      setQaPDFAttachment(null); // Clear the QA PDF attachment after sending
      fetchSentReplies();
    } catch (error) {
      console.error('Error sending composed email:', error);
      toast.error('Failed to send email');
    } finally {
      setIsComposing(false);
    }
  };

  const handleCopyDraft = () => {
    navigator.clipboard.writeText(currentDraft);
    toast.success('Draft copied to clipboard');
  };

  // Open edit draft modal
  const handleOpenEditDraft = () => {
    if (!selectedEmail?.draft_reply) return;
    setEditableDraft(selectedEmail.draft_reply);
    // Initialize reply fields for sending from edit modal
    initializeReplyFields();
    setShowEditDraftModal(true);
  };

  // Save edited draft
  const handleSaveEditedDraft = async () => {
    if (!selectedEmail) return;
    
    setIsSavingDraft(true);
    try {
      const { error } = await authedSupabase
        .from('email_copilot_emails')
        .update({ draft_reply: editableDraft })
        .eq('id', selectedEmail.id);

      if (error) throw error;

      // Update local state
      setSelectedEmail({
        ...selectedEmail,
        draft_reply: editableDraft
      });
      
      toast.success('Draft saved successfully');
      setShowEditDraftModal(false);
      fetchEmails();
    } catch (error) {
      console.error('Error saving draft:', error);
      toast.error('Failed to save draft');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleArchiveEmail = async () => {
    if (!selectedEmail) return;
    
    try {
      const { error } = await authedSupabase
        .from('email_copilot_emails')
        .update({ status: 'archived' })
        .eq('id', selectedEmail.id);

      if (error) throw error;

      toast.success('Email archived');
      setSelectedEmail(null);
      fetchEmails();
    } catch (error) {
      console.error('Error archiving:', error);
      toast.error('Failed to archive email');
    }
  };

  const handleDeleteEmail = async () => {
    if (!selectedEmail) return;
    
    try {
      const { error } = await authedSupabase
        .from('email_copilot_emails')
        .delete()
        .eq('id', selectedEmail.id);

      if (error) throw error;

      toast.success('Email deleted');
      setSelectedEmail(null);
      fetchEmails();
    } catch (error) {
      console.error('Error deleting:', error);
      toast.error('Failed to delete email');
    }
  };

  const getUrgencyBadge = (level: string | null) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; className: string }> = {
      high: { variant: 'destructive', label: 'High', className: 'bg-destructive/10 text-destructive border-destructive/20' },
      medium: { variant: 'default', label: 'Medium', className: 'bg-warning/10 text-warning border-warning/20' },
      low: { variant: 'secondary', label: 'Low', className: 'bg-muted text-muted-foreground' }
    };
    const config = variants[level || 'low'] || variants.low;
    return <Badge variant="outline" className={config.className}>{config.label}</Badge>;
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; className: string }> = {
      unread: { label: 'Unread', className: 'bg-info/10 text-info border-info/20' },
      read: { label: 'Read', className: 'bg-muted text-muted-foreground' },
      summarized: { label: 'Summarized', className: 'bg-success/10 text-success border-success/20' },
      drafted: { label: 'Draft Ready', className: 'bg-accent/10 text-accent border-accent/20' },
      archived: { label: 'Archived', className: 'bg-muted/10 text-muted-foreground border-border/20' }
    };
    const { label, className } = config[status] || config.read;
    return <Badge variant="outline" className={className}>{label}</Badge>;
  };

  // Filter and search emails
  const filteredEmails = emails.filter(email => {
    const senderText = toSafeString(email.sender).toLowerCase();
    const subjectText = toSafeString(email.subject).toLowerCase();
    const bodyText = toSafeString(email.body).toLowerCase();
    const toRecipients = toStringArray(email.to_recipients);

    // Folder filter based on viewMode
    const targetFolder = viewMode === 'sent' ? 'sent' : 'inbox';
    if (email.folder !== targetFolder) return false;
    
    // Status filter (only apply to inbox view)
    if (viewMode === 'inbox') {
      if (statusFilter === 'all') {
        if (!showArchived && email.status === 'archived') return false;
      } else if (statusFilter === 'archived') {
        if (email.status !== 'archived') return false;
      } else {
        if (email.status !== statusFilter) return false;
      }
    }
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSender = senderText.includes(query);
      const matchesSubject = subjectText.includes(query);
      const matchesBody = bodyText.includes(query);
      // For sent emails, also search in recipients
      const matchesRecipients = toRecipients.some(r => r.toLowerCase().includes(query));
      if (!matchesSender && !matchesSubject && !matchesBody && !matchesRecipients) return false;
    }
    
    return true;
  });
  
  // Group filtered emails by thread
  const emailThreads = groupEmailsByThread(filteredEmails);
  const sortedThreadKeys = Array.from(emailThreads.keys()).sort((a, b) => {
    const aEmails = emailThreads.get(a)!;
    const bEmails = emailThreads.get(b)!;
    return new Date(bEmails[0].received_at).getTime() - new Date(aEmails[0].received_at).getTime();
  });
  
  /**
   * Audit item 40 — Sent had no search.
   *
   * `filteredEmails` has always applied `searchQuery` to sent emails, including
   * their recipients; what was missing was the box, and this list. The Sent
   * view shows synced sent emails AND replies composed here, so searching one
   * and not the other would be worse than searching neither.
   */
  const filteredSentReplies = sentReplies.filter((reply) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return [
      reply.recipient,
      reply.subject,
      reply.body,
      ...(reply.cc_recipients ?? []),
      ...(reply.bcc_recipients ?? []),
    ].some((field) => toSafeString(field).toLowerCase().includes(query));
  });

  const inboxEmails = emails.filter(e => e.folder === 'inbox' && e.status !== 'archived');
  const sentEmails = emails.filter(e => e.folder === 'sent');
  const unreadCount = inboxEmails.filter(e => e.status === 'unread').length;
  const sentCount = sentEmails.length + sentReplies.length;

  return (
    <div className="h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] min-h-0 flex flex-col overflow-hidden overscroll-none bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.14),transparent_34%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/0.18))]">
      {/* Header */}
      <div className="mx-3 md:mx-6 mt-3 md:mt-5 mb-3 flex shrink-0 flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center rounded-2xl border border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.92),hsl(var(--background)/0.78))] px-4 md:px-5 py-3 md:py-4 shadow-2xl shadow-sm dark:shadow-black/20 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <div className="relative p-2 md:p-2.5 bg-primary/15 rounded-2xl ring-1 ring-primary/30 shadow-lg shadow-primary/10">
            <Mail className="h-4 w-4 md:h-5 md:w-5 text-primary" />
            <span className="absolute -right-1 -top-1 rounded-full border border-background bg-background p-0.5 shadow-sm">
              <Sparkles className="h-2.5 w-2.5 text-primary" />
            </span>
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
              Email Copilot
              {unreadCount > 0 && (
                <Badge variant="secondary" className="rounded-full border border-primary/30 bg-primary/15 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-primary shadow-sm" title={`${unreadCount} unread emails`}>{unreadCount}</Badge>
              )}
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground/90 hidden sm:block">AI-powered email summaries & draft replies</p>
            <div className="mt-1.5 hidden flex-wrap items-center gap-1.5 sm:flex">
              <LiveModelBadge agentKey="email_copilot" size="sm" showSlot />
              <ModelUpgradeButton agentKey="email_copilot" />
            </div>
          </div>

        </div>
        <div className="flex w-full max-w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end rounded-2xl border border-primary/10 bg-background/35 p-1.5 shadow-inner shadow-sm dark:shadow-black/10 md:gap-2.5">
          {/* Notification toggles */}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={toggleSoundNotifications}
            title={soundEnabled ? 'Disable sound notifications' : 'Enable sound notifications'}
            aria-label={soundEnabled ? 'Disable sound notifications' : 'Enable sound notifications'}
            className="h-10 w-10 rounded-xl border border-border/70 bg-background/65 shadow-sm transition-all hover:-translate-y-px hover:border-primary/45 hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_18px_hsl(var(--primary)/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
          >
            {/*
              Audit item 41 — these two buttons drew the SAME icon. One mutes a
              sound and one stops a browser notification, and a reader had only
              position to tell them apart; the second's colour did not help
              either, because `text-success` is not a token and
              compiled to nothing, so both bells inherited the same colour.

              A speaker for the sound and a bell for the notification says
              which is which without depending on colour at all — which is what
              a reader needs when the two sit side by side, and what a
              colour-blind reader needs regardless.
            */}
            {soundEnabled ? (
              <Volume2 className="h-4 w-4 text-primary" />
            ) : (
              <VolumeX className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={toggleBrowserNotifications}
            title={browserNotificationsEnabled ? 'Disable browser notifications' : 'Enable browser notifications'}
            aria-label={browserNotificationsEnabled ? 'Disable browser notifications' : 'Enable browser notifications'}
            className="h-10 w-10 rounded-xl border border-border/70 bg-background/65 shadow-sm transition-all hover:-translate-y-px hover:border-success/45 hover:bg-success/10 hover:text-success hover:shadow-[0_0_18px_hsl(142_71%_45%/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40"
          >
            {browserNotificationsEnabled ? (
              <Bell className="h-4 w-4 text-success" />
            ) : (
              <BellOff className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
          
          {/* Mailbox Selector */}
          {(hasAdminEmailAccess || personalMailbox) && (
            <Select
              value={selectedMailbox}
              onValueChange={(value: 'admin' | 'personal') => setSelectedMailbox(value)}
            >
              <SelectTrigger aria-label="Select mailbox" className="h-10 w-auto min-w-[138px] rounded-xl border-primary/25 bg-background/75 text-xs shadow-sm transition-all hover:border-primary/55 hover:bg-primary/5 hover:shadow-[0_0_18px_hsl(var(--primary)/0.10)] focus:ring-2 focus:ring-primary/40 md:min-w-[156px] md:text-sm">
                <Inbox className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
                <SelectValue placeholder="Select mailbox" />
              </SelectTrigger>
              <SelectContent>
                {hasAdminEmailAccess && (
                  <SelectItem value="admin">Admin Inbox</SelectItem>
                )}
                {personalMailbox ? (
                  <SelectItem value="personal">Personal Mailbox</SelectItem>
                ) : (
                  <SelectItem value="personal" disabled>
                    Personal (Not configured)
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          )}

          <Button variant="outline" size="sm" className="min-h-10 gap-1.5 rounded-xl border-border/70 bg-background/65 px-2.5 shadow-sm transition-all hover:-translate-y-px hover:border-brand-300/50 hover:bg-brand-500/10 hover:text-brand-200 hover:shadow-[0_0_18px_hsl(43_74%_49%/0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/40" onClick={() => setShowScheduledList(true)} title="Scheduled sends" aria-label="Open scheduled sends">
            <Clock className="h-3.5 w-3.5" />
            {scheduledSends.length > 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{scheduledSends.length}</Badge>}
          </Button>
          <Button variant="outline" size="sm" className="min-h-10 gap-1.5 rounded-xl border-accent/20 bg-background/65 px-2.5 shadow-sm transition-all hover:-translate-y-px hover:border-accent/45 hover:bg-accent/10 hover:text-accent hover:shadow-[0_0_18px_hsl(270_91%_65%/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" onClick={() => setShowSnippetManager(true)} title="Snippet library" aria-label="Open snippet library">
            <Sparkles className="h-3.5 w-3.5" />
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open email options" className="h-10 w-10 rounded-xl border-border/70 bg-background/65 shadow-sm transition-all hover:-translate-y-px hover:border-primary/45 hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_18px_hsl(var(--primary)/0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 md:w-auto md:px-3">
                <MoreVertical className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl border-primary/15 bg-popover/95 shadow-xl shadow-sm dark:shadow-black/20 backdrop-blur">
              {!personalMailbox && (
                <>
                  <DropdownMenuItem onClick={() => setShowMailboxSettings(true)} className="rounded-lg transition-colors focus:bg-primary/10 focus:text-primary">
                    <Settings className="h-4 w-4 mr-2" />
                    Configure Personal Mailbox
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {personalMailbox && (
                <>
                  <DropdownMenuItem onClick={() => setShowMailboxSettings(true)} className="rounded-lg transition-colors focus:bg-primary/10 focus:text-primary">
                    <Settings className="h-4 w-4 mr-2" />
                    Edit Personal Mailbox
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={handleImportHistory} disabled={isSyncing} className="rounded-lg transition-colors">
                <History className="h-4 w-4 mr-2" />
                Import Full History
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleClearAllEmails} className="rounded-lg text-destructive transition-colors focus:bg-destructive/10 focus:text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Clear All Emails
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl border-success/25 bg-background/65 shadow-sm transition-all hover:-translate-y-px hover:border-brand-300/45 hover:bg-brand-500/10 hover:text-brand-100 hover:shadow-[0_0_20px_hsl(43_74%_49%/0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/40 disabled:cursor-not-allowed disabled:border-brand-300/25 disabled:bg-brand-500/10 disabled:text-brand-100 disabled:opacity-80 md:w-auto md:px-3" onClick={handleSyncOutlook} disabled={isSyncing} aria-label={isSyncing ? 'Syncing emails' : 'Sync emails'}>
            <span className="relative inline-flex">
              {isSyncing && <span className="absolute -right-1 -top-1 h-2 w-2 animate-ping rounded-full bg-brand-300/70" />}
              <RefreshCw className={`h-4 w-4 md:mr-2 ${isSyncing ? 'animate-spin text-brand-200' : ''}`} />
            </span>
            <span className="hidden md:inline">{isSyncing ? 'Syncing...' : 'Sync'}</span>
          </Button>
          <Button size="icon" className="h-10 w-10 rounded-xl border border-primary/20 bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--primary)/0.82))] text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_0_28px_hsl(var(--primary)/0.28)] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:translate-y-0 md:w-auto md:px-4" onClick={() => setShowComposeModal(true)} aria-label="Compose new email">
            <Plus className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Compose</span>
          </Button>
        </div>
      </div>

      {/* Disclaimer - hidden on mobile to save space */}
      {!isMobile && (
      <div className="relative mx-3 md:mx-6 mb-3 shrink-0 overflow-hidden rounded-2xl border border-brand-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.14),rgba(10,10,10,0.72)_48%,rgba(24,24,27,0.64))] px-4 py-3 shadow-lg shadow-sm dark:shadow-black/15 backdrop-blur">
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/70 to-transparent" />
        <p className="flex items-center gap-3 text-xs leading-5 text-brand-50/85 md:text-sm">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand-200/30 bg-brand-300/12 shadow-inner shadow-brand-950/20">
            <AlertCircle className="h-4 w-4 text-brand-300" />
          </span>
          <span><strong className="font-semibold text-brand-100">Human-in-the-loop:</strong> All AI outputs are drafts. Review before sending.</span>
        </p>
      </div>
      )}

      {/* Main Content */}
      <div className="relative mx-3 md:mx-6 mb-3 md:mb-5 flex min-h-0 flex-1 basis-0 overflow-hidden rounded-3xl border border-primary/10 bg-[linear-gradient(135deg,hsl(var(--card)/0.82),hsl(var(--background)/0.64))] shadow-2xl shadow-sm dark:shadow-black/25 backdrop-blur"
        onMouseMove={(e) => {
          if (!isDraggingRef.current) return;
          const delta = e.clientX - dragStartXRef.current;
          const newWidth = Math.min(600, Math.max(280, dragStartWidthRef.current + delta));
          setListPanelWidth(newWidth);
        }}
        onMouseUp={() => { isDraggingRef.current = false; }}
        onMouseLeave={() => { isDraggingRef.current = false; }}
      >
        {/* Email List Panel - full width on mobile, hidden when detail shown */}
        <div 
          className={`${isMobile ? 'w-full' : ''} min-h-0 overflow-hidden border-r border-primary/10 flex flex-col bg-card/85 shadow-[inset_-1px_0_0_hsl(var(--primary)/0.04)] ${isMobile && showMobileDetail ? 'hidden' : ''}`}
          style={!isMobile ? { width: listPanelWidth, minWidth: 280, maxWidth: 600, flexShrink: 0 } : undefined}
        >
          {/* Inbox/Sent Tabs */}
          <div className="shrink-0 px-3 pt-3 border-b border-border/70 bg-background/30">
            <div role="tablist" aria-label="Mailbox view" className="mb-3 flex gap-1.5 rounded-2xl border border-primary/10 bg-background/45 p-1.5 shadow-inner shadow-sm dark:shadow-black/10">
              <button
                onClick={() => { setViewMode('inbox'); setSelectedSentReply(null); }}
                role="tab"
                aria-selected={viewMode === 'inbox'}
                aria-controls="email-copilot-list"
                className={`flex-1 flex items-center justify-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-0 ${
                  viewMode === 'inbox'
                    ? 'bg-primary/15 text-primary shadow-md shadow-primary/15 ring-1 ring-primary/45'
                    : 'text-muted-foreground hover:-translate-y-px hover:bg-primary/10 hover:text-foreground hover:shadow-[0_0_18px_hsl(var(--primary)/0.10)]'
                }`}
              >
                <Inbox className="h-4 w-4 shrink-0" />
                <span>Inbox</span>
                {unreadCount > 0 && (
                  <Badge variant="secondary" className="h-5 rounded-full border border-primary/25 bg-primary/15 px-2 text-[11px] font-semibold tabular-nums text-primary">{unreadCount}</Badge>
                )}
              </button>
              <button
                onClick={() => { setViewMode('sent'); setSelectedEmail(null); }}
                role="tab"
                aria-selected={viewMode === 'sent'}
                aria-controls="email-copilot-list"
                className={`flex-1 flex items-center justify-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-0 ${
                  viewMode === 'sent'
                    ? 'bg-primary/15 text-primary shadow-md shadow-primary/15 ring-1 ring-primary/45'
                    : 'text-muted-foreground hover:-translate-y-px hover:bg-primary/10 hover:text-foreground hover:shadow-[0_0_18px_hsl(var(--primary)/0.10)]'
                }`}
              >
                <Send className="h-4 w-4 shrink-0" />
                <span>Sent</span>
                <Badge variant="outline" className="h-5 rounded-full border-border/70 bg-background/70 px-2 text-[11px] font-semibold tabular-nums text-muted-foreground">{sentCount}</Badge>
              </button>
            </div>
          </div>

          {/*
            Audit item 40 — Sent had no search while Inbox did.

            One control above the branch rather than a second copy inside it:
            `searchQuery` already drove `filteredEmails` for BOTH folders,
            matching recipients as well as sender, subject and body — what was
            missing was the box. `filteredSentReplies` now applies the same
            query to replies composed here, because searching the synced half
            of Sent and not the composed half would be worse than searching
            neither. The status filter and Show Archived stay inbox-only:
            neither means anything for Sent.
          */}
          <div className="shrink-0 border-b border-border/70 bg-background/20 px-3 py-3">
                {/* Search */}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
                  <Input
                    placeholder="Search emails..."
                    aria-label="Search emails"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="min-h-10 rounded-2xl border-primary/15 bg-background/75 pl-10 pr-9 text-sm shadow-inner shadow-sm dark:shadow-black/10 placeholder:text-muted-foreground/70 transition-all focus-visible:border-primary/65 focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear email search"
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_14px_hsl(var(--primary)/0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
          </div>

          {viewMode === 'inbox' ? (
            <>
              {/*
                Audit item 39 — the inbox fitted one email.

                Four stacked rows stood between the tabs and the first message:
                search, the status filter with Show Archived, and a count row
                of its own. On a laptop that is most of the column. The filters
                and the count are one row now — the count is a reading OF the
                filter, so it belongs beside it — which buys back a row and a
                border without removing anything.
              */}
              <div className="shrink-0 border-b border-border/70 bg-background/20 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger aria-label="Filter emails by status" className="h-9 min-w-[130px] flex-1 rounded-xl border-primary/15 bg-background/75 text-xs shadow-sm transition-all hover:border-primary/55 hover:bg-primary/5 hover:shadow-[0_0_18px_hsl(var(--primary)/0.10)] focus:ring-2 focus:ring-primary/40">
                      <Filter className="h-3 w-3 mr-1" />
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-primary/15 bg-popover/95 shadow-xl shadow-sm dark:shadow-black/20 backdrop-blur">
                      <SelectItem value="all">All Emails</SelectItem>
                      <SelectItem value="unread">Unread</SelectItem>
                      <SelectItem value="read">Read</SelectItem>
                      <SelectItem value="summarized">Summarized</SelectItem>
                      <SelectItem value="drafted">Draft Ready</SelectItem>
                      <SelectItem value="replied">Replied</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>

                  <Badge
                    variant={showArchived ? "default" : "outline"}
                    className={`min-h-9 cursor-pointer rounded-xl px-2.5 text-xs font-semibold transition-all hover:-translate-y-px hover:border-primary/50 hover:bg-primary/10 hover:shadow-[0_0_18px_hsl(var(--primary)/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 ${showArchived ? 'border-primary/35 bg-primary/15 text-primary shadow-sm shadow-primary/10' : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setShowArchived(!showArchived)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={showArchived}
                    aria-label={showArchived ? 'Showing archived emails' : 'Show archived emails'}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowArchived(!showArchived); } }}
                  >
                    <Archive className="h-3 w-3 mr-1" />
                    {showArchived ? 'Showing' : 'Show'} Archived
                  </Badge>

                  <span className="ml-auto whitespace-nowrap text-xs font-semibold tabular-nums text-muted-foreground">
                    {filteredEmails.length} {filteredEmails.length === 1 ? 'email' : 'emails'}
                    {sortedThreadKeys.length !== filteredEmails.length && (
                      <span className="ml-1 font-medium text-muted-foreground/75">
                        · {sortedThreadKeys.length} {sortedThreadKeys.length === 1 ? 'thread' : 'threads'}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </>
          ) : (
            /* Sent Replies Header */
            <div className="shrink-0 border-b border-primary/10 bg-[linear-gradient(135deg,hsl(var(--muted)/0.28),hsl(var(--background)/0.22))] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/15 bg-primary/10">
                  <Send className="h-3.5 w-3.5 text-primary" />
                </span>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {sentCount} sent {sentCount === 1 ? 'email' : 'emails'}
                </span>
              </div>
            </div>
          )}
          
          <ScrollArea id="email-copilot-list" className="min-h-0 flex-1 overscroll-contain bg-background/15 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
            {viewMode === 'inbox' ? (
              // Inbox view
              <>
                {isLoading ? (
                  <div className="m-4 overflow-hidden rounded-[1.75rem] border border-primary/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.82),hsl(var(--background)/0.62))] p-8 text-center shadow-inner shadow-sm dark:shadow-black/10">
                    <span className="relative mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10">
                      <span className="absolute inset-2 animate-ping rounded-2xl bg-primary/10" />
                      <RefreshCw className="relative h-6 w-6 animate-spin text-primary/70" />
                    </span>
                    <p className="text-sm font-semibold text-foreground">Loading emails...</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Checking the selected mailbox for the latest messages.</p>
                  </div>
                ) : filteredEmails.length === 0 ? (
                  <div className="m-4 rounded-[1.75rem] border border-dashed border-primary/25 bg-[linear-gradient(135deg,hsl(var(--card)/0.76),hsl(var(--background)/0.58))] p-8 text-center shadow-inner shadow-sm dark:shadow-black/10">
                    <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10">
                      <Inbox className="h-7 w-7 text-primary/45" />
                    </span>
                    {/*
                      Searching and filtering happen over the messages ALREADY
                      LOADED, never over the mailbox — so "no matching emails"
                      is only true when there is nothing left to load. While
                      `hasMoreEmails` holds, the honest statement is that we
                      have not looked at the rest yet, and the Load more button
                      below the list is what looks.
                    */}
                    <p className="text-sm font-semibold text-foreground">
                      {searchQuery || statusFilter !== 'all'
                        ? (hasMoreEmails ? 'No matches in the emails loaded so far' : 'No matching emails')
                        : 'No emails'}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {searchQuery || statusFilter !== 'all'
                        ? (hasMoreEmails
                          ? 'Search covers what has been loaded. Load more below to search further back.'
                          : 'Try adjusting your filters')
                        : 'Sync your inbox or add an email'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 p-3">
                    {sortedThreadKeys.map((threadKey) => {
                      const threadEmails = emailThreads.get(threadKey)!;
                      const isThreaded = threadEmails.length > 1;
                      const isExpanded = expandedThreads.has(threadKey);
                      const latestEmail = threadEmails[0];
                      const hasUnread = threadEmails.some(e => e.status === 'unread');
                      const hasSummary = threadEmails.some(e => e.summary);
                      const hasDraft = threadEmails.some(e => e.draft_reply);
                      
                      return (
                        <div key={threadKey}>
                          {/* Thread Header / Single Email */}
                          <div
                            role="button"
                            tabIndex={0}
                            aria-label={`${isThreaded ? 'Open thread' : 'Open email'} from ${extractSenderName(latestEmail.sender)}: ${latestEmail.subject || '(No Subject)'}`}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
                            onClick={() => {
                              if (isThreaded && !isExpanded) {
                                toggleThread(threadKey);
                              } else if (isThreaded && isExpanded) {
                                // If already expanded and clicking the header, collapse the thread
                                toggleThread(threadKey);
                              } else {
                                handleSelectEmail(latestEmail);
                              }
                            }}
                            className={`group relative cursor-pointer overflow-hidden rounded-2xl border border-border/55 border-l-4 px-4 py-[1.125rem] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-l-primary hover:border-primary/35 hover:ring-1 hover:ring-primary/20 hover:bg-[linear-gradient(135deg,hsl(var(--primary)/0.075),hsl(var(--card)/0.92)_42%,hsl(var(--background)/0.72))] hover:shadow-[0_16px_36px_hsl(var(--primary)/0.11)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 ${
                              selectedEmail?.id === latestEmail.id ? 'border-l-primary border-primary/40 bg-[linear-gradient(135deg,hsl(var(--primary)/0.16),hsl(var(--card)/0.95)_48%,hsl(var(--primary)/0.055))] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.24),0_18px_40px_hsl(var(--primary)/0.13)] ring-1 ring-primary/35' : latestEmail.status === 'archived' ? 'border-l-slate-400/35 bg-muted/30 opacity-85' : 'border-l-transparent bg-card/72'
                            } ${hasUnread ? 'bg-[linear-gradient(135deg,hsl(var(--primary)/0.095),hsl(var(--card)/0.88)_52%,hsl(var(--background)/0.68))]' : ''}`}
                          >
                            <div className="pointer-events-none absolute inset-y-3 left-0 w-0.5 rounded-r-full bg-primary/0 transition-colors group-hover:bg-primary/70" />
                            <div className="flex items-start gap-3.5">
                              {/* Avatar */}
                              <div className={`mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border shadow-[inset_0_1px_0_hsl(var(--background)/0.45),0_10px_24px_hsl(var(--primary)/0.12)] ring-1 transition-all group-hover:scale-[1.04] group-hover:border-primary/45 group-hover:ring-primary/35 group-hover:shadow-[0_12px_28px_hsl(var(--primary)/0.18)] ${
                                hasUnread ? 'border-primary/35 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.32),hsl(var(--primary)/0.13)_60%,hsl(var(--card)/0.9))] ring-primary/25' : 'border-primary/20 bg-[linear-gradient(135deg,hsl(var(--primary)/0.16),hsl(var(--muted)/0.38))] ring-primary/15'
                              }`}>
                                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-primary drop-shadow-sm">
                                  {getSenderInitials(latestEmail.sender)}
                                </span>
                              </div>
                              
                              <div className="flex-1 min-w-0">
                                {/* Row 1: Sender + Date — date always visible */}
                                <div className="mb-1 flex items-center">
                                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                    {hasUnread && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.65)]" />}
                                    <span title={extractSenderName(latestEmail.sender)} className={`truncate text-[0.92rem] leading-5 tracking-[-0.01em] ${hasUnread ? 'font-bold text-foreground' : 'font-semibold text-foreground/90'}`}>
                                      {extractSenderName(latestEmail.sender)}
                                    </span>
                                    {isThreaded && (
                                      <Badge variant="secondary" className="flex-shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-primary shadow-sm">
                                        <MessageCircle className="mr-1 h-2.5 w-2.5 text-primary" />
                                        {threadEmails.length}
                                      </Badge>
                                    )}
                                  </div>
                                  <span className="flex-shrink-0 whitespace-nowrap pl-2 text-[10px] font-medium text-muted-foreground/80">
                                    {formatEmailDate(latestEmail.received_at)}
                                  </span>
                                </div>
                                {/* Row 2: Subject */}
                                <p title={latestEmail.subject || '(No Subject)'} className={`truncate text-sm leading-5 tracking-[-0.005em] ${hasUnread ? 'font-bold text-foreground' : 'font-semibold text-foreground/80'}`}>
                                  {latestEmail.subject || '(No Subject)'}
                                </p>
                                {/* Row 3: Body preview */}
                                <p title={latestEmail.body?.replace(/\n/g, ' ')} className="mt-1.5 truncate text-xs leading-5 text-muted-foreground/90 transition-colors group-hover:text-foreground/68">
                                  {latestEmail.body?.slice(0, 50).replace(/\n/g, ' ')}…
                                </p>
                                
                                {/* Status indicators */}
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  {latestEmail.urgency_level && latestEmail.urgency_level !== 'low' && (
                                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                                      latestEmail.urgency_level === 'high' ? 'text-destructive border-destructive/30' : 'text-warning border-warning/30'
                                    }`}>
                                      {latestEmail.urgency_level === 'high' ? '🔴' : '🟡'} {latestEmail.urgency_level}
                                    </Badge>
                                  )}
                                  {hasSummary && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-success border-success/30">
                                      <Sparkles className="h-2.5 w-2.5 mr-0.5" /> AI
                                    </Badge>
                                  )}
                                  {hasDraft && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-accent border-accent/30 bg-accent/5">
                                      <MessageSquare className="h-2.5 w-2.5 mr-0.5 text-accent" /> Draft
                                    </Badge>
                                  )}
                                  {latestEmail.status === 'replied' && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-info border-info/30 bg-info/5">
                                      <Reply className="h-2.5 w-2.5 mr-0.5 text-info" /> Replied
                                    </Badge>
                                  )}
                                  {isNonEmptyArray(latestEmail.attachments) && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-foreground/75 border-primary/20 bg-primary/5">
                                      <Paperclip className="h-2.5 w-2.5 mr-0.5 text-primary" /> {latestEmail.attachments.length}
                                    </Badge>
                                  )}
                                  {latestEmail.status === 'archived' && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-border/20 bg-muted/10">
                                      <Archive className="h-2.5 w-2.5 mr-0.5" /> Archived
                                    </Badge>
                                  )}
                                  {isThreaded && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleThread(threadKey);
                                      }}
                                      aria-label={isExpanded ? 'Collapse thread' : 'Expand thread'}
                                      className="ml-auto rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_14px_hsl(var(--primary)/0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                    >
                                      {isExpanded ? (
                                        <ChevronUp className="h-4 w-4" />
                                      ) : (
                                        <ChevronDown className="h-4 w-4" />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {/* Expanded Thread Emails */}
                          {isThreaded && isExpanded && (
                            <div className="border-l-2 border-l-primary/20 bg-background/30">
                              {threadEmails.map((email, index) => (
                                <div
                                  key={email.id}
                                  onClick={() => handleSelectEmail(email)}
                                  className={`group/thread border-t border-border/45 py-3 pl-8 pr-4 cursor-pointer transition-colors hover:bg-primary/5 ${
                                    selectedEmail?.id === email.id ? 'border-l-2 border-l-primary bg-primary/10' : ''
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-[linear-gradient(135deg,hsl(var(--primary)/0.14),hsl(var(--muted)/0.32))] shadow-sm ring-1 ring-primary/10 transition-transform group-hover/thread:scale-[1.03]">
                                      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-primary">
                                        {getSenderInitials(email.sender)}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
                                      <span title={extractSenderName(email.sender)} className={`truncate text-xs ${email.status === 'unread' ? 'font-semibold text-foreground' : 'text-foreground/75'}`}>
                                        {extractSenderName(email.sender)}
                                      </span>
                                      {email.summary && (
                                        <Sparkles className="h-3 w-3 text-success flex-shrink-0" />
                                      )}
                                      {email.draft_reply && (
                                        <MessageSquare className="h-3 w-3 text-accent flex-shrink-0" />
                                      )}
                                      {isNonEmptyArray(email.attachments) && (
                                        <Paperclip className="h-3 w-3 text-primary flex-shrink-0" />
                                      )}
                                    </div>
                                    <span className="flex-shrink-0 whitespace-nowrap pl-2 text-[10px] font-medium text-muted-foreground/80">
                                      {formatEmailDate(email.received_at)}
                                    </span>
                                  </div>
                                  <p title={email.body?.replace(/\n/g, ' ')} className="mt-1 truncate pl-8 text-xs text-muted-foreground/85">
                                    {email.body?.slice(0, 50).replace(/\n/g, ' ')}…
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              // Sent view - shows both synced sent emails AND manually sent replies
              <>
                {filteredEmails.length === 0 && filteredSentReplies.length === 0 ? (
                  <div className="m-4 rounded-[1.75rem] border border-dashed border-success/25 bg-[linear-gradient(135deg,hsl(var(--card)/0.76),hsl(var(--background)/0.58))] p-8 text-center shadow-inner shadow-sm dark:shadow-black/10">
                    <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-success/20 bg-success/10">
                      <Send className="h-7 w-7 text-success/55" />
                    </span>
                    <p className="text-sm font-semibold text-foreground">
                      {hasMoreEmails && searchQuery ? 'No matches in the emails loaded so far' : 'No sent emails'}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {hasMoreEmails
                        ? 'Search covers what has been loaded. Load more below to search further back.'
                        : 'Emails you send will appear here'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 p-3">
                    {/* Show synced sent emails from Outlook */}
                    {filteredEmails.map((email) => (
                      <div
                        key={email.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open sent email to ${email.to_recipients?.[0] || 'Unknown'}: ${email.subject || '(No Subject)'}`}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
                        onClick={() => {
                          handleSelectEmail(email);
                          setSelectedSentReply(null);
                        }}
                        className={`group cursor-pointer rounded-2xl border border-border/55 border-l-4 px-4 py-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-l-green-500/60 hover:border-success/25 hover:bg-success/5 hover:shadow-[0_14px_32px_hsl(142_71%_45%/0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/35 ${
                          selectedEmail?.id === email.id ? 'border-l-green-500 border-success/35 bg-success/10 ring-1 ring-success/20' : 'border-l-green-500/25 bg-card/70'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-success/25 bg-[linear-gradient(135deg,hsl(var(--success)/0.12),hsl(var(--muted)/0.32))] shadow-sm ring-1 ring-success/10">
                            <Send className="h-4 w-4 text-success" />
                          </div>
                          
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <span className="text-sm font-medium truncate">
                                To: {email.to_recipients?.[0] || 'Unknown'}
                                {email.to_recipients?.length > 1 && ` +${email.to_recipients.length - 1}`}
                              </span>
                              <span className="text-xs text-muted-foreground flex-shrink-0">
                                {formatEmailDate(email.received_at)}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                              {email.subject || '(No Subject)'}
                            </p>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {email.body?.slice(0, 80).replace(/\n/g, ' ')}…
                            </p>
                            <div className="flex items-center gap-1.5 mt-2">
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-primary border-primary/30">
                                <CheckCircle className="h-2.5 w-2.5 mr-0.5" /> Sent
                              </Badge>
                              {isNonEmptyArray(email.attachments) && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-foreground/75 border-primary/20 bg-primary/5">
                                  <Paperclip className="h-2.5 w-2.5 mr-0.5 text-primary" /> {email.attachments.length}
                                </Badge>
                              )}
                              {isNonEmptyArray(email.cc_recipients) && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  CC: {email.cc_recipients.length}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {/* Show manually sent replies from the dashboard */}
                    {filteredSentReplies.map((reply) => (
                      <div
                        key={`reply-${reply.id}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open sent reply to ${reply.recipient}: ${reply.subject || '(No Subject)'}`}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
                        onClick={() => {
                          setSelectedSentReply(reply);
                          setSelectedEmail(null);
                          if (isMobile) setShowMobileDetail(true);
                        }}
                        className={`group cursor-pointer rounded-2xl border border-border/55 border-l-4 px-4 py-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-l-green-500/60 hover:border-success/25 hover:bg-success/5 hover:shadow-[0_14px_32px_hsl(142_71%_45%/0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/35 ${
                          selectedSentReply?.id === reply.id ? 'border-l-green-500 border-success/35 bg-success/10 ring-1 ring-success/20' : 'border-l-green-500/25 bg-card/70'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-success/25 bg-[linear-gradient(135deg,hsl(var(--success)/0.12),hsl(var(--muted)/0.32))] shadow-sm ring-1 ring-success/10">
                            <Send className="h-4 w-4 text-success" />
                          </div>
                          
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <span className="text-sm font-medium truncate">
                                To: {reply.recipient}
                              </span>
                              <span className="text-xs text-muted-foreground flex-shrink-0">
                                {formatEmailDate(reply.sent_at)}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                              {reply.subject || '(No Subject)'}
                            </p>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {reply.body?.slice(0, 80).replace(/\n/g, ' ')}…
                            </p>
                            <div className="flex items-center gap-1.5 mt-2">
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-success border-success/30">
                                <CheckCircle className="h-2.5 w-2.5 mr-0.5" /> Sent via Copilot
                              </Badge>
                              {isNonEmptyArray(reply.attachments) && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-foreground/75 border-success/25 bg-success/5">
                                  <Paperclip className="h-2.5 w-2.5 mr-0.5 text-success" /> {reply.attachments.length}
                                </Badge>
                              )}
                              {isNonEmptyArray(reply.cc_recipients) && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  CC: {reply.cc_recipients.length}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/*
              One Load more, drawn for BOTH views and OUTSIDE the empty-state
              branch.
              
              It used to live inside the inbox list's `else`, so a search that
              matched nothing in the page already loaded rendered "No matching
              emails — try adjusting your filters" with no way to look further,
              while the match sat on page four of a 7,980-message mailbox. The
              advice was wrong and the only control that could have proved it
              wrong was hidden by the same condition. Sent never had the button
              at all, so that view could not page past its first load however
              many sent messages existed.
            */}
            {hasMoreEmails && (
              <div className="p-4 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMoreEmails}
                  disabled={isLoadingMore}
                  className="w-full rounded-full border-primary/20 bg-background/70 shadow-sm transition-all hover:border-primary/45 hover:bg-primary/5 disabled:bg-muted/40"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading more emails...
                    </>
                  ) : (
                    <>Load more emails ({emails.length} loaded)</>
                  )}
                </Button>
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Resizable Drag Handle */}
        {!isMobile && (
          <div
            className="group relative w-2 flex-shrink-0 cursor-col-resize bg-gradient-to-b from-transparent via-border/70 to-transparent transition-all hover:bg-primary/10"
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingRef.current = true;
              dragStartXRef.current = e.clientX;
              dragStartWidthRef.current = listPanelWidth;
            }}
          >
            <div className="absolute inset-y-4 left-1/2 w-px -translate-x-1/2 rounded-full bg-border/80 transition-colors group-hover:bg-primary/50" />
          </div>
        )}

        {/* Email Detail Panel - Full screen overlay on mobile */}
        <div role="region" aria-label="Email detail panel" className={`${isMobile ? 'absolute inset-0 z-50' : 'flex-1 min-w-0 basis-0'} min-h-0 overflow-hidden flex flex-col bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.08),transparent_34%),hsl(var(--background)/0.38)] ${isMobile && !showMobileDetail ? 'hidden' : ''}`}>
          {viewMode === 'sent' && selectedSentReply ? (
            // Sent Reply Detail View
            <>
              <div className="shrink-0 px-6 py-4 bg-background border-b">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    {isMobile && (
                      <Button variant="ghost" size="icon" onClick={handleMobileBack} className="mr-2 -ml-2">
                        <ArrowLeft className="h-5 w-5" />
                      </Button>
                    )}
                    <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
                      <Send className="h-5 w-5 text-success" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">{selectedSentReply.subject || '(No Subject)'}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm font-medium">To:</span>
                        <span className="text-sm text-muted-foreground">{selectedSentReply.recipient}</span>
                      </div>
                      {isNonEmptyArray(selectedSentReply.cc_recipients) && (
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/70">CC:</span>
                          <span>{toStringArray(selectedSentReply.cc_recipients).join(', ')}</span>
                        </div>
                      )}
                      {isNonEmptyArray(selectedSentReply.bcc_recipients) && (
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/70">BCC:</span>
                          <span>{toStringArray(selectedSentReply.bcc_recipients).join(', ')}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>{formatFullDate(selectedSentReply.sent_at)}</span>
                        <span className="text-muted-foreground/50">•</span>
                        <span>{formatDistanceToNow(new Date(selectedSentReply.sent_at), { addSuffix: true })}</span>
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-success border-success/30 bg-success/10">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Sent
                  </Badge>
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1 overscroll-contain [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
                <div className="min-w-0 space-y-4 p-4 md:p-6">
                  {/* Attachments Section */}
                  {isNonEmptyArray(selectedSentReply.attachments) && (
                    <div className="bg-muted/30 rounded-lg p-4">
                      <Label className="text-xs uppercase text-muted-foreground font-semibold mb-3 block">
                        Attachments ({selectedSentReply.attachments.length})
                      </Label>
                      <div className="space-y-2">
                        {toObjectArray(selectedSentReply.attachments).map((attachment, index) => (
                          <div 
                            key={index}
                            className="flex items-center gap-3 p-2 bg-background rounded-lg border"
                          >
                            <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                              {attachment.contentType?.startsWith('image/') ? (
                                <ImageIcon className="h-4 w-4 text-primary" />
                              ) : (
                                <FileIcon className="h-4 w-4 text-primary" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{attachment.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {attachment.size < 1024 
                                  ? `${attachment.size} B`
                                  : attachment.size < 1024 * 1024
                                    ? `${(attachment.size / 1024).toFixed(1)} KB`
                                    : `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`
                                }
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="bg-card/90 rounded-2xl border border-border/70 p-6 shadow-xl shadow-sm dark:shadow-black/10">
                    <RichTextBody 
                      content={selectedSentReply.body}
                      className="prose prose-sm max-w-none dark:prose-invert"
                    />
                  </div>
                </div>
              </ScrollArea>
            </>
          ) : selectedEmail ? (
            <>
              {/* Email Header */}
              <div className="shrink-0 border-b border-primary/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.86)_56%,hsl(var(--primary)/0.045))] px-4 py-4 shadow-[0_14px_36px_hsl(var(--background)/0.16)] md:px-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-3 md:gap-4">
                    {isMobile && (
                      <Button variant="ghost" size="icon" onClick={handleMobileBack} className="-ml-1 shrink-0 rounded-full border border-primary/10 bg-background/45">
                        <ArrowLeft className="h-5 w-5" />
                      </Button>
                    )}
                    {!isMobile && (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.28),hsl(var(--primary)/0.12)_58%,hsl(var(--card)/0.92))] shadow-[inset_0_1px_0_hsl(var(--background)/0.45),0_14px_32px_hsl(var(--primary)/0.14)] ring-1 ring-primary/20">
                        <span className="text-base font-black uppercase tracking-[0.16em] text-primary drop-shadow-sm">
                          {getSenderInitials(selectedEmail.sender)}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-2">
                      <h2 title={selectedEmail.subject || '(No Subject)'} className="line-clamp-2 text-lg font-bold leading-snug tracking-[-0.02em] text-foreground md:text-xl">{selectedEmail.subject || '(No Subject)'}</h2>
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:gap-2">
                        <span title={extractSenderName(selectedEmail.sender)} className="min-w-0 truncate text-sm font-bold text-foreground md:text-[0.95rem]">{extractSenderName(selectedEmail.sender)}</span>
                        {!isMobile && <span title={selectedEmail.sender} className="min-w-0 max-w-full truncate rounded-full border border-border/60 bg-background/45 px-2 py-0.5 text-xs text-muted-foreground md:max-w-[22rem]">&lt;{selectedEmail.sender}&gt;</span>}
                        {isNonEmptyArray(selectedEmail.attachments) && (
                          <Badge variant="outline" className="h-5 rounded-full border-primary/25 bg-primary/5 px-2 text-[10px] font-semibold text-primary">
                            <Paperclip className="mr-1 h-2.5 w-2.5" /> {selectedEmail.attachments.length}
                          </Badge>
                        )}
                      </div>
                      {/* To Recipients */}
                      {isNonEmptyArray(selectedEmail.to_recipients) && (
                        <div className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
                          <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-foreground/60">To:</span>
                          <span className="min-w-0 truncate" title={toStringArray(selectedEmail.to_recipients).join(', ')}>{toStringArray(selectedEmail.to_recipients).join(', ')}</span>
                        </div>
                      )}
                      {/* CC Recipients */}
                      {isNonEmptyArray(selectedEmail.cc_recipients) && (
                        <div className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
                          <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-foreground/60">CC:</span>
                          <span className="min-w-0 truncate" title={toStringArray(selectedEmail.cc_recipients).join(', ')}>{toStringArray(selectedEmail.cc_recipients).join(', ')}</span>
                        </div>
                      )}
                      {/* BCC Recipients */}
                      {isNonEmptyArray(selectedEmail.bcc_recipients) && (
                        <div className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
                          <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-foreground/60">BCC:</span>
                          <span className="min-w-0 truncate" title={toStringArray(selectedEmail.bcc_recipients).join(', ')}>{toStringArray(selectedEmail.bcc_recipients).join(', ')}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5 text-primary/70" />
                        <span className="text-foreground/70">{formatFullDate(selectedEmail.received_at)}</span>
                        <span className="text-muted-foreground/50">•</span>
                        <span>{formatDistanceToNow(new Date(selectedEmail.received_at), { addSuffix: true })}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 rounded-2xl border border-border/55 bg-background/35 p-2 shadow-sm xl:max-w-[24rem] xl:justify-end">
                    <EmailClientAssignment
                      emailId={selectedEmail.id}
                      currentClientId={selectedEmail.client_id}
                      currentClientName={selectedEmail.client_name}
                      onAssignmentChange={(clientId, clientName) => {
                        // Update local state
                        setSelectedEmail(prev => prev ? { ...prev, client_id: clientId, client_name: clientName } : null);
                        setEmails(prev => prev.map(e => 
                          e.id === selectedEmail.id 
                            ? { ...e, client_id: clientId, client_name: clientName }
                            : e
                        ));
                      }}
                    />
                    {getStatusBadge(selectedEmail.status)}
                    {selectedEmail.urgency_level && getUrgencyBadge(selectedEmail.urgency_level)}
                    {selectedEmail.summary?.sentiment && selectedEmail.summary.sentiment !== 'neutral' && (
                      <Badge variant="outline" className={
                        selectedEmail.summary.sentiment === 'angry' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                        selectedEmail.summary.sentiment === 'negative' ? 'bg-warning/10 text-warning border-warning/20' :
                        'bg-success/10 text-success border-success/20'
                      }>
                        {selectedEmail.summary.sentiment === 'angry' ? '🔥' : selectedEmail.summary.sentiment === 'negative' ? '😟' : '😊'} {selectedEmail.summary.sentiment}
                      </Badge>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full border border-border/60 bg-card/50 hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_14px_hsl(var(--primary)/0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={handleArchiveEmail}>
                          <Archive className="h-4 w-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                        {canDeleteModule('email_copilot') && (
                          <DropdownMenuItem onClick={handleDeleteEmail} className="text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>

              {/* Email Content */}
              <ScrollArea className="min-h-0 flex-1 overscroll-contain [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
                <div className="min-w-0 space-y-6 p-4 md:p-6">
                  {/* Tier 4: Intelligence Panel */}
                  <EmailIntelligencePanel
                    email={{
                      id: selectedEmail.id,
                      sender: selectedEmail.sender,
                      subject: selectedEmail.subject,
                      body: selectedEmail.body,
                      received_at: selectedEmail.received_at,
                    }}
                    threadEmails={(() => {
                      const key = getThreadKey(selectedEmail.subject);
                      return emails
                        .filter(e => getThreadKey(e.subject) === key && e.id !== selectedEmail.id)
                        .slice(0, 6)
                        .map(e => ({ sender: e.sender, subject: e.subject, body: e.body, received_at: e.received_at }));
                    })()}
                    intelligence={selectedEmail.summary ? {
                      sentiment: selectedEmail.summary.sentiment,
                      category: selectedEmail.summary.category,
                      language: selectedEmail.summary.language,
                      urgencyLevel: selectedEmail.summary.urgencyLevel,
                    } : null}
                    onIntelligenceUpdate={(next) => {
                      setSelectedEmail(prev => prev ? {
                        ...prev,
                        urgency_level: next.urgencyLevel || prev.urgency_level,
                        summary: { ...(prev.summary || { tldr: '', keyPoints: [], requiredActions: [], urgencyLevel: 'low' }), ...next } as EmailSummary,
                      } : null);
                      setEmails(prev => prev.map(e => e.id === selectedEmail.id ? {
                        ...e,
                        urgency_level: next.urgencyLevel || e.urgency_level,
                        summary: { ...(e.summary || { tldr: '', keyPoints: [], requiredActions: [], urgencyLevel: 'low' }), ...next } as EmailSummary,
                      } : e));
                    }}
                  />

                  {/* Email Body */}
                  <div className="min-w-0 overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.88))] shadow-[0_18px_48px_hsl(var(--background)/0.18)]">
                    <div className="border-b border-border/55 bg-muted/20 px-5 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          <Mail className="h-3.5 w-3.5 text-primary/70" />
                          Email body
                        </div>
                        {/* Audit item 42 — read it in the whole window. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowBodyModal(true)}
                          aria-label="Expand email body"
                          className="h-8 shrink-0 gap-1.5 rounded-full text-xs hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                          Expand
                        </Button>
                      </div>
                    </div>
                    <div className="max-h-[min(62dvh,44rem)] overflow-auto overscroll-contain px-5 py-5 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] sm:px-7 sm:py-6">
                      <EmailBodyView
                        content={selectedEmail.body}
                        html={selectedEmail.body_html}
                        className="prose prose-sm max-w-none leading-7 text-foreground/90 dark:prose-invert prose-a:font-medium prose-a:text-primary prose-a:underline-offset-4 prose-a:break-words prose-p:my-3 prose-blockquote:rounded-2xl prose-blockquote:border-l-primary/45 prose-blockquote:bg-muted/35 prose-blockquote:px-4 prose-blockquote:py-3 prose-blockquote:text-muted-foreground prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:break-words prose-table:block prose-table:max-w-full prose-table:overflow-x-auto [&_*]:max-w-full [&_*]:break-words"
                      />
                    </div>
                  </div>

                  {/* Attachments Section */}
                  {isNonEmptyArray(selectedEmail.attachments) && (
                    <EmailAttachmentsList attachments={selectedEmail.attachments} />
                  )}

                  {/* AI Summary */}
                  {selectedEmail.summary && (
                    <div className="overflow-hidden rounded-[1.75rem] border border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.97),hsl(var(--primary)/0.045))] shadow-[0_18px_48px_hsl(var(--primary)/0.08)] transition-all hover:border-primary/35">
                      <div className="flex items-center justify-between gap-3 border-b border-primary/15 bg-primary/10 px-5 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-inner">
                            <Sparkles className="h-4 w-4 text-primary" />
                          </span>
                          <div className="min-w-0">
                            <span className="block text-sm font-bold text-foreground">AI Summary</span>
                            <span className="block text-xs text-muted-foreground">Generated insight for review</span>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setShowSummaryModal(true)} aria-label="View full AI summary" className="shrink-0 rounded-full hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_14px_hsl(var(--primary)/0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                          View Full Summary
                        </Button>
                      </div>
                      <div className="space-y-5 p-5">
                        <div className="rounded-2xl border border-border/55 bg-background/45 p-4">
                          <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">TL;DR</Label>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/85">{selectedEmail.summary.tldr}</p>
                        </div>
                        {toStringArray(selectedEmail.summary.keyPoints).length > 0 && (
                          <div className="rounded-2xl border border-border/55 bg-background/35 p-4">
                            <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Key Points</Label>
                            <ul className="mt-3 space-y-2">
                              {toStringArray(selectedEmail.summary.keyPoints).map((point, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm leading-6">
                                  <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                                  <span className="min-w-0 break-words text-foreground/85">{point}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {toStringArray(selectedEmail.summary.requiredActions).length > 0 && (
                          <div className="rounded-2xl border border-success/20 bg-success/5 p-4">
                            <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Required Actions</Label>
                            <ul className="mt-3 space-y-2">
                              {toStringArray(selectedEmail.summary.requiredActions).map((action, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm leading-6">
                                  <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
                                  <span className="min-w-0 break-words text-foreground/85">{action}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Draft Reply Preview */}
                  {selectedEmail.draft_reply && (
                    <div className="overflow-hidden rounded-[1.75rem] border border-brand-500/25 bg-[linear-gradient(135deg,hsl(var(--card)/0.97),hsl(43_74%_49%/0.055))] shadow-[0_18px_48px_hsl(43_74%_49%/0.10)] transition-all hover:border-brand-500/40">
                      <div className="flex items-center justify-between gap-3 border-b border-brand-500/20 bg-brand-500/10 px-5 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-brand-500/25 bg-brand-500/10 shadow-inner">
                            <MessageSquare className="h-4 w-4 text-brand-600" />
                          </span>
                          <div className="min-w-0">
                            <span className="block text-sm font-bold text-foreground">Draft Reply</span>
                            <span className="block text-xs text-brand-700 dark:text-brand-300">Review required before sending</span>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" aria-label="View and edit draft reply" className="shrink-0 rounded-full hover:bg-brand-500/10 hover:text-brand-700 hover:shadow-[0_0_16px_hsl(43_74%_49%/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/35 dark:hover:text-brand-300" onClick={() => {
                          setCurrentDraft(selectedEmail.draft_reply || '');
                          initializeReplyFields();
                          setShowDraftModal(true);
                        }}>
                          View & Edit Draft
                        </Button>
                      </div>
                      <div className="space-y-3 p-5">
                        <div className="flex items-start gap-2 rounded-2xl border border-brand-500/20 bg-brand-500/10 p-3 text-xs leading-5 text-brand-800 dark:text-brand-200">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>AI outputs are drafts. Review and edit before sending.</span>
                        </div>
                        <p className="line-clamp-4 whitespace-pre-wrap break-words rounded-2xl border border-border/55 bg-background/45 p-4 text-sm leading-6 text-foreground/85">
                          {selectedEmail.draft_reply}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Action Bar */}
              <div className="flex shrink-0 flex-col gap-3 border-t border-primary/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.86))] px-4 py-3 shadow-[0_-12px_30px_rgba(0,0,0,0.12)] md:flex-row md:items-center md:justify-between md:px-6 md:py-4">
                <div className="flex items-center gap-2 md:gap-3">
                  <Button 
                    onClick={handleSummarize} 
                    disabled={isSummarizing}
                    variant={selectedEmail.summary ? "outline" : "default"}
                    size={isMobile ? "sm" : "default"}
                    className="flex-1 rounded-full md:flex-none"
                  >
                    <Sparkles className={`h-4 w-4 mr-2 ${isSummarizing ? 'animate-pulse' : ''}`} />
                    {isSummarizing ? 'Summarizing...' : selectedEmail.summary ? 'Re-summarize' : 'Summarize'}
                  </Button>
                  <Button 
                    onClick={() => {
                      setCurrentDraft('');
                      setReplyContext('');
                      initializeReplyFields();
                      setShowDraftModal(true);
                    }} 
                    variant="outline"
                    size={isMobile ? "sm" : "default"}
                    className="flex-1 rounded-full border-brand-500/25 bg-brand-500/5 hover:bg-brand-500/10 md:flex-none"
                  >
                    <Reply className="h-4 w-4 mr-2 text-brand-600" />
                    {isMobile ? 'Reply' : (selectedEmail.draft_reply ? 'Compose New Reply' : 'Compose Reply')}
                  </Button>
                  <Button 
                    onClick={handleOpenForward}
                    variant="outline"
                    size={isMobile ? "sm" : "default"}
                    className="flex-1 rounded-full md:flex-none"
                  >
                    <Forward className="h-4 w-4 mr-2" />
                    Forward
                  </Button>
                </div>
                
                {/* Quick access buttons for existing summaries/drafts */}
                <div className="flex items-center gap-2">
                  {selectedEmail.summary && (
                    <Button 
                      variant="secondary" 
                      size="sm"
                      onClick={() => setShowSummaryModal(true)}
                      className="flex-1 rounded-full md:flex-none"
                    >
                      <Sparkles className="h-4 w-4 mr-2 text-primary" />
                      {isMobile ? 'Summary' : 'View Summary'}
                    </Button>
                  )}
                  {selectedEmail.draft_reply && (
                    <Button 
                      variant="secondary" 
                      size="sm"
                      onClick={handleOpenEditDraft}
                      className="flex-1 rounded-full border border-brand-500/20 bg-brand-500/10 text-brand-800 hover:bg-brand-500/15 dark:text-brand-200 md:flex-none"
                    >
                      <MessageSquare className="h-4 w-4 mr-2 text-brand-600" />
                      {isMobile ? 'Edit Draft' : 'View & Edit Draft'}
                    </Button>
                  )}
                </div>

                {/* Smart Quick-Reply Chips */}
                {(quickReplies.length > 0 || loadingQuickReplies) && selectedEmail.status !== 'replied' && (
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-primary" /> Quick reply
                    </span>
                    {loadingQuickReplies ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-2 py-1">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        <span className="text-[11px] font-medium text-muted-foreground">Preparing reply options...</span>
                        <div className="h-5 w-20 animate-pulse rounded-full bg-primary/10" />
                        <div className="h-5 w-24 animate-pulse rounded-full bg-primary/10" />
                      </div>
                    ) : (
                      quickReplies.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setCurrentDraft(q + '\n\nKind regards');
                            initializeReplyFields();
                            setShowDraftModal(true);
                          }}
                          className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-primary/10"
                        >
                          {q}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="relative flex flex-1 items-center justify-center overflow-hidden p-6 sm:p-8">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,hsl(var(--primary)/0.09),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.45),transparent_45%,hsl(var(--primary)/0.035))]" />
              <div className="pointer-events-none absolute left-4 top-1/2 hidden -translate-y-1/2 items-center gap-2 rounded-full border border-primary/10 bg-card/45 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/55 shadow-sm lg:flex">
                <ArrowLeft className="h-3.5 w-3.5" />
                Inbox
              </div>
              <div className="relative max-w-md text-center" aria-live="polite">
                <div className="rounded-[2rem] border border-dashed border-primary/25 bg-[linear-gradient(135deg,hsl(var(--card)/0.86),hsl(var(--background)/0.72)_58%,hsl(var(--primary)/0.055))] px-8 py-10 shadow-[0_24px_70px_hsl(var(--primary)/0.11)] ring-1 ring-primary/10 sm:px-12 sm:py-14">
                  <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-[1.75rem] border border-primary/20 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.24),hsl(var(--primary)/0.10)_58%,hsl(var(--card)/0.92))] shadow-[inset_0_1px_0_hsl(var(--background)/0.5),0_18px_40px_hsl(var(--primary)/0.13)] ring-1 ring-primary/15">
                    <Mail className="h-11 w-11 text-primary/60 drop-shadow-sm" />
                  </div>
                  <p className="text-xl font-bold tracking-[-0.02em] text-foreground">
                    {viewMode === 'sent' ? 'Select a sent email' : 'Select an email'}
                  </p>
                  <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                    {viewMode === 'sent' ? 'Choose a sent email from the list to view details' : 'Choose an email from the list to view details'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Email Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Email Manually</DialogTitle>
            <DialogDescription>
              Paste email content to process with AI
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="sender">From (Email Address) *</Label>
              <Input
                id="sender"
                placeholder="sender@example.com"
                value={newEmail.sender}
                onChange={(e) => setNewEmail({ ...newEmail, sender: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="subject">Subject *</Label>
              <Input
                id="subject"
                placeholder="Email subject"
                value={newEmail.subject}
                onChange={(e) => setNewEmail({ ...newEmail, subject: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="received">Received Date</Label>
              <Input
                id="received"
                type="date"
                value={newEmail.received_at}
                onChange={(e) => setNewEmail({ ...newEmail, received_at: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="body">Email Body *</Label>
              <Textarea
                id="body"
                placeholder="Paste the email content here..."
                className="h-40"
                value={newEmail.body}
                onChange={(e) => setNewEmail({ ...newEmail, body: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button onClick={handleAddEmail}>Add Email</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Draft Reply Modal */}
      <Dialog open={showDraftModal} onOpenChange={(open) => {
        setShowDraftModal(open);
        if (!open) {
          setReplyContext('');
          setReplyCc('');
          setReplyBcc('');
          seededReplyForEmailId.current = null;
        }
      }}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-3 overflow-hidden rounded-[1.75rem] border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--background)/0.92)_58%,hsl(43_74%_49%/0.045))] p-3 shadow-[0_24px_80px_hsl(var(--background)/0.35)] sm:max-h-[90vh] sm:w-full sm:p-6 lg:max-w-4xl lg:p-7 xl:max-w-5xl">
          <DialogHeader className="border-b border-primary/10 pb-3 pr-10">
            <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap">
              <div className="flex-1 min-w-0">
                <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-brand-500/25 bg-brand-500/10">
                    <MessageSquare className="h-4 w-4 text-brand-600" />
                  </span>
                  <span className="truncate">Compose Reply</span>
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs sm:text-sm">
                  Review recipients, edit your message, then send or copy
                </DialogDescription>
              </div>
              {selectedEmail && (
                <div className="shrink-0 max-w-full">
                  <EmailClientAssignment
                    emailId={selectedEmail.id}
                    currentClientId={selectedEmail.client_id}
                    currentClientName={selectedEmail.client_name}
                    onAssignmentChange={(clientId, clientName) => {
                      setSelectedEmail(prev => prev ? { ...prev, client_id: clientId, client_name: clientName } : null);
                      setEmails(prev => prev.map(e =>
                        e.id === selectedEmail.id ? { ...e, client_id: clientId, client_name: clientName } : e
                      ));
                    }}
                  />
                </div>
              )}
            </div>
          </DialogHeader>
          
          <ScrollArea className="min-h-0 flex-1 -mr-2 overscroll-contain pr-2 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] sm:pr-4">
            <div className="space-y-3 sm:space-y-4">
              {/* Email Recipients Section */}
              <div className="space-y-2 rounded-2xl border border-border/60 bg-background/45 p-3 shadow-sm sm:space-y-3 sm:p-4">
                {/* From Field - Non-editable */}
                <div className="grid grid-cols-[44px_1fr] sm:grid-cols-[60px_1fr] gap-2 items-center">
                  <Label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-sm">From:</Label>
                  <div className="flex h-9 items-center truncate rounded-xl border border-border/70 bg-muted/40 px-3 text-xs text-muted-foreground sm:text-sm">
                    {selectedMailbox === 'personal' && personalMailbox 
                      ? personalMailbox 
                      : 'Admin Mailbox'}
                  </div>
                </div>
                <div className="grid grid-cols-[44px_1fr] sm:grid-cols-[60px_1fr] gap-2 items-center">
                  <Label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-sm">To:</Label>
                  <Input
                    value={replyTo}
                    aria-label="Reply recipient"
                    onChange={(e) => setReplyTo(e.target.value)}
                    placeholder="name@example.com, second@example.com"
                    className="h-9 rounded-xl border-border/70 bg-background/70 text-xs focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)] sm:text-sm"
                  />
                </div>
                <div className="grid grid-cols-[44px_1fr] sm:grid-cols-[60px_1fr] gap-2 items-center">
                  <Label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-sm">Subject:</Label>
                  <Input
                    value={replySubject}
                    aria-label="Reply subject"
                    onChange={(e) => setReplySubject(e.target.value)}
                    placeholder="Email subject"
                    className="h-9 rounded-xl border-border/70 bg-background/70 text-xs focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)] sm:text-sm"
                  />
                </div>
                <div className="grid grid-cols-[44px_1fr] sm:grid-cols-[60px_1fr] gap-2 items-center">
                  <Label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-sm">CC:</Label>
                  <Input
                    value={replyCc}
                    aria-label="Reply CC recipients"
                    onChange={(e) => setReplyCc(e.target.value)}
                    placeholder="cc@example.com, another@example.com"
                    className="h-9 rounded-xl border-border/70 bg-background/70 text-xs focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)] sm:text-sm"
                  />
                </div>
                <div className="grid grid-cols-[44px_1fr] sm:grid-cols-[60px_1fr] gap-2 items-center">
                  <Label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-sm">BCC:</Label>
                  <Input
                    value={replyBcc}
                    aria-label="Reply BCC recipients"
                    onChange={(e) => setReplyBcc(e.target.value)}
                    placeholder="bcc@example.com, another@example.com"
                    className="h-9 rounded-xl border-border/70 bg-background/70 text-xs focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)] sm:text-sm"
                  />
                </div>
              </div>

              {/* AI Reply Assistant */}
              {selectedEmail && (
                <AIReplyAssistant
                  email={{
                    sender: selectedEmail.sender,
                    subject: selectedEmail.subject,
                    body: selectedEmail.body,
                    received_at: selectedEmail.received_at,
                  }}
                  emailId={selectedEmail.id}
                  linkedPropertyAddress={selectedEmail.linked_property_address}
                  threadEmails={(() => {
                    const key = getThreadKey(selectedEmail.subject);
                    return emails
                      .filter(e => getThreadKey(e.subject) === key && e.id !== selectedEmail.id)
                      .slice(0, 4)
                      .map(e => ({ sender: e.sender, subject: e.subject, body: e.body, received_at: e.received_at }));
                  })()}
                  draft={currentDraft}
                  onDraftChange={setCurrentDraft}
                  onInitialiseFields={initializeReplyFields}
                  isRecording={isRecording}
                  isTranscribing={isTranscribing}
                  onStartRecording={startRecording}
                  onStopRecording={stopRecording}
                  composerRef={composerTextareaRef}
                />
              )}
              
              <Separator />
              
              {/* Attachments Section with Drag & Drop */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Attachments</Label>
                <input
                  type="file"
                  ref={replyFileInputRef}
                  onChange={handleReplyFileSelect}
                  multiple
                  className="hidden"
                />
                <div
                  onDragOver={(e) => handleDragOver(e, setReplyDragActive)}
                  onDragLeave={(e) => handleDragLeave(e, setReplyDragActive)}
                  onDrop={(e) => handleDrop(e, (files) => setReplyAttachments(prev => [...prev, ...files]), setReplyDragActive)}
                  onClick={() => replyFileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Add reply attachments"
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); replyFileInputRef.current?.click(); } }}
                  className={`cursor-pointer rounded-2xl border-2 border-dashed p-5 text-center transition-all ${
                    replyDragActive 
                      ? 'border-primary bg-primary/10 shadow-inner' 
                      : 'border-muted-foreground/25 bg-background/45 hover:border-primary/45 hover:bg-primary/5 hover:shadow-[0_0_18px_hsl(var(--primary)/0.10)]'
                  }`}
                >
                  <Upload className="mx-auto mb-2 h-6 w-6 text-primary/70" />
                  <p className="text-sm text-muted-foreground">
                    Drag & drop files here or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Max 10MB per file
                  </p>
                </div>
                {replyAttachments.length > 0 && (
                  <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-2">
                    {replyAttachments.map((file, index) => (
                      <div key={index} className="flex items-center justify-between rounded-xl bg-background p-2 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{file.name}</span>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            ({formatFileSize(file.size)})
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); removeReplyAttachment(index); }}
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <Separator />
              
              {/* Draft Content */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Message Body</Label>
                  <span className="text-[10px] text-muted-foreground">
                    {currentDraft.trim() ? `${currentDraft.trim().split(/\s+/).length} words` : 'Tip: select text then use Improve'}
                  </span>
                </div>
                <ComposerTextarea
                  textareaRef={composerTextareaRef}
                  value={currentDraft}
                  onChange={setCurrentDraft}
                  snippets={snippets}
                  onManageSnippets={() => setShowSnippetManager(true)}
                  className="h-[250px] resize-none rounded-2xl border-border/70 bg-background/80 font-sans text-sm leading-6 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)] lg:h-[340px] xl:h-[400px]"
                  placeholder="Draft reply will appear here..."
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      if (currentDraft && replyTo && !isSendingEmail) handleSendClick();
                    }
                  }}
                />
                {(isSendingEmail || isDrafting) && (
                  <div className="mt-2 flex items-center gap-2 rounded-2xl border border-brand-500/20 bg-brand-500/10 px-3 py-2 text-xs text-brand-800 dark:text-brand-200">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" />
                    <span>{isSendingEmail ? 'Sending only after confirmation...' : 'Generating a draft for human review...'}</span>
                  </div>
                )}
                <div className="mt-2">
                  <RecipientSanityWarning
                    to={replyTo}
                    cc={replyCc}
                    bcc={replyBcc}
                    expectedDomain={selectedEmail?.sender?.split('@')[1] || null}
                    bodyText={currentDraft}
                    attachmentCount={replyAttachments.length}
                  />
                </div>
                <div className="mt-2"><AttachmentSummary files={replyAttachments.map(f => ({ name: f.name, size: f.size }))} /></div>
              </div>
            </div>
          </ScrollArea>
          
          <DialogFooter className="flex-col gap-2 border-t border-primary/10 pt-3 sm:flex-row sm:justify-between sm:gap-3 sm:pt-4">
            <p className="hidden items-center gap-1 rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1.5 text-xs text-brand-800 dark:text-brand-200 sm:flex">
              <AlertCircle className="h-3.5 w-3.5 text-brand-400" />
              Review carefully before sending
            </p>
            <div className="flex gap-1.5 sm:gap-2 flex-wrap justify-end w-full sm:w-auto">
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setShowDraftModal(false)}>
                Cancel
              </Button>
              <Button variant="outline" size="sm" className="rounded-full" onClick={handleCopyDraft}>
                <Copy className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Copy</span>
              </Button>
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setShowFollowUp(true)}>
                <Bell className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Remind me</span>
              </Button>
              <ScheduleSendButton
                disabled={isSendingEmail || !currentDraft || !replyTo}
                buildPayload={async () => {
                  const ccList = parseEmailList(replyCc);
                  const bccList = parseEmailList(replyBcc);
                  const attachmentsData = await Promise.all(
                    replyAttachments.map(async (file) => ({
                      name: file.name,
                      contentType: file.type || 'application/octet-stream',
                      contentBytes: await fileToBase64(file),
                    })),
                  );
                  return {
                    recipient: replyTo,
                    cc_recipients: ccList,
                    bcc_recipients: bccList,
                    subject: replySubject,
                    body: currentDraft,
                    attachments: attachmentsData,
                    mailbox_source: selectedMailbox,
                    original_email_id: selectedEmail?.id,
                  };
                }}
                onScheduled={() => { refreshScheduled(); setShowDraftModal(false); }}
              />
              <Button 
                onClick={handleSendClick} 
                size="sm"
                disabled={isSendingEmail || !currentDraft || !replyTo}
                className="bg-success hover:bg-success"
              >
                <Send className="h-4 w-4 mr-2" />
                Send Reply
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Confirmation Dialog */}
      <Dialog open={showSendConfirmModal} onOpenChange={setShowSendConfirmModal}>
        {/*
          448px (`max-w-md`) for a dialog that lists From/To/CC/BCC/Subject,
          the attachments and a preview of the message is what the 19 Sep audit
          called "the window overall is too narrow"; the footer fell out of the
          box below it because the shell was bounded at 85dvh and told not to
          clip. The shell now scrolls (see `dialog.tsx`) and the preview has a
          bound of its own — it was `line-clamp-4`, which silently hides the
          rest of what is about to be sent irreversibly.
        */}
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-success" />
              Confirm Send
            </DialogTitle>
            <DialogDescription>
              Please review the email details before sending
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 py-4">
            <div className="p-3 bg-muted/50 rounded-lg space-y-2">
              <div className="flex gap-2">
                <span className="text-sm font-medium w-16">From:</span>
                <span className="text-sm text-muted-foreground flex-1">
                  {selectedMailbox === 'personal' && personalMailbox 
                    ? personalMailbox 
                    : 'Admin Mailbox'}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-sm font-medium w-16">To:</span>
                <span className="text-sm text-muted-foreground flex-1">{replyTo}</span>
              </div>
              {replyCc && (
                <div className="flex gap-2">
                  <span className="text-sm font-medium w-16">CC:</span>
                  <span className="text-sm text-muted-foreground flex-1">{replyCc}</span>
                </div>
              )}
              {replyBcc && (
                <div className="flex gap-2">
                  <span className="text-sm font-medium w-16">BCC:</span>
                  <span className="text-sm text-muted-foreground flex-1">{replyBcc}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-sm font-medium w-16">Subject:</span>
                <span className="text-sm text-muted-foreground flex-1 truncate">{replySubject}</span>
              </div>
            </div>
            
            {replyAttachments.length > 0 && (
              <div className="p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Attachments ({replyAttachments.length}):</p>
                <div className="flex flex-wrap gap-1">
                  {replyAttachments.map((file, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      <Paperclip className="h-3 w-3 mr-1" />
                      {file.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Message preview:</p>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm">
                {currentDraft}
              </p>
            </div>
            
            <div className="flex items-center gap-2 p-2 bg-brand-500/10 border border-brand-500/20 rounded-lg">
              <AlertCircle className="h-4 w-4 text-brand-600 flex-shrink-0" />
              <p className="text-xs text-brand-700">
                This action cannot be undone. The email will be sent from your connected Outlook account.
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendConfirmModal(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => handleSendEmail()}
              disabled={isSendingEmail}
              className="bg-success hover:bg-success"
            >
              {isSendingEmail ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {isSendingEmail ? 'Sending...' : 'Confirm & Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Summary Preview Modal */}
      <Dialog open={showSummaryModal} onOpenChange={setShowSummaryModal}>
        <DialogContent className="flex max-h-[min(86dvh,760px)] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Summary
            </DialogTitle>
            <DialogDescription>
              AI-generated summary of the email
            </DialogDescription>
          </DialogHeader>
          {selectedEmail?.summary && (
            <ScrollArea className="min-h-0 max-h-[55dvh] overscroll-contain [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
              <div className="space-y-6 pr-4">
                <div>
                  <Label className="text-xs uppercase text-muted-foreground font-semibold">TL;DR</Label>
                  <p className="text-sm mt-2 p-3 bg-muted/50 rounded-lg">{selectedEmail.summary.tldr}</p>
                </div>
                
                {toStringArray(selectedEmail.summary.keyPoints).length > 0 && (
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground font-semibold">Key Points</Label>
                    <ul className="mt-2 space-y-2">
                      {toStringArray(selectedEmail.summary.keyPoints).map((point, i) => (
                        <li key={i} className="text-sm flex items-start gap-2 p-2 bg-muted/30 rounded-lg">
                          <ChevronRight className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {toStringArray(selectedEmail.summary.requiredActions).length > 0 && (
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground font-semibold">Required Actions</Label>
                    <ul className="mt-2 space-y-2">
                      {toStringArray(selectedEmail.summary.requiredActions).map((action, i) => (
                        <li key={i} className="text-sm flex items-start gap-2 p-2 bg-success/10 rounded-lg">
                          <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                <div>
                  <Label className="text-xs uppercase text-muted-foreground font-semibold">Urgency Level</Label>
                  <div className="mt-2">
                    {getUrgencyBadge(selectedEmail.summary.urgencyLevel)}
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSummaryModal(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compose New Email Modal */}
      <Dialog open={showComposeModal} onOpenChange={(open) => {
        setShowComposeModal(open);
        if (!open) {
          setComposeEmail({ to: '', subject: '', body: '', cc: '', bcc: '' });
        }
      }}>
        <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-2xl flex-col overflow-hidden rounded-[1.75rem] border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--background)/0.92)_58%,hsl(var(--primary)/0.045))] p-4 shadow-[0_24px_80px_hsl(var(--background)/0.35)] sm:h-[min(90dvh,900px)] sm:max-h-[min(90dvh,900px)] sm:overflow-hidden sm:p-6 lg:max-w-3xl">
          <DialogHeader className="border-b border-primary/10 pb-3">
            <DialogTitle className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                <Mail className="h-4 w-4 text-primary" />
              </span>
              Compose New Email
            </DialogTitle>
            <DialogDescription>
              Create and send a new email from scratch
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="min-h-0 flex-1 overscroll-contain pr-4 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] [&>[data-radix-scroll-area-viewport]]:!block [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!w-full">
            <div className="w-full min-w-0 max-w-full space-y-4">

              {/* Email Recipients Section */}
              <div className="space-y-3 rounded-2xl border border-border/60 bg-background/45 p-4 shadow-sm">
                <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                  <Label className="whitespace-nowrap text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">To: *</Label>
                  <Input
                    value={composeEmail.to}
                    aria-label="Recipient email address"
                    onChange={(e) => setComposeEmail({ ...composeEmail, to: e.target.value })}
                    placeholder="name@example.com, second@example.com"
                    className="h-9 rounded-xl border-border/70 bg-background/70 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]"
                  />
                </div>
                <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                  <Label className="whitespace-nowrap text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">Subject:</Label>
                  <Input
                    value={composeEmail.subject}
                    aria-label="Email subject"
                    onChange={(e) => setComposeEmail({ ...composeEmail, subject: e.target.value })}
                    placeholder="Email subject"
                    className="h-9 rounded-xl border-border/70 bg-background/70 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]"
                  />
                </div>
                <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                  <Label className="whitespace-nowrap text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">CC:</Label>
                  <Input
                    value={composeEmail.cc}
                    aria-label="CC recipients"
                    onChange={(e) => setComposeEmail({ ...composeEmail, cc: e.target.value })}
                    placeholder="cc@example.com, another@example.com"
                    className="h-9 rounded-xl border-border/70 bg-background/70 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]"
                  />
                </div>
                <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                  <Label className="whitespace-nowrap text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">BCC:</Label>
                  <Input
                    value={composeEmail.bcc}
                    aria-label="BCC recipients"
                    onChange={(e) => setComposeEmail({ ...composeEmail, bcc: e.target.value })}
                    placeholder="bcc@example.com, another@example.com"
                    className="h-9 rounded-xl border-border/70 bg-background/70 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]"
                  />
                </div>
              </div>
              
              {/* Attachments Section with Drag & Drop */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Attachments</Label>
                <input
                  type="file"
                  ref={composeFileInputRef}
                  onChange={handleComposeFileSelect}
                  multiple
                  className="hidden"
                />
                <div
                  onDragOver={(e) => handleDragOver(e, setComposeDragActive)}
                  onDragLeave={(e) => handleDragLeave(e, setComposeDragActive)}
                  onDrop={(e) => handleDrop(e, (files) => setComposeAttachments(prev => [...prev, ...files]), setComposeDragActive)}
                  onClick={() => composeFileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Add compose attachments"
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); composeFileInputRef.current?.click(); } }}
                  className={`cursor-pointer rounded-2xl border-2 border-dashed p-5 text-center transition-all ${
                    composeDragActive 
                      ? 'border-primary bg-primary/10 shadow-inner' 
                      : 'border-muted-foreground/25 bg-background/45 hover:border-primary/45 hover:bg-primary/5 hover:shadow-[0_0_18px_hsl(var(--primary)/0.10)]'
                  }`}
                >
                  <Upload className="mx-auto mb-2 h-6 w-6 text-primary/70" />
                  <p className="text-sm text-muted-foreground">
                    Drag & drop files here or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Max 10MB per file
                  </p>
                </div>
                {/* QA PDF Attachment Badge (from Aurixa Intelligence Hub) */}
                {qaPDFAttachment && (
                  <div className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 to-primary/5 p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                        <div className="rounded-xl bg-primary/20 p-2 flex-shrink-0">
                          <FileIcon className="h-6 w-6 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="min-w-0 flex-1 truncate font-medium text-sm" title={qaPDFAttachment.fileName}>{qaPDFAttachment.fileName}</p>
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-primary/30 text-primary flex-shrink-0">
                              From Q&A
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {(qaPDFAttachment.fileSize / 1024).toFixed(1)} KB • Attached and ready to send
                          </p>
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setQaPDFAttachment(null);
                          // Also remove from composeAttachments if it's the QA PDF
                          setComposeAttachments(prev => 
                            prev.filter(f => f.name !== qaPDFAttachment.fileName)
                          );
                        }}
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
                {/* Other Attachments (excluding QA PDF if already shown above) */}
                {composeAttachments.filter(f => !qaPDFAttachment || f.name !== qaPDFAttachment.fileName).length > 0 && (
                  <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-2">
                    {composeAttachments
                      .filter(f => !qaPDFAttachment || f.name !== qaPDFAttachment.fileName)
                      .map((file, index) => {
                        // Find the original index for removal
                        const originalIndex = composeAttachments.findIndex(f2 => f2 === file);
                        return (
                          <div key={index} className="flex w-full min-w-0 max-w-full items-center justify-between gap-2 overflow-hidden rounded-xl bg-background p-2 text-sm">
                            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                              <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
                              <span className="text-xs text-muted-foreground flex-shrink-0">
                                ({formatFileSize(file.size)})
                              </span>
                            </div>

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); removeComposeAttachment(originalIndex); }}
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
              
              {/* Email Body */}
              <div className="rounded-2xl border border-primary/15 bg-background/60 p-3 shadow-sm">
                <Label className="mb-2 block text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Message Body *
                </Label>
                <ComposerTextarea
                  value={composeEmail.body}
                  onChange={(v) => setComposeEmail({ ...composeEmail, body: v })}
                  snippets={snippets}
                  onManageSnippets={() => setShowSnippetManager(true)}
                  className="min-h-[320px] w-full resize-y rounded-xl border-2 border-border bg-background text-sm leading-6 text-foreground shadow-inner focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]"
                  placeholder="Type your email message here..."
                />

                <div className="mt-2">
                  <RecipientSanityWarning
                    to={composeEmail.to}
                    cc={composeEmail.cc}
                    bcc={composeEmail.bcc}
                    expectedDomain={null}
                    bodyText={composeEmail.body}
                    attachmentCount={composeAttachments.length}
                    onApplyFix={(from, to) => setComposeEmail(prev => ({ ...prev, to: prev.to.replace(from, to), cc: prev.cc.replace(from, to), bcc: prev.bcc.replace(from, to) }))}
                  />
                </div>
                <div className="mt-2"><AttachmentSummary files={composeAttachments.map(f => ({ name: f.name, size: f.size }))} /></div>
              </div>
            </div>
          </ScrollArea>
          
          <DialogFooter className="flex-col gap-3 border-t border-primary/10 pt-4 sm:flex-row sm:justify-between">
            <p className="flex items-center gap-1 rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1.5 text-xs text-brand-800 dark:text-brand-200">
              <AlertCircle className="h-3.5 w-3.5 text-brand-400" />
              Review carefully before sending
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" className="rounded-full" onClick={() => setShowComposeModal(false)}>
                Cancel
              </Button>
              <ScheduleSendButton
                disabled={isComposing || !composeEmail.to || !composeEmail.body}
                buildPayload={async () => {
                  const ccList = parseEmailList(composeEmail.cc);
                  const bccList = parseEmailList(composeEmail.bcc);
                  const attachmentsData = await Promise.all(
                    composeAttachments.map(async (file) => ({
                      name: file.name,
                      contentType: file.type || 'application/octet-stream',
                      contentBytes: await fileToBase64(file),
                    })),
                  );
                  return {
                    recipient: composeEmail.to,
                    cc_recipients: ccList,
                    bcc_recipients: bccList,
                    subject: composeEmail.subject || '(No Subject)',
                    body: composeEmail.body,
                    attachments: attachmentsData,
                    mailbox_source: selectedMailbox,
                  };
                }}
                onScheduled={() => { refreshScheduled(); setShowComposeModal(false); setComposeEmail({ to: '', subject: '', body: '', cc: '', bcc: '' }); setComposeAttachments([]); }}
              />
              <Button 
                onClick={handleSendComposedEmail} 
                disabled={isComposing || !composeEmail.to || !composeEmail.body}
                className="rounded-full bg-success shadow-lg shadow-success/10 hover:bg-success"
              >
                {isComposing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending safely...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Email
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Draft Modal - Enhanced with Send capability and recipient fields */}
      <Dialog open={showEditDraftModal} onOpenChange={setShowEditDraftModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-accent" />
              Edit Draft Reply
            </DialogTitle>
            <DialogDescription>
              Edit your draft and send directly, or save for later
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="min-h-0 flex-1 overscroll-contain pr-4 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
            <div className="space-y-4">
              {/* Recipient Fields */}
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
                <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                  <Label className="text-sm text-muted-foreground">To:</Label>
                  <Input
                    value={replyTo}
                    aria-label="Reply recipient"
                    onChange={(e) => setReplyTo(e.target.value)}
                    placeholder="name@example.com, second@example.com"
                    className="h-8"
                  />
                </div>
                <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                  <Label className="text-sm text-muted-foreground">Subject:</Label>
                  <Input
                    value={replySubject}
                    aria-label="Reply subject"
                    onChange={(e) => setReplySubject(e.target.value)}
                    placeholder="Email subject"
                    className="h-8"
                  />
                </div>
                <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                  <Label className="text-sm text-muted-foreground">CC:</Label>
                  <Input
                    value={replyCc}
                    aria-label="Reply CC recipients"
                    onChange={(e) => setReplyCc(e.target.value)}
                    placeholder="cc@example.com, another@example.com"
                    className="h-8"
                  />
                </div>
                <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                  <Label className="text-sm text-muted-foreground">BCC:</Label>
                  <Input
                    value={replyBcc}
                    aria-label="Reply BCC recipients"
                    onChange={(e) => setReplyBcc(e.target.value)}
                    placeholder="bcc@example.com, another@example.com"
                    className="h-8"
                  />
                </div>
              </div>
              
              {/* Draft Body */}
              <div>
                <Label className="text-sm font-medium mb-2 block">Message Body</Label>
                <Textarea
                  value={editableDraft}
                  onChange={(e) => setEditableDraft(e.target.value)}
                  className="h-[300px] resize-none font-sans text-sm"
                  placeholder="Edit your draft reply or compose a new message..."
                />
              </div>
            </div>
          </ScrollArea>
          
          <DialogFooter className="flex-col gap-3 sm:flex-row sm:justify-between border-t pt-4">
            <p className="text-xs text-brand-100/90 flex items-center gap-2">
              <span>{editableDraft.length} characters</span>
              {replyTo && <span className="text-success">• Ready to send</span>}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowEditDraftModal(false)}>
                Cancel
              </Button>
              <Button 
                variant="secondary"
                onClick={handleSaveEditedDraft} 
                disabled={isSavingDraft || !editableDraft.trim()}
              >
                {isSavingDraft ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Save Draft
                  </>
                )}
              </Button>
              <Button 
                onClick={async () => {
                  if (!editableDraft.trim() || !replyTo) {
                    toast.error('Please fill in recipient and message body');
                    return;
                  }
                  // Save the draft first, then use it to send
                  setCurrentDraft(editableDraft);
                  setShowEditDraftModal(false);
                  setShowSendConfirmModal(true);
                }}
                disabled={!editableDraft.trim() || !replyTo || !replyTo.includes('@')}
                className="bg-success hover:bg-success"
              >
                <Send className="h-4 w-4 mr-2" />
                Send Now
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Forward Email Modal */}
      <Dialog open={showForwardModal} onOpenChange={(open) => {
        setShowForwardModal(open);
        if (!open) {
          setForwardAttachments([]);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Forward className="h-5 w-5 text-info" />
              Forward Email
            </DialogTitle>
            <DialogDescription>
              Forward this email to another recipient
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="min-h-0 flex-1 overscroll-contain pr-4 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
            <div className="space-y-4">
              {/* Recipients Section */}
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
                <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                  <Label className="text-sm text-muted-foreground">To: *</Label>
                  <Input
                    value={forwardTo}
                    onChange={(e) => setForwardTo(e.target.value)}
                    placeholder="name@example.com, second@example.com"
                    className="h-8"
                  />
                </div>
                <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                  <Label className="text-sm text-muted-foreground">CC:</Label>
                  <Input
                    value={forwardCc}
                    onChange={(e) => setForwardCc(e.target.value)}
                    placeholder="cc@example.com, another@example.com"
                    className="h-8"
                  />
                </div>
                <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                  <Label className="text-sm text-muted-foreground">BCC:</Label>
                  <Input
                    value={forwardBcc}
                    onChange={(e) => setForwardBcc(e.target.value)}
                    placeholder="bcc@example.com, another@example.com"
                    className="h-8"
                  />
                </div>
              </div>
              
              {/* Attachments Section with Drag & Drop */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Attachments {forwardAttachments.length > 0 && `(${forwardAttachments.length})`}
                </Label>
                <input
                  type="file"
                  ref={forwardFileInputRef}
                  onChange={handleForwardFileSelect}
                  multiple
                  className="hidden"
                />
                <div
                  onDragOver={(e) => handleDragOver(e, setForwardDragActive)}
                  onDragLeave={(e) => handleDragLeave(e, setForwardDragActive)}
                  onDrop={(e) => handleDrop(e, (files) => setForwardAttachments(prev => [...prev, ...files]), setForwardDragActive)}
                  onClick={() => forwardFileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                    forwardDragActive 
                      ? 'border-primary bg-primary/5' 
                      : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                  }`}
                >
                  <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Drag & drop files here or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Original attachments are included. Max 10MB per file.
                  </p>
                </div>
                {forwardAttachments.length > 0 && (
                  <div className="space-y-2 p-2 bg-muted/30 rounded-lg max-h-32 overflow-y-auto">
                    {forwardAttachments.map((file, index) => (
                      <div key={index} className="flex items-center justify-between text-sm p-2 bg-background rounded">
                        <div className="flex items-center gap-2 min-w-0">
                          <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{file.name}</span>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            ({formatFileSize(file.size)})
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); removeForwardAttachment(index); }}
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Email Body */}
              <div>
                <Label className="text-sm font-medium mb-2 block">Message</Label>
                <Textarea
                  value={forwardBody}
                  onChange={(e) => setForwardBody(e.target.value)}
                  className="h-[250px] resize-none font-sans text-sm"
                  placeholder="Add a message before the forwarded content (optional)..."
                />
              </div>
            </div>
          </ScrollArea>
          
          <DialogFooter className="flex-col gap-3 sm:flex-row sm:justify-between border-t pt-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5 text-brand-400" />
              Forwarding with {forwardAttachments.length} attachment(s)
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowForwardModal(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleSendForward} 
                disabled={isForwarding || !forwardTo}
                className="bg-info hover:bg-info"
              >
                {isForwarding ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Forwarding...
                  </>
                ) : (
                  <>
                    <Forward className="h-4 w-4 mr-2" />
                    Forward Email
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Personal Mailbox Settings Modal */}
      <MailboxSettingsModal 
        open={showMailboxSettings}
        onOpenChange={setShowMailboxSettings}
        currentMailbox={personalMailbox}
        onMailboxUpdated={(newMailbox) => {
          setPersonalMailbox(newMailbox);
          if (newMailbox) {
            toast.success('Personal mailbox configured successfully');
          }
        }}
      />

      <SnippetManagerDialog
        open={showSnippetManager}
        onOpenChange={setShowSnippetManager}
        snippets={snippets}
        onChanged={refreshSnippets}
      />
      {/*
        Audit item 42 — the email body, in the whole window.

        The SAME `EmailBodyView` with the SAME prose classes as the panel, so
        the expanded reading cannot become a second rendering of the message
        that differs from the one beside it. A flex column with the scroll on
        the body means a long email scrolls inside the dialog rather than
        pushing its own header off the top.
      */}
      <Dialog open={showBodyModal} onOpenChange={setShowBodyModal}>
        <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-5xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="pr-8 text-left text-base leading-6">
              {selectedEmail?.subject || '(No subject)'}
            </DialogTitle>
            <DialogDescription className="text-left">
              {selectedEmail?.sender}
              {selectedEmail?.received_at ? ` — ${formatEmailDate(selectedEmail.received_at)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-1 py-2 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
            {selectedEmail && (
              <EmailBodyView
                content={selectedEmail.body}
                html={selectedEmail.body_html}
                className="prose prose-sm max-w-none leading-7 text-foreground/90 dark:prose-invert prose-a:font-medium prose-a:text-primary prose-a:underline-offset-4 prose-a:break-words prose-p:my-3 prose-blockquote:rounded-2xl prose-blockquote:border-l-primary/45 prose-blockquote:bg-muted/35 prose-blockquote:px-4 prose-blockquote:py-3 prose-blockquote:text-muted-foreground prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:break-words prose-table:block prose-table:max-w-full prose-table:overflow-x-auto [&_*]:max-w-full [&_*]:break-words"
              />
            )}
          </div>
          {/* Expanding an email used to be a dead end — it showed the message
              and offered nothing to do with it, so the operator had to close
              the window to act. The same three acts the reading pane offers
              are here, on the message they are looking at. */}
          {selectedEmail && (
            <DialogFooter className="shrink-0 flex-col gap-2 border-t pt-3 sm:flex-row sm:justify-end">
              <Button
                onClick={() => { setShowBodyModal(false); handleSummarize(); }}
                disabled={isSummarizing}
                variant={selectedEmail.summary ? 'outline' : 'default'}
                className="rounded-full"
              >
                <Sparkles className={`mr-2 h-4 w-4 ${isSummarizing ? 'animate-pulse' : ''}`} />
                {selectedEmail.summary ? 'Re-summarize' : 'Summarize'}
              </Button>
              <Button
                onClick={() => {
                  setShowBodyModal(false);
                  setCurrentDraft('');
                  setReplyContext('');
                  initializeReplyFields();
                  setShowDraftModal(true);
                }}
                variant="outline"
                className="rounded-full border-brand-500/25 bg-brand-500/5 hover:bg-brand-500/10"
              >
                <Reply className="mr-2 h-4 w-4 text-brand-600" />
                Compose Reply
              </Button>
              <Button
                onClick={() => { setShowBodyModal(false); handleOpenForward(); }}
                variant="outline"
                className="rounded-full"
              >
                <Forward className="mr-2 h-4 w-4" />
                Forward
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ScheduledSendsDialog
        open={showScheduledList}
        onOpenChange={setShowScheduledList}
        items={scheduledSends}
        onChanged={refreshScheduled}
      />
      <FollowUpReminderDialog
        open={showFollowUp}
        onOpenChange={setShowFollowUp}
        defaultTitle={selectedEmail ? `Follow up: ${selectedEmail.subject}` : 'Follow up on email'}
        defaultDescription={selectedEmail ? `Re: ${selectedEmail.sender}` : ''}
        clientId={selectedEmail?.client_id || null}
      />
    </div>
  );
}

// Mailbox Settings Modal Component
function MailboxSettingsModal({ 
  open, 
  onOpenChange, 
  currentMailbox,
  onMailboxUpdated 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
  currentMailbox: string | null;
  onMailboxUpdated: (mailbox: string | null) => void;
}) {
  const [mailboxValue, setMailboxValue] = useState(currentMailbox || '');
  const [isSaving, setIsSaving] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [accountRole, setAccountRole] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    setMailboxValue(currentMailbox || '');
  }, [currentMailbox, open]);

  // Fetch the caller's own account email so we can lock the input to it —
  // matches the server-side ownership guard in admin-user-management.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingProfile(true);
    invokeSecureFunction('admin-user-management', { action: 'get_own_profile' })
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.success) {
          setAccountEmail(data.user?.email || null);
          setAccountRole(data.user?.role || null);
        }
      })
      .finally(() => { if (!cancelled) setLoadingProfile(false); });
    return () => { cancelled = true; };
  }, [open]);

  const isSuperadmin = accountRole === 'superadmin';
  const lockedToOwnEmail = !!accountEmail && !isSuperadmin;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Non-superadmins can only bind their own account email.
      const trimmed = lockedToOwnEmail ? (accountEmail || '') : mailboxValue.trim();
      if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        toast.error('Please enter a valid email address');
        setIsSaving(false);
        return;
      }

      const { data, error } = await invokeSecureFunction('admin-user-management', {
        action: 'update_own_mailbox',
        personal_mailbox: trimmed || null,
      });

      if (error) {
        toast.error(error.message || 'Failed to update mailbox');
        return;
      }

      if (data?.success) {
        const { data: profile } = await invokeSecureFunction('admin-user-management', {
          action: 'get_own_profile',
        });
        const persisted = profile?.success ? (profile.user?.personal_mailbox || null) : (trimmed || null);
        onMailboxUpdated(persisted);
        toast.success(persisted ? 'Personal mailbox saved' : 'Personal mailbox cleared');
        onOpenChange(false);
      } else {
        toast.error(data?.error || 'Failed to update mailbox');
      }
    } catch (err) {
      console.error('Failed to update mailbox:', err);
      toast.error('Failed to update mailbox');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configure Personal Mailbox
          </DialogTitle>
          <DialogDescription>
            {lockedToOwnEmail
              ? 'For security, you can only connect the mailbox that matches your account email.'
              : 'Enter your personal Microsoft 365 email address to sync emails from your own mailbox.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="personal-mailbox">Personal Email Address</Label>
            <Input
              id="personal-mailbox"
              type="email"
              placeholder={loadingProfile ? 'Loading…' : 'your.email@company.com'}
              value={lockedToOwnEmail ? (accountEmail || '') : mailboxValue}
              onChange={(e) => setMailboxValue(e.target.value)}
              disabled={lockedToOwnEmail || loadingProfile}
              readOnly={lockedToOwnEmail}
            />
            <p className="text-xs text-muted-foreground">
              {lockedToOwnEmail
                ? 'Locked to your account email. Ask a superadmin to link a different address on your behalf.'
                : 'This email must be part of the same Microsoft 365 organization.'}
            </p>
          </div>
        </div>


        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Mailbox'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
