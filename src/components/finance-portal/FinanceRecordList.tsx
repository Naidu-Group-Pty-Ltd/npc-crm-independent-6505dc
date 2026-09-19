import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Pencil, Trash2, Eye, Lock, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { TableConfig } from './financeTableConfig';
import { IncomeSourceForm } from '@/components/clients/income/IncomeSourceForm';
import type { IncomeSource } from '@/components/clients/income/incomeSourceTypes';

interface Props {
  clientId: string;
  config: TableConfig;
}

export function FinanceRecordList({ clientId, config }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);

  const queryKey = ['finance-portal-client-data', clientId, config.key];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-client-data', {
        operation: 'list_records',
        client_id: clientId,
        table_key: config.key,
      });
      if (error) throw new Error(error.message);
      return data as { records: any[]; permission: { view: boolean; edit: boolean; delete: boolean } };
    },
  });

  const permission = data?.permission || { view: false, edit: false, delete: false };
  const records = data?.records || [];

  const saveMutation = useMutation({
    mutationFn: async (vars: { mode: 'create' | 'update'; payload: any; record_id?: string }) => {
      const { data, error } = await invokeFinanceFunction('finance-portal-client-data', {
        operation: vars.mode === 'create' ? 'create_record' : 'update_record',
        client_id: clientId,
        table_key: config.key,
        record_id: vars.record_id,
        payload: vars.payload,
      });
      if (error) {
        const detail = (data && (data.details || data.error)) || error.message;
        throw new Error(String(detail || 'Save failed'));
      }
      return data;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.mode === 'create' ? `${config.singular} created and synced to Command Centre` : `${config.singular} updated and synced to Command Centre`);
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['finance-portal-client-summary', clientId] });
      if (config.key === 'income') {
        qc.invalidateQueries({ queryKey: ['finance-portal-bc', clientId] });
      }
      if (config.key === 'address_history') {
        qc.invalidateQueries({ queryKey: ['finance-portal-pipeline'] });
      }
      setCreating(false);
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message || 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (record_id: string) => {
      const { data, error } = await invokeFinanceFunction('finance-portal-client-data', {
        operation: 'delete_record',
        client_id: clientId,
        table_key: config.key,
        record_id,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      toast.success(`${config.singular} deleted and synced to Command Centre`);
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['finance-portal-client-summary', clientId] });
      if (config.key === 'income') {
        qc.invalidateQueries({ queryKey: ['finance-portal-bc', clientId] });
      }
      if (config.key === 'address_history') {
        qc.invalidateQueries({ queryKey: ['finance-portal-pipeline'] });
      }
      setDeleting(null);
    },
    onError: (e: any) => toast.error(e.message || 'Delete failed'),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const msg = (error as Error).message || 'Failed to load';
    if (msg.includes('No view permission')) {
      return (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <Lock className="h-8 w-8 mx-auto mb-3 opacity-50" />
            You do not have permission to view {config.label.toLowerCase()} for this client.
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-destructive">{msg}</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            {config.label}
            <Badge variant="outline" className="text-xs gap-1">
              <Eye className="h-3 w-3" />
              View
              {permission.edit && <> · <Pencil className="h-3 w-3" /> Edit</>}
              {permission.delete && <> · <Trash2 className="h-3 w-3" /> Delete</>}
            </Badge>
            {config.key === 'income' && (
              <Badge variant="secondary" className="text-xs gap-1">
                <RefreshCw className="h-3 w-3" />
                Command Centre sync
              </Badge>
            )}
          </CardTitle>
          <CardDescription>{config.description}</CardDescription>
        </div>
        {permission.edit && (
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add {config.singular}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground border rounded-lg">
            No {config.label.toLowerCase()} recorded yet.
          </div>
        ) : (
          <div className="space-y-2">
            {records.map(r => (
              <div key={r.id} className="border rounded-lg p-4 flex items-start justify-between gap-3 hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    {r[config.primaryColumn] || '—'}
                    {config.secondaryColumn && r[config.secondaryColumn] && (
                      <span className="text-muted-foreground font-normal ml-2 text-xs">
                        · {r[config.secondaryColumn]}
                      </span>
                    )}
                  </div>
                  {config.renderSummary?.(r) ?? null}
                </div>
                <div className="flex items-center gap-1">
                  {permission.edit && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {permission.delete && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleting(r)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {(creating || editing) && (
        <RecordDialog
          open
          onClose={() => { setCreating(false); setEditing(null); }}
          config={config}
          record={editing}
          onSave={(payload) =>
            saveMutation.mutate({
              mode: editing ? 'update' : 'create',
              payload,
              record_id: editing?.id,
            })
          }
          saving={saveMutation.isPending}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={o => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {config.singular.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The record will be permanently removed and an audit entry created.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function RecordDialog({ open, onClose, config, record, onSave, saving }: {
  open: boolean;
  onClose: () => void;
  config: TableConfig;
  record: any | null;
  onSave: (payload: any) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    for (const f of config.fields) {
      initial[f.key] = record?.[f.key] ?? (f.type === 'boolean' ? false : '');
    }
    return initial;
  });

  const update = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = () => {
    const payload: Record<string, any> = {};
    for (const f of config.fields) {
      const v = form[f.key];
      if (f.required && (v === '' || v == null)) {
        toast.error(`${f.label} is required`);
        return;
      }
      if (v === '' || v == null) {
        payload[f.key] = null;
      } else if (f.type === 'number' || f.type === 'currency' || f.type === 'percent') {
        payload[f.key] = Number(v);
      } else {
        payload[f.key] = v;
      }
    }
    onSave(payload);
  };

  if (config.key === 'income') {
    const contactType: 'primary' | 'secondary' = record?.contact_type === 'secondary' ? 'secondary' : 'primary';

    const handleIncomeSave = (source: IncomeSource) => {
      const { id, client_id, ...payload } = source;
      onSave(payload);
    };

    return (
      <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{record ? 'Edit Income Source' : 'Add Income Source'}</DialogTitle>
            <DialogDescription>
              Uses the same income categories, source types, frequency conversion and annual totals as the Command Centre.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            Saved income is written to the shared Command Centre income source table for transparent account sync.
          </div>

          <IncomeSourceForm
            source={record || undefined}
            contactType={contactType}
            onSave={handleIncomeSave}
            onCancel={onClose}
            isPending={saving}
            hideShading
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{record ? `Edit ${config.singular}` : `Add ${config.singular}`}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          {config.fields.map(f => (
            <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
              <Label className="text-xs flex items-center gap-1">
                {f.label}
                {f.required && <span className="text-destructive">*</span>}
              </Label>
              {f.type === 'select' ? (
                <Select value={form[f.key] || ''} onValueChange={v => update(f.key, v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {f.options?.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === 'textarea' ? (
                <Textarea value={form[f.key] || ''} onChange={e => update(f.key, e.target.value)} rows={4} className="mt-1" />
              ) : f.type === 'boolean' ? (
                <div className="flex items-center gap-2 mt-2">
                  <Switch checked={!!form[f.key]} onCheckedChange={v => update(f.key, v)} />
                  <span className="text-sm text-muted-foreground">{form[f.key] ? 'Yes' : 'No'}</span>
                </div>
              ) : (
                <Input
                  type={f.type === 'date' ? 'date' : f.type === 'number' || f.type === 'currency' || f.type === 'percent' ? 'number' : 'text'}
                  step={f.type === 'percent' ? '0.01' : undefined}
                  value={form[f.key] ?? ''}
                  onChange={e => update(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="mt-1"
                />
              )}
              {f.helpText && <div className="text-xs text-muted-foreground mt-1">{f.helpText}</div>}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {record ? 'Save Changes' : `Create ${config.singular}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
