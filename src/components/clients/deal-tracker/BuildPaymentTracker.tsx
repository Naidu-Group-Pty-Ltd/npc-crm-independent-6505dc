import { useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CalendarIcon, Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BuildProgressPayment } from './types';

interface BuildPaymentTrackerProps {
  payments: BuildProgressPayment[];
  buildPrice: number | null;
  onUpdatePayment: (paymentId: string, data: Partial<BuildProgressPayment>) => void;
}

function DateCell({ value, onChange, label }: { value: string | null; onChange: (v: string | null) => void; label?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs px-1.5 w-full justify-start">
          <CalendarIcon className="h-3 w-3 mr-1 shrink-0" />
          {value ? format(new Date(value), 'dd/MM/yy') : (label || '—')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? new Date(value) : undefined}
          onSelect={(date) => {
            onChange(date ? format(date, 'yyyy-MM-dd') : null);
            setOpen(false);
          }}
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

export function BuildPaymentTracker({ payments, buildPrice, onUpdatePayment }: BuildPaymentTrackerProps) {
  const sorted = [...payments].sort((a, b) => a.display_order - b.display_order);

  const formatCurrency = (val: number | null) => {
    if (!val) return '—';
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val);
  };

  const isStageComplete = (p: BuildProgressPayment) =>
    p.builder_invoice_received && p.submitted_to_lender && p.funds_released && p.paid_to_builder;

  const completedCount = sorted.filter(isStageComplete).length;
  const progressPercent = sorted.length > 0 ? (completedCount / sorted.length) * 100 : 0;


  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground font-medium">{completedCount}/{sorted.length} stages</span>
      </div>

      <div className="overflow-x-auto max-w-full">
        <Table className="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]">#</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-center">Invoice Rcvd</TableHead>
              <TableHead className="text-center">Submitted</TableHead>
              <TableHead className="text-center">Funds Released</TableHead>
              <TableHead className="text-center">Paid Builder</TableHead>
              <TableHead className="text-center">Completed</TableHead>
              <TableHead className="text-center">Commission</TableHead>

            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((p) => {
              const stageAmount = buildPrice ? (buildPrice * p.percentage / 100) : p.amount;
              return (
                <TableRow key={p.id} className={cn(isStageComplete(p) && 'bg-success/5')}>
                  <TableCell className="font-mono text-xs">{p.stage_number}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm">{p.stage_name}</span>
                      {p.is_commission_trigger && (
                        <Bell className="h-3 w-3 text-brand-500" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{p.percentage}%</TableCell>
                  <TableCell className="text-right text-sm">{formatCurrency(stageAmount || null)}</TableCell>

                  {/* Invoice Received */}
                  <TableCell className="text-center">

                    <div className="flex flex-col items-center gap-0.5">
                      <Checkbox
                        checked={p.builder_invoice_received}
                        onCheckedChange={(checked) => onUpdatePayment(p.id, {
                          builder_invoice_received: !!checked,
                          builder_invoice_date: checked ? (p.builder_invoice_date || format(new Date(), 'yyyy-MM-dd')) : null,
                        })}
                      />
                      {p.builder_invoice_received && (
                        <DateCell
                          value={p.builder_invoice_date}
                          onChange={(d) => onUpdatePayment(p.id, { builder_invoice_date: d })}
                        />
                      )}
                    </div>
                  </TableCell>

                  {/* Submitted to Lender */}
                  <TableCell className="text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <Checkbox
                        checked={p.submitted_to_lender}
                        onCheckedChange={(checked) => onUpdatePayment(p.id, {
                          submitted_to_lender: !!checked,
                          submitted_to_lender_date: checked ? (p.submitted_to_lender_date || format(new Date(), 'yyyy-MM-dd')) : null,
                        })}
                      />
                      {p.submitted_to_lender && (
                        <DateCell
                          value={p.submitted_to_lender_date}
                          onChange={(d) => onUpdatePayment(p.id, { submitted_to_lender_date: d })}
                        />
                      )}
                    </div>
                  </TableCell>

                  {/* Funds Released */}
                  <TableCell className="text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <Checkbox
                        checked={p.funds_released}
                        onCheckedChange={(checked) => onUpdatePayment(p.id, {
                          funds_released: !!checked,
                          funds_released_date: checked ? (p.funds_released_date || format(new Date(), 'yyyy-MM-dd')) : null,
                        })}
                      />
                      {p.funds_released && (
                        <DateCell
                          value={p.funds_released_date}
                          onChange={(d) => onUpdatePayment(p.id, { funds_released_date: d })}
                        />
                      )}
                    </div>
                  </TableCell>

                  {/* Paid to Builder */}
                  <TableCell className="text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <Checkbox
                        checked={p.paid_to_builder}
                        onCheckedChange={(checked) => onUpdatePayment(p.id, {
                          paid_to_builder: !!checked,
                          paid_to_builder_date: checked ? (p.paid_to_builder_date || format(new Date(), 'yyyy-MM-dd')) : null,
                        })}
                      />
                      {p.paid_to_builder && (
                        <DateCell
                          value={p.paid_to_builder_date}
                          onChange={(d) => onUpdatePayment(p.id, { paid_to_builder_date: d })}
                        />
                      )}
                    </div>
                  </TableCell>

                  {/* Completed — derived final status */}
                  <TableCell className="text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <Checkbox checked={isStageComplete(p)} disabled aria-readonly />
                      {isStageComplete(p) && p.paid_to_builder_date && (
                        <span className="text-[10px] text-success">{format(new Date(p.paid_to_builder_date), 'dd/MM/yy')}</span>
                      )}
                    </div>
                  </TableCell>

                  {/* Commission — which stages pay one, and how much, varies
                      builder to builder, so both are set here per stage. */}
                  <TableCell className="text-center">
                    <div className="flex flex-col items-center gap-1">
                      <label
                        className="flex cursor-pointer items-center gap-1.5 text-[10px] font-medium text-muted-foreground"
                        title={p.is_commission_trigger
                          ? 'This stage pays a commission — untick if this builder does not pay one here'
                          : 'Tick if this builder pays a commission at this stage'}
                      >
                        <Checkbox
                          className="h-3.5 w-3.5"
                          checked={p.is_commission_trigger}
                          aria-label={`${p.stage_name} pays a commission`}
                          onCheckedChange={(checked) => onUpdatePayment(p.id, {
                            is_commission_trigger: !!checked,
                            // A stage that stops being a trigger cannot stay "received".
                            ...(checked ? {} : { commission_received: false, commission_received_date: null }),
                          })}
                        />
                        Pays commission
                      </label>
                      {p.is_commission_trigger && (
                        <>
                          <Input
                            key={`${p.id}-comm-${p.commission_amount ?? 'unset'}`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            defaultValue={p.commission_amount ?? ''}
                            placeholder="Amount $"
                            aria-label={`Commission amount for ${p.stage_name}`}
                            title="Commission owed to the agency at this stage"
                            className="h-7 w-24 text-right font-mono text-xs"
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              const parsed = raw === '' ? null : Number(raw);
                              const next = parsed !== null && Number.isFinite(parsed) ? parsed : null;
                              if ((next ?? null) !== (p.commission_amount ?? null)) {
                                onUpdatePayment(p.id, { commission_amount: next });
                              }
                            }}
                          />
                          <div className="flex items-center gap-1.5">
                            <Checkbox
                              checked={p.commission_received}
                              aria-label={`Commission received for ${p.stage_name}`}
                              onCheckedChange={(checked) => onUpdatePayment(p.id, {
                                commission_received: !!checked,
                                commission_received_date: checked ? (p.commission_received_date || format(new Date(), 'yyyy-MM-dd')) : null,
                              })}
                            />
                            {p.commission_received ? (
                              <Badge variant="outline" className="text-[10px] text-success border-success/30">Paid</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] text-brand-600 border-brand-500/30">Due</Badge>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
