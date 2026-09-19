import { useState } from 'react';
import { format } from 'date-fns';
import { FileSignature, Plus, Package, ShieldCheck, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  useComplianceRecords, useCompliancePacks, COMPLIANCE_TYPE_LABEL,
  type ComplianceRecord, type ComplianceRecordType, type ComplianceStatus,
} from '@/hooks/useComplianceRecords';

interface Props {
  clientId: string;
  dealId?: string | null;
}

const STATUS_TONE: Record<ComplianceStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_signature: 'bg-brand-500/10 text-brand-700 border-brand-500/30',
  signed: 'bg-success/10 text-success border-success/30',
  expired: 'bg-destructive/10 text-destructive border-destructive/30',
  superseded: 'bg-muted text-muted-foreground',
  voided: 'bg-destructive/10 text-destructive border-destructive/30',
};

export function ComplianceTab({ clientId, dealId }: Props) {
  const { records, isLoading, createVersion, updateStatus, remove } = useComplianceRecords({ clientId });
  const { packs, generate: generatePack } = useCompliancePacks(clientId);

  const [createOpen, setCreateOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [form, setForm] = useState<{ type: ComplianceRecordType; title: string; notes: string }>({
    type: 'bid', title: '', notes: '',
  });
  const [packTypes, setPackTypes] = useState<Set<ComplianceRecordType>>(new Set());
  const [shareWithClient, setShareWithClient] = useState(false);

  const currentRecords = records.filter(r => r.is_current);
  const historyRecords = records.filter(r => !r.is_current);

  const handleCreate = () => {
    if (!form.title) return;
    createVersion({
      client_id: clientId,
      deal_id: dealId || null,
      type: form.type,
      title: form.title,
      notes: form.notes,
      status: 'draft',
      content: { manual: true },
    });
    setCreateOpen(false);
    setForm({ type: 'bid', title: '', notes: '' });
  };

  const handleGeneratePack = () => {
    const ids = currentRecords.filter(r => packTypes.has(r.type)).map(r => r.id);
    const types = Array.from(packTypes);
    if (ids.length === 0) return;
    generatePack({
      client_id: clientId,
      deal_id: dealId || undefined,
      included_record_ids: ids,
      included_types: types,
      shared_with_client: shareWithClient,
    });
    setPackOpen(false);
    setPackTypes(new Set());
    setShareWithClient(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Compliance Records
          </h3>
          <p className="text-xs text-muted-foreground">Versioned records with audit history</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPackOpen(true)} className="gap-1">
            <Package className="h-4 w-4" /> Generate Pack
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1">
            <Plus className="h-4 w-4" /> New Record
          </Button>
        </div>
      </div>

      {/* CURRENT RECORDS */}
      {isLoading ? <Skeleton className="h-32 w-full" /> : currentRecords.length === 0 ? (
        <Card><CardContent className="text-center py-8 text-sm text-muted-foreground flex flex-col items-center gap-2">
          <AlertCircle className="h-8 w-8 text-muted-foreground/40" /> No compliance records yet.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {currentRecords.map(r => (
            <Card key={r.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">{COMPLIANCE_TYPE_LABEL[r.type]}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.title}</p>
                  </div>
                  <Badge className={`text-[10px] border ${STATUS_TONE[r.status]} capitalize`}>{r.status.replace(/_/g, ' ')}</Badge>
                </div>
              </CardHeader>
              <CardContent className="text-xs space-y-1 pt-0">
                <div className="flex justify-between text-muted-foreground">
                  <span>v{r.version} · {format(new Date(r.generated_at), 'dd MMM yy')}</span>
                  {r.signed_at && <span className="text-success">Signed {format(new Date(r.signed_at), 'dd MMM')}</span>}
                </div>
                <div className="flex gap-1 mt-2">
                  {r.status !== 'signed' && (
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() =>
                      updateStatus({ id: r.id, status: 'signed', signed_at: new Date().toISOString(), signed_by_name: 'Manual' })}
                    >Mark Signed</Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive ml-auto"
                    onClick={() => { if (confirm('Delete this record?')) remove(r.id); }}>×</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* HISTORY */}
      {historyRecords.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show {historyRecords.length} superseded version(s)</summary>
          <ul className="mt-2 space-y-1 pl-4">
            {historyRecords.map(r => (
              <li key={r.id} className="flex justify-between text-muted-foreground">
                <span>{COMPLIANCE_TYPE_LABEL[r.type]} v{r.version}</span>
                <span>{format(new Date(r.generated_at), 'dd MMM yy')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* PACK EXPORTS */}
      {packs.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Compliance Pack Exports</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {packs.map(p => (
                <li key={p.id} className="flex justify-between items-center py-1 border-b last:border-0">
                  <span>{format(new Date(p.generated_at), 'dd MMM yy HH:mm')} · {p.included_types.length} record(s)</span>
                  {p.shared_with_client && <Badge variant="outline" className="text-[10px]">Shared</Badge>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* CREATE MODAL */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileSignature className="h-5 w-5" /> New Compliance Record</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as ComplianceRecordType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(COMPLIANCE_TYPE_LABEL) as ComplianceRecordType[]).map(t => (
                    <SelectItem key={t} value={t}>{COMPLIANCE_TYPE_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. BID Statement — Loan #2024-001" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
            <p className="text-xs text-muted-foreground">A new version will be created and prior versions of this type will be superseded automatically.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.title}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PACK GENERATION */}
      <Dialog open={packOpen} onOpenChange={setPackOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Package className="h-5 w-5" /> Generate Compliance Pack</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Select current records to bundle into a single PDF pack.</p>
            <div className="space-y-1">
              {currentRecords.map(r => (
                <label key={r.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer hover:bg-muted/30 rounded px-2">
                  <Checkbox
                    checked={packTypes.has(r.type)}
                    onCheckedChange={(c) => {
                      const next = new Set(packTypes);
                      if (c) next.add(r.type); else next.delete(r.type);
                      setPackTypes(next);
                    }}
                  />
                  {COMPLIANCE_TYPE_LABEL[r.type]} <span className="text-xs text-muted-foreground">v{r.version}</span>
                </label>
              ))}
              {currentRecords.length === 0 && <p className="text-xs text-muted-foreground py-2">No current records to include.</p>}
            </div>
            <label className="flex items-center gap-2 text-sm pt-2">
              <Checkbox checked={shareWithClient} onCheckedChange={(c) => setShareWithClient(!!c)} />
              Share with client portal
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPackOpen(false)}>Cancel</Button>
            <Button onClick={handleGeneratePack} disabled={packTypes.size === 0}>Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
