import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Loader2, UserCheck } from 'lucide-react';
import {
  UNDERTAKING_STATUS_LABELS,
  undertakingStatusVariant,
  useLoanWriterUndertakings,
} from '@/hooks/useLoanWriterUndertakings';
import { usePartnerReferralMutations, type PartnerReferral } from '@/hooks/usePartnerReferrals';

const UNASSIGNED = '__unassigned__';

/**
 * Clause 4 gate: an outbound finance referral may only be worked by an individual
 * loan writer with a live Annexure B undertaking. The dropdown deliberately shows
 * only live undertakings — a lapsed one is not a near miss, it is a hard stop.
 */
export default function LoanWriterAssignmentCard({ referral }: { referral: PartnerReferral }) {
  const { data: undertakings = [], isLoading } = useLoanWriterUndertakings({ status: 'active' });
  const { assignLoanWriter } = usePartnerReferralMutations();
  const [selected, setSelected] = useState<string>(UNASSIGNED);

  const live = useMemo(() => undertakings.filter((u) => u.is_live !== false), [undertakings]);
  const current = useMemo(
    () => undertakings.find((u) => u.id === (referral as { loan_writer_undertaking_id?: string }).loan_writer_undertaking_id),
    [undertakings, referral],
  );

  const assigned = !!referral.assigned_loan_writer_name;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-primary" />
          Loan writer (Annexure B)
        </h4>
        {assigned ? (
          <Badge variant="default">{referral.assigned_loan_writer_name}</Badge>
        ) : (
          <Badge variant="outline">Unassigned</Badge>
        )}
      </div>

      {current && (
        <div className="rounded-md border border-border p-2.5 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={undertakingStatusVariant(current.status)}>
              {UNDERTAKING_STATUS_LABELS[current.status]}
            </Badge>
            <span className="font-mono text-muted-foreground">{current.reference}</span>
          </div>
          <p className="text-muted-foreground">
            {current.licensee_name || '—'}
            {current.crn ? ` · CRN ${current.crn}` : ''}
            {current.authorisation_end_date
              ? ` · authorised to ${format(new Date(current.authorisation_end_date), 'dd MMM yyyy')}`
              : ''}
          </p>
        </div>
      )}

      {live.length === 0 && !isLoading ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <span>
            No live loan writer undertakings. Register and activate one before this referral can be submitted.
          </span>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Assign to</Label>
            <Select value={selected} onValueChange={setSelected} disabled={isLoading}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a loan writer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Clear assignment</SelectItem>
                {live.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.writer_full_name}
                    {u.writer_entity_name ? ` — ${u.writer_entity_name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="gap-2"
            disabled={assignLoanWriter.isPending}
            onClick={() =>
              assignLoanWriter.mutate({
                id: referral.id,
                loan_writer_undertaking_id: selected === UNASSIGNED ? null : selected,
              })
            }
          >
            {assignLoanWriter.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
