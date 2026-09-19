import { useState, useRef, useCallback, useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MessageSquare, Phone, Mail, Calendar, CheckSquare, Plus, Loader2, Pencil, Lock, Share2, Users, Briefcase, Globe } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { SyncStatusBadge } from '@/components/sync/SyncStatusBadge';
import { getActorLabel, getConflictReason, getSurfaceLabel } from '@/lib/syncDisplay';

interface ClientNotesProps {
  clientId: string;
}

const noteTypes = [
  { value: 'general', label: 'General', icon: MessageSquare },
  { value: 'call', label: 'Call', icon: Phone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'meeting', label: 'Meeting', icon: Calendar },
  { value: 'task', label: 'Task', icon: CheckSquare },
] as const;

type NoteType = typeof noteTypes[number]['value'];

type Visibility = 'internal_npc' | 'client_only' | 'finance_only' | 'shared';

const visibilityOptions: { value: Visibility; label: string; icon: any; desc: string }[] = [
  { value: 'internal_npc', label: 'Internal', icon: Lock, desc: 'Command Center only' },
  { value: 'client_only', label: 'Client', icon: Users, desc: 'Visible in client portal' },
  { value: 'finance_only', label: 'Finance', icon: Briefcase, desc: 'Visible in finance portal' },
  { value: 'shared', label: 'All', icon: Globe, desc: 'Both portals + GHL' },
];

