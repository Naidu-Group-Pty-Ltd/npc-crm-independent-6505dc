import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Mail, 
  Phone, 
  FileText, 
  Star, 
  Plus, 
  MoreVertical, 
  Pencil, 
  Trash2,
  Loader2,
  MessageSquare,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { formatFullName } from '@/utils/nameFormatting';
import { format } from 'date-fns';
import { useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';
import { FollowUpFlag } from './FollowUpFlag';
import { invalidateClientQueries } from '@/lib/clients/invalidateClientQueries';

interface ClientNote {
  id: string;
  client_id: string;
  content: string;
  note_type: string;
  created_at: string;
}

interface TrackedClient {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  primary_email: string | null;
  primary_mobile: string | null;
  pipeline_status: string | null;
  current_stage_id: string | null;
  is_favorite?: boolean;
  deal_status?: string;
  first_deal_closed_at?: string | null;
  follow_up_date?: string | null;
}

interface StageInfo {
  name: string;
  color: string;
}

interface ActiveClientCardProps {
  client: TrackedClient;
  stageInfo: StageInfo;
}

const noteTypes = [
  { value: 'general', label: 'General', icon: MessageSquare },
  { value: 'call', label: 'Call', icon: Phone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'meeting', label: 'Meeting', icon: Calendar },
  { value: 'task', label: 'Task', icon: CheckSquare },
] as const;

type NoteType = typeof noteTypes[number]['value'];

// Character limit for note truncation
const NOTE_TRUNCATE_LENGTH = 150;
const PAGE_SIZE = 10;
const activeClientBadgeClass = "inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5 shadow-sm";
const activeClientActionButtonClass = "client-tracker-gold-interaction rounded-xl border border-border/60 bg-background/75 text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary hover:shadow-md hover:shadow-primary/10 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-0";
const activeClientMenuContentClass = "z-50 min-w-[10rem] rounded-xl border-border/70 bg-popover/95 p-1.5 shadow-xl shadow-sm dark:shadow-black/20 backdrop-blur-xl";
const activeClientMenuItemClass = "cursor-pointer rounded-lg px-2.5 py-2 text-sm focus:bg-primary/10 focus:text-primary";

const getActiveStageBadgeStyle = (color: string) => ({
  backgroundColor: `${color}20`,
  borderColor: `${color}80`,
  color,
});

/**
 * Fetch notes with pagination for infinite scrolling
 */
async function fetchNotesSecure(clientId: string, page: number) {
  const { data, error } = await invokeSecureFunction('get-client-data', {
    clientId,
    include: { notes: true },
    notesOptions: {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
  });

  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to fetch notes');
  
  const notes = data.notes || [];
  return {
    notes,
    nextPage: notes.length === PAGE_SIZE ? page + 1 : undefined,
  };
}

export function ActiveClientCard({ client, stageInfo }: ActiveClientCardProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteType, setNewNoteType] = useState<NoteType>('general');
  const [editNoteContent, setEditNoteContent] = useState('');
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  // Infinite query for notes
  const {
    data,
    isLoading: notesLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['client-notes', client.id],
    queryFn: ({ pageParam = 0 }) => fetchNotesSecure(client.id, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 0,
  });

  const notes = data?.pages.flatMap((page) => page.notes) || [];

  // Two-way realtime sync with ClientNotes (and any other open tab): any insert/update/delete
  // on this client's notes refetches the shared ['client-notes', clientId] cache.
  useEffect(() => {
    const channel = supabase
      .channel(`client-notes-${client.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_notes', filter: `client_id=eq.${client.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['client-notes', client.id] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [client.id, queryClient]);

  // Toggle note expansion
  const toggleNoteExpansion = (noteId: string) => {
    setExpandedNotes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(noteId)) {
        newSet.delete(noteId);
      } else {
        newSet.add(noteId);
      }
      return newSet;
    });
  };

  // Check if note needs truncation
  const isNoteTruncated = (content: string) => content.length > NOTE_TRUNCATE_LENGTH;

  // Get truncated or full content
  const getNoteDisplay = (note: ClientNote) => {
    const isExpanded = expandedNotes.has(note.id);
    if (isExpanded || !isNoteTruncated(note.content)) {
      return note.content;
    }
    return note.content.substring(0, NOTE_TRUNCATE_LENGTH) + '...';
  };

  // Toggle favorite mutation
  const toggleFavoriteMutation = useMutation({
    mutationFn: async () => {
      // Use secure Edge Function with HttpOnly cookie auth
      const { data, error: fnError } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'clients',
        clientId: client.id,
        data: { is_favorite: !client.is_favorite },
      });
      if (!fnError && data?.success) return;
      console.warn('Secure update failed, falling back to direct query');

      // Fallback to direct query
      const { error } = await supabase
        .from('clients')
        .update({ is_favorite: !client.is_favorite })
        .eq('id', client.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateClientQueries(queryClient, client.id);
      toast.success(client.is_favorite ? 'Removed from active clients' : 'Added to active clients');
    },
    onError: (error: any) => {
      toast.error('Failed to update: ' + error.message);
    }
  });

  // Add note mutation with GHL sync
  const addNoteMutation = useMutation({
    mutationFn: async () => {
      // Use secure Edge Function with HttpOnly cookie auth
      const { data, error: fnError } = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_notes',
        clientId: client.id,
        data: {
          client_id: client.id,
          note_type: newNoteType,
          content: newNoteContent.trim(),
          // Quick notes are internal by default; use the client's Notes tab to share outward.
          visibility: 'internal_npc'
        },
      });
      if (!fnError && data?.success) {
        return data.result;
      }
      console.warn('Secure create failed, falling back to Edge Function');

      // Fallback still uses secure function
      const fallbackResult = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_notes',
        clientId: client.id,
        data: {
          client_id: client.id,
          note_type: newNoteType,
          content: newNoteContent.trim(),
          visibility: 'internal_npc'
        },
      });

      if (fallbackResult.error || !fallbackResult.data?.success) {
        throw new Error(fallbackResult.error?.message || 'Failed to create note');
      }

      return fallbackResult.data.result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-notes', client.id] });
      setNewNoteContent('');
      setNewNoteType('general');
      setIsAddingNote(false);
      toast.success('Note added');
    },
    onError: (error: any) => {
      toast.error('Failed to add note: ' + error.message);
    }
  });

  // Update note mutation with GHL sync
  const updateNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      // Use secure Edge Function with HttpOnly cookie auth
      const { data, error: fnError } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'client_notes',
        clientId: client.id,
        recordId: noteId,
        data: { content: editNoteContent.trim() },
      });
      if (!fnError && data?.success) {
        // Sync update to GHL
        invokeSecureFunction('sync-notes-to-ghl', {
          action: 'update',
          clientId: client.id,
          noteId,
          noteContent: `[UPDATED] ${editNoteContent.trim()}`,
          noteType: 'general'
        }).catch(err => console.error('GHL note sync failed:', err));
        return;
      }
      throw new Error(fnError?.message || 'Failed to update note');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-notes', client.id] });
      setEditingNoteId(null);
      setEditNoteContent('');
      toast.success('Note updated');
    },
    onError: (error: any) => {
      toast.error('Failed to update note: ' + error.message);
    }
  });

  // Delete note mutation with GHL sync
  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      // Sync delete to GHL first (best effort)
      await invokeSecureFunction('sync-notes-to-ghl', {
        action: 'delete',
        clientId: client.id,
        noteId
      }).catch(err => console.error('GHL note delete sync failed:', err));

      // Use secure Edge Function with HttpOnly cookie auth
      const { data, error: fnError } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_notes',
        clientId: client.id,
        recordId: noteId,
      });
      if (!fnError && data?.success) return;
      throw new Error(fnError?.message || 'Failed to delete note');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-notes', client.id] });
      toast.success('Note deleted');
    },
    onError: (error: any) => {
      toast.error('Failed to delete note: ' + error.message);
    }
  });

  const handleStartEdit = (note: ClientNote) => {
    setEditingNoteId(note.id);
    setEditNoteContent(note.content);
  };

  const handleCancelEdit = () => {
    setEditingNoteId(null);
    setEditNoteContent('');
  };

  const getNoteTypeIcon = (type: string) => {
    const noteType = noteTypes.find(t => t.value === type);
    const Icon = noteType?.icon || MessageSquare;
    return <Icon className="h-3.5 w-3.5" />;
  };

  const getNoteTypeColor = (type: string) => {
    switch (type) {
      case 'call': return 'text-success';
      case 'email': return 'text-info';
      case 'meeting': return 'text-accent';
      case 'task': return 'text-warning';
      default: return 'text-muted-foreground';
    }
  };

  // Use onScrollCapture to capture scroll events from the inner viewport
  const handleScrollCapture = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    // Only handle scroll events from the actual scrollable viewport
    if (!target.classList.contains('h-full')) return;
    
    const scrolledToBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
    if (scrolledToBottom && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  return (
    <Card className={cn(
      "client-tracker-gold-interaction group flex flex-col overflow-hidden rounded-2xl border-border/70 bg-[linear-gradient(145deg,hsl(var(--card)/0.96),hsl(var(--background)/0.74))] shadow-lg shadow-sm dark:shadow-black/10 transition-all duration-300 hover:-translate-y-1 hover:border-primary/35 hover:shadow-xl hover:shadow-primary/10",
      client.is_favorite && "ring-2 ring-brand-400/50"
    )}>
      <CardHeader className="border-b border-border/60 bg-card/35 pb-3">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge 
              className={cn(activeClientBadgeClass, "truncate border")}
              style={getActiveStageBadgeStyle(stageInfo.color)}
              variant="outline"
            >
              {stageInfo.name}
            </Badge>
            {client.deal_status === 'closed' && (
              <Badge variant="default" className={cn(activeClientBadgeClass, "border border-success/30 bg-success/15 text-success shadow-success/15 hover:bg-success/20")}>
                🏆 Deal Closed
              </Badge>
            )}
          </div>
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={client.is_favorite ? 'Remove from active clients' : 'Add to active clients'}
              className={cn("h-10 w-10 shrink-0 hover:border-brand-400/35 hover:bg-brand-400/10 hover:text-brand-400 focus-visible:ring-brand-400/30", activeClientActionButtonClass)}
              onClick={() => toggleFavoriteMutation.mutate()}
              disabled={toggleFavoriteMutation.isPending}
            >
              <Star 
                className={cn(
                  "h-5 w-5 transition-colors",
                  client.is_favorite 
                    ? 'fill-brand-400 text-brand-400' 
                    : 'text-muted-foreground hover:text-brand-400'
                )} 
              />
            </Button>
            <FollowUpFlag
              clientId={client.id}
              followUpDate={client.follow_up_date}
              invalidateKeys={[['client-notes', client.id]]}
            />
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-lg font-semibold tracking-tight transition-colors group-hover:text-primary">
                {formatFullName(client.primary_first_name, client.primary_surname)}
              </CardTitle>
              <div className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
                {client.primary_email && (
                  <span className="flex items-center gap-1.5 truncate" title={client.primary_email}>
                    <Mail className="h-3.5 w-3.5 flex-shrink-0 text-primary/70" />
                    <span className="truncate">{client.primary_email}</span>
                  </span>
                )}
                {client.primary_mobile && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 flex-shrink-0 text-primary/70" />
                    {client.primary_mobile}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 p-4">
        {/* Add Note Section */}
        {isAddingNote ? (
          <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-3 shadow-inner shadow-sm dark:shadow-black/10">
            <div className="flex items-center gap-2.5 flex-wrap">
              <Select value={newNoteType} onValueChange={(v: NoteType) => setNewNoteType(v)}>
                <SelectTrigger className="h-8 w-32 rounded-xl border-border/70 bg-background/80 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/70 bg-popover/95 shadow-xl">
                  {noteTypes.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex items-center gap-2">
                        <type.icon className="h-3.5 w-3.5" />
                        {type.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <VoiceNoteRecorder
                noteType={newNoteType}
                onTranscriptReady={(text) => setNewNoteContent(prev => prev ? `${prev}\n\n${text}` : text)}
                disabled={addNoteMutation.isPending}
              />
            </div>
            <Textarea
              placeholder="Enter your note..."
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              className="min-h-[88px] rounded-xl border-border/70 bg-background/85 text-sm focus-visible:ring-primary/35"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-9 rounded-xl text-sm shadow-sm shadow-primary/15 focus-visible:ring-primary/35"
                onClick={() => addNoteMutation.mutate()}
                disabled={!newNoteContent.trim() || addNoteMutation.isPending}
              >
                {addNoteMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : null}
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-9 rounded-xl text-sm text-muted-foreground transition-all hover:bg-background/80 hover:text-foreground focus-visible:ring-primary/25"
                onClick={() => {
                  setIsAddingNote(false);
                  setNewNoteContent('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="client-tracker-gold-interaction h-10 w-full rounded-xl border-primary/25 bg-primary/5 text-sm font-semibold text-primary shadow-sm transition-all hover:border-primary/45 hover:bg-primary/10 hover:shadow-md hover:shadow-primary/10 focus-visible:ring-primary/35"
            onClick={() => setIsAddingNote(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Note
          </Button>
        )}

        {/* Notes List with Infinite Scroll */}
        {notesLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card/35 py-5 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Loading notes...</span>
          </div>
        ) : notes.length > 0 ? (
          <div className="space-y-2.5">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
              <FileText className="h-3.5 w-3.5 text-primary/70" />
              Notes ({notes.length}{hasNextPage ? '+' : ''})
            </p>
            <ScrollArea className="client-tracker-kanban-scroll h-52 rounded-2xl border border-border/55 bg-background/45 p-2" onScrollCapture={handleScrollCapture}>
              <div 
                ref={scrollRef}
                className="space-y-2.5 pr-3"
              >
                {notes.map((note: ClientNote) => (
                  <div 
                    key={note.id} 
                    className="client-tracker-gold-interaction relative rounded-2xl border border-border/60 bg-card/80 p-3 text-sm shadow-sm shadow-sm dark:shadow-black/5 transition-all hover:border-primary/30 hover:bg-primary/5 hover:shadow-md hover:shadow-primary/10"
                  >
                    {editingNoteId === note.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editNoteContent}
                          onChange={(e) => setEditNoteContent(e.target.value)}
                          className="min-h-[88px] rounded-xl border-border/70 bg-background/85 text-sm focus-visible:ring-primary/35"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-9 rounded-xl text-sm focus-visible:ring-primary/35"
                            onClick={() => updateNoteMutation.mutate(note.id)}
                            disabled={!editNoteContent.trim() || updateNoteMutation.isPending}
                          >
                            {updateNoteMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : null}
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-9 rounded-xl text-sm text-muted-foreground transition-all hover:bg-background/80 hover:text-foreground focus-visible:ring-primary/25"
                            onClick={handleCancelEdit}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mb-2 flex items-center gap-2">
                          <span className={cn("flex h-6 w-6 items-center justify-center rounded-full bg-background/80", getNoteTypeColor(note.note_type))}>
                            {getNoteTypeIcon(note.note_type)}
                          </span>
                          <span className="capitalize text-xs font-semibold text-muted-foreground">
                            {note.note_type}
                          </span>
                          <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground/75">
                            {format(new Date(note.created_at), 'dd MMM yyyy, h:mm a')}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Open note actions for ${format(new Date(note.created_at), 'dd MMM yyyy, h:mm a')}`}
                                className={cn("h-9 w-9 p-0", activeClientActionButtonClass)}
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={6} className={activeClientMenuContentClass}>
                              <DropdownMenuItem className={activeClientMenuItemClass} onClick={() => handleStartEdit(note)}>
                                <Pencil className="mr-2 h-3.5 w-3.5 text-primary" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => deleteNoteMutation.mutate(note.id)}
                                className={cn(activeClientMenuItemClass, "text-destructive focus:bg-destructive/10 focus:text-destructive")}
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{getNoteDisplay(note)}</p>
                        {isNoteTruncated(note.content) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="client-tracker-gold-interaction mt-2 h-7 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/35"
                            onClick={() => toggleNoteExpansion(note.id)}
                          >
                            {expandedNotes.has(note.id) ? (
                              <>
                                <ChevronUp className="h-3 w-3 mr-0.5" />
                                Show less
                              </>
                            ) : (
                              <>
                                <ChevronDown className="h-3 w-3 mr-0.5" />
                                Read more
                              </>
                            )}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Loading more notes...
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card/35 p-4 text-center text-sm text-muted-foreground">
            <FileText className="h-5 w-5 text-primary/60" />
            <p className="font-medium italic">No notes for this client</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
