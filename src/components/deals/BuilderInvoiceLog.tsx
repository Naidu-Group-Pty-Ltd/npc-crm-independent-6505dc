import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle, Circle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DealLoadingState, DealStatePanel } from '@/components/deals/DealStatePresentation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DealWithClient } from '@/hooks/useAllDeals';

interface Props {
  deals: DealWithClient[];
  isLoading: boolean;
  onUpdatePayment?: (paymentId: string, clientId: string, data: Record<string, unknown>) => void;
  onUpdateDeal?: (dealId: string, clientId: string, data: Record<string, unknown>) => void;
}

export interface InvoiceStage {
  paymentId: string;
  stageName: string;
  stageNumber: number;
  displayOrder: number;
  percentage: number;
  amount: number | null;
  builderInvoiceReceived: boolean;
  builderInvoiceDate: string | null;
  submittedToLender: boolean;
  submittedDate: string | null;
  fundsReleased: boolean;
  fundsReleasedDate: string | null;
  paidToBuilder: boolean;
  paidToBuilderDate: string | null;
  commissionReceived: boolean;
}

export interface BuilderInvoiceProjectRow {
  rowKey: string;
  dealId: string;
  clientId: string;
  clientName: string;
  propertyAddress: string | null;
  persistedStageId: string | null;
  stages: InvoiceStage[];
}

export const isInvoiceStageComplete = (stage: InvoiceStage) =>
  stage.builderInvoiceReceived && stage.submittedToLender && stage.fundsReleased && stage.paidToBuilder;

export function getActiveStage(row: BuilderInvoiceProjectRow, localActiveStageId?: string) {
  const inferredIndex = row.stages.findIndex((stage) => !isInvoiceStageComplete(stage));
  const firstIncompleteIndex = inferredIndex === -1 ? row.stages.length - 1 : inferredIndex;
  const persistedIndex = row.stages.findIndex((stage) => stage.paymentId === (localActiveStageId || row.persistedStageId));

  // A persisted stage may remain ahead of a corrected historical stage. Do not
  // move the project backwards when an authorised user repairs old stage data.
  return row.stages[Math.max(firstIncompleteIndex, persistedIndex)] || row.stages[0];
}

export function getAvailableStages(row: BuilderInvoiceProjectRow, activeStage: InvoiceStage) {
  const activeIndex = row.stages.findIndex((stage) => stage.paymentId === activeStage.paymentId);
  return row.stages.slice(0, activeIndex + 1);
}

export function getSelectedStage(row: BuilderInvoiceProjectRow, localStageId?: string, localActiveStageId?: string) {
  const activeStage = getActiveStage(row, localActiveStageId);
  const availableStages = getAvailableStages(row, activeStage);
  return availableStages.find((stage) => stage.paymentId === localStageId) || activeStage;
}

