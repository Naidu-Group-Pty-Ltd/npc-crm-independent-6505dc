import { Switch } from '@/components/ui/switch';
import { CheckCircle2 } from 'lucide-react';

/**
 * "This property is owned outright."
 *
 * ## Why a control rather than just a zero
 *
 * `loan_remaining: 0` already means no loan everywhere downstream — equity,
 * LVR and serviceability all read it correctly. What the property forms had no
 * way to do was SAY it: the loan input renders `value={loan_remaining || ''}`,
 * so a recorded zero and an unrecorded loan draw the same empty box, and the
 * interest rate and repayment fields sat there beside it inviting a figure
 * that does not exist. An operator with a client who owns their home outright
 * could not tell whether they had recorded that or merely not got to it — the
 * 19 Sep 2026 clone audit's "there is no way to save the property as loan
 * settled or no loan remaining".
 *
 * ## What it does and does not do
 *
 * It is a VIEW of the loan figures, not a new column. Turning it on writes
 * `loan_remaining: 0` and clears the rate and the repayment, which is what
 * "owned outright" means in the numbers the rest of the product already reads;
 * turning it off restores an editable loan block with nothing in it. Adding a
 * column would create a second place that says whether there is a loan, and
 * the two would eventually disagree.
 */
export function OwnedOutrightToggle({
  ownedOutright,
  onChange,
  disabled,
}: {
  ownedOutright: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <CheckCircle2
          className={ownedOutright ? 'h-4 w-4 shrink-0 text-success' : 'h-4 w-4 shrink-0 text-muted-foreground'}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">Owned outright</p>
          <p className="text-xs text-muted-foreground">
            No loan remaining. Clears the loan balance, rate and repayment.
          </p>
        </div>
      </div>
      <Switch
        checked={ownedOutright}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label="This property is owned outright, with no loan remaining"
      />
    </div>
  );
}
