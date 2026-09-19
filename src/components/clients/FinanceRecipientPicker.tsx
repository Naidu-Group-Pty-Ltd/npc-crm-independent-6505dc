/**
 * "Send to Finance" — who, asked at the moment of sending.
 *
 * ## What this replaces
 *
 * The menu item used to read *Send to Graham Turnbull*, and no one had chosen
 * him. The recipient was `finance_agent_contacts` ordered by `is_default`, and
 * in production no contact carries that flag — so the name on a production menu
 * was whichever row Postgres returned first. It happened to be the one partner
 * with no Finance Portal account at all, which `share-report-with-finance`
 * refuses; the document was rendered, uploaded nowhere, and the toast said the
 * send had failed for a person nobody had picked.
 *
 * So this asks. One dialog, listing the partners the send function itself
 * reports for this client, with the reason beside any it would refuse.
 *
 * ## The rules it renders
 *
 *   • The client's assigned partner is first and preselected, badged as the
 *     assigned one — nine clients in seven hundred and seventy-five have an
 *     assignment, so where there is one it is nearly always the answer.
 *   • A partner the send would refuse is shown, disabled, with the refusal —
 *     hiding them would leave "no finance partners" on screen for a client that
 *     plainly has one, and the fix (assign them, or invite them to the portal)
 *     is not discoverable from an absence.
 *   • Nothing eligible is an empty state that names the screen that fixes it,
 *     never a dead end.
 */
import { useEffect, useState } from 'react';
import { AlertCircle, Building2, Check, Loader2, Send, UserCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  useFinanceReportRecipients,
  type FinanceReportRecipient,
} from '@/hooks/useFinanceReportRecipients';

export interface FinanceRecipientPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  /** What is being sent, for the sentence above the list. */
  documentLabel?: string;
  /**
   * How it will reach them, which decides who may be chosen.
   *
   * Audit item 12. `'portal'` is the Finance Portal share, and a partner
   * without a portal account cannot receive that — so they are listed with
   * the refusal and cannot be selected. `'email'` needs an address and
   * nothing else, so that refusal does not apply and must not disable them:
   * the whole point of composing an email is reaching a partner the portal
   * share cannot.
   */
  deliveryMode?: 'portal' | 'email';
  /** Disabled while the caller is producing or sending the document. */
  busy?: boolean;
  onConfirm: (recipient: FinanceReportRecipient) => void;
}

/** Assigned partners first, then the rest of the eligible, then the blocked. */
function order(recipients: FinanceReportRecipient[]): FinanceReportRecipient[] {
  const rank = (recipient: FinanceReportRecipient) => {
    if (!recipient.eligible) return 3;
    if (recipient.is_assigned_to_client) return 0;
    if (recipient.is_client_finance_contact) return 1;
    return 2;
  };
  return [...recipients].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function FinanceRecipientPicker({
  open,
  onOpenChange,
  clientId,
  clientName,
  documentLabel = 'this report',
  deliveryMode = 'portal',
  busy = false,
  onConfirm,
}: FinanceRecipientPickerProps) {
  const byEmail = deliveryMode === 'email';
  /** Selectable here — not the same question as eligible for the portal. */
  const canReceive = (recipient: FinanceReportRecipient) =>
    byEmail ? Boolean(recipient.email) : recipient.eligible;
  const { recipients, eligible, suggested, isLoading, error, refetch } = useFinanceReportRecipients(
    clientId,
    open,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Preselect once the list settles, and again if the dialog is reopened for a
  // different client. Never overwrite a choice the person has already made.
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) => current ?? suggested?.id ?? null);
  }, [open, suggested?.id]);

  const selected = (byEmail ? recipients : eligible).find(
    (recipient) => recipient.id === selectedId && canReceive(recipient),
  ) ?? null;
  const rows = order(recipients);

  return (
    <Dialog open={open} onOpenChange={busy ? () => undefined : onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-lg sm:p-0">
        <DialogHeader className="shrink-0 space-y-1.5 border-b border-border/60 p-4 sm:p-6">
          <DialogTitle className="flex items-center gap-2 pr-8 text-left">
            <Send className="h-5 w-5 text-info" aria-hidden="true" />
            Send to Finance
          </DialogTitle>
          <DialogDescription className="text-left">
            Choose the finance partner who should receive {documentLabel} for {clientName}
            {byEmail ? ' by email.' : ' through the Finance Portal.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {isLoading && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading finance partners…
            </p>
          )}

          {!isLoading && error && (
            <div className="space-y-3 py-4 text-sm" role="alert">
              <p className="flex items-start gap-2 text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Unable to load finance partners. {error.message}</span>
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          )}

          {!isLoading && !error && rows.length === 0 && (
            <div className="space-y-2 py-4 text-sm">
              <p className="font-medium text-foreground">
                No finance partner is currently assigned to this client.
              </p>
              <p className="text-muted-foreground">
                Finance partners are added in Settings → Finance Agent Contacts, then assigned to a
                client in Admin → Finance Portal.
              </p>
            </div>
          )}

          {!isLoading && !error && rows.length > 0 && (
            <div className="space-y-2" role="radiogroup" aria-label="Finance partners">
              {!byEmail && eligible.length === 0 && (
                <p className="mb-3 text-sm text-muted-foreground">
                  No finance partner is currently able to receive this client's reports. Assign one
                  to this client in Admin → Finance Portal, or invite them to the Finance Portal
                  first.
                </p>
              )}
              {rows.map((recipient) => {
                const isSelected = recipient.id === selectedId;
                return (
                  <button
                    key={recipient.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={!canReceive(recipient) || busy}
                    onClick={() => setSelectedId(recipient.id)}
                    className={cn(
                      'glass-inset flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      canReceive(recipient) ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                      isSelected && 'border-primary/50 ring-1 ring-primary/30',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-sm font-medium text-foreground">
                          {recipient.name}
                        </span>
                        {recipient.is_assigned_to_client && (
                          <span className="dashboard-status-chip dashboard-status-chip-success">
                            <UserCheck className="h-3 w-3" aria-hidden="true" />
                            Assigned to this client
                          </span>
                        )}
                      </span>
                      {recipient.company && (
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{recipient.company}</span>
                        </span>
                      )}
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {recipient.email}
                      </span>
                      {/* The refusal, said here rather than after the document
                          has been produced and the send rejected. */}
                      {!recipient.eligible && recipient.blocked_message && (
                        <span className="mt-1.5 block text-xs text-warning">
                          {recipient.blocked_message}
                          {byEmail && ' They can still be emailed.'}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border/60 p-4 sm:p-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selected || busy}
            onClick={() => selected && onConfirm(selected)}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {busy ? 'Sending…' : byEmail ? 'Compose email' : 'Send report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