function VisibilityPicker({ value, onChange }: { value: Visibility | null; onChange: (v: Visibility) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Visibility (required)</Label>
      <div className="flex flex-wrap gap-1.5">
        {visibilityOptions.map(opt => {
          const Icon = opt.icon;
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ' +
                (active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/40')
              }
              title={opt.desc}
            >
              <Icon className="h-3 w-3" />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getVisibilityBadge(v?: string | null) {
  const opt = visibilityOptions.find(o => o.value === v) || visibilityOptions[0];
  const Icon = opt.icon;
  return (
    <Badge variant="outline" className="text-xs">
      <Icon className="h-3 w-3 mr-1" /> {opt.label}
    </Badge>
  );
}

const PAGE_SIZE = 10;

/**
 * Secure fetch for notes data using HttpOnly cookies with pagination
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

export function ClientNotes({ clientId }: ClientNotesProps) {
  const [newNote, setNewNote] = useState('');
  const [noteType, setNoteType] = useState<NoteType>('general');
  // Per-note visibility picker — defaults to Internal (Command Center only) so
  // save works immediately; the user can upgrade before saving.
  const [visibility, setVisibility] = useState<Visibility | null>('internal_npc');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editNoteType, setEditNoteType] = useState<NoteType>('general');
  const [editVisibility, setEditVisibility] = useState<Visibility>('internal_npc');
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['client-notes', clientId],
    queryFn: ({ pageParam = 0 }) => fetchNotesSecure(clientId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 0,
  });

  const notes = data?.pages.flatMap((page) => page.notes) || [];

  // Two-way realtime sync with the Client Tracker quick-notes card (and any other open tab).
  useEffect(() => {
    const channel = supabase
      .channel(`client-notes-${clientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_notes', filter: `client_id=eq.${clientId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['client-notes', clientId] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId, queryClient]);

  const addNoteMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!visibility) throw new Error('Choose a visibility');
      const payload = {
        note_type: noteType,
        content,
        visibility,
      };

      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_notes',
        clientId,
        data: payload,
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to add note');
      return data.result;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['client-notes', clientId] });
      logActivityDirect({
        actionType: 'client_note_added',
        entityType: 'client_note',
        entityId: clientId,
        metadata: { note_type: noteType, visibility }
      });
      // Push to external GHL only when fully shared (both portals + external).
      if (visibility === 'shared') {
        invokeSecureFunction('sync-notes-to-ghl', {
          action: 'create',
          clientId,
          noteId: result?.id,
          noteContent: result?.content || newNote.trim(),
          noteType,
        }).catch(err => console.warn('GHL note sync failed:', err));
      }
      const label = visibilityOptions.find(o => o.value === visibility)?.label || 'Note';
      setNewNote('');
      setVisibility('internal_npc');
      setIsAdding(false);
      toast.success('Note saved successfully.');
    },
    onError: (error: any) => {
      toast.error('Failed to add note: ' + error.message);
    }
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_notes',
        clientId,
        recordId: noteId,
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to delete note');
    },
    onSuccess: (_result, noteId) => {
      // Sync delete to GHL (non-blocking)
      invokeSecureFunction('sync-notes-to-ghl', {
        action: 'delete',
        clientId,
        noteId,
      }).catch(err => console.warn('GHL note delete sync failed:', err));
      queryClient.invalidateQueries({ queryKey: ['client-notes', clientId] });
      toast.success('Note deleted');
    }
  });

  const editNoteMutation = useMutation({
    mutationFn: async () => {
      const noteId = editingId!;
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'client_notes',
        clientId,
        recordId: noteId,
        data: {
          content: editContent.trim(),
          note_type: editNoteType,
          visibility: editVisibility,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to update note');
      // Push to external GHL only when fully shared (both portals + external).
      if (editVisibility === 'shared') {
        invokeSecureFunction('sync-notes-to-ghl', {
          action: 'create',
          clientId,
          noteId,
          noteContent: editContent.trim(),
          noteType: editNoteType,
        }).catch(err => console.warn('GHL note sync failed:', err));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-notes', clientId] });
      setEditingId(null);
      toast.success('Note updated');
    },
    onError: (error: any) => {
      toast.error('Failed to update note: ' + error.message);
    },
  });

  const startEditingNote = (note: any) => {
    setEditingId(note.id);
    setEditContent(note.content);
    setEditNoteType(note.note_type);
    setEditVisibility((note.visibility as Visibility) || 'internal_npc');
  };

  const getNoteIcon = (type: string) => {
    const noteType = noteTypes.find(t => t.value === type);
    const Icon = noteType?.icon || MessageSquare;
    return <Icon className="h-3.5 w-3.5" />;
  };

  const getNoteColor = (type: string) => {
    switch (type) {
      case 'call': return 'bg-success/10 text-success border-success/20';
      case 'email': return 'bg-info/10 text-info border-info/20';
      case 'meeting': return 'bg-accent/10 text-accent border-accent/20';
      case 'task': return 'bg-warning/10 text-warning border-warning/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Note Form */}
      {isAdding ? (
        <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={noteType} onValueChange={(v: NoteType) => setNoteType(v)}>
              <SelectTrigger className="w-32 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
              noteType={noteType} 
              onTranscriptReady={(text) => setNewNote(prev => prev ? `${prev}\n\n${text}` : text)}
              disabled={addNoteMutation.isPending}
            />
          </div>
          <Textarea
            placeholder="Enter your note..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="min-h-[80px]"
          />
          <VisibilityPicker value={visibility} onChange={setVisibility} />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                const content = newNote.trim();
                if (!content) {
                  toast.error('Enter a note before saving.');
                  return;
                }
                addNoteMutation.mutate(content);
              }}
              disabled={!newNote.trim() || !visibility || addNoteMutation.isPending}
            >
              {addNoteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {addNoteMutation.isPending ? 'Saving note…' : 'Save Note'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsAdding(false);
                setNewNote('');
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
          onClick={() => setIsAdding(true)}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Note
        </Button>
      )}

      {/* Notes List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No notes yet</p>
        </div>
      ) : (
        <ScrollArea className="h-[300px]">
          <div 
            ref={scrollRef}
            className="space-y-3 pr-4"
            onScroll={(e) => {
              const target = e.currentTarget;
              const scrolledToBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
              if (scrolledToBottom && hasNextPage && !isFetchingNextPage) {
                fetchNextPage();
              }
            }}
          >
            {notes.map((note: any) => {
              const isEditing = editingId === note.id;

              if (isEditing) {
                return (
                  <div key={note.id} className="p-3 border rounded-lg space-y-2 ring-1 ring-primary">
                    <Select value={editNoteType} onValueChange={(v: NoteType) => setEditNoteType(v)}>
                      <SelectTrigger className="w-32 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
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
                    <Textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="min-h-[60px]"
                    />
                    <VisibilityPicker value={editVisibility} onChange={setEditVisibility} />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => editNoteMutation.mutate()}
                        disabled={!editContent.trim() || editNoteMutation.isPending}
                      >
                        {editNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={note.id} className="p-3 border rounded-lg space-y-2 group">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={getNoteColor(note.note_type)}>
                        {getNoteIcon(note.note_type)}
                        <span className="ml-1.5 capitalize">{note.note_type}</span>
                      </Badge>
                      <SyncStatusBadge status={note.sync_status} />
                      {note.source_surface && <Badge variant="outline" className="text-xs">{getSurfaceLabel(note.source_surface)}</Badge>}
                      {getVisibilityBadge(note.visibility)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => startEditingNote(note)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                        onClick={() => deleteNoteMutation.mutate(note.id)}
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {getActorLabel(note) && <span>By {getActorLabel(note)}</span>}
                    {note.version_number ? <span>v{note.version_number}</span> : null}
                    {getConflictReason(note) ? <span className="text-warning">{getConflictReason(note)}</span> : null}
                  </div>
                </div>
              );
            })}
            {isFetchingNextPage && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
