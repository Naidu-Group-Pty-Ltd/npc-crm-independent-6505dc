import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { DollarSign, Bell, CheckCircle, Clock, Circle, ReceiptText, Send, Banknote, Calendar as CalendarIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { DealWithClient } from '@/hooks/useAllDeals';
import { agentFeeEntry, agentFeeReceiptPatch } from '@/lib/deals/commissionModel.pure';
import { pipelineBadgeClass } from '@/components/deals/pipelineBadgeStyles';
import { DealLoadingState, NoResultsState } from '@/components/deals/DealStatePresentation';


const kpiCardBase = 'relative overflow-hidden rounded-2xl border shadow-xl shadow-sm dark:shadow-black/5 before:absolute before:inset-x-6 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent';
const tableShellClass = 'overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-xl shadow-sm dark:shadow-black/5';
const tableHeaderClass = '[&_tr]:border-b [&_tr]:border-border/70 [&_th]:bg-muted/55 [&_th]:py-3 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.16em] [&_th]:text-muted-foreground';
const rowHoverClass = 'border-border/55 transition-colors hover:bg-brand-500/5 data-[state=selected]:bg-muted';
const emptyDashClass = 'inline-flex min-w-6 justify-center rounded-full border border-dashed border-border/80 bg-muted/35 px-2 py-0.5 font-mono text-xs text-muted-foreground';

/**
 * The day a commission was received, editable in place.
 *
 * `agentFeeReceiptPatch` is the one rule that writes the flag and the date
 * together, so correcting the date goes through it rather than writing the
 * column directly — otherwise a correction could leave `commission_received`
 * and `commission_received_date` disagreeing, which is the shape
 * `healFinanceIdentity` exists to repair elsewhere.
 */
function ReceiptDateCell({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (isoDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs font-normal"
          title="Change the date this commission was received"
          aria-label="Change the date this commission was received"
        >
          <CalendarIcon className="h-3 w-3 text-muted-foreground" />
          {selected ? format(selected, 'dd MMM yyyy') : 'Set date'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) onChange(format(date, 'yyyy-MM-dd'));
            setOpen(false);
          }}
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

interface Props {
  deals: DealWithClient[];
  isLoading: boolean;
  onUpdatePayment?: (paymentId: string, clientId: string, data: any) => void;
  /**
   * Writes an agent fee's receipt, which lives on the deal rather than on a
   * build payment. Without it those rows still SHOW — a fee nobody can mark
   * received is still a fee that is owed — they simply carry no controls.
   */
  onUpdateDeal?: (dealId: string, clientId: string, data: any) => void;
}

interface CommissionRow {
  /**
   * Which table the row's toggles write to. A house-and-land deal earns its
   * commission stage by stage and each stage is a `build_progress_payments`
   * row; an existing-property purchase or a refinance earns a single agent
   * fee recorded on `client_deals` itself.
   *
   * The dashboard was built out of build payments alone, so a deal type with
   * no payment schedule contributed nothing to the table, nothing to Total
   * Expected and nothing to Total Received — invisible on the one screen
   * that exists to show what the agency is owed.
   */
  source: 'build_payment' | 'deal';
  /** The build payment's id, or the deal's — see `source`. */
  recordId: string;
  dealId: string;
  clientId: string;
  clientName: string;
  stageName: string;
  stageNumber: number;
  percentage: number;
  amount: number | null;
  builderInvoiceReceived: boolean;
  submittedToLender: boolean;
  fundsReleased: boolean;
  commissionReceived: boolean;
  commissionReceivedDate: string | null;
  commissionAmount: number | null;
  buildPrice: number | null;
}

export function CommissionDashboard({ deals, isLoading, onUpdatePayment, onUpdateDeal }: Props) {
  const commissionRows = useMemo(() => {
    const rows: CommissionRow[] = [];
    for (const deal of deals) {
      // A deal paid once rather than per stage contributes exactly one row.
      // `agentFeeEntry` answers null for house-and-land, so the two branches
      // can never both fire and double-count the same commission.
      const fee = agentFeeEntry(deal);
      if (fee) {
        rows.push({
          source: 'deal',
          recordId: deal.id,
          dealId: deal.id,
          clientId: deal.client_id,
          clientName: deal.client_name || 'Unknown',
          stageName: fee.label,
          stageNumber: 0,
          percentage: 0,
          amount: null,
          builderInvoiceReceived: false,
          submittedToLender: false,
          fundsReleased: false,
          commissionReceived: fee.received,
          commissionReceivedDate: fee.receivedDate,
          commissionAmount: fee.amount,
          buildPrice: null,
        });
      }
      const payments = deal.buildPayments || [];
      for (const p of payments) {
        if (!p.is_commission_trigger) continue;
        rows.push({
          source: 'build_payment',
          recordId: p.id,
          dealId: deal.id,
          clientId: deal.client_id,
          clientName: deal.client_name || 'Unknown',
          stageName: p.stage_name,
          stageNumber: p.stage_number,
          percentage: p.percentage,
          amount: deal.build_price ? (deal.build_price * p.percentage / 100) : p.amount,
          builderInvoiceReceived: p.builder_invoice_received || false,
          submittedToLender: p.submitted_to_lender || false,
          fundsReleased: p.funds_released || false,
          commissionReceived: p.commission_received || false,
          commissionReceivedDate: p.commission_received_date,
          commissionAmount: p.commission_amount,
          buildPrice: deal.build_price,
        });
      }
    }
    return rows;
  }, [deals]);

  const stats = useMemo(() => {
    const pending = commissionRows.filter(r => !r.commissionReceived);
    const received = commissionRows.filter(r => r.commissionReceived);
    const pendingSlabs = pending.filter(r => r.stageName === 'Slab/Base');
    const pendingFrames = pending.filter(r => r.stageName === 'Frame');
    const totalReceived = received.reduce((s, r) => s + (r.commissionAmount || 0), 0);
    // Only stages with a set commission amount count — a missing amount is
    // "not recorded", never a guessed figure.
    const totalExpected = pending.reduce((s, r) => s + (r.commissionAmount || 0), 0);
    const totalPending = pending.length;
    return { pending, received, pendingSlabs, pendingFrames, totalReceived, totalExpected, totalPending };
  }, [commissionRows]);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val);

  function ToggleCheck({ value, field, row }: { value: boolean; field: string; row: CommissionRow }) {
    // Builder invoice, lender submission and funds release are build-payment
    // facts. An agent fee has none of them, and drawing an unticked circle
    // would read as an outstanding step rather than as an inapplicable one.
    if (row.source === 'deal') {
      return <span className={emptyDashClass}>—</span>;
    }
    if (!onUpdatePayment) {
      return value ? (
        <CheckCircle className="h-4 w-4 text-success mx-auto" />
      ) : (
        <span className={emptyDashClass}>—</span>
      );
    }

    const dateField = field === 'builder_invoice_received' ? 'builder_invoice_date'
      : field === 'submitted_to_lender' ? 'submitted_to_lender_date'
      : field === 'funds_released' ? 'funds_released_date'
      : field === 'commission_received' ? 'commission_received_date'
      : null;

    const handleToggle = () => {
      const newVal = !value;
      const update: any = { [field]: newVal };
      if (dateField) {
        update[dateField] = newVal ? new Date().toISOString().split('T')[0] : null;
      }
      onUpdatePayment(row.recordId, row.clientId, update);
    };

    const iconTone = field === 'funds_released'
      ? 'text-success bg-success/10 border-success/25'
      : field === 'submitted_to_lender'
        ? 'text-info bg-info/10 border-info/25'
        : field === 'builder_invoice_received'
          ? 'text-brand-700 bg-brand-500/10 border-brand-500/25'
          : 'text-success bg-success/10 border-success/25';

    return (
      <button
        onClick={handleToggle}
        className={cn(
          'mx-auto inline-flex h-8 w-8 items-center justify-center rounded-full border transition-all hover:-translate-y-0.5 hover:scale-105 hover:shadow-md',
          value ? iconTone : 'border-border/70 bg-muted/30 text-muted-foreground/45 hover:border-brand-300/60 hover:bg-brand-500/10 hover:text-brand-700'
        )}
        title={`Toggle ${field.replace(/_/g, ' ')}`}
      >
        {value ? <CheckCircle className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
      </button>
    );
  }

  if (isLoading) {
    return (
      <DealLoadingState title="Loading commission dashboard" description="Reviewing commission triggers, invoice dates and received funds without estimating missing values." />
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card className={cn(kpiCardBase, 'border-brand-300/45 bg-gradient-to-br from-brand-50 via-card to-warning/80 dark:from-brand-950/35 dark:via-card dark:to-warning/20')}>
          <CardContent className="p-4 text-center sm:p-5">
            <Clock className="mx-auto mb-2 h-5 w-5 text-brand-600" />
            <p className="text-2xl font-black tabular-nums text-brand-700 sm:text-3xl">{stats.totalPending}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-800/75 dark:text-brand-200/80">Pending</p>
            {stats.totalExpected > 0 && (
              <p className="mt-0.5 text-[10px] font-semibold tabular-nums text-brand-700/80 dark:text-brand-200/70">{formatCurrency(stats.totalExpected)} expected</p>
            )}
          </CardContent>
        </Card>
        <Card className={cn(kpiCardBase, 'border-brand-300/35 bg-gradient-to-br from-card via-brand-50/70 to-card dark:via-brand-950/20')}>
          <CardContent className="p-4 text-center sm:p-5">
            <Bell className="mx-auto mb-2 h-5 w-5 text-brand-600" />
            <p className="text-2xl font-black tabular-nums text-brand-700 sm:text-3xl">{stats.pendingSlabs.length}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Slab Pending</p>
          </CardContent>
        </Card>
        <Card className={cn(kpiCardBase, 'border-warning/35 bg-gradient-to-br from-card via-warning/70 to-card dark:via-warning/20')}>
          <CardContent className="p-4 text-center sm:p-5">
            <Bell className="mx-auto mb-2 h-5 w-5 text-warning" />
            <p className="text-2xl font-black tabular-nums text-warning sm:text-3xl">{stats.pendingFrames.length}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Frame Pending</p>
          </CardContent>
        </Card>
        <Card className={cn(kpiCardBase, 'border-success/40 bg-gradient-to-br from-success via-card to-success/80 dark:from-success/30 dark:via-card dark:to-success/20')}>
          <CardContent className="p-4 text-center sm:p-5">
            <CheckCircle className="mx-auto mb-2 h-5 w-5 text-success" />
            <p className="text-2xl font-black tabular-nums text-success sm:text-3xl">{stats.received.length}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-success/70 dark:text-success/80">Received</p>
          </CardContent>
        </Card>
        <Card className={cn(kpiCardBase, 'col-span-2 border-success/45 bg-gradient-to-br from-success via-card to-success/80 dark:from-success/30 dark:via-card dark:to-success/20 sm:col-span-1')}>
          <CardContent className="p-4 text-center sm:p-5">
            <DollarSign className="mx-auto mb-2 h-5 w-5 text-success" />
            <p className="text-xl font-black tabular-nums text-success sm:text-2xl">{formatCurrency(stats.totalReceived)}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-success/70 dark:text-success/80">Total Received</p>
          </CardContent>
        </Card>
      </div>

      {/* Pending Commissions */}
      <Card className="overflow-hidden rounded-2xl border-brand-200/45 bg-gradient-to-br from-card via-card to-brand-50/35 shadow-xl shadow-sm dark:shadow-black/5 dark:border-brand-900/40 dark:to-brand-950/15">
        <CardHeader className="border-b border-brand-200/35 bg-brand-500/5 pb-3">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand-500" />
            Pending Commission Triggers
          </CardTitle>
          <p className="text-[11px] leading-4 text-muted-foreground">
            Draw % and Draw amount are the bank's progress payment for the stage. Commission is what the agency is owed when that stage pays — set per stage because it varies builder to builder (configure stages on the client's deal, amounts here or there).
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className={cn(tableShellClass, 'max-w-full overflow-auto rounded-none border-0 shadow-none')}>
            <Table>
              <TableHeader className={tableHeaderClass}>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Client</TableHead>
                  <TableHead className="whitespace-nowrap">Stage / basis</TableHead>
                  <TableHead className="text-right whitespace-nowrap hidden sm:table-cell">Draw %</TableHead>
                  <TableHead className="text-right whitespace-nowrap hidden sm:table-cell">Draw amount</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Commission</TableHead>
                  <TableHead className="text-center whitespace-nowrap">Invoice</TableHead>
                  <TableHead className="text-center whitespace-nowrap hidden sm:table-cell">Submitted</TableHead>
                  <TableHead className="text-center whitespace-nowrap">Funds</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.pending.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="p-4">
                      <NoResultsState title="No pending commission triggers" description="There are no commission events waiting in this view. Received and zero-value states remain visible where recorded." />
                    </TableCell>
                  </TableRow>
                ) : (
                  stats.pending.map((row, idx) => (
                    <TableRow key={`${row.dealId}-${row.stageNumber}-${idx}`} className={rowHoverClass}>
                      <TableCell className="py-3.5 font-semibold text-xs sm:text-sm whitespace-nowrap">{row.clientName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Bell className="h-3.5 w-3.5 text-brand-500 shrink-0" />
                          <span className="text-xs sm:text-sm">{row.stageName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-xs font-semibold text-muted-foreground sm:table-cell">{row.source === 'deal' ? <span className={emptyDashClass}>—</span> : `${row.percentage}%`}</TableCell>
                      <TableCell className="hidden text-right text-xs font-bold text-brand-700 tabular-nums sm:table-cell sm:text-sm">{row.amount ? formatCurrency(row.amount) : <span className={emptyDashClass}>—</span>}</TableCell>
                      <TableCell className="text-right">
                        {(row.source === 'deal' ? onUpdateDeal : onUpdatePayment) ? (
                          <Input
                            key={`${row.recordId}-comm-${row.commissionAmount ?? 'unset'}`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            defaultValue={row.commissionAmount ?? ''}
                            placeholder="$"
                            aria-label={`Commission amount for ${row.clientName} — ${row.stageName}`}
                            title={row.source === 'deal'
                              ? 'The agent fee this deal earns, paid once rather than per stage'
                              : 'Commission the agency is owed at this stage (varies builder to builder)'}
                            className="ml-auto h-8 w-24 text-right font-mono text-xs"
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              const parsed = raw === '' ? null : Number(raw);
                              const next = parsed !== null && Number.isFinite(parsed) ? parsed : null;
                              if ((next ?? null) === (row.commissionAmount ?? null)) return;
                              // A build payment keeps its own `commission_amount`;
                              // an agent fee IS the deal's `commission_estimate`,
                              // which is the figure Financial Controls edits — one
                              // number in one column, reachable from both screens.
                              if (row.source === 'deal') {
                                onUpdateDeal?.(row.dealId, row.clientId, { commission_estimate: next });
                              } else {
                                onUpdatePayment?.(row.recordId, row.clientId, { commission_amount: next });
                              }
                            }}
                          />
                        ) : (
                          <span className="text-xs font-bold tabular-nums text-brand-700">
                            {row.commissionAmount ? formatCurrency(row.commissionAmount) : <span className={emptyDashClass}>—</span>}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <ToggleCheck value={row.builderInvoiceReceived} field="builder_invoice_received" row={row} />
                      </TableCell>
                      <TableCell className="text-center hidden sm:table-cell">
                        <ToggleCheck value={row.submittedToLender} field="submitted_to_lender" row={row} />
                      </TableCell>
                      <TableCell className="text-center">
                        <ToggleCheck value={row.fundsReleased} field="funds_released" row={row} />
                      </TableCell>
                      <TableCell>
                        {/* The status pill is a reading, not a control: it
                            used to BE the button, so clicking "Awaiting" to
                            see what it meant silently marked the commission
                            received. The act now has its own labelled button. */}
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          {row.source === 'deal' ? (
                            <Badge variant="outline" className={pipelineBadgeClass('warning', false, 'whitespace-nowrap')}><DollarSign className="mr-1 h-3 w-3" />Agent fee</Badge>
                          ) : row.fundsReleased ? (
                            <Badge className={pipelineBadgeClass('warning', false, 'whitespace-nowrap')}><Banknote className="mr-1 h-3 w-3" />Awaiting</Badge>
                          ) : row.submittedToLender ? (
                            <Badge variant="outline" className={pipelineBadgeClass('warning', false, 'whitespace-nowrap')}><Send className="mr-1 h-3 w-3" />Submitted</Badge>
                          ) : row.builderInvoiceReceived ? (
                            <Badge variant="outline" className={pipelineBadgeClass('warning', false, 'whitespace-nowrap')}><ReceiptText className="mr-1 h-3 w-3" />Invoice</Badge>
                          ) : (
                            <span className={emptyDashClass}>—</span>
                          )}
                          {(row.source === 'deal' ? onUpdateDeal : onUpdatePayment) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 shrink-0 rounded-full border-success/35 bg-success/5 px-2.5 text-[11px] font-semibold text-success hover:bg-success/10"
                              title="Record that this commission payment has been received"
                              onClick={() => {
                                // The flag and the date are set together, by the
                                // one rule both surfaces use.
                                const patch = agentFeeReceiptPatch(true, new Date().toISOString().split('T')[0]);
                                if (row.source === 'deal') {
                                  onUpdateDeal?.(row.dealId, row.clientId, patch);
                                } else {
                                  onUpdatePayment?.(row.recordId, row.clientId, patch);
                                }
                              }}
                            >
                              Mark received
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Received Commissions */}
      {stats.received.length > 0 && (
        <Card className="overflow-hidden rounded-2xl border-success/45 bg-gradient-to-br from-card via-card to-success/35 shadow-xl shadow-sm dark:shadow-black/5 dark:border-success/40 dark:to-success/15">
          <CardHeader className="border-b border-success/35 bg-success/5 pb-3">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-success" />
              Received Commissions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className={cn(tableShellClass, 'max-w-full overflow-auto rounded-none border-0 shadow-none')}>
              <Table>
                <TableHeader className={tableHeaderClass}>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Client</TableHead>
                    <TableHead className="whitespace-nowrap">Stage / basis</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
                    <TableHead className="whitespace-nowrap">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.received.map((row, idx) => (
                    <TableRow key={`recv-${row.dealId}-${row.stageNumber}-${idx}`} className="border-border/55 transition-colors hover:bg-success/5">
                      <TableCell className="py-3.5 font-semibold text-xs sm:text-sm">{row.clientName}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{row.stageName}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold text-brand-700 sm:text-sm">
                        {row.commissionAmount ? formatCurrency(row.commissionAmount) : <span className={emptyDashClass}>—</span>}
                      </TableCell>
                      {/*
                        The date the money arrived, not the date somebody
                        clicked. "Mark received" stamps today and this column
                        was read-only, so an agent recording a payment that
                        cleared on Friday had no way to say Friday — asked for
                        in the 19 Sep 2026 clone audit. Editable only where the
                        surface can write; otherwise it reads as before.
                      */}
                      <TableCell className="text-xs sm:text-sm">
                        {(row.source === 'deal' ? onUpdateDeal : onUpdatePayment) ? (
                          <ReceiptDateCell
                            value={row.commissionReceivedDate}
                            onChange={(next) => {
                              const patch = agentFeeReceiptPatch(true, next);
                              if (row.source === 'deal') {
                                onUpdateDeal?.(row.dealId, row.clientId, patch);
                              } else {
                                onUpdatePayment?.(row.recordId, row.clientId, patch);
                              }
                            }}
                          />
                        ) : row.commissionReceivedDate ? (
                          format(new Date(row.commissionReceivedDate), 'dd MMM yyyy')
                        ) : (
                          <span className={emptyDashClass}>—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
