import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { Loader2, Save, Shield } from 'lucide-react';
import {
  SolicitorPermissionMatrixEditor,
  EMPTY_SOLICITOR_MATRIX,
  normalizeSolicitorMatrix,
  type SolicitorPermissionMatrix,
} from './SolicitorPermissionMatrix';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; name: string } | null;
  onSaved?: () => void;
}

/**
 * Per-solicitor GLOBAL baseline permissions.
 * OR-merged with each per-client matrix — a per-client matrix can only add
 * matter policies can explicitly allow or deny; deny overrides this baseline.
 */
export function SolicitorGlobalPermissionsDialog({ open, onOpenChange, user, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [matrix, setMatrix] = useState<SolicitorPermissionMatrix>(EMPTY_SOLICITOR_MATRIX);

  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await invokeSecureFunction('solicitor-portal-admin', {
          operation: 'get_global_permissions',
          solicitor_user_id: user.id,
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        const has = !!data?.has_global;
        setEnabled(has);
        setMatrix(has ? normalizeSolicitorMatrix(data?.permissions) : EMPTY_SOLICITOR_MATRIX);
      } catch (e: any) {
        toast.error(e.message || 'Failed to load baseline permissions');
      } finally {
        setLoading(false);
      }
    })();
  }, [open, user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { data, error } = await invokeSecureFunction('solicitor-portal-admin', {
        operation: 'update_global_permissions',
        solicitor_user_id: user.id,
        clear: !enabled,
        permissions: enabled ? matrix : null,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(enabled ? 'Baseline permissions saved' : 'Baseline permissions cleared');
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save baseline permissions');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Baseline Permissions
          </DialogTitle>
          <DialogDescription>
            {user ? (
              <>
                Applies to every client <span className="font-medium text-foreground">{user.name}</span> is
                assigned to, now and in future. Per-client matrices can grant extra access on top but never
                remove what the baseline allows.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="flex-1 pr-3">
            <div className="space-y-4 pb-2">
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="space-y-0.5">
                  <Label htmlFor="solicitor-baseline-toggle">Enable baseline permissions</Label>
                  <p className="text-xs text-muted-foreground">
                    When off, only per-client matrices apply.
                  </p>
                </div>
                <Switch id="solicitor-baseline-toggle" checked={enabled} onCheckedChange={setEnabled} />
              </div>
              <SolicitorPermissionMatrixEditor matrix={matrix} onChange={setMatrix} disabled={!enabled} />
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
