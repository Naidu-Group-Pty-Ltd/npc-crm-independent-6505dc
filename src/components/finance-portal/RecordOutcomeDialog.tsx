import { useState } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Trophy } from 'lucide-react';
import { triggerFinanceCelebration } from '@/lib/finance-portal/celebrate';

const REASON_CATEGORIES = [
  'Serviceability', 'LVR / deposit', 'Credit history', 'Employment stability',
  'Property type / location', 'Valuation shortfall', 'Client withdrew',
  'Lost to competitor', 'Documentation', 'Other',
];

interface Props {
  purchaseFileId: string;
  defaultLender?: string | null;
  defaultLoanAmount?: number | null;
  trigger?: React.ReactNode;
  onRecorded?: () => void;
}

export function RecordOutcomeDialog({ purchaseFileId, defaultLender, defaultLoanAmount, trigger, onRecorded }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<'won' | 'lost' | 'withdrawn'>('won');
  const [reasonCategory, setReasonCategory] = useState<string>('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [lender, setLender] = useState(defaultLender || '');
  const [loanAmount, setLoanAmount] = useState(defaultLoanAmount ? String(defaultLoanAmount) : '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const { data, error } = await invokeFinanceFunction('finance-portal-pipeline', {
      operation: 'record_outcome',
      purchase_file_id: purchaseFileId,
      outcome,
      reason_category: reasonCategory || null,
      reason_detail: reasonDetail || null,
      lender: lender || null,
      loan_amount: loanAmount ? Number(loanAmount) : null,
    });
    setSaving(false);
    if (error || data?.error) {
      toast.error(data?.error || 'Failed to record outcome');
    } else {
      toast.success(`Outcome recorded as ${outcome}`);
      if (outcome === 'won') {
        triggerFinanceCelebration('unconditional_approval');
      }
      setOpen(false);
      setReasonCategory('');
      setReasonDetail('');
      onRecorded?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div onClick={() => setOpen(true)} className="contents">
        {trigger || (
          <Button variant="outline" size="sm">
            <Trophy className="h-4 w-4 mr-2" />
            Record outcome
          </Button>
        )}
      </div>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record win / loss outcome</DialogTitle>
          <DialogDescription>Captured for Win/Loss analytics. Wins are also auto-derived from settled files.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Outcome</Label>
            <Select value={outcome} onValueChange={(v) => setOutcome(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="won">Won (settled / approved)</SelectItem>
                <SelectItem value="lost">Lost (declined / not proceeded)</SelectItem>
                <SelectItem value="withdrawn">Withdrawn</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {outcome === 'lost' && (
            <div>
              <Label>Reason category</Label>
              <Select value={reasonCategory} onValueChange={setReasonCategory}>
                <SelectTrigger><SelectValue placeholder="Select reason..." /></SelectTrigger>
                <SelectContent>
                  {REASON_CATEGORIES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Notes</Label>
            <Textarea value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)} placeholder="What happened, lessons learned, etc." rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lender</Label>
              <Input value={lender} onChange={(e) => setLender(e.target.value)} />
            </div>
            <div>
              <Label>Loan amount</Label>
              <Input value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} type="number" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving...' : 'Save outcome'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