export function buildBuilderInvoiceProjectRows(deals: DealWithClient[]): BuilderInvoiceProjectRow[] {
  return deals.flatMap((deal) => {
    const stages = (deal.buildPayments || [])
      .map((payment): InvoiceStage => ({
        paymentId: payment.id,
        stageName: payment.stage_name,
        stageNumber: payment.stage_number,
        displayOrder: payment.display_order ?? payment.stage_number,
        percentage: payment.percentage,
        amount: deal.build_price ? deal.build_price * payment.percentage / 100 : payment.amount,
        builderInvoiceReceived: payment.builder_invoice_received || false,
        builderInvoiceDate: payment.builder_invoice_date,
        submittedToLender: payment.submitted_to_lender || false,
        submittedDate: payment.submitted_to_lender_date,
        fundsReleased: payment.funds_released || false,
        fundsReleasedDate: payment.funds_released_date,
        paidToBuilder: payment.paid_to_builder || false,
        paidToBuilderDate: payment.paid_to_builder_date,
        commissionReceived: payment.commission_received || false,
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder || a.stageNumber - b.stageNumber);

    if (!stages.length) return [];
    return [{
      rowKey: deal.id,
      dealId: deal.id,
      clientId: deal.client_id,
      clientName: deal.client_name || 'Unknown',
      propertyAddress: deal.property_address,
      persistedStageId: deal.builder_invoice_current_payment_id,
      stages,
    }];
  });
}

export function BuilderInvoiceLog({ deals, isLoading, onUpdatePayment, onUpdateDeal }: Props) {
  const projectRows = useMemo(() => buildBuilderInvoiceProjectRows(deals), [deals]);
  const [selectedStages, setSelectedStages] = useState<Record<string, string>>({});
  const [activeStages, setActiveStages] = useState<Record<string, string>>({});

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(value);
  const formatStatusDate = (date: string) => format(new Date(date), 'dd/MM/yy');

  function StatusDate({ date }: { date: string }) {
    return <span className="inline-flex min-w-[4.25rem] items-center justify-center rounded-full border border-success/25 bg-success/10 px-2 py-1 text-[11px] font-semibold tabular-nums text-success">{formatStatusDate(date)}</span>;
  }

  function ToggleCheck({ value, field, dateField, stage, row, activeStage }: { value: boolean; field: string; dateField?: string; stage: InvoiceStage; row: BuilderInvoiceProjectRow; activeStage: InvoiceStage }) {
    const icon = value ? <CheckCircle className="h-4 w-4" /> : <Circle className="h-3.5 w-3.5" />;
    if (!onUpdatePayment) {
      return <span className={cn('mx-auto flex h-7 w-7 items-center justify-center rounded-full border', value ? 'border-success/25 bg-success/10 text-success' : 'border-brand-500/20 bg-brand-500/10 text-brand-700 dark:text-brand-300')}>{icon}</span>;
    }
    const handleToggle = () => {
      const newValue = !value;
      const update = {
        [field]: newValue,
        ...(dateField ? { [dateField]: newValue ? new Date().toISOString().split('T')[0] : null } : {}),
      };
      onUpdatePayment(stage.paymentId, row.clientId, update);

      const completionFieldMap: Record<string, keyof InvoiceStage> = {
        builder_invoice_received: 'builderInvoiceReceived',
        submitted_to_lender: 'submittedToLender',
        funds_released: 'fundsReleased',
        paid_to_builder: 'paidToBuilder',
      };
      const completionField = completionFieldMap[field];
      const updatedStage = completionField ? { ...stage, [completionField]: newValue } : stage;
      if (stage.paymentId === activeStage.paymentId && isInvoiceStageComplete(updatedStage)) {
        const activeIndex = row.stages.findIndex((option) => option.paymentId === activeStage.paymentId);
        const nextStage = row.stages[activeIndex + 1];
        if (nextStage) {
          setActiveStages((current) => ({ ...current, [row.dealId]: nextStage.paymentId }));
          setSelectedStages((current) => ({ ...current, [row.dealId]: nextStage.paymentId }));
          onUpdateDeal?.(row.dealId, row.clientId, { builder_invoice_current_payment_id: nextStage.paymentId });
        }
      }
    };
    return <button type="button" onClick={handleToggle} className={cn('mx-auto flex h-7 w-7 items-center justify-center rounded-full border transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', value ? 'border-success/25 bg-success/10 text-success' : 'border-brand-500/20 bg-brand-500/10 text-brand-700 hover:border-brand-500/35 dark:text-brand-300')} aria-label={`${value ? 'Clear' : 'Mark'} ${field.replace(/_/g, ' ')}`}>{icon}</button>;
  }

  if (isLoading) return <DealLoadingState title="Loading builder invoices" description="Checking build payment stages and invoice receipt status." />;
  if (!projectRows.length) return <DealStatePanel icon={<FileText className="h-7 w-7 text-brand-200" />} eyebrow="Builder invoices" title="No build progress payments found" description="Builder invoice tracking will appear when House & Land deals include real build payment stages." />;

  return (
    <Card className="min-w-0 overflow-hidden rounded-[1.35rem] border-brand-200/15 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_36%),linear-gradient(145deg,rgba(255,255,255,0.065),rgba(24,24,27,0.90)_48%,rgba(0,0,0,0.72))] shadow-[0_22px_60px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.07)]">
      <CardHeader className="border-b border-brand-100/10 bg-background px-4 py-4 dark:bg-black/15 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1"><CardTitle className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><FileText className="h-4 w-4" /></span>Builder Invoice Log</CardTitle><p className="text-xs text-muted-foreground sm:text-sm">Construction progress payment ledger and invoice status controls.</p></div>
          <Badge variant="outline" className="w-fit rounded-full border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{projectRows.length} {projectRows.length === 1 ? 'project' : 'projects'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 p-3 sm:p-4">
        <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-brand-100/15 bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] dark:bg-background/45 [scrollbar-color:rgba(245,158,11,0.42)_rgba(24,24,27,0.78)] [scrollbar-width:thin]">
          <Table className="min-w-[900px]">
            <TableHeader className="sticky top-0 z-10 bg-background/85 backdrop-blur"><TableRow className="hover:bg-transparent">
              {['Client', 'Stage', '%', 'Amount', 'Invoice', 'Submitted', 'Funds', 'Paid', 'Comm.'].map((heading, index) => <TableHead key={heading} className={cn('whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground', index >= 2 && index <= 3 && 'text-right', index >= 4 && 'text-center')}>{heading}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>{projectRows.map((row) => {
              const activeStage = getActiveStage(row, activeStages[row.dealId]);
              const availableStages = getAvailableStages(row, activeStage);
              const stage = getSelectedStage(row, selectedStages[row.dealId], activeStages[row.dealId]);
              if (!stage) return null;
              const toggle = (value: boolean, field: string, dateField?: string) => <ToggleCheck value={value} field={field} dateField={dateField} stage={stage} row={row} activeStage={activeStage} />;
              return <TableRow className="group border-brand-100/10 hover:bg-brand-300/[0.055]" key={row.rowKey}>
                <TableCell className="px-4 py-4"><div className="whitespace-nowrap text-xs font-semibold text-foreground sm:text-sm">{row.clientName}</div>{row.propertyAddress && <div className="mt-1 max-w-[15rem] truncate text-[11px] text-muted-foreground" title={row.propertyAddress}>{row.propertyAddress}</div>}</TableCell>
                <TableCell className="min-w-[12rem] px-4 py-4"><Select value={stage.paymentId} onValueChange={(paymentId) => setSelectedStages((current) => ({ ...current, [row.dealId]: paymentId }))} disabled={!onUpdateDeal}><SelectTrigger className="h-9 min-w-[11rem] border-brand-200/20 bg-background/75 text-xs focus:ring-primary/40" aria-label={`Construction stage for ${row.clientName}`}><SelectValue /></SelectTrigger><SelectContent>{availableStages.map((option) => <SelectItem key={option.paymentId} value={option.paymentId}>{option.stageName} — {option.paymentId === activeStage.paymentId ? 'Current' : 'Completed'}</SelectItem>)}</SelectContent></Select></TableCell>
                <TableCell className="px-4 py-4 text-right font-mono text-xs tabular-nums sm:text-sm">{stage.percentage}%</TableCell>
                <TableCell className="px-4 py-4 text-right font-mono text-xs tabular-nums sm:text-sm">{stage.amount != null ? formatCurrency(stage.amount) : <span className="text-muted-foreground/60">Not set</span>}</TableCell>
                <TableCell className="px-4 py-4 text-center">{stage.builderInvoiceDate && stage.builderInvoiceReceived ? <StatusDate date={stage.builderInvoiceDate} /> : toggle(stage.builderInvoiceReceived, 'builder_invoice_received', 'builder_invoice_date')}</TableCell>
                <TableCell className="px-4 py-4 text-center">{stage.submittedDate && stage.submittedToLender ? <StatusDate date={stage.submittedDate} /> : toggle(stage.submittedToLender, 'submitted_to_lender', 'submitted_to_lender_date')}</TableCell>
                <TableCell className="px-4 py-4 text-center">{stage.fundsReleasedDate && stage.fundsReleased ? <StatusDate date={stage.fundsReleasedDate} /> : toggle(stage.fundsReleased, 'funds_released', 'funds_released_date')}</TableCell>
                <TableCell className="px-4 py-4 text-center">{stage.paidToBuilderDate && stage.paidToBuilder ? <StatusDate date={stage.paidToBuilderDate} /> : toggle(stage.paidToBuilder, 'paid_to_builder', 'paid_to_builder_date')}</TableCell>
                <TableCell className="px-4 py-4 text-center">{stage.commissionReceived ? <Badge variant="outline" className="rounded-full border-success/25 bg-success/10 px-2.5 py-1 text-[10px] font-semibold text-success">Paid</Badge> : toggle(stage.commissionReceived, 'commission_received', 'commission_received_date')}</TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
