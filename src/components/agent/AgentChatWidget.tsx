import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MessageSquare, X, Plus, Trash2, Send, Check, XCircle, Loader2, ChevronLeft, Pencil, RotateCcw, Sparkles, Diamond, BarChart3, Calendar, Zap, TrendingUp, Target, FileDown, Brain, Bell, Settings, Users, Share2, ClipboardList, Clock, Shield, ChevronRight, Info, Play, HelpCircle, ArrowRight, Paperclip, File, Image as ImageIcon, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InternalMessagesPanel } from '@/components/agent/InternalMessagesPanel';
import { OPEN_INTERNAL_MESSAGES_EVENT, onInternalMessage, setInternalMessagesPanelOpen } from '@/lib/internalMessagingBus';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { VoiceToTextButton } from '@/components/ui/VoiceToTextButton';
import { SearchInput } from '@/components/ui/search-input';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { streamSecureFunction } from '@/lib/streamSecureFunction';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { secureStorageUpload } from '@/hooks/useSecureStorage';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AgentMessageRenderer } from '@/components/agent/AgentMessageRenderer';
import { MemoryCitations, type RecalledMemory } from '@/components/agent/MemoryCitations';
import { AurixaMark } from '@/components/agent/AurixaMark';

import { extractFileContent, formatFilesForAgent, ACCEPTED_EXTENSIONS, type ExtractedFile } from '@/lib/agentFileExtractor';

const ROTATING_PLACEHOLDERS = [
  'Ask Aurixa anything…',
  'Draft a client email…',
  'Plan tomorrow\u2019s briefing…',
  'What moved in my pipeline?',
  'Summarise this week\u2019s wins…',
];

// Consistent color palette for sender attribution in collaborative conversations
const SENDER_COLORS = [
  'text-info dark:text-info',
  'text-success dark:text-success',
  'text-warning dark:text-warning',
  'text-primary dark:text-accent',
  'text-destructive dark:text-destructive',
  'text-info dark:text-info',
  'text-brand-600 dark:text-brand-400',
  'text-primary/80 dark:text-accent',
];

function getSenderColor(senderId: string, senderMap: Map<string, number>): string {
  if (!senderMap.has(senderId)) {
    senderMap.set(senderId, senderMap.size);
  }
  return SENDER_COLORS[senderMap.get(senderId)! % SENDER_COLORS.length];
}

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  shared?: boolean;
  shared_by?: string;
  shared_by_me?: boolean;
  shared_with_username?: string;
  permission?: string;
  handoff_note?: string;
}

type SidebarTab = 'mine' | 'shared_with_me' | 'shared_by_me';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: any[];
  requires_confirmation?: boolean;
  confirmation_status?: 'pending' | 'approved' | 'rejected';
  created_at: string;
  sent_by?: string | null;
  sent_by_username?: string;
  recalled_memory_ids?: string[];
  recalled_memories?: RecalledMemory[];
}

type PanelView = 'chat' | 'notifications' | 'settings' | 'share' | 'messages';
type SettingsTab = 'playbooks' | 'tasks' | 'audit';

