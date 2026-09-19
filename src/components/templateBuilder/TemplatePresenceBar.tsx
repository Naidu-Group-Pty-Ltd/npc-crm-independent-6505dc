import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

export interface PresenceUser {
  user_id: string;
  name: string;
  color: string;
  page_id?: string | null;
  selected_block_id?: string | null;
  selected_overlay_id?: string | null;
  workspace_mode?: string | null;
  editing_text?: boolean;
  online_at: string;
}

interface TemplatePresenceBarProps {
  templateId: string;
  currentUserId?: string | null;
  currentUserName?: string | null;
  activePageId?: string | null;
  selectedBlockId?: string | null;
  selectedOverlayId?: string | null;
  workspaceMode?: string | null;
  editingText?: boolean;
  onSoftLockChange?: (users: PresenceUser[]) => void;
}

const PALETTE = ['#D4A843', '#7AB7FF', '#8AE6A2', '#F4A0C5', '#C99BFF', '#FFB36B', '#73E3D6'];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function TemplatePresenceBar({
  templateId,
  currentUserId,
  currentUserName,
  activePageId,
  selectedBlockId,
  selectedOverlayId,
  workspaceMode,
  editingText = false,
  onSoftLockChange,
}: TemplatePresenceBarProps) {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!templateId || !currentUserId) return;
    const ch = supabase.channel(`tpl-presence:${templateId}`, {
      config: { presence: { key: currentUserId } },
    });

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as Record<string, PresenceUser[]>;
      const flat: PresenceUser[] = [];
      for (const arr of Object.values(state)) {
        if (arr.length) flat.push(arr[0]);
      }
      setUsers(flat);
    });

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({
          user_id: currentUserId,
          name: currentUserName || 'Anon',
          color: colorFor(currentUserId),
          page_id: activePageId ?? null,
          selected_block_id: selectedBlockId ?? null,
          selected_overlay_id: selectedOverlayId ?? null,
          workspace_mode: workspaceMode ?? null,
          editing_text: editingText,
          online_at: new Date().toISOString(),
        });
      }
    });

    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [templateId, currentUserId, currentUserName]);

  // Update page_id when it changes
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !currentUserId) return;
    ch.track({
      user_id: currentUserId,
      name: currentUserName || 'Anon',
      color: colorFor(currentUserId),
      page_id: activePageId ?? null,
      selected_block_id: selectedBlockId ?? null,
      selected_overlay_id: selectedOverlayId ?? null,
      workspace_mode: workspaceMode ?? null,
      editing_text: editingText,
      online_at: new Date().toISOString(),
    }).catch(() => {});
  }, [activePageId, currentUserId, currentUserName, selectedBlockId, selectedOverlayId, workspaceMode, editingText]);

  useEffect(() => {
    const blockers = users.filter((u) => {
      if (u.user_id === currentUserId) return false;
      if (selectedOverlayId && u.selected_overlay_id === selectedOverlayId) return true;
      if (!selectedOverlayId && selectedBlockId && u.selected_block_id === selectedBlockId) return true;
      return false;
    });
    onSoftLockChange?.(blockers);
  }, [currentUserId, onSoftLockChange, selectedBlockId, selectedOverlayId, users]);

  if (users.length === 0) return null;

  return (
    <TooltipProvider>
      <div className="flex items-center -space-x-2">
        {users.slice(0, 5).map((u) => {
          const initials = (u.name || '?').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
          return (
            <Tooltip key={u.user_id}>
              <TooltipTrigger asChild>
                <Avatar
                  className="h-7 w-7 ring-2 ring-background text-[10px]"
                  style={{ backgroundColor: u.color }}
                >
                  <AvatarFallback className="bg-transparent text-foreground font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <div className="font-semibold">{u.name}</div>
                {u.workspace_mode && <div className="text-muted-foreground">mode: {u.workspace_mode}</div>}
                {u.page_id && <div className="text-muted-foreground">page {u.page_id.slice(0, 8)}</div>}
                {u.selected_block_id && <div className="text-muted-foreground">block {u.selected_block_id.slice(0, 8)}</div>}
                {u.selected_overlay_id && <div className="text-muted-foreground">overlay {u.selected_overlay_id.slice(0, 8)}</div>}
                {u.editing_text && <div className="text-brand-600">editing text</div>}
              </TooltipContent>
            </Tooltip>
          );
        })}
        {users.length > 5 && (
          <div className="h-7 w-7 rounded-full ring-2 ring-background bg-muted text-[10px] flex items-center justify-center font-semibold">
            +{users.length - 5}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
