import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { Loader2, Save, Settings } from 'lucide-react';
import { FinancePermissionMatrixEditor, EMPTY_MATRIX, normalizeMatrix, type FinancePermissionMatrix } from './FinancePermissionMatrix';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (matrix: FinancePermissionMatrix) => void;
}

export function DefaultPermissionsDialog({ open, onOpenChange, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [matrix, setMatrix] = useState<FinancePermissionMatrix>(EMPTY_MATRIX);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await invokeSecureFunction('finance-portal-admin', {
          operation: 'get_default_permissions',
        });
        if (error) throw new Error(error.message);
        setMatrix(normalizeMatrix(data?.record?.permissions));
      } catch (e: any) {
        toast.error(e.message || 'Failed to load defaults');
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'update_default_permissions',
        permissions: matrix,
      });
      if (error) throw new Error(error.message);
      toast.success('Default permissions saved');
      onSaved?.(matrix);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden rounded-2xl border-border/70 bg-card/95 p-0 shadow-2xl shadow-black/15 backdrop-blur">
        <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-card/90 to-muted/25 p-5">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-xl tracking-tight">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Settings className="h-5 w-5" />
            </span>
            <span className="truncate">Default Permission Template</span>
          </DialogTitle>
          <DialogDescription className="leading-6">
            New client assignments will start with these permissions. Existing assignments are not changed.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-14">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[58vh] overflow-auto p-5">
            <FinancePermissionMatrixEditor matrix={matrix} onChange={setMatrix} disabled={saving} />
          </div>
        )}
        <DialogFooter className="border-t border-border/60 bg-muted/20 p-5">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="rounded-xl">Cancel</Button>
          <Button onClick={save} disabled={saving || loading} className="gap-2 rounded-xl">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Defaults
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
