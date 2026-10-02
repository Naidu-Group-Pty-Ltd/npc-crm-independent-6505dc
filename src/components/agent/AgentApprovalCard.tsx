/**
 * AgentApprovalCard — the moment Aurixa asks before it acts.
 *
 * The agent already refuses to send, create or change anything without a
 * person's yes; the old surface was two small buttons under the reply. This
 * frames that moment as what it is — a colleague holding a finished piece of
 * work out for sign-off — and names the work in plain words ("Send an email ·
 * Settlement update") from the tool call itself. The email preview the widget
 * already drew is passed in unchanged as `children`, and Approve / Cancel call
 * the same `confirm-action` path they always did.
 */
import type { ReactNode } from 'react';
import { Check, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { summarisePendingActions } from '@/lib/agent/toolNarration.pure';
import { domainIcon } from './domainIcon';

interface AgentApprovalCardProps {
  toolCalls?: unknown[];
  status?: 'pending' | 'approved' | 'rejected';
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
  children?: ReactNode;
}

export function AgentApprovalCard({ toolCalls, status, busy, onApprove, onReject, children }: AgentApprovalCardProps) {
  const actions = summarisePendingActions(toolCalls);
  const pending = status === 'pending';
  const heading = pending
    ? 'Needs your go-ahead'
    : status === 'approved'
      ? 'Approved'
      : status === 'rejected'
        ? 'Cancelled'
        : 'Proposed action';

  return (
    <div className="aurixa-approval mt-2.5" data-status={status ?? 'proposed'}>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <ShieldCheck className={cn('h-3.5 w-3.5 shrink-0', pending ? 'text-brand' : 'text-muted-foreground')} aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {heading}
        </span>
      </div>

      <ul className="space-y-1.5 px-3 pb-2 pt-2">
        {actions.length === 0 ? (
          <li className="text-[13px] font-medium text-foreground">This action needs your approval</li>
        ) : (
          actions.map((a) => {
            const Icon = domainIcon(a.domain);
            return (
              <li key={`${a.name}-${a.detail ?? ''}`} className="flex items-start gap-2.5">
                <span className="aurixa-approval__icon mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium leading-snug text-foreground">{a.title}</span>
                  {a.detail && <span className="block truncate text-[12px] text-muted-foreground">{a.detail}</span>}
                </span>
              </li>
            );
          })
        )}
      </ul>

      {children && <div className="px-3 pb-2.5">{children}</div>}

      {status === 'pending' && (
        <div className="flex gap-2 border-t border-[hsl(var(--aurixa-glass-border)/0.5)] px-3 py-2.5">
          <Button size="sm" variant="default" className="h-8 flex-1 text-xs" onClick={onApprove} disabled={busy}>
            <Check className="mr-1 h-3.5 w-3.5" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="h-8 flex-1 text-xs" onClick={onReject} disabled={busy}>
            <XCircle className="mr-1 h-3.5 w-3.5" /> Cancel
          </Button>
        </div>
      )}
      {status === 'approved' && (
        <p className="flex items-center gap-1 border-t border-[hsl(var(--aurixa-glass-border)/0.5)] px-3 py-2 text-xs text-primary">
          <Check className="h-3 w-3" /> Approved &amp; executed
        </p>
      )}
      {status === 'rejected' && (
        <p className="flex items-center gap-1 border-t border-[hsl(var(--aurixa-glass-border)/0.5)] px-3 py-2 text-xs text-destructive">
          <XCircle className="h-3 w-3" /> Cancelled
        </p>
      )}
    </div>
  );
}