export function AgentChatWidget() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [internalUnread, setInternalUnread] = useState(0);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('mine');
  const [sharedByMeConversations, setSharedByMeConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingConvoId, setEditingConvoId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<PanelView>('chat');
  const [notifCount, setNotifCount] = useState(0);
  const [notifications, setNotifications] = useState<any>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('playbooks');
  const [settingsData, setSettingsData] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [shareTargets, setShareTargets] = useState<string[]>([]);
  const [shareNote, setShareNote] = useState('');
  const [sharePermission, setSharePermission] = useState<'view' | 'collaborate'>('view');
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [extractedFiles, setExtractedFiles] = useState<ExtractedFile[]>([]);
  const [extractingFiles, setExtractingFiles] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [skills, setSkills] = useState<Array<{ id: string; slug: string; name: string; icon?: string | null; system_prompt?: string; is_public?: boolean }>>([]);
  const [activeSkillSlug, setActiveSkillSlug] = useState<string | null>(() => {
    try { return localStorage.getItem('aurixa_active_skill') || null; } catch { return null; }
  });
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  // Rotate composer placeholder while idle for signature "living" feel.
  useEffect(() => {
    if (loading || input.length > 0) return;
    const id = window.setInterval(
      () => setPlaceholderIdx((i) => (i + 1) % ROTATING_PLACEHOLDERS.length),
      4000
    );
    return () => window.clearInterval(id);
  }, [loading, input.length]);

  // Auto-resize textarea when input changes (covers voice transcription + typing)
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
  }, [input]);
  const editInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    if (!user) return;
    setLoadingConvos(true);
    try {
      const { data } = await invokeSecureFunction('ai-dashboard-agent', { action: 'list-conversations' });
      if (data?.conversations) {
        const own = (data.conversations || []).map((c: any) => ({ ...c, shared: false }));
        const shared = (data.shared_conversations || []).map((c: any) => ({ ...c, shared: true }));
        setConversations([...own, ...shared]);
        const byMe = (data.shared_by_me_conversations || []).map((c: any) => ({ ...c, shared_by_me: true }));
        setSharedByMeConversations(byMe);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
    setLoadingConvos(false);
  }, [user]);

  // Load notifications
  const loadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await invokeSecureFunction('ai-dashboard-agent', { action: 'get-notifications' });
      if (data) {
        setNotifCount(data.total_notifications || 0);
        setNotifications(data);
      }
    } catch (err) { console.error('Notif error:', err); }
  }, [user]);

  useEffect(() => {
    if (isOpen && user) {
      loadConversations();
      loadNotifications();
    }
  }, [isOpen, user, loadConversations, loadNotifications]);

  // Listen for external requests to open a specific conversation (e.g. from notification bell)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setIsOpen(true);
      if (detail?.conversationId) {
        setActiveConversation(detail.conversationId);
        setShowSidebar(false);
      }
      if (detail?.tab) {
        setSidebarTab(detail.tab);
      }
      loadConversations();
    };
    window.addEventListener('open-agent-conversation', handler);
    return () => window.removeEventListener('open-agent-conversation', handler);
  }, [loadConversations]);

  // Open straight into internal team messages (from a message pop-up alert)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setIsOpen(true);
      setPendingThreadId(detail?.threadId ?? null);
      setPanelView('messages');
    };
    window.addEventListener(OPEN_INTERNAL_MESSAGES_EVENT, handler);
    return () => window.removeEventListener(OPEN_INTERNAL_MESSAGES_EVENT, handler);
  }, []);

  // Let the pop-up alert surface know when the user is already reading messages.
  useEffect(() => {
    setInternalMessagesPanelOpen(isOpen && panelView === 'messages');
    return () => setInternalMessagesPanelOpen(false);
  }, [isOpen, panelView]);


  // Keep the orb badge fresh for internal messages even when the panel is closed.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const { data } = await invokeSecureFunction('internal-messaging', { action: 'list_threads' });
        if (cancelled) return;
        const total = (data?.threads ?? []).reduce(
          (sum: number, t: any) => sum + (t.unread || 0), 0,
        );
        setInternalUnread(total);
      } catch { /* badge stays as-is */ }
    };
    refresh();
    const off = onInternalMessage(() => refresh());
    const id = setInterval(refresh, 30_000);
    return () => { cancelled = true; off(); clearInterval(id); };
  }, [user]);



  // Poll notifications every 2 min
  useEffect(() => {
    if (!isOpen || !user) return;
    const interval = setInterval(loadNotifications, 120000);
    return () => clearInterval(interval);
  }, [isOpen, user, loadNotifications]);

  // Determine if current conversation is collaborative
  const isCollaborativeConvo = useMemo(() => {
    if (!activeConversation) return false;
    const conv = conversations.find(c => c.id === activeConversation);
    if (conv?.shared && conv?.permission === 'collaborate') return true;
    // Check if I shared it with collaborators
    const sharedOut = sharedByMeConversations.find(c => c.id === activeConversation);
    if (sharedOut?.permission === 'collaborate') return true;
    // Also check if any share exists for this convo
    return sharedByMeConversations.some(c => c.id === activeConversation) || (conv?.shared === true);
  }, [activeConversation, conversations, sharedByMeConversations]);

  // Load messages for active conversation
  useEffect(() => {
    if (!activeConversation) return;
    (async () => {
      try {
        const { data } = await invokeSecureFunction('ai-dashboard-agent', {
          action: 'get-messages',
          conversation_id: activeConversation,
        });
        if (data?.messages) setMessages(data.messages);
      } catch (err) {
        console.error('Failed to load messages:', err);
      }
    })();
  }, [activeConversation]);

  // Realtime subscription for collaborative conversations — live message sync
  useEffect(() => {
    if (!activeConversation || !isCollaborativeConvo) return;
    
    const channel = supabase
      .channel(`agent-messages-${activeConversation}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'agent_messages',
        filter: `conversation_id=eq.${activeConversation}`,
      }, async (payload) => {
        // When a new message arrives, check if it's from another user
        const newMsg = payload.new as any;
        if (newMsg.sent_by === user?.id && newMsg.role === 'user') return; // Skip own messages (already shown)
        
        // Refresh messages to get full data with username joins
        try {
          const { data } = await invokeSecureFunction('ai-dashboard-agent', {
            action: 'get-messages',
            conversation_id: activeConversation,
          });
          if (data?.messages) setMessages(data.messages);
        } catch (err) {
          console.error('Realtime message refresh failed:', err);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeConversation, isCollaborativeConvo, user?.id]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus edit input
  useEffect(() => {
    if (editingConvoId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingConvoId]);

  const filteredConversations = conversations.filter(c =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredSharedByMe = sharedByMeConversations.filter(c =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Derive counts for tab badges
  const ownConvos = filteredConversations.filter(c => !c.shared);
  const sharedWithMeConvos = filteredConversations.filter(c => c.shared);

  const createConversation = async () => {
    try {
      const { data } = await invokeSecureFunction('ai-dashboard-agent', { action: 'create-conversation' });
      if (data?.conversation) {
        setConversations(prev => [data.conversation, ...prev]);
        setActiveConversation(data.conversation.id);
        setMessages([]);
        setShowSidebar(false);
        setPanelView('chat');
        logActivityDirect({
          actionType: 'qa_conversation_created',
          entityType: 'qa_conversation',
          entityId: data.conversation.id,
          entityName: data.conversation.title,
          metadata: { source: 'agent_chat' }
        });
      }
    } catch (err) {
      toast.error('Failed to create conversation');
    }
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const conv = conversations.find(c => c.id === id);
      await invokeSecureFunction('ai-dashboard-agent', { action: 'delete-conversation', conversation_id: id });
      setConversations(prev => prev.filter(c => c.id !== id));
      logActivityDirect({
        actionType: 'qa_conversation_deleted',
        entityType: 'qa_conversation',
        entityId: id,
        entityName: conv?.title,
        metadata: { source: 'agent_chat' }
      });
      if (activeConversation === id) {
        setActiveConversation(null);
        setMessages([]);
        setShowSidebar(true);
      }
    } catch (err) {
      toast.error('Failed to delete conversation');
    }
  };

  const renameConversation = async (id: string) => {
    if (!editTitle.trim()) { setEditingConvoId(null); return; }
    try {
      await invokeSecureFunction('ai-dashboard-agent', { action: 'rename-conversation', conversation_id: id, title: editTitle.trim() });
      setConversations(prev => prev.map(c => c.id === id ? { ...c, title: editTitle.trim() } : c));
    } catch (err) { toast.error('Failed to rename conversation'); }
    setEditingConvoId(null);
  };

  // File attachment handlers
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    const maxFiles = 5;
    const newFiles = files.slice(0, maxFiles - attachedFiles.length);
    if (newFiles.length < files.length) {
      toast.info(`Max ${maxFiles} files per message. Only first ${newFiles.length} added.`);
    }
    
    // Extract each file individually so one failure doesn't break the rest
    setExtractingFiles(true);
    const successFiles: File[] = [];
    const successExtracted: ExtractedFile[] = [];
    
    for (const file of newFiles) {
      try {
        const extracted = await extractFileContent(file);
        successFiles.push(file);
        successExtracted.push(extracted);
      } catch (err: any) {
        console.error(`[Agent] Extraction failed for ${file.name}:`, err);
        toast.error(`Failed to process "${file.name}": ${err.message}`);
        // Skip this file — don't add to either array
      }
    }
    
    if (successFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...successFiles]);
      setExtractedFiles(prev => [...prev, ...successExtracted]);
    }
    
    setExtractingFiles(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
    setExtractedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const sendMessage = async (overrideMessage?: string) => {
    const msg = (overrideMessage || input).trim();
    if ((!msg && extractedFiles.length === 0) || loading) return;
    if (!overrideMessage) {
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }
    setRetryMessage(null);
    setLoading(true);
    setPanelView('chat');

    // Capture and clear attached files
    const filesToSend = [...extractedFiles];
    const rawFiles = [...attachedFiles];
    setAttachedFiles([]);
    setExtractedFiles([]);

    let convId = activeConversation;
    if (!convId) {
      try {
        const { data } = await invokeSecureFunction('ai-dashboard-agent', { action: 'create-conversation' });
        if (!data?.conversation) { setLoading(false); return; }
        convId = data.conversation.id;
        setConversations(prev => [data.conversation, ...prev]);
        setActiveConversation(convId);
        setShowSidebar(false);
      } catch (err) {
        toast.error('Failed to create conversation');
        setLoading(false);
        return;
      }
    }

    // Build display message (with file indicators)
    const fileIndicators = filesToSend.length > 0
      ? filesToSend.map(f => `📎 ${f.filename}`).join('\n') + '\n\n'
      : '';
    const displayContent = fileIndicators + msg;
    const tempUserMsg: Message = { id: `temp-${Date.now()}`, role: 'user', content: displayContent, created_at: new Date().toISOString(), sent_by: user?.id, sent_by_username: user?.username || 'You' };
    setMessages(prev => [...prev, tempUserMsg]);

    // Build agent message with file context
    const fileContext = formatFilesForAgent(filesToSend);
    const imageFiles = filesToSend.filter(f => f.isImage && f.base64Data);
    
    // Build the message to send to the agent
    // If only images are attached (no text context from documents), generate a descriptive fallback
    let agentMessage = msg;
    if (fileContext) {
      agentMessage = `${fileContext}\n\n${msg}`;
    }
    // Ensure message is never empty — the edge function requires it
    if (!agentMessage.trim()) {
      if (imageFiles.length > 0) {
        const imageNames = imageFiles.map(f => f.filename).join(', ');
        agentMessage = `[User attached ${imageFiles.length} image${imageFiles.length > 1 ? 's' : ''}: ${imageNames}. Please analyze the attached image${imageFiles.length > 1 ? 's' : ''}.]`;
      } else if (filesToSend.length > 0) {
        const fileNames = filesToSend.map(f => f.filename).join(', ');
        agentMessage = `[User attached ${filesToSend.length} file${filesToSend.length > 1 ? 's' : ''}: ${fileNames}. Please review the attached file${filesToSend.length > 1 ? 's' : ''}.]`;
      }
    }

    // Upload files to storage in background (don't block the message)
    if (rawFiles.length > 0 && user) {
      const finalConvId = convId;
      Promise.all(rawFiles.map(async (file, idx) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const storagePath = `agent-uploads/${user.id}/${timestamp}-${file.name}`;
        try {
          // Bound to the conversation this attachment belongs to. `secure-storage`
          // derives ownership from an authoritative row, and an agent
          // attachment belongs to a chat rather than to any client.
          await secureStorageUpload('client-files', storagePath, file, {
            upsert: true,
            resourceId: finalConvId,
          });
          // Index in DB
          await invokeSecureFunction('ai-dashboard-agent', {
            action: 'index-file-upload',
            conversation_id: finalConvId,
            filename: file.name,
            mime_type: filesToSend[idx]?.mimeType || file.type,
            file_size: file.size,
            storage_path: storagePath,
            extracted_text: filesToSend[idx]?.extractedText?.substring(0, 10000) || null,
            file_category: filesToSend[idx]?.category || 'general',
          });
        } catch (err) {
          console.warn('[Agent] Background file upload failed:', err);
        }
      })).catch(() => {});
    }

    try {
      const payload: any = { action: 'chat', conversation_id: convId, message: agentMessage };
      if (activeSkillSlug) payload.skill_slug = activeSkillSlug;
      const allImageAttachments: Array<{ filename: string; mime_type: string; base64: string }> = [];
      
      // Regular image files
      if (imageFiles.length > 0) {
        for (const f of imageFiles) {
          if (f.base64Data) {
            allImageAttachments.push({
              filename: f.filename,
              mime_type: f.mimeType,
              base64: f.base64Data,
            });
          }
        }
      }
      
      // Scanned PDF pages rendered as images
      for (const f of filesToSend) {
        if (f.pdfPageImages && f.pdfPageImages.length > 0) {
          for (const page of f.pdfPageImages) {
            allImageAttachments.push({
              filename: `${f.filename}_page${page.pageNumber}.png`,
              mime_type: 'image/png',
              base64: page.base64,
            });
          }
        }
      }
      
      if (allImageAttachments.length > 0) {
        payload.image_attachments = allImageAttachments;
      }
      const payloadStream: any = { ...payload, action: 'chat-stream' };
      const streamMsgId = `stream-${Date.now()}`;
      const streamMsg: Message = { id: streamMsgId, role: 'assistant', content: '', created_at: new Date().toISOString() };
      setMessages(prev => [...prev, streamMsg]);
      setStreamingId(streamMsgId);

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = '';
      let requiresConfirmation = false;
      let sawEvent = false;
      let streamError: string | null = null;

      try {
        for await (const evt of streamSecureFunction('ai-dashboard-agent', payloadStream, { signal: controller.signal })) {
          sawEvent = true;
          if (evt.event === 'token' && evt.data?.delta) {
            accumulated += evt.data.delta;
            setMessages(prev => prev.map(m => m.id === streamMsgId ? { ...m, content: accumulated } : m));
          } else if (evt.event === 'memories' && Array.isArray(evt.data?.items)) {
            const items: RecalledMemory[] = evt.data.items;
            setMessages(prev => prev.map(m => m.id === streamMsgId ? { ...m, recalled_memories: items, recalled_memory_ids: items.map(i => i.id) } : m));
          } else if (evt.event === 'tool') {
            if (evt.data?.phase === 'start') setActiveTool(evt.data.name);
            else if (evt.data?.phase === 'end') setActiveTool(null);
          } else if (evt.event === 'error') {
            streamError = evt.data?.message || 'Stream error';
          } else if (evt.event === 'done') {
            requiresConfirmation = Boolean(evt.data?.requires_confirmation);
          }
        }
      } catch (streamErr: any) {
        if (streamErr?.name === 'AbortError') {
          accumulated += '\n\n_Stopped._';
          setMessages(prev => prev.map(m => m.id === streamMsgId ? { ...m, content: accumulated } : m));
        } else {
          streamError = streamErr?.message || 'Network error';
        }
      } finally {
        abortRef.current = null;
        setStreamingId(null);
        setActiveTool(null);
      }

      if (streamError && !sawEvent) {
        setRetryMessage(msg);
        setMessages(prev => prev.filter(m => m.id !== streamMsgId).concat({ id: `error-${Date.now()}`, role: 'assistant', content: `⚠️ ${streamError}`, created_at: new Date().toISOString() }));
        toast.error(streamError);
      } else {
        // Refresh from server so partial stream text is replaced by the persisted
        // canonical message (with tool_calls / confirmation metadata attached).
        const { data: refreshed } = await invokeSecureFunction('ai-dashboard-agent', { action: 'get-messages', conversation_id: convId });
        if (refreshed?.messages) setMessages(refreshed.messages);
        loadConversations();
        if (panelView === 'settings') loadSettingsData(settingsTab);
        if (requiresConfirmation) {
          // no-op: confirmation buttons will render off the refreshed message metadata
        }
      }
    } catch (err: any) {
      setRetryMessage(msg);
      setMessages(prev => [...prev.filter(m => m.id !== tempUserMsg.id), tempUserMsg, { id: `error-${Date.now()}`, role: 'assistant', content: `⚠️ ${err.message || 'Network error'}`, created_at: new Date().toISOString() }]);
      toast.error(err.message || 'Failed to send message');
    }
    setLoading(false);
  };

  const stopStreaming = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  const handleConfirmAction = async (messageId: string, approved: boolean) => {
    setLoading(true);
    try {
      await invokeSecureFunction('ai-dashboard-agent', { action: 'confirm-action', conversation_id: activeConversation, message_id: messageId, approved });
      const { data } = await invokeSecureFunction('ai-dashboard-agent', { action: 'get-messages', conversation_id: activeConversation });
      if (data?.messages) setMessages(data.messages);
      toast.success(approved ? 'Action approved and executed' : 'Action cancelled');
      // Refresh settings panel after action approval (playbook/task creation etc.)
      if (approved && panelView === 'settings') loadSettingsData(settingsTab);
    } catch (err) { toast.error('Failed to process action'); }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // Settings data loaders
  const loadSettingsData = async (tab: SettingsTab) => {
    setSettingsData(null);
    try {
      const actionMap = { playbooks: 'get-playbooks-list', tasks: 'get-scheduled-tasks-list', audit: 'get-audit-log' };
      const { data } = await invokeSecureFunction('ai-dashboard-agent', { action: actionMap[tab] });
      setSettingsData(data);
    } catch (err) { console.error('Settings load error:', err); }
  };

  // Share conversation
  const handleShareConversation = async () => {
    if (shareTargets.length === 0 || !activeConversation) return;
    try {
      await invokeSecureFunction('ai-dashboard-agent', { action: 'share-conversation', target_user_names: shareTargets, conversation_id: activeConversation, handoff_note: shareNote.trim() || undefined, permission: sharePermission });
      toast.success(`Shared with ${shareTargets.length} team member${shareTargets.length > 1 ? 's' : ''} (${sharePermission})`);
      logActivityDirect({
        actionType: 'report_shared',
        entityType: 'qa_conversation',
        entityId: activeConversation,
        entityName: conversations.find(c => c.id === activeConversation)?.title,
        metadata: { shared_with: shareTargets, permission: sharePermission, source: 'agent_chat' }
      });
      setShareTargets([]);
      setShareNote('');
      setSharePermission('view');
      setPanelView('chat');
    } catch (err) { toast.error('Failed to share conversation'); }
  };

  // Load team members for sharing
  useEffect(() => {
    if (panelView === 'share' && teamMembers.length === 0) {
      invokeSecureFunction('ai-dashboard-agent', { action: 'get-team-members-list' })
        .then(({ data }) => { if (data?.team_members) setTeamMembers(data.team_members); })
        .catch(() => {});
    }
  }, [panelView]);

  // Load available skills (personas) once panel opens
  useEffect(() => {
    if (!isOpen || skills.length > 0) return;
    invokeSecureFunction('ai-dashboard-agent', { action: 'list-skills' })
      .then(({ data }) => { if (data?.skills) setSkills(data.skills); })
      .catch(() => {});
  }, [isOpen, skills.length]);

  const activeSkill = useMemo(
    () => skills.find(s => s.slug === activeSkillSlug) || null,
    [skills, activeSkillSlug]
  );

  const selectSkill = (slug: string | null) => {
    setActiveSkillSlug(slug);
    try {
      if (slug) localStorage.setItem('aurixa_active_skill', slug);
      else localStorage.removeItem('aurixa_active_skill');
    } catch {}
    setSkillPickerOpen(false);
  };


  if (!user) return null;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="group fixed bottom-[5.5rem] right-4 z-[55] flex h-14 w-14 items-center justify-center rounded-full transition-transform hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 md:bottom-6 md:right-6 md:z-40"
        aria-label="Open Aurixa"
        title="Ask Aurixa"
      >
        {/* Outer aurora glow ring */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full opacity-80 blur-[10px] transition-opacity group-hover:opacity-100"
          style={{
            background:
              'conic-gradient(from 180deg, hsl(var(--aurixa-aurora-1)/0.9), hsl(var(--aurixa-aurora-2)/0.8), hsl(var(--aurixa-aurora-3)/0.85), hsl(var(--aurixa-aurora-1)/0.9))',
            animation: 'aurixa-orb-spin 12s linear infinite',
          }}
        />
        {/* Inner glass disc */}
        <span
          aria-hidden
          className="absolute inset-[3px] rounded-full aurixa-glass"
        />
        <AurixaMark size="md" state={loading ? 'thinking' : 'idle'} className="relative z-10" />
        {notifCount + internalUnread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 z-20 flex h-5 min-w-5 items-center justify-center rounded-full border border-background bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground shadow-[0_0_0_2px_hsl(var(--background))]">
            {notifCount + internalUnread > 9 ? '9+' : notifCount + internalUnread}
          </span>
        )}

      </button>
    );
  }

  return (
    <div className="fixed bottom-[5.5rem] right-4 z-[60] flex flex-col overflow-hidden rounded-[20px] aurixa-glass animate-in slide-in-from-bottom-4 fade-in duration-300
      w-[calc(100vw-2rem)] max-w-[440px] h-[min(75vh,580px)]
      md:bottom-6 md:right-6 md:h-[min(85vh,640px)]">
      {/* Header */}
      <div className="relative flex items-center justify-between border-b border-[hsl(var(--aurixa-glass-border)/0.5)] px-4 py-3 shrink-0 bg-gradient-to-b from-[hsl(var(--aurixa-glass-bg)/0.6)] to-transparent">
        <div className="flex items-center gap-2.5 min-w-0">
          {!showSidebar && activeConversation && panelView === 'chat' && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowSidebar(true)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          {panelView !== 'chat' && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPanelView('chat')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <AurixaMark size="sm" state={loading ? 'thinking' : 'idle'} />
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-heading text-[15px] font-semibold tracking-tight text-foreground">Aurixa</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {/* Internal team messages */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 relative"
            onClick={() => { setPendingThreadId(null); setPanelView(panelView === 'messages' ? 'chat' : 'messages'); }}
            title="Team messages"
          >
            <Users className={cn('h-4 w-4', panelView === 'messages' && 'text-primary')} />
            {internalUnread > 0 && (
              <span className="absolute top-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-destructive-foreground">
                {internalUnread > 9 ? '9+' : internalUnread}
              </span>
            )}
          </Button>
          {/* Notification bell */}
          <Button variant="ghost" size="icon" className="h-7 w-7 relative" onClick={() => { setPanelView(panelView === 'notifications' ? 'chat' : 'notifications'); loadNotifications(); }} title="Notifications">
            <Bell className={cn("h-4 w-4", panelView === 'notifications' && "text-primary")} />
            {notifCount > 0 && <span className="absolute top-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-destructive-foreground">{notifCount > 9 ? '9+' : notifCount}</span>}
          </Button>

          {/* Share */}
          {activeConversation && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPanelView(panelView === 'share' ? 'chat' : 'share')} title="Share conversation">
              <Share2 className={cn("h-4 w-4", panelView === 'share' && "text-primary")} />
            </Button>
          )}
          {/* Settings - Playbooks, Schedules & Audit */}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setPanelView(panelView === 'settings' ? 'chat' : 'settings'); if (panelView !== 'settings') loadSettingsData('playbooks'); }} title="Playbooks, Schedules & Audit Log">
            <Settings className={cn("h-4 w-4", panelView === 'settings' && "text-primary")} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={createConversation} title="New conversation">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {/* Streaming aurora bar — becomes visible during generation */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-[2px] transition-opacity',
            loading || streamingId ? 'opacity-100' : 'opacity-0'
          )}
          style={{
            background:
              'linear-gradient(90deg, transparent, hsl(var(--aurixa-aurora-1)), hsl(var(--aurixa-aurora-2)), hsl(var(--aurixa-aurora-3)), transparent)',
            backgroundSize: '200% 100%',
            animation: 'aurixa-shimmer 2.4s linear infinite',
          }}
        />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ═══ INTERNAL TEAM MESSAGES PANEL ═══ */}
        {panelView === 'messages' && (
          <div className="w-full flex flex-col min-h-0">
            <InternalMessagesPanel
              onUnreadChange={setInternalUnread}
              initialThreadId={pendingThreadId}
            />
          </div>
        )}

        {/* ═══ NOTIFICATIONS PANEL ═══ */}

        {panelView === 'notifications' && (
          <div className="w-full flex flex-col">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Bell className="h-4 w-4 text-primary" /> Notifications</h3>
            </div>
            <ScrollArea className="flex-1 p-4">
              {!notifications ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-3">
                  {[
                    { icon: '⏰', label: 'Overdue Reminders', count: notifications.overdue_reminders, color: 'text-destructive dark:text-destructive bg-destructive/10', action: '⏰ Overdue reminders' },
                    { icon: '🚨', label: 'Urgent Deals', count: notifications.urgent_deals, color: 'text-warning dark:text-warning bg-warning/10', action: '🚨 Show urgent deals' },
                    { icon: '🏠', label: 'Settlements This Week', count: notifications.upcoming_settlements, color: 'text-info dark:text-info bg-info/10', action: '🏠 Upcoming settlements' },
                    { icon: '📞', label: 'Unread Call Alerts', count: notifications.unread_call_alerts, color: 'text-primary dark:text-accent bg-primary/10', action: '📞 Unread call alerts' },
                    { icon: '⚠️', label: 'Clawback Risk (90d)', count: notifications.clawback_risk_deals, color: 'text-brand-600 dark:text-brand-400 bg-brand-500/10', action: '⚠️ Clawback risk deals' },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() => { setPanelView('chat'); setShowSidebar(false); sendMessage(item.action); }}
                      className={cn("w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border/30 hover:border-primary/30 transition-colors text-left", item.count > 0 ? item.color : 'text-muted-foreground bg-muted/20')}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{item.icon}</span>
                        <span className="text-xs font-medium">{item.label}</span>
                      </div>
                      <span className={cn("text-sm font-bold", item.count > 0 ? '' : 'text-muted-foreground')}>{item.count}</span>
                    </button>
                  ))}
                  <div className={cn("mt-3 text-center py-2 rounded-lg text-xs font-medium",
                    notifications.severity === 'high' ? 'bg-destructive/10 text-destructive dark:text-destructive' :
                    notifications.severity === 'medium' ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400' :
                    'bg-success/10 text-success dark:text-success'
                  )}>
                    {notifications.severity === 'high' ? '🔴 Needs immediate attention' : notifications.severity === 'medium' ? '🟡 Some items need review' : '🟢 All clear'}
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* ═══ SETTINGS PANEL ═══ */}
        {panelView === 'settings' && (
          <div className="w-full flex flex-col">
            {/* Tabs with descriptions */}
            <div className="flex border-b">
              {([['playbooks', '📋', 'Playbooks'], ['tasks', '⏰', 'Schedules'], ['audit', '📜', 'Audit Log']] as const).map(([tab, icon, label]) => (
                <button key={tab} onClick={() => { setSettingsTab(tab); loadSettingsData(tab); }}
                  className={cn("flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium border-b-2 transition-colors",
                    settingsTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}>
                  <span className="flex items-center gap-1"><span>{icon}</span> {label}</span>
                  <span className="text-[9px] font-normal opacity-70">
                    {tab === 'playbooks' ? 'Saved workflows' : tab === 'tasks' ? 'Auto-run timers' : 'Action history'}
                  </span>
                </button>
              ))}
            </div>
            <ScrollArea className="flex-1 p-3">
              {!settingsData ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : settingsTab === 'playbooks' ? (
                <div className="space-y-2">
                  {(settingsData.playbooks || []).length === 0 ? (
                    <div className="text-center py-4">
                      <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                        <ClipboardList className="h-7 w-7 text-primary" />
                      </div>
                      <p className="text-sm font-semibold text-foreground">Playbooks</p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-[260px] mx-auto">
                        Save multi-step workflows as reusable recipes. Run them anytime with one click instead of retyping instructions.
                      </p>
                      <div className="mt-3 space-y-1.5 text-left max-w-[240px] mx-auto">
                        <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                          <span className="text-primary mt-0.5">1.</span>
                          <span>Ask Oryxa to perform a multi-step task</span>
                        </div>
                        <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                          <span className="text-primary mt-0.5">2.</span>
                          <span>Say <span className="font-medium text-foreground">"Save this as a playbook"</span></span>
                        </div>
                        <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                          <span className="text-primary mt-0.5">3.</span>
                          <span>Re-run it anytime from here or by name</span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 text-xs gap-1.5"
                        onClick={() => { setPanelView('chat'); setShowSidebar(false); setInput('Create a playbook for '); }}
                      >
                        <Plus className="h-3 w-3" /> Create Your First Playbook
                      </Button>
                    </div>
                  ) : (settingsData.playbooks || []).map((pb: any) => (
                    <div key={pb.id} className="rounded-lg border border-border/30 p-3 hover:border-primary/20 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{pb.icon || '📋'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{pb.name}</p>
                          <p className="text-[10px] text-muted-foreground">{(pb.steps || []).length} steps • Run {pb.run_count || 0}x</p>
                        </div>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => { setPanelView('chat'); setShowSidebar(false); sendMessage(`Run playbook "${pb.name}"`); }}>
                          <Zap className="h-3 w-3 mr-1" /> Run
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : settingsTab === 'tasks' ? (
                <div className="space-y-2">
                  {(settingsData.tasks || []).length === 0 ? (
                    <div className="text-center py-4">
                      <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                        <Clock className="h-7 w-7 text-primary" />
                      </div>
                      <p className="text-sm font-semibold text-foreground">Scheduled Tasks</p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-[260px] mx-auto">
                        Set up automated timers so Oryxa runs playbooks or tools on a recurring schedule — like a cron job for your dashboard.
                      </p>
                      <div className="mt-3 space-y-1.5 text-left max-w-[260px] mx-auto">
                        <p className="text-[10px] font-medium text-foreground mb-1">Example commands:</p>
                        {[
                          '"Schedule a morning briefing every weekday at 8am"',
                          '"Run my weekly digest playbook every Friday"',
                          '"Send me overdue reminders every day at 9am"',
                        ].map((example, i) => (
                          <button
                            key={i}
                            onClick={() => { setPanelView('chat'); setShowSidebar(false); setInput(example.replace(/"/g, '')); }}
                            className="flex items-center gap-2 w-full text-left text-[11px] text-muted-foreground hover:text-foreground rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
                          >
                            <ArrowRight className="h-3 w-3 text-primary shrink-0" />
                            <span className="italic">{example}</span>
                          </button>
                        ))}
                      </div>
                      <p className="mt-3 text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                        <Shield className="h-3 w-3" /> Write actions still require your approval
                      </p>
                    </div>
                  ) : (settingsData.tasks || []).map((task: any) => (
                    <div key={task.id} className="rounded-lg border border-border/30 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{task.name}</p>
                          <p className="text-[10px] text-muted-foreground">{task.schedule_description || task.schedule_cron}</p>
                        </div>
                        <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium", task.is_enabled ? 'bg-success/10 text-success dark:text-success' : 'bg-muted text-muted-foreground')}>
                          {task.is_enabled ? 'Active' : 'Paused'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {(settingsData.actions || []).length === 0 ? (
                    <div className="text-center py-4">
                      <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                        <Shield className="h-7 w-7 text-primary" />
                      </div>
                      <p className="text-sm font-semibold text-foreground">Audit Log</p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-[260px] mx-auto">
                        Every action Oryxa performs is logged here with full details. You can review what happened and undo write actions within 30 seconds.
                      </p>
                      <div className="mt-3 rounded-lg border border-border/30 p-2.5 max-w-[240px] mx-auto">
                        <p className="text-[10px] font-medium text-foreground mb-1.5">What gets logged:</p>
                        <div className="space-y-1">
                          {['Client updates & creation', 'Email sends', 'Report generation', 'Reminder changes'].map((item) => (
                            <div key={item} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <Check className="h-3 w-3 text-primary shrink-0" />
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <p className="mt-3 text-[10px] text-muted-foreground">
                        Actions will appear here as you use the agent.
                      </p>
                    </div>
                  ) : (settingsData.actions || []).map((action: any) => (
                    <div key={action.id} className="rounded-lg border border-border/30 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", action.status === 'success' ? 'bg-success' : 'bg-destructive')} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium truncate">{action.tool_name}</p>
                          <p className="text-[10px] text-muted-foreground">{new Date(action.created_at).toLocaleString('en-AU')}</p>
                        </div>
                        {!action.is_rolled_back && action.rollback_data && (
                          <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1.5" onClick={() => { setPanelView('chat'); setShowSidebar(false); sendMessage(`Undo action ${action.id}`); }}>
                            <RotateCcw className="h-2.5 w-2.5 mr-0.5" /> Undo
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* ═══ SHARE PANEL ═══ */}
        {panelView === 'share' && (
          <div className="w-full flex flex-col">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Share2 className="h-4 w-4 text-primary" /> Share Conversation</h3>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Share with</label>
                <div className="space-y-1.5">
                  {teamMembers.length > 0 ? teamMembers.map((member) => {
                    const isSelected = shareTargets.includes(member.username);
                    return (
                    <button key={member.id} onClick={() => setShareTargets(prev => isSelected ? prev.filter(t => t !== member.username) : [...prev, member.username])}
                      className={cn("w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-xs transition-colors",
                        isSelected ? 'border-primary bg-primary/5' : 'border-border/30 hover:border-primary/20'
                      )}>
                      <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{member.username}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{member.email} • {member.role}</p>
                      </div>
                      {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </button>
                    );
                  }) : (
                    <div className="text-center py-4 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                      <p className="text-[10px]">Loading team...</p>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Permission level</label>
                <div className="flex gap-1.5">
                  {(['view', 'collaborate'] as const).map((perm) => (
                    <button key={perm} onClick={() => setSharePermission(perm)}
                      className={cn("flex-1 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                        sharePermission === perm ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/20'
                      )}>
                      {perm === 'view' ? '👁️ View Only' : '✏️ Collaborate'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Handoff note (optional)</label>
                <Input value={shareNote} onChange={(e) => setShareNote(e.target.value)} placeholder="Context for the recipient..." className="h-8 text-xs" />
              </div>
              <Button size="sm" className="w-full h-8 text-xs" disabled={shareTargets.length === 0} onClick={handleShareConversation}>
                <Share2 className="h-3 w-3 mr-1.5" /> Share with {shareTargets.length > 0 ? `${shareTargets.length} member${shareTargets.length > 1 ? 's' : ''}` : '...'}
              </Button>
            </div>
          </div>
        )}

        {/* ═══ CONVERSATION SIDEBAR ═══ */}
        {panelView === 'chat' && showSidebar && (
          <div className="w-full flex flex-col bg-muted/20">
            {/* Search */}
            <div className="px-3 py-2 border-b">
              <SearchInput
                value={searchQuery}
                onValueChange={setSearchQuery}
                placeholder="Search conversations..."
                className="h-8 text-xs"
                iconClassName="left-2.5 h-3.5 w-3.5"
              />
            </div>

            {/* Tabs */}
            <div className="flex border-b px-1 pt-1 gap-0.5">
              {([
                { key: 'mine' as SidebarTab, label: 'Mine', count: ownConvos.length, icon: MessageSquare },
                { key: 'shared_with_me' as SidebarTab, label: 'Shared', count: sharedWithMeConvos.length, icon: Users },
                { key: 'shared_by_me' as SidebarTab, label: 'Sent', count: filteredSharedByMe.length, icon: Share2 },
              ]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setSidebarTab(tab.key)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium rounded-t-md transition-colors border-b-2",
                    sidebarTab === tab.key
                      ? "border-primary text-primary bg-background"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <tab.icon className="h-3 w-3" />
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className={cn(
                      "ml-0.5 text-[9px] px-1.5 py-0 rounded-full",
                      sidebarTab === tab.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Conversation list */}
            <ScrollArea className="flex-1">
              {loadingConvos ? (
                <div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : (() => {
                const renderConvo = (conv: Conversation, variant: SidebarTab) => (
                  <div key={conv.id} className="group">
                    {editingConvoId === conv.id ? (
                      <div className="px-2 py-1.5">
                        <Input ref={editInputRef} value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={() => renameConversation(conv.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') renameConversation(conv.id); if (e.key === 'Escape') setEditingConvoId(null); }}
                          className="h-7 text-xs" />
                      </div>
                    ) : (
                      <button onClick={() => { setActiveConversation(conv.id); setShowSidebar(false); }}
                        className={cn("w-full text-left px-3 py-2.5 rounded-lg text-sm hover:bg-accent/50 transition-colors flex items-center justify-between gap-1",
                          activeConversation === conv.id && "bg-accent"
                        )}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate block text-xs font-medium">{conv.title}</span>
                            {(variant === 'shared_with_me' || variant === 'shared_by_me') && conv.permission && (
                              <span className={cn("shrink-0 text-[9px] px-1.5 py-0.5 rounded-full border",
                                conv.permission === 'collaborate'
                                  ? 'bg-success/10 text-success dark:text-success border-success/20'
                                  : 'bg-info/10 text-info dark:text-info border-info/20'
                              )}>
                                {conv.permission === 'collaborate' ? '✏️' : '👁️'}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground mt-0.5 block">
                            {variant === 'shared_with_me' && conv.shared_by ? `From ${conv.shared_by} • ` : ''}
                            {variant === 'shared_by_me' && conv.shared_with_username ? `To ${conv.shared_with_username} • ` : ''}
                            {new Date(conv.updated_at).toLocaleDateString('en-AU')}
                          </span>
                          {conv.handoff_note && (
                            <span className="text-[10px] text-muted-foreground/60 italic block mt-0.5 truncate">
                              "{conv.handoff_note}"
                            </span>
                          )}
                        </div>
                        {variant === 'mine' && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); setEditingConvoId(conv.id); setEditTitle(conv.title); }} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Rename"><Pencil className="h-3 w-3" /></button>
                            <button onClick={(e) => deleteConversation(conv.id, e)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Delete"><Trash2 className="h-3 w-3" /></button>
                          </div>
                        )}
                      </button>
                    )}
                  </div>
                );

                // Determine which list to show
                const activeList = sidebarTab === 'mine' ? ownConvos
                  : sidebarTab === 'shared_with_me' ? sharedWithMeConvos
                  : filteredSharedByMe;

                const emptyMessages: Record<SidebarTab, { icon: React.ElementType; text: string }> = {
                  mine: { icon: MessageSquare, text: 'No conversations yet' },
                  shared_with_me: { icon: Users, text: 'No conversations shared with you yet' },
                  shared_by_me: { icon: Share2, text: 'You haven\'t shared any conversations yet' },
                };

                if (activeList.length === 0) {
                  const empty = emptyMessages[sidebarTab];
                  return (
                    <div className="p-6 text-center">
                      <empty.icon className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground mb-3">{searchQuery ? 'No matching conversations' : empty.text}</p>
                      {sidebarTab === 'mine' && !searchQuery && (
                        <Button size="sm" onClick={createConversation} variant="outline"><Plus className="h-4 w-4 mr-1" /> New Chat</Button>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="p-1.5 space-y-0.5">
                    {activeList.map(c => renderConvo(c, sidebarTab))}
                  </div>
                );
              })()}
            </ScrollArea>
          </div>
        )}

        {/* ═══ CHAT AREA ═══ */}
        {panelView === 'chat' && !showSidebar && (
          <div className="flex-1 flex flex-col min-h-0">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center px-4 py-6">
                  <AurixaMark size="hero" state="idle" className="mb-4" />
                  <p className="font-heading text-lg font-medium text-foreground tracking-tight mb-1">How can I help?</p>
                  <p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed">Ask about clients, deals, emails, reminders, pipeline, calendar, or borrowing capacity.</p>
                  <div className="flex flex-wrap gap-1.5 mt-5 justify-center">
                    {[
                      '☀️ Morning briefing',
                      '🔍 Proactive insights scan',
                      '📊 Pipeline overview',
                      '⏰ Overdue reminders',
                      '📅 Upcoming appointments',
                      '💰 Commission forecast',
                      '🏥 System health check',
                      '📊 Chart: deals by stage',
                      '📈 Weekly digest',
                      '🏆 Top clients',
                      '💹 Revenue forecast',
                      '🔮 What-if: rates +0.5%',
                      '📤 Export pipeline data',
                      '📋 My playbooks',
                      '🔎 Smart search',
                      '📝 Generate report for...',
                    ].map((prompt) => (
                      <button key={prompt} onClick={() => sendMessage(prompt)}
                        className="text-[11px] px-2.5 py-1.5 rounded-full border border-[hsl(var(--aurixa-glass-border)/0.6)] bg-[hsl(var(--aurixa-glass-bg)/0.4)] hover:border-brand/40 hover:bg-brand/5 hover:text-foreground transition-colors text-muted-foreground backdrop-blur">
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(() => {
                const senderColorMap = new Map<string, number>();
                return messages.map((msg) => {
                const showAttribution = msg.role === 'user' && msg.sent_by_username && isCollaborativeConvo;
                const isOtherUser = msg.role === 'user' && msg.sent_by && msg.sent_by !== user?.id;
                const senderColor = msg.sent_by ? getSenderColor(msg.sent_by, senderColorMap) : '';
                return (
                <div key={msg.id} className={cn("flex flex-col animate-aurixa-rise", msg.role === 'user' ? (isOtherUser ? "items-start" : "items-end") : "items-start")}>
                  {showAttribution && (
                    <span className={cn("text-[10px] font-medium mb-0.5 px-1", senderColor)}>
                      {msg.sent_by_username}{isOtherUser ? '' : ' (You)'}
                    </span>
                  )}
                  {msg.role === 'assistant' ? (
                    <div className="flex w-full gap-2.5 items-start">
                      <span className="pt-0.5 shrink-0"><AurixaMark size="sm" state={streamingId === msg.id ? 'thinking' : 'idle'} /></span>
                      <div className={cn(
                        "flex-1 min-w-0 text-sm leading-relaxed text-foreground",
                        streamingId === msg.id && msg.content.length > 0 && "[&_p:last-child]:aurixa-shimmer-text"
                      )}>
                        <AgentMessageRenderer content={msg.content} />
                      </div>
                    </div>
                  ) : (
                  <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm",
                    msg.role === 'user'
                      ? isOtherUser
                        ? "bg-[hsl(var(--aurixa-glass-bg)/0.7)] border border-[hsl(var(--aurixa-glass-border)/0.5)] text-foreground rounded-bl-md backdrop-blur"
                        : "bg-primary text-primary-foreground rounded-br-md"
                      : "aurixa-hairline rounded-bl-md"
                  )}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  )}
                  {msg.role === 'assistant' && (
                  <div className="w-full pl-[calc(22px+0.625rem)]">
                    {/* Confirmation + email preview + memory citations rendered under assistant text without a bubble */}
                    {/* Email preview */}
                    {msg.requires_confirmation && msg.tool_calls?.some((tc: any) => tc.function?.name === 'send_email') && (
                      <div className="mt-2 rounded-lg border border-primary/20 overflow-hidden text-xs">
                        {msg.tool_calls.filter((tc: any) => tc.function?.name === 'send_email').map((tc: any, i: number) => {
                          const args = JSON.parse(tc.function.arguments || '{}');
                          return (
                            <div key={i}>
                              <div className="flex items-center gap-1.5 font-semibold text-primary bg-primary/10 px-3 py-2">📧 Email Preview</div>
                              <div className="p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground shrink-0">From:</span>
                                  <div className="flex gap-1">
                                    <span className={cn("px-2 py-0.5 rounded-full border text-[10px] font-medium", (args.mailbox_source || 'admin') === 'admin' ? "bg-primary/15 border-primary/30 text-primary" : "bg-muted/50 border-border/50 text-muted-foreground")}>🏢 Admin</span>
                                    <span className={cn("px-2 py-0.5 rounded-full border text-[10px] font-medium", args.mailbox_source === 'personal' ? "bg-primary/15 border-primary/30 text-primary" : "bg-muted/50 border-border/50 text-muted-foreground")}>👤 Personal</span>
                                  </div>
                                </div>
                                <div><span className="text-muted-foreground">To:</span> <span className="font-medium">{args.to}</span></div>
                                {args.cc?.length > 0 && <div><span className="text-muted-foreground">CC:</span> {args.cc.join(', ')}</div>}
                                {args.bcc?.length > 0 && <div><span className="text-muted-foreground">BCC:</span> {args.bcc.join(', ')}</div>}
                                <div><span className="text-muted-foreground">Subject:</span> <span className="font-medium">{args.subject}</span></div>
                                {args.body && (
                                  <div className="mt-2 pt-2 border-t border-border/30">
                                    <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Body</div>
                                    <div className="prose prose-xs dark:prose-invert max-w-none bg-background/50 rounded p-2 border border-border/20 max-h-[120px] overflow-y-auto [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{args.body}</ReactMarkdown>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Confirmation buttons */}
                    {msg.requires_confirmation && msg.confirmation_status === 'pending' && (
                      <div className="flex gap-2 mt-3 pt-2.5 border-t border-border/50">
                        <Button size="sm" variant="default" className="h-7 text-xs flex-1" onClick={() => handleConfirmAction(msg.id, true)} disabled={loading}><Check className="h-3 w-3 mr-1" /> Approve</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => handleConfirmAction(msg.id, false)} disabled={loading}><XCircle className="h-3 w-3 mr-1" /> Cancel</Button>
                      </div>
                    )}
                    {msg.confirmation_status === 'approved' && <p className="text-xs text-primary mt-1.5 flex items-center gap-1"><Check className="h-3 w-3" /> Approved & executed</p>}
                    {msg.confirmation_status === 'rejected' && <p className="text-xs text-destructive mt-1.5 flex items-center gap-1"><XCircle className="h-3 w-3" /> Cancelled</p>}
                    {msg.role === 'assistant' && msg.recalled_memories && msg.recalled_memories.length > 0 && (
                      <MemoryCitations messageId={msg.id} memories={msg.recalled_memories} />
                    )}
                  </div>
                  )}
                </div>
                );
              });
              })()}
              {loading && !streamingId && (
                <div className="flex items-center gap-2.5 pt-1 animate-aurixa-rise">
                  <AurixaMark size="sm" state="thinking" />
                  <span className="text-sm aurixa-shimmer-text font-medium">Thinking…</span>
                </div>
              )}
              {retryMessage && !loading && (
                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={() => sendMessage(retryMessage)} className="h-7 text-xs text-muted-foreground hover:text-foreground">
                    <RotateCcw className="h-3 w-3 mr-1" /> Retry
                  </Button>
                </div>
              )}
            </div>

            {/* Input */}
            {(() => {
              const activeConvMeta = conversations.find(c => c.id === activeConversation);
              const isReadOnly = activeConvMeta?.shared && activeConvMeta?.permission === 'view';
              if (isReadOnly) {
                return (
                  <div className="border-t p-3 shrink-0 bg-muted/30 text-center">
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">👁️ View-only access — you can read but not send messages</p>
                  </div>
                );
              }
              return (
                <div className="border-t shrink-0 bg-background">
                  {/* Skill (persona) picker */}
                  <div className="px-3 pt-2 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setSkillPickerOpen(o => !o)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                        activeSkill
                          ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15"
                          : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/70"
                      )}
                      title="Choose an Aurixa skill (persona)"
                    >
                      <Brain className="h-3 w-3" />
                      {activeSkill ? (
                        <>
                          <span>{activeSkill.icon || '🧠'} {activeSkill.name}</span>
                          <span className="opacity-60">·</span>
                          <span className="opacity-70">change</span>
                        </>
                      ) : (
                        <span>General assistant · pick a skill</span>
                      )}
                    </button>
                    {activeSkill && (
                      <button
                        type="button"
                        onClick={() => selectSkill(null)}
                        className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {skillPickerOpen && (
                    <div className="px-3 pt-2">
                      <div className="rounded-lg border border-border/60 bg-muted/30 p-2 max-h-48 overflow-y-auto space-y-1">
                        {skills.length === 0 && (
                          <div className="text-[11px] text-muted-foreground px-2 py-1">No skills available yet.</div>
                        )}
                        {skills.map(s => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => selectSkill(s.slug)}
                            className={cn(
                              "w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors flex items-start gap-2",
                              activeSkillSlug === s.slug
                                ? "bg-primary/15 text-primary"
                                : "hover:bg-accent hover:text-accent-foreground"
                            )}
                          >
                            <span className="text-sm leading-none">{s.icon || '🧠'}</span>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{s.name}</div>
                              {s.system_prompt && (
                                <div className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                                  {s.system_prompt.slice(0, 140)}
                                </div>
                              )}
                            </div>
                            {activeSkillSlug === s.slug && <Check className="h-3 w-3 shrink-0 mt-0.5" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* File preview chips */}
                  {attachedFiles.length > 0 && (
                    <div className="px-3 pt-2 flex flex-wrap gap-1.5">
                      {attachedFiles.map((file, idx) => {
                        const isImg = file.type.startsWith('image/');
                        return (
                          <div key={idx} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted/60 border border-border/40 text-xs max-w-[200px]">
                            {isImg ? <ImageIcon className="h-3 w-3 text-primary shrink-0" /> : <File className="h-3 w-3 text-primary shrink-0" />}
                            <span className="truncate">{file.name}</span>
                            <button onClick={() => removeAttachedFile(idx)} className="shrink-0 hover:text-destructive transition-colors"><X className="h-3 w-3" /></button>
                          </div>
                        );
                      })}
                      {extractingFiles && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Extracting...</div>}
                    </div>
                  )}
                  <div className="p-3">
                    <div className="aurixa-hairline flex gap-1.5 items-end rounded-2xl p-1.5 shadow-[0_10px_30px_-15px_hsl(var(--aurixa-glow)/0.35)]">
                      <div className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${loading || attachedFiles.length >= 5 || extractingFiles ? 'opacity-50' : 'hover:bg-brand/10 text-muted-foreground hover:text-brand'}`} title="Attach files">
                        <input
                          ref={fileInputRef}
                          id="agent-file-input"
                          type="file"
                          multiple
                          accept={ACCEPTED_EXTENSIONS}
                          onChange={handleFileSelect}
                          disabled={loading || attachedFiles.length >= 5 || extractingFiles}
                          aria-label="Attach files"
                          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                        />
                        <Paperclip className="pointer-events-none h-4 w-4" />
                      </div>
                       <Textarea ref={textareaRef} value={input} onChange={(e) => {
                        setInput(e.target.value);
                        const ta = e.target;
                        ta.style.height = 'auto';
                        ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
                      }} onKeyDown={handleKeyDown}
                        placeholder={ROTATING_PLACEHOLDERS[placeholderIdx]}
                        className="!min-h-[36px] max-h-[160px] resize-none text-sm rounded-xl overflow-y-auto border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/70 transition-[background]" rows={1} disabled={loading} style={{ height: 'auto' }} />
                      <VoiceToTextButton onTranscript={(text) => setInput(prev => prev ? `${prev} ${text}` : text)} disabled={loading} size="sm" className="shrink-0" />
                      {streamingId ? (
                        <Button size="icon" variant="destructive" onClick={stopStreaming} className="h-9 w-9 shrink-0 rounded-xl" aria-label="Stop generating"><Square className="h-4 w-4" /></Button>
                      ) : (
                        <Button
                          size="icon"
                          onClick={() => sendMessage()}
                          disabled={(!input.trim() && extractedFiles.length === 0) || loading || extractingFiles}
                          aria-label="Send"
                          className={cn(
                            "h-9 w-9 shrink-0 rounded-xl border-0 text-brand-foreground shadow-[0_6px_18px_-6px_hsl(var(--brand)/0.55)] transition-all",
                            "bg-[linear-gradient(135deg,hsl(var(--brand-500)),hsl(var(--brand-700)))] hover:brightness-110",
                            "disabled:opacity-40 disabled:shadow-none disabled:bg-none disabled:bg-muted disabled:text-muted-foreground"
                          )}
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {activeTool && (
                      <p className="text-[10px] text-muted-foreground mt-1.5 text-center flex items-center justify-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" /> Running <span className="font-mono">{activeTool}</span>…
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-muted-foreground/80">
                      <span className="font-mono uppercase tracking-[0.14em]">↵ send · ⇧↵ newline</span>
                      <span>Aurixa may make mistakes</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
