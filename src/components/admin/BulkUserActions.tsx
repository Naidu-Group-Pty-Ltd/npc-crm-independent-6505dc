import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { Trash2, UserCheck, UserX } from 'lucide-react';

interface BulkUserActionsProps {
  selectedIds: Set<string>;
  currentUserId: string;
  onToggleSelect: (userId: string) => void;
  onSelectAll: (userIds: string[]) => void;
  onClearSelection: () => void;
  onRefresh: () => void;
}

export function BulkUserActions({ selectedIds, currentUserId, onToggleSelect, onSelectAll, onClearSelection, onRefresh }: BulkUserActionsProps) {
  const [confirmAction, setConfirmAction] = useState<'activate' | 'deactivate' | 'delete' | null>(null);
  const [processing, setProcessing] = useState(false);

  const count = selectedIds.size;
  if (count === 0) return null;

  const handleBulkAction = async (action: 'activate' | 'deactivate' | 'delete') => {
    setProcessing(true);
    const ids = Array.from(selectedIds).filter(id => id !== currentUserId);
    let successCount = 0;

    for (const userId of ids) {
      try {
        if (action === 'delete') {
          const { data } = await invokeSecureFunction('admin-user-management', { action: 'delete_user', user_id: userId });
          if (data?.success) successCount++;
        } else {
          const { data } = await invokeSecureFunction('admin-user-management', {
            action: 'update_user', user_id: userId, is_active: action === 'activate'
          });
          if (data?.success) successCount++;
        }
      } catch { /* continue */ }
    }

    toast.success(`${action === 'delete' ? 'Deleted' : action === 'activate' ? 'Activated' : 'Deactivated'} ${successCount}/${ids.length} users`);
    logActivityDirect({
      actionType: action === 'delete' ? 'user_deactivated' : action === 'activate' ? 'user_activated' : 'user_deactivated',
      entityType: 'user', entityName: `Bulk ${action}`,
      metadata: { action: `bulk_${action}`, count: successCount }
    });
    onClearSelection();
    onRefresh();
    setProcessing(false);
    setConfirmAction(null);
  };

  return (
    <>
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
        <span className="text-sm font-medium">{count} user(s) selected</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setConfirmAction('activate')} disabled={processing}>
          <UserCheck className="h-4 w-4 mr-1" /> Activate
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirmAction('deactivate')} disabled={processing}>
          <UserX className="h-4 w-4 mr-1" /> Deactivate
        </Button>
        <Button variant="destructive" size="sm" onClick={() => setConfirmAction('delete')} disabled={processing}>
          <Trash2 className="h-4 w-4 mr-1" /> Delete
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearSelection}>Clear</Button>
      </div>

      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Bulk {confirmAction}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will {confirmAction} {count} selected user(s). {confirmAction === 'delete' && 'Users will be soft-deleted and can be restored later.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && handleBulkAction(confirmAction)}
              className={confirmAction === 'delete' ? 'bg-destructive text-destructive-foreground' : ''}
            >
              {processing ? 'Processing...' : `${confirmAction} ${count} users`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export { type BulkUserActionsProps };
