import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, FileText, Clock, ChevronRight, Trash2, Check } from 'lucide-react';
import { LenderCombobox } from '@/components/clients/LenderCombobox';
import {
  useLenderSubmissions, useSubmissionDocs, useSubmissionTimeline,
  STATUS_LABEL, STATUS_PIPELINE, LenderSubmission, LenderSubmissionStatus,
} from '@/hooks/useLenderSubmissions';
import { cn } from '@/lib/utils';

interface Props { clientId: string; dealId?: string; }

const STATUS_VARIANT: Record<LenderSubmissionStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  pre_assessment: 'bg-info/10 text-info dark:text-info',
  submitted: 'bg-brand-500/10 text-brand-600 dark:text-brand-400',
  conditional_approval: 'bg-primary/10 text-primary',
  unconditional_approval: 'bg-primary/15 text-primary',
  loan_docs_issued: 'bg-primary/20 text-primary',
  settled: 'bg-success/15 text-success',
  declined: 'bg-destructive/10 text-destructive',
  withdrawn: 'bg-muted text-muted-foreground',
};

export function LenderSubmissionsPanel({ clientId, dealId }: Props) {
  const { submissions, isLoading, create, transition, remove } = useLenderSubmissions({ clientId });
  const [selected, setSelected] = useState<LenderSubmission | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ lender_name: '', loan_amount: '', interest_rate: '', notes: '' });

  const handleCreate = () => {
    if (!form.lender_name) return;
    create({
      client_id: clientId,
      deal_id: dealId,
      lender_id: form.lender_name.toLowerCase().replace(/\s+/g, '-'),
      lender_name: form.lender_name,
      loan_amount: form.loan_amount ? parseFloat(form.loan_amount) : null,
      interest_rate: form.interest_rate ? parseFloat(form.interest_rate) : null,
      notes: form.notes || null,
      status: 'draft',
    });
    setNewOpen(false);
    setForm({ lender_name: '', loan_amount: '', interest_rate: '', notes: '' });
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Lender Submissions</CardTitle>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New submission</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New lender submission</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Lender</Label>
                <LenderCombobox value={form.lender_name} onChange={(v) => setForm(f => ({ ...f, lender_name: v }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Loan amount</Label>
                  <Input type="number" value={form.loan_amount} onChange={(e) => setForm(f => ({ ...f, loan_amount: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Rate (%)</Label>
                  <Input type="number" step="0.01" value={form.interest_rate} onChange={(e) => setForm(f => ({ ...f, interest_rate: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!form.lender_name}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading...</div>
        ) : submissions.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No submissions yet. Click "New submission" to create one.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {submissions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className="w-full flex items-center justify-between p-3 hover:bg-muted/30 text-left"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{s.lender_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.loan_amount ? `$${s.loan_amount.toLocaleString('en-AU')}` : '—'}
                    {s.interest_rate ? ` · ${s.interest_rate.toFixed(2)}%` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={cn("text-[10px]", STATUS_VARIANT[s.status])}>{STATUS_LABEL[s.status]}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>

      {selected && (
        <SubmissionDetailDialog
          submission={selected}
          onClose={() => setSelected(null)}
          onTransition={(to_status, decline_reason) => transition({ id: selected.id, to_status, decline_reason })}
          onDelete={() => { remove(selected.id); setSelected(null); }}
        />
      )}
    </Card>
  );
}

function SubmissionDetailDialog({
  submission, onClose, onTransition, onDelete,
}: {
  submission: LenderSubmission;
  onClose: () => void;
  onTransition: (s: LenderSubmissionStatus, declineReason?: string) => void;
  onDelete: () => void;
}) {
  const { docs, add, updateStatus, remove } = useSubmissionDocs(submission.id);
  const { data: timeline } = useSubmissionTimeline(submission.id);
  const [docName, setDocName] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const currentIdx = STATUS_PIPELINE.indexOf(submission.status);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl h-[90vh] p-0 flex flex-col">
        <DialogHeader className="p-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            {submission.lender_name}
            <Badge className={cn("text-[10px]", STATUS_VARIANT[submission.status])}>{STATUS_LABEL[submission.status]}</Badge>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {/* Pipeline */}
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">Pipeline</div>
              <div className="flex items-center gap-1 flex-wrap">
                {STATUS_PIPELINE.map((s, i) => (
                  <div key={s} className="flex items-center gap-1">
                    <div className={cn(
                      "px-2 py-1 rounded text-[10px] font-medium",
                      i <= currentIdx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}>
                      {STATUS_LABEL[s]}
                    </div>
                    {i < STATUS_PIPELINE.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {STATUS_PIPELINE.slice(currentIdx + 1, currentIdx + 2).map(next => (
                  <Button key={next} size="sm" onClick={() => onTransition(next)}>
                    Advance to {STATUS_LABEL[next]}
                  </Button>
                ))}
                {submission.status !== 'declined' && submission.status !== 'settled' && submission.status !== 'withdrawn' && (
                  <>
                    <Dialog>
                      <DialogTrigger asChild><Button size="sm" variant="destructive">Decline</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Decline reason</DialogTitle></DialogHeader>
                        <Textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Why was this declined?" />
                        <DialogFooter>
                          <Button variant="destructive" onClick={() => onTransition('declined', declineReason)} disabled={!declineReason}>Confirm decline</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <Button size="sm" variant="outline" onClick={() => onTransition('withdrawn')}>Withdraw</Button>
                  </>
                )}
              </div>
            </div>

            <Tabs defaultValue="documents">
              <TabsList>
                <TabsTrigger value="documents"><FileText className="h-3 w-3 mr-1" /> Documents</TabsTrigger>
                <TabsTrigger value="timeline"><Clock className="h-3 w-3 mr-1" /> Timeline</TabsTrigger>
              </TabsList>

              <TabsContent value="documents" className="space-y-3">
                <div className="flex gap-2">
                  <Input placeholder="Document name (e.g. Payslip Jan 2026)" value={docName} onChange={(e) => setDocName(e.target.value)} />
                  <Button size="sm" onClick={() => { if (docName) { add({ doc_type: 'supporting', doc_name: docName }); setDocName(''); } }}>Add</Button>
                </div>
                <div className="space-y-1">
                  {docs.length === 0 ? (
                    <div className="text-sm text-muted-foreground p-4 text-center">No documents yet.</div>
                  ) : docs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between p-2 rounded border border-border">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{d.doc_name}</div>
                        <div className="text-[10px] text-muted-foreground">{d.doc_type}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select value={d.status} onValueChange={(v) => updateStatus({ doc_id: d.id, status: v as any })}>
                          <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="required">Required</SelectItem>
                            <SelectItem value="received">Received</SelectItem>
                            <SelectItem value="verified">Verified</SelectItem>
                            <SelectItem value="waived">Waived</SelectItem>
                          </SelectContent>
                        </Select>
                        {d.status === 'verified' && <Check className="h-4 w-4 text-success" />}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(d.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="timeline">
                <div className="space-y-2">
                  {(timeline ?? []).length === 0 ? (
                    <div className="text-sm text-muted-foreground p-4 text-center">No events yet.</div>
                  ) : (timeline ?? []).map((e) => (
                    <div key={e.id} className="flex gap-3 text-sm">
                      <div className="text-xs text-muted-foreground tabular-nums shrink-0 w-24">
                        {new Date(e.created_at).toLocaleDateString('en-AU')}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{e.event_label}</div>
                        {e.payload?.from && <div className="text-xs text-muted-foreground">{e.payload.from} → {e.payload.to}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>

            {submission.decline_reason && (
              <div className="p-3 rounded border border-destructive/30 bg-destructive/5 text-sm">
                <div className="font-medium text-destructive mb-1">Decline reason</div>
                <div className="text-muted-foreground">{submission.decline_reason}</div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t flex justify-between">
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete submission
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
