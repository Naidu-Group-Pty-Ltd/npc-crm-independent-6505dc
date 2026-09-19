import { useMemo, useState } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { AlarmClock, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { parseNaturalDate } from '@/lib/financeNaturalDate';

const QUICK_OPTIONS = [
  { label: 'In 1 hour', value: 'in 1 hour' },
  { label: 'Tomorrow 9am', value: 'tomorrow 9am' },
  { label: 'Mon 9am', value: 'monday 9am' },
  { label: 'Next week', value: 'next week' },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  purchaseFileId?: string;
  clientId?: string;
  fileIds?: string[]; // for bulk
  onDone?: () => void;
}

export function SmartSnoozeDialog({
  open, onOpenChange, purchaseFileId, clientId, fileIds, onDone,
}: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [raw, setRaw] = useState('tomorrow 9am');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const parsed = useMemo(() => parseNaturalDate(raw), [raw]);
  const isBulk = !!fileIds?.length;

  const handleSubmit = async () => {
    if (!parsed) { toast.error('Could not understand that time'); return; }
    setSubmitting(true);
    try {
      if (isBulk) {
        const { data, error } = await invokeFinanceFunction('finance-portal-bulk-actions', {
          operation: 'bulk_snooze',
          file_ids: fileIds,
          raw_input: raw,
          snooze_until: parsed.toISOString(),
          reason,
        });
        if (error) throw new Error(error.message);
        toast.success(`Snoozed ${data?.processed ?? 0} file(s)`);
      } else {
        const { error } = await invokeFinanceFunction('finance-portal-snoozes', {
          operation: 'create',
          payload: {
            scope: purchaseFileId ? 'purchase_file' : clientId ? 'client' : 'general',
            purchase_file_id: purchaseFileId,
            client_id: clientId,
            raw_input: raw,
            snooze_until: parsed.toISOString(),
            reason,
          },
        });
        if (error) throw new Error(error.message);
        toast.success(`Reminder set for ${parsed.toLocaleString('en-AU')}`);
      }
      onOpenChange(false);
      setReason('');
      onDone?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to snooze');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlarmClock className="h-5 w-5 text-primary" />
            Smart Snooze {isBulk && `(${fileIds!.length} files)`}
          </DialogTitle>
          <DialogDescription>
            Type when you want to be reminded. Try natural phrases like "tomorrow 9am",
            "in 3 days", "next Monday" or "Friday 2pm".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="snooze-input">When to remind me</Label>
            <Input
              id="snooze-input"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="tomorrow 9am"
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {QUICK_OPTIONS.map(o => (
                <Badge
                  key={o.value}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => setRaw(o.value)}
                >
                  {o.label}
                </Badge>
              ))}
            </div>
            {parsed ? (
              <p className="text-xs text-success flex items-center gap-1 pt-1">
                <Sparkles className="h-3 w-3" />
                Parsed: {parsed.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              </p>
            ) : (
              <p className="text-xs text-destructive pt-1">
                Couldn't parse — try "tomorrow 9am" or "in 3 days"
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="snooze-reason">Reason (optional)</Label>
            <Textarea
              id="snooze-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Chase valuation"
              rows={2}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || !parsed}>
            {submitting ? 'Setting…' : 'Snooze'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
