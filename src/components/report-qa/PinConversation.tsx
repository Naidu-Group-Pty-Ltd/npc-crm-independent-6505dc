import { Button } from '@/components/ui/button';
import { Pin, PinOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PinConversationProps {
  conversationId: string;
  isPinned: boolean;
  onTogglePin: (conversationId: string) => void;
  compact?: boolean;
}

export function PinConversation({ 
  conversationId, 
  isPinned, 
  onTogglePin,
  compact 
}: PinConversationProps) {
  if (compact) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-6 w-6 p-0",
          isPinned && "text-primary"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(conversationId);
        }}
        title={isPinned ? 'Unpin conversation' : 'Pin conversation'}
      >
        {isPinned ? (
          <Pin className="h-3 w-3 fill-current" />
        ) : (
          <Pin className="h-3 w-3" />
        )}
      </Button>
    );
  }

  return (
    <Button
      variant={isPinned ? "secondary" : "ghost"}
      size="sm"
      className="report-qa-toolbar-control h-8 gap-1.5 px-3 text-xs font-medium"
      data-active={isPinned ? 'true' : undefined}
      onClick={() => onTogglePin(conversationId)}
      title={isPinned ? 'Unpin conversation' : 'Pin conversation'}
    >
      {isPinned ? (
        <>
          <PinOff className="h-3 w-3" />
          Unpin
        </>
      ) : (
        <>
          <Pin className="h-3 w-3" />
          Pin
        </>
      )}
    </Button>
  );
}

// Hook to manage pinned conversations
export function usePinnedConversations() {
  const getPinnedIds = (): string[] => {
    try {
      const stored = localStorage.getItem('pinned-qa-conversations');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  };

  const togglePin = (conversationId: string) => {
    const pinned = getPinnedIds();
    const newPinned = pinned.includes(conversationId)
      ? pinned.filter(id => id !== conversationId)
      : [...pinned, conversationId];
    localStorage.setItem('pinned-qa-conversations', JSON.stringify(newPinned));
    return newPinned;
  };

  const isPinned = (conversationId: string): boolean => {
    return getPinnedIds().includes(conversationId);
  };

  return { getPinnedIds, togglePin, isPinned };
}
