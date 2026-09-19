import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Copy } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { logActivityDirect } from '@/hooks/useActivityLogger';

interface User {
  id: string;
  username: string;
  user_roles: Array<{ role: string }>;
}

interface ClonePermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceUserId: string;
  users: User[];
  onSuccess: () => void;
}

export function ClonePermissionsDialog({ open, onOpenChange, sourceUserId, users, onSuccess }: ClonePermissionsDialogProps) {
  const [targetUserId, setTargetUserId] = useState('');
  const [cloning, setCloning] = useState(false);

  const sourceUser = users.find(u => u.id === sourceUserId);
  // Every account other than the source is a valid target, superadmins
  // included. Excluding them left no way to seed a superadmin's stored grid —
  // the rows that decide their access the moment the role is taken away.
  const eligibleTargets = users.filter(u => u.id !== sourceUserId);

  const handleClone = async () => {
    if (!targetUserId) { toast.error('Select a target user'); return; }
    setCloning(true);
    try {
      // Fetch source permissions
      const { data: sourceData } = await invokeSecureFunction('admin-user-management', {
        action: 'get_user_permissions', user_id: sourceUserId
      });
      if (!sourceData?.success) { toast.error('Failed to fetch source permissions'); return; }

      const perms = sourceData.permissions.map((p: any) => ({
        module_key: p.dashboard_modules?.module_key,
        can_view: p.can_view, can_edit: p.can_edit, can_delete: p.can_delete,
      })).filter((p: any) => p.module_key && p.can_view);

      // Apply to target
      const { data } = await invokeSecureFunction('admin-user-management', {
        action: 'update_permissions', user_id: targetUserId, permissions: perms,
      });

      if (data?.success) {
        const targetUser = users.find(u => u.id === targetUserId);
        toast.success(`Permissions cloned from ${sourceUser?.username} to ${targetUser?.username}`);
        logActivityDirect({
          actionType: 'user_permissions_changed', entityType: 'user',
          entityId: targetUserId, entityName: targetUser?.username,
          metadata: { action: 'cloned_from', source_user: sourceUser?.username, source_user_id: sourceUserId }
        });
        onOpenChange(false);
        onSuccess();
      } else {
        toast.error(data?.error || 'Failed to clone permissions');
      }
    } catch { toast.error('Failed to clone permissions'); }
    finally { setCloning(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Copy className="h-5 w-5" /> Clone Permissions</DialogTitle>
          <DialogDescription>
            Copy all permissions from <strong>{sourceUser?.username}</strong> to another user. This will overwrite the target user's existing permissions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Target User</Label>
            <Select value={targetUserId} onValueChange={setTargetUserId}>
              <SelectTrigger><SelectValue placeholder="Select user to copy permissions to..." /></SelectTrigger>
              <SelectContent>
                {eligibleTargets.map(u => (
                  <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleClone} disabled={cloning || !targetUserId} className="w-full">
            {cloning ? 'Cloning...' : 'Clone Permissions'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
