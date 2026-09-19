import { useState } from 'react';
import { Calendar, Trash2, Clock, X, CheckSquare, Square } from 'lucide-react';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { GHLEvent } from '@/hooks/useGHLCalendar';

interface BatchActionsProps {
  events: GHLEvent[];
  selectedEventIds: Set<string>;
  onToggleSelect: (eventId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBatchDelete: (eventIds: string[]) => Promise<void>;
  onBatchReschedule: (eventIds: string[]) => void;
  isLoading?: boolean;
}

export function BatchActions({
  events,
  selectedEventIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onBatchDelete,
  onBatchReschedule,
  isLoading,
}: BatchActionsProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedCount = selectedEventIds.size;
  const allSelected = selectedCount === events.length && events.length > 0;

  const handleBatchDelete = async () => {
    setIsDeleting(true);
    try {
      const ids = Array.from(selectedEventIds);
      await onBatchDelete(ids);
      logActivityDirect({
        actionType: 'appointment_deleted',
        entityType: 'appointment',
        entityName: `Batch delete: ${ids.length} events`,
        metadata: { batch: true, count: ids.length, event_ids: ids.slice(0, 10) }
      });
      onClearSelection();
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  if (selectedCount === 0) {
    return null;
  }

  return (
    <>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
        <div className="flex items-center gap-2 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg px-4 py-2">
          <Badge variant="secondary" className="font-mono">
            {selectedCount} selected
          </Badge>

          <div className="h-4 w-px bg-border" />

          <Button
            variant="ghost"
            size="sm"
            onClick={allSelected ? onClearSelection : onSelectAll}
            className="h-8 text-xs"
          >
            {allSelected ? (
              <>
                <Square className="h-3 w-3 mr-1" />
                Deselect all
              </>
            ) : (
              <>
                <CheckSquare className="h-3 w-3 mr-1" />
                Select all
              </>
            )}
          </Button>

          <div className="h-4 w-px bg-border" />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onBatchReschedule(Array.from(selectedEventIds))}
            disabled={isLoading}
            className="h-8 text-xs"
          >
            <Clock className="h-3 w-3 mr-1" />
            Reschedule
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
            disabled={isLoading}
            className="h-8 text-xs text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete
          </Button>

          <div className="h-4 w-px bg-border" />

          <Button
            variant="ghost"
            size="icon"
            onClick={onClearSelection}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} events?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. All selected events will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBatchDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : `Delete ${selectedCount} events`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Selectable event wrapper
interface SelectableEventProps {
  eventId: string;
  isSelected: boolean;
  onToggle: () => void;
  selectionMode: boolean;
  children: React.ReactNode;
}

export function SelectableEvent({
  eventId,
  isSelected,
  onToggle,
  selectionMode,
  children,
}: SelectableEventProps) {
  if (!selectionMode) {
    return <>{children}</>;
  }

  return (
    <div className="relative group">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          'absolute -left-1 top-1/2 -translate-y-1/2 z-10 p-0.5 rounded transition-all',
          'opacity-0 group-hover:opacity-100',
          isSelected && 'opacity-100'
        )}
      >
        {isSelected ? (
          <CheckSquare className="h-4 w-4 text-primary" />
        ) : (
          <Square className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <div className={cn(
        'transition-all',
        isSelected && 'ring-2 ring-primary rounded'
      )}>
        {children}
      </div>
    </div>
  );
}
