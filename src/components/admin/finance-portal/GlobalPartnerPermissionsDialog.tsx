import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { Loader2, Save, Trash2, Shield } from 'lucide-react';
import {
  FinancePermissionMatrixEditor,
  EMPTY_MATRIX,
  normalizeMatrix,
  type FinancePermissionMatrix,
} from './FinancePermissionMatrix';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partner: { portal_user_id: string; contact_name: string; contact_email: string } | null;
  onSaved?: () => void;
}

/**
 * Per-finance-partner GLOBAL permission template.
 * - When enabled, these permissions cascade to every client this partner is assigned to.
 * - Per-client matrices remain independent and can only GRANT additional permissions on
 *   top of the global baseline (OR-merge). They never remove what the global allows.
 * - Disabling clears the global; per-client matrices then behave exactly as before.
 */
export function GlobalPartnerPermissionsDialog({ open, onOpenChange, partner, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [matrix, setMatrix] = useState<FinancePermissionMatrix>(EMPTY_MATRIX);

  useEffect(() => {
    if (!open || !partner) return;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await invokeSecureFunction('finance-portal-admin', {
          operation: 'get_partner_global_permissions',
          finance_user_id: partner.portal_user_id,
        });
        if (error) throw new Error(error.message);
        const has = !!data?.has_global;
        setEnabled(has);
        setMatrix(has ? normalizeMatrix(data?.global_permissions) : EMPTY_MATRIX);
      } catch (e: any) {
        toast.error(e.message || 'Failed to load global permissions');
      } finally {
        setLoading(false);
      }
    })();
  }, [open, partner]);

  const save = async () => {
    if (!partner) return;
    setSaving(true);
    try {
      const { error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'update_partner_global_permissions',
        finance_user_id: partner.portal_user_id,
        clear: !enabled,
        permissions: enabled ? matrix : null,
      });
      if (error) throw new Error(error.message);
      toast.success(enabled ? 'Global permissions saved' : 'Global permissions disabled');
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Global Permissions
          </DialogTitle>
          <DialogDescription>
            {partner ? (
              <>
                Baseline permissions for <span className="font-medium text-foreground">{partner.contact_name}</span>.
                When enabled, these apply to every client this partner is assigned to (current and future).
                Per-client matrices can still add extra permissions on top, but they will never remove what the global allows.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="global-perms-toggle" className="text-sm font-medium">
                  Enable global baseline
                </Label>
                <p className="text-xs text-muted-foreground">
                  When off, only per-client matrices apply (current behaviour).
                </p>
              </div>
              <Switch
                id="global-perms-toggle"
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={saving}
              />
            </div>

            <div className={enabled ? '' : 'pointer-events-none opacity-50'}>
              <FinancePermissionMatrixEditor matrix={matrix} onChange={setMatrix} disabled={saving || !enabled} />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading} className="gap-2">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : enabled ? (
              <Save className="h-4 w-4" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {enabled ? 'Save Global Permissions' : 'Disable Global'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
