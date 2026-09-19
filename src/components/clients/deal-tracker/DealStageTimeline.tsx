import { useState } from 'react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Check, Circle, Clock, SkipForward, CalendarIcon, FileCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DealStage, StageStatus } from './types';

interface DealStageTimelineProps {
  stages: DealStage[];
  onUpdateStage: (stageId: string, data: Partial<DealStage>) => void;
}

const STATUS_ICONS: Record<StageStatus, React.ReactNode> = {
  pending: <Circle className="h-4 w-4 text-muted-foreground" />,
  in_progress: <Clock className="h-4 w-4 text-brand-500" />,
  complete: <Check className="h-4 w-4 text-success" />,
  skipped: <SkipForward className="h-4 w-4 text-muted-foreground/50" />,
};

const STATUS_COLORS: Record<StageStatus, string> = {
  pending: 'border-muted-foreground/30 bg-muted/30',
  in_progress: 'border-brand-500 bg-brand-500/10 ring-2 ring-brand-500/20',
  complete: 'border-success/30 bg-success/10',
  skipped: 'border-muted-foreground/20 bg-muted/20 opacity-60',
};

const NEXT_STATUS: Record<StageStatus, StageStatus> = {
  pending: 'in_progress',
  in_progress: 'complete',
  complete: 'pending',
  skipped: 'pending',
};

function StageDatePicker({ stage, onUpdateStage }: { stage: DealStage; onUpdateStage: (id: string, data: Partial<DealStage>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5 flex items-center gap-3 text-xs flex-wrap">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" title="Internal target date for this stage">
            <CalendarIcon className="h-3 w-3 mr-1" />
            <span className="mr-1 text-muted-foreground">Key date:</span>
            {stage.key_date ? format(new Date(stage.key_date), 'dd MMM yyyy') : 'Set date'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={stage.key_date ? new Date(stage.key_date) : undefined}
            onSelect={(date) => {
              onUpdateStage(stage.id, { key_date: date ? format(date, 'yyyy-MM-dd') : null });
              setOpen(false);
            }}
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * The recorded date beside "Completed" / "Invoice Received". A checkbox can
 * only stamp *today*, so the date itself opens a calendar — backfilling a
 * stage that actually completed last week is an edit, not a re-toggle.
 */
function EditableStageDate({
  value,
  onSelect,
  ariaLabel,
}: {
  value: string;
  onSelect: (iso: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          title={ariaLabel}
          className="ml-1 inline-flex items-center rounded text-success underline decoration-dotted underline-offset-2 transition-colors hover:text-success/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-success/50"
        >
          ({format(new Date(value), 'dd MMM yyyy')})
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={new Date(value)}
          onSelect={(date) => {
            if (date) onSelect(date.toISOString());
            setOpen(false);
          }}
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

export function DealStageTimeline({ stages, onUpdateStage }: DealStageTimelineProps) {
  const sorted = [...stages].sort((a, b) => a.display_order - b.display_order);

  const handleStatusToggle = (stage: DealStage) => {
    const newStatus = NEXT_STATUS[stage.status];
    const updates: Partial<DealStage> = { status: newStatus };
    if (newStatus === 'complete') {
      updates.completed_at = new Date().toISOString();
    } else {
      updates.completed_at = null;
    }
    onUpdateStage(stage.id, updates);
  };

  const handleSkip = (stage: DealStage) => {
    onUpdateStage(stage.id, { status: 'skipped', completed_at: null });
  };

  return (
    <div className="space-y-1">
      {sorted.map((stage, idx) => {
        const isLast = idx === sorted.length - 1;
        return (
          <div key={stage.id} className="flex gap-2 sm:gap-3">
            {/* Timeline connector */}
            <div className="flex flex-col items-center">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleStatusToggle(stage)}
                      className={cn(
                        'w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-all hover:scale-110',
                        STATUS_COLORS[stage.status]
                      )}
                    >
                      {STATUS_ICONS[stage.status]}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>Click to change status → {NEXT_STATUS[stage.status]}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {!isLast && (
                <div className={cn(
                  'w-0.5 flex-1 min-h-[16px]',
                  stage.status === 'complete' ? 'bg-success/50' : 'bg-border'
                )} />
              )}
            </div>

            {/* Stage content */}
            <div className={cn(
              'flex-1 pb-3 pt-0.5 min-w-0',
              stage.status === 'skipped' && 'opacity-60'
            )}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-xs sm:text-sm">{stage.stage_name}</span>
                {stage.stage_category && (
                  <Badge variant="outline" className="text-[10px] h-5">{stage.stage_category}</Badge>
                )}
                {stage.percentage_or_amount && (
                  <Badge variant="secondary" className="text-[10px] h-5">{stage.percentage_or_amount}</Badge>
                )}
                {stage.status !== 'skipped' && stage.status !== 'complete' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => handleSkip(stage)}
                  >
                    <SkipForward className="h-3 w-3 mr-0.5" />
                    Skip
                  </Button>
                )}
              </div>

              {/* Details - stack vertically on mobile */}
              <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 text-xs text-muted-foreground">
                <div className="truncate">
                  <span className="font-medium">Responsible:</span> {stage.responsible || '—'}
                </div>
                <div className="truncate">
                  <span className="font-medium">Client:</span> {stage.client_action || '—'}
                </div>
                <div className="truncate">
                  <span className="font-medium">Internal:</span> {stage.internal_action || '—'}
                </div>
              </div>

              {/* Stage completion & invoice checkboxes */}
              <div className="mt-1.5 flex items-center gap-4 flex-wrap">
                {/* Completed checkbox */}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`completed-${stage.id}`}
                    checked={stage.status === 'complete'}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onUpdateStage(stage.id, { status: 'complete', completed_at: new Date().toISOString() });
                      } else {
                        onUpdateStage(stage.id, { status: 'pending', completed_at: null });
                      }
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <label htmlFor={`completed-${stage.id}`} className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    Completed
                  </label>
                  {stage.status === 'complete' && stage.completed_at && (
                    <span className="text-xs">
                      <EditableStageDate
                        value={stage.completed_at}
                        onSelect={(iso) => onUpdateStage(stage.id, { completed_at: iso })}
                        ariaLabel={`Edit the completed date for ${stage.stage_name}`}
                      />
                    </span>
                  )}
                </div>

                {/* Invoice received checkbox */}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`invoice-${stage.id}`}
                    checked={stage.invoice_received || false}
                    onCheckedChange={(checked) => {
                      onUpdateStage(stage.id, {
                        invoice_received: !!checked,
                        invoice_received_date: checked ? new Date().toISOString() : null,
                      });
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <label htmlFor={`invoice-${stage.id}`} className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                    <FileCheck className="h-3 w-3" />
                    Invoice Received
                  </label>
                  {stage.invoice_received && stage.invoice_received_date && (
                    <span className="text-xs">
                      <EditableStageDate
                        value={stage.invoice_received_date}
                        onSelect={(iso) => onUpdateStage(stage.id, { invoice_received_date: iso })}
                        ariaLabel={`Edit the invoice received date for ${stage.stage_name}`}
                      />
                    </span>
                  )}
                </div>
              </div>

              <StageDatePicker
                stage={stage}
                onUpdateStage={onUpdateStage}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
