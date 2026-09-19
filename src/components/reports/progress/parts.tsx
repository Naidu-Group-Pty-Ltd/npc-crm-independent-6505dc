/**
 * Sub-components for the report generation progress widget.
 * Kept in one file to limit fragmentation while still separating concerns.
 */
import { forwardRef, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Layers } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertCircle,
  CalendarIcon,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  History as HistoryIcon,
  Loader2,
  MoreVertical,
  Square,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import type { GenerationHistoryEntry } from '@/hooks/useGenerationHistory';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { SearchInput } from '@/components/ui/search-input';
import { activityState, isResumable, formatEta, formatElapsed } from './selectors.pure';

/* ---------- Types shared with parent ---------- */

export interface ReportProgress {
  id: string;
  property_address: string;
  status: string;
  sectionsCompleted: number;
  totalSections: number;
  contentLength: number;
  error_message?: string | null;
  lastUpdated: Date;
  lastCompletedSection: number;
  createdAt: Date;
  bulkJobId?: string | null;
  generationEngine?: 'legacy' | 'compass-40' | null;
}

export interface AutoContinueSettings {
  enabled: boolean;
  maxRetries: number;
  delaySeconds: number;
}

export interface AggregateCounts {
  queued: number;
  processing: number;
  stalled: number;
  failed: number;
  completed: number;
  total: number;
  completedSections: number;
  totalSections: number;
}

/* ---------- Header (chips + overflow menu) ---------- */

interface HeaderProps {
  counts: AggregateCounts;
  paused: boolean;
  autoContinueSettings: AutoContinueSettings;
  onTogglePaused: () => void;
  onResumeAllStalled: () => void;
  onClearCompleted: () => void;
  onToggleHistory: () => void;
  historyOpen: boolean;
  onToggleAutoContinue: (enabled: boolean) => void;
  onChangeDelay: (seconds: number) => void;
  onMinimize: () => void;
  onDragStart?: (e: React.PointerEvent) => void;
  draggable?: boolean;
  /** Keyboard-reachable equivalent of the pointer-only drag. */
  onMoveCorner?: (corner: 'br' | 'bl' | 'tr' | 'tl') => void;
}

export function GenerationProgressHeader({
  counts,
  paused,
  autoContinueSettings,
  onTogglePaused,
  onResumeAllStalled,
  onClearCompleted,
  onToggleHistory,
  historyOpen,
  onToggleAutoContinue,
  onChangeDelay,
  onMinimize,
  onDragStart,
  draggable,
  onMoveCorner,
}: HeaderProps) {
  const aggregatePct =
    counts.totalSections > 0
      ? Math.round((counts.completedSections / counts.totalSections) * 100)
      : 0;

  return (
    <div
      className={cn(
        // The card itself is the glass pane. Per glass.css, nested and repeated
        // elements inside a pane get a translucent fill and a hairline only —
        // never their own backdrop-filter.
        'border-b border-border bg-muted/40',
        draggable && 'cursor-grab active:cursor-grabbing select-none'
      )}
      onPointerDown={draggable ? onDragStart : undefined}
    >
      <div className="flex items-start justify-between px-3 py-2 gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium text-foreground whitespace-nowrap">
            {historyOpen ? 'History' : 'Generating'}
          </span>
          {/* One compact summary line rather than five pills. At 320px wide,
              chips carrying both an icon and a word wrapped into a five-row
              column and pushed the controls off the top of the card. This says
              the same thing in one line, still in words rather than colour. */}
          {!historyOpen && (
            <span className="text-xs text-muted-foreground">
              {[
                counts.processing > 0 && `${counts.processing} running`,
                counts.queued > 0 && `${counts.queued} queued`,
                counts.stalled > 0 && `${counts.stalled} stalled`,
                counts.failed > 0 && `${counts.failed} failed`,
                counts.completed > 0 && `${counts.completed} done`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                onClick={onToggleHistory}
                aria-label="Toggle history"
                aria-pressed={historyOpen}
              >
                <HistoryIcon className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>History (last 10)</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                aria-label="Generation options"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Bulk actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={onTogglePaused}>
                {paused ? (
                  <>
                    <PlayCircle className="h-4 w-4 mr-2" /> Resume polling
                  </>
                ) : (
                  <>
                    <PauseCircle className="h-4 w-4 mr-2" /> Pause polling
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onResumeAllStalled} disabled={counts.stalled === 0}>
                <RefreshCw className="h-4 w-4 mr-2" /> Retry all stalled
              </DropdownMenuItem>
              {/* Labelled for what it actually does: this clears the whole
                  generation history, not just dismissed rows. */}
              <DropdownMenuItem onClick={onClearCompleted}>
                <Trash2 className="h-4 w-4 mr-2" /> Clear history
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Auto-continue</DropdownMenuLabel>
              {/* Native menu primitives, not a Switch and a Slider parked inside
                  the menu's DOM. Radix menus own arrow keys for their own roving
                  focus, so a Slider nested here could not be adjusted from the
                  keyboard at all, and neither control had an accessible name —
                  the adjacent <span>s were plain text, not labels. */}
              <DropdownMenuCheckboxItem
                checked={autoContinueSettings.enabled}
                onCheckedChange={onToggleAutoContinue}
              >
                Resume stalled reports automatically
              </DropdownMenuCheckboxItem>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Wait before resuming
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(autoContinueSettings.delaySeconds)}
                onValueChange={(v) => onChangeDelay(Number(v))}
              >
                {[10, 15, 30, 60].map((seconds) => (
                  <DropdownMenuRadioItem
                    key={seconds}
                    value={String(seconds)}
                    disabled={!autoContinueSettings.enabled}
                  >
                    {seconds} seconds
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {onMoveCorner && (
                <>
                  <DropdownMenuSeparator />
                  {/* The only keyboard route to repositioning; dragging is
                      pointer-only and the widget is fixed over every route. */}
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Move panel
                  </DropdownMenuLabel>
                  <div className="grid grid-cols-2 gap-1 px-2 pb-2">
                    {(
                      [
                        ['tl', 'Top left'],
                        ['tr', 'Top right'],
                        ['bl', 'Bottom left'],
                        ['br', 'Bottom right'],
                      ] as const
                    ).map(([value, label]) => (
                      <Button
                        key={value}
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => onMoveCorner(value)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                onClick={onMinimize}
                aria-label="Minimize"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse (Esc)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {!historyOpen && counts.total > 0 && (
        <div className="px-3 pb-2 space-y-1">
          <Progress
            value={aggregatePct}
            className="h-1"
            aria-label={`Overall generation progress: ${counts.completedSections} of ${counts.totalSections} sections`}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {counts.completedSections}/{counts.totalSections} sections across {counts.total}{' '}
              report{counts.total === 1 ? '' : 's'}
            </span>
            <span>{aggregatePct}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Rich minimised pill ---------- */

interface PillProps {
  counts: AggregateCounts;
  etaMs: number | null;
  onClick: () => void;
}

/** Ring geometry. Derived, not inlined: the radius and the circumference used to
 *  be two independent literals (`r="12"` and a hardcoded `75.4`), so changing the
 *  size silently desynced the arc from the percentage it claimed to show. */
const RING_RADIUS = 12;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export const GenerationProgressPill = forwardRef<HTMLButtonElement, PillProps>(
  function GenerationProgressPill({ counts, etaMs, onClick }, ref) {
    const pct =
      counts.totalSections > 0
        ? Math.round((counts.completedSections / counts.totalSections) * 100)
        : 0;
    const eta = formatEta(etaMs);

    // Spell the whole state out for assistive tech — the ring and the failure
    // badge are decorative duplicates of it.
    const summary = [
      `${counts.total} report${counts.total === 1 ? '' : 's'} generating`,
      `${pct}% complete`,
      counts.failed > 0 ? `${counts.failed} failed` : null,
      eta ? `about ${eta} remaining` : null,
    ]
      .filter(Boolean)
      .join(', ');

    return (
      <Button
        ref={ref}
        variant="default"
        onClick={onClick}
        aria-label={`${summary}. Open generation details.`}
        className="glass-raised h-11 rounded-full pl-2 pr-3 gap-2 motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:scale-[1.03] motion-safe:active:scale-[0.98]"
      >
        <span className="relative flex h-7 w-7 items-center justify-center">
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 28 28" aria-hidden="true">
            <circle
              cx="14"
              cy="14"
              r={RING_RADIUS}
              strokeWidth="3"
              className="fill-none stroke-primary-foreground/25"
            />
            <circle
              cx="14"
              cy="14"
              r={RING_RADIUS}
              strokeWidth="3"
              className="fill-none stroke-primary-foreground"
              strokeDasharray={`${(pct / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
              strokeLinecap="round"
            />
          </svg>
          <span className="text-xs font-bold tabular-nums" aria-hidden="true">
            {pct}
          </span>
        </span>
        <span className="flex flex-col items-start leading-tight" aria-hidden="true">
          <span className="text-xs font-semibold">
            {counts.total} report{counts.total === 1 ? '' : 's'}
          </span>
          <span className="text-xs opacity-90">{eta ?? 'Estimating…'}</span>
        </span>
        {counts.failed > 0 && (
          <span
            aria-hidden="true"
            className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-destructive-foreground"
          >
            {counts.failed}
          </span>
        )}
      </Button>
    );
  },
);

/* ---------- Per-report item ---------- */

interface ItemProps {
  report: ReportProgress;
  etaMs: number | null;
  retryState?: { attempts: number; lastAttempt: number; retryAt?: number };
  autoContinueSettings: AutoContinueSettings;
  sectionTimeline: number[]; // epoch ms of each section completion
  /** Clock from the container's tick, so elapsed readouts advance predictably. */
  now: number;
  /** Whether polling/auto-continue is paused, so the row can tell the truth. */
  paused: boolean;
  onContinue: () => void;
  onDismiss: () => void;
  onKill?: () => void;
  isMobile?: boolean;
}

export function GenerationProgressItem({
  report,
  etaMs,
  retryState,
  autoContinueSettings,
  sectionTimeline,
  now,
  paused,
  onContinue,
  onDismiss,
  onKill,
  isMobile = false,
}: ItemProps) {
  const navigate = useNavigate();
  const [killOpen, setKillOpen] = useState(false);
  const percentage =
    report.totalSections > 0
      ? Math.round((report.sectionsCompleted / report.totalSections) * 100)
      : 0;

  // "now" arrives as a prop from the container's 1s tick. Calling Date.now()
  // here made the render impure and — worse — froze every elapsed readout
  // whenever polling stopped, because nothing re-rendered to advance it.
  const timeSinceUpdate = now - report.lastUpdated.getTime();
  const timeSinceCreation = now - report.createdAt.getTime();

  // One shared definition of state, so the row can never say "Processing" while
  // the header chip above it says "Stalled".
  const state = activityState(report, now);
  const isStuck = state === 'stalled';
  const isIncomplete = report.sectionsCompleted < report.totalSections;

  const showContinueButton = isResumable(report, now);
  const currentSection = Math.min(report.sectionsCompleted + 1, report.totalSections);

  const retriesUsed = retryState?.attempts || 0;
  const maxRetriesReached = retriesUsed >= autoContinueSettings.maxRetries;
  // Derived from whether a timer genuinely exists, not from "would we schedule
  // one". While paused, no timer is ever scheduled — yet rows used to promise
  // "Auto-resuming in 15s" and disable Stop, locking the user out of stopping a
  // job that was never going to resume.
  const hasScheduledRetry = retryState?.retryAt !== undefined && !paused;
  const retryInSeconds =
    retryState?.retryAt !== undefined
      ? Math.max(0, Math.ceil((retryState.retryAt - now) / 1000))
      : null;

  const openReport = () => navigate(`/investment-report/${report.id}`);

  const copyError = () => {
    const text = report.error_message || 'No error message';
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success('Error copied to clipboard'))
      .catch(() => toast.error('Could not copy error'));
  };

  return (
    <div className={cn('p-3 border-b border-border last:border-b-0', isMobile && 'px-4 py-3')}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={openReport}
            className={cn(
              'group flex items-center gap-1 text-left font-medium text-foreground truncate w-full hover:text-primary transition-colors',
              isMobile ? 'text-sm' : 'text-xs'
            )}
            title={`Open report for ${report.property_address}`}
          >
            <span className="truncate">{report.property_address}</span>
            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 shrink-0" />
          </button>
          {/* Status line. Colour is never the only signal — each state pairs a
              distinct icon with distinct words, which also sidesteps `--primary`
              and `--warning` being the same hue in the dark theme. Foreground
              tones use the `-foreground` token in light mode, because the raw
              --success/--warning hues fall well under 4.5:1 as small text. */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {state === 'queued' && (
              <>
                <Clock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs text-muted-foreground">Queued</span>
              </>
            )}
            {state === 'generating' && (
              <>
                <Loader2
                  className="h-3 w-3 text-info motion-safe:animate-spin"
                  aria-hidden="true"
                />
                <span className="text-xs font-medium text-foreground">
                  Section {currentSection} of {report.totalSections}
                </span>
                <span className="text-xs text-muted-foreground">
                  • {formatElapsed(timeSinceCreation)} elapsed
                </span>
                {etaMs !== null && (
                  <span className="text-xs text-muted-foreground">• ~{formatEta(etaMs)} left</span>
                )}
              </>
            )}
            {state === 'completed' && (
              <>
                <CheckCircle2 className="h-3 w-3 text-success" aria-hidden="true" />
                <span className="text-xs font-medium text-foreground">
                  Finished in {formatElapsed(timeSinceCreation)}
                </span>
              </>
            )}
            {state === 'failed' && (
              <>
                <AlertCircle className="h-3 w-3 text-destructive" aria-hidden="true" />
                <span className="text-xs font-medium text-foreground">
                  {report.error_message?.toLowerCase().startsWith('cancelled')
                    ? report.error_message
                    : maxRetriesReached
                      ? `Failed after ${retriesUsed} attempt${retriesUsed === 1 ? '' : 's'}`
                      : 'Failed'}
                </span>
              </>
            )}
            {state === 'stalled' && (
              <>
                <PauseCircle className="h-3 w-3 text-warning" aria-hidden="true" />
                <span className="text-xs font-medium text-foreground">
                  {hasScheduledRetry && retryInSeconds !== null
                    ? `Stalled — resuming in ${retryInSeconds}s`
                    : paused
                      ? 'Stalled — auto-resume paused'
                      : maxRetriesReached
                        ? `Stalled — ${retriesUsed} attempts used`
                        : 'Stalled'}
                </span>
                <span className="text-xs text-muted-foreground">
                  • no progress for {formatElapsed(timeSinceUpdate)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {state === 'completed' && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs"
              onClick={openReport}
            >
              <ExternalLink className="h-3 w-3 mr-1" aria-hidden="true" />
              Open
            </Button>
          )}
          {showContinueButton && !hasScheduledRetry && (
            <Button
              size="sm"
              variant="outline"
              className={cn('h-8 text-xs', isMobile ? 'px-3' : 'px-2')}
              onClick={onContinue}
            >
              <PlayCircle className="h-3 w-3 mr-1" aria-hidden="true" />
              Resume
            </Button>
          )}
          {onKill && (report.status === 'pending' || report.status === 'processing') && (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Never disabled. A disabled button dispatches no pointer events,
                    so the tooltip explaining *why* it was unavailable could never
                    be shown — and while paused the row locked the user out of
                    stopping a job that would never resume on its own. Stopping is
                    always allowed; it cancels any pending retry too. */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-destructive"
                  onClick={() => setKillOpen(true)}
                  aria-label={`Stop generating ${report.property_address}`}
                >
                  <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop this job</TooltipContent>
            </Tooltip>
          )}
          <AlertDialog open={killOpen} onOpenChange={setKillOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Stop report generation?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground">
                        {report.property_address}
                      </span>{' '}
                      will be marked as <span className="text-destructive font-medium">failed</span>{' '}
                      and removed from the active queue.
                    </p>
                    <p>
                      Progress so far: {report.sectionsCompleted}/{report.totalSections} sections.
                      This cannot be undone, but you can re-generate the report later.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep running</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: "destructive" })}
                  onClick={() => {
                    onKill?.();
                    setKillOpen(false);
                  }}
                >
                  Stop generation
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onDismiss}
                aria-label={`Hide ${report.property_address} from this list. Generation continues.`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Hide from this list — generation continues</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Segmented progress */}
      <SegmentedProgress
        total={report.totalSections}
        completed={report.sectionsCompleted}
        currentInProgress={report.status === 'processing' && !isStuck}
        failed={report.status === 'failed' || maxRetriesReached}
      />

      {/* Plain text, no dotted-underline "cursor-help" affordance hiding detail
          behind a hover-only tooltip. The two figures it used to reveal ("DB
          saved" vs "content detected") were an artefact of counting markdown
          headings client-side; there is now one authoritative count. The
          content-size line is gone because the widget no longer downloads the
          report body — it would read 0.0 KB for every row. */}
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>
          {report.sectionsCompleted}/{report.totalSections} sections
          {sectionTimeline.length >= 2 && report.sectionsCompleted > 0 && (
            <>
              {' · '}
              {formatElapsed(
                (sectionTimeline[sectionTimeline.length - 1] - sectionTimeline[0]) /
                  Math.max(1, sectionTimeline.length - 1),
              )}{' '}
              each
            </>
          )}
        </span>
        <span>{percentage}%</span>
      </div>

      {/* Needs enough observations to show a shape. With two or three points the
          line is flat and reads as a stray horizontal rule rather than a trend. */}
      {sectionTimeline.length >= 5 && <Sparkline timestamps={sectionTimeline} />}

      {retriesUsed > 0 && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          <span>
            {retriesUsed} auto-retry attempt{retriesUsed > 1 ? 's' : ''} used
            {maxRetriesReached && ' (max reached)'}
          </span>
        </div>
      )}

      {isStuck && (
        <div
          className={cn(
            'mt-2 p-2 rounded text-xs border',
            maxRetriesReached
              ? 'bg-destructive/10 border-destructive/20 text-destructive'
              : 'bg-warning/10 border-warning/20 text-warning'
          )}
        >
          <div className="flex items-start gap-1.5">
            {hasScheduledRetry ? (
              <Zap className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            ) : maxRetriesReached ? (
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            ) : (
              <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            )}
            <div className="space-y-0.5 flex-1">
              {hasScheduledRetry ? (
                <>
                  <p className="font-medium">Auto-resuming in {autoContinueSettings.delaySeconds}s</p>
                  <p className="opacity-80">
                    Attempt {retriesUsed + 1} of {autoContinueSettings.maxRetries} • Resume from
                    section {currentSection}
                  </p>
                </>
              ) : maxRetriesReached ? (
                <>
                  <p className="font-medium">Max retries reached</p>
                  <p className="opacity-80">
                    Tried {retriesUsed} times • last update {formatElapsed(timeSinceUpdate)} ago
                  </p>
                  <p className="opacity-80">
                    Press <span className="font-medium">Continue</span> to manually retry from
                    section {currentSection}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">Generation stalled</p>
                  <p className="opacity-80">
                    No progress for {formatElapsed(timeSinceUpdate)}
                  </p>
                  {autoContinueSettings.enabled ? (
                    <p className="opacity-80">Auto-continue will retry shortly…</p>
                  ) : (
                    <p className="opacity-80">
                      Press <span className="font-medium">Continue</span> to resume from section{' '}
                      {currentSection}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {report.error_message && (
        <div className="mt-2 p-2 bg-destructive/10 rounded text-xs text-destructive">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="line-clamp-2 flex-1">{report.error_message}</span>
            <button
              type="button"
              onClick={copyError}
              className="shrink-0 hover:text-foreground"
              title="Copy error"
              aria-label="Copy error message"
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Segmented progress bar ---------- */

function SegmentedProgress({
  total,
  completed,
  currentInProgress,
  failed,
}: {
  total: number;
  completed: number;
  currentInProgress: boolean;
  failed: boolean;
}) {
  // Beyond this, individual segments stop being legible: a Compass report has 40
  // sections and the card is 320px wide, which left ~5px per segment with 2px
  // gaps. Past the cap we render one continuous bar, which reads better and
  // says exactly the same thing as the "x of y" text beneath it.
  const MAX_SEGMENTS = 20;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const label = `${completed} of ${total} sections complete`;

  if (total > MAX_SEGMENTS) {
    return (
      <div
        className="h-1.5 w-full overflow-hidden rounded-sm bg-muted"
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={label}
        aria-label="Section progress"
      >
        <div
          className={cn(
            'h-full rounded-sm motion-safe:transition-[width] motion-safe:duration-500',
            failed ? 'bg-destructive' : 'bg-info',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }

  return (
    <div
      className="flex gap-0.5"
      role="progressbar"
      aria-valuenow={completed}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuetext={label}
      aria-label="Section progress"
    >
      {Array.from({ length: total }).map((_, i) => {
        const isDone = i < completed;
        const isCurrent = i === completed && currentInProgress;
        const isFailed = i === completed && failed;
        return (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              'h-1.5 flex-1 rounded-sm motion-safe:transition-colors',
              isDone && 'bg-info',
              // The pulse is the only cue for "this one is being written right
              // now", and the global reduced-motion rule freezes animations —
              // so under reduced motion the segment is distinguished by tone.
              isCurrent && 'bg-info/60 motion-safe:animate-pulse motion-reduce:bg-info/70',
              isFailed && 'bg-destructive',
              !isDone && !isCurrent && !isFailed && 'bg-muted'
            )}
          />
        );
      })}
    </div>
  );
}

/* ---------- Sparkline ---------- */

function Sparkline({ timestamps }: { timestamps: number[]; startedAt?: number }) {
  // Intervals between observed sections only. Seeding the series with the
  // report's creation time made the first "interval" the entire queue wait,
  // which is typically an order of magnitude larger than any per-section gap —
  // it set the maximum and flattened every real data point onto the baseline.
  const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i]);
  if (intervals.length === 0) return null;
  const max = Math.max(...intervals, 1);
  const w = 100;
  const h = 16;
  const stepX = w / Math.max(intervals.length, 1);
  const path = intervals
    .map((v, i) => {
      const x = i * stepX + stepX / 2;
      const y = h - (v / max) * (h - 2) - 1;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const slowest = Math.round(max / 1000);
  const fastest = Math.round(Math.min(...intervals) / 1000);
  return (
    <div className="mt-1.5">
      {/* `title` on a div is not reliably exposed; give the graphic a real role
          and name, and state the range in words since the chart has no axis. */}
      <svg
        width="100%"
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Time per section, fastest ${fastest} seconds, slowest ${slowest} seconds`}
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1" className="text-info/70" />
      </svg>
    </div>
  );
}

/* ---------- History list ---------- */

type HistoryFilter = 'all' | 'completed' | 'failed' | 'cancelled' | 'dismissed';
type HistorySort = 'recent' | 'oldest';

export function GenerationHistoryList({
  entries,
  onClear,
}: {
  entries: GenerationHistoryEntry[];
  onClear: () => void;
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [sort, setSort] = useState<HistorySort>('recent');
  const [query, setQuery] = useState('');
  const [cancelledByFilter, setCancelledByFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  const cancellers = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      if (e.cancelledBy) set.add(e.cancelledBy);
    });
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => (filter === 'all' ? true : e.status === filter))
      .filter((e) => (q ? e.property_address.toLowerCase().includes(q) : true))
      .filter((e) => {
        if (cancelledByFilter === 'all') return true;
        return e.cancelledBy === cancelledByFilter;
      })
      .filter((e) => {
        if (!dateFrom && !dateTo) return true;
        const startOfDay = dateFrom ? new Date(dateFrom).setHours(0, 0, 0, 0) : null;
        const endOfDay = dateTo ? new Date(dateTo).setHours(23, 59, 59, 999) : null;
        if (startOfDay && e.finishedAt < startOfDay) return false;
        if (endOfDay && e.finishedAt > endOfDay) return false;
        return true;
      })
      .sort((a, b) =>
        sort === 'recent' ? b.finishedAt - a.finishedAt : a.finishedAt - b.finishedAt,
      );
  }, [entries, filter, sort, query, cancelledByFilter, dateFrom, dateTo]);

  const hasActiveFilters =
    filter !== 'all' ||
    query.trim().length > 0 ||
    cancelledByFilter !== 'all' ||
    dateFrom !== undefined ||
    dateTo !== undefined;

  if (entries.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-muted-foreground">
        <HistoryIcon className="h-6 w-6 mx-auto mb-2 opacity-50" />
        <p>No completed jobs yet.</p>
      </div>
    );
  }
  return (
    <>
      <div className="border-b border-border bg-muted/30 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {filtered.length} of {entries.length}
          </span>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setFilter('all');
                  setQuery('');
                  setCancelledByFilter('all');
                  setDateFrom(undefined);
                  setDateTo(undefined);
                }}
                className="text-xs text-primary hover:text-primary/80"
              >
                Reset filters
              </button>
            )}
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        </div>
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search address…"
          className="h-7 text-xs"
          iconClassName="left-2 h-3 w-3"
        />
        <div className="flex items-center gap-1.5">
          <Select value={filter} onValueChange={(v) => setFilter(v as HistoryFilter)}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as HistorySort)}>
            <SelectTrigger className="h-7 text-xs w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {cancellers.length > 0 && (
          <Select value={cancelledByFilter} onValueChange={setCancelledByFilter}>
            <SelectTrigger className="h-7 text-xs w-full">
              <SelectValue placeholder="Stopped by…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any user</SelectItem>
              {cancellers.map((name) => (
                <SelectItem key={name} value={name}>
                  Stopped by {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'h-7 text-xs flex-1 justify-start text-left font-normal',
                  !dateFrom && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-1.5 h-3 w-3" />
                {dateFrom ? format(dateFrom, 'dd MMM yyyy') : 'From date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateFrom}
                onSelect={setDateFrom}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'h-7 text-xs flex-1 justify-start text-left font-normal',
                  !dateTo && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-1.5 h-3 w-3" />
                {dateTo ? format(dateTo, 'dd MMM yyyy') : 'To date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateTo}
                onSelect={setDateTo}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          No matches for current filters.
        </div>
      ) : (
        filtered.map((e) => (
          <button
            key={e.id + e.finishedAt}
            type="button"
            onClick={() => navigate(`/investment-report/${e.id}`)}
            className="w-full text-left p-3 border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start gap-2">
              {e.status === 'completed' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
              ) : e.status === 'failed' ? (
                <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
              ) : e.status === 'cancelled' ? (
                <Square className="h-3.5 w-3.5 fill-current text-destructive mt-0.5 shrink-0" />
              ) : (
                <X className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {e.property_address}
                </p>
                <p className="text-xs text-muted-foreground">
                  {e.sectionsCompleted}/{e.totalSections} sections • {formatElapsed(e.durationMs)} •{' '}
                  {timeAgo(e.finishedAt)}
                </p>
                {e.status === 'cancelled' && (
                  <p className="text-xs text-destructive/80 mt-0.5">
                    Stopped by {e.cancelledBy || 'user'}
                  </p>
                )}
                {e.error_message && e.status !== 'cancelled' && (
                  <p className="text-xs text-destructive line-clamp-1 mt-0.5">
                    {e.error_message}
                  </p>
                )}
              </div>
            </div>
          </button>
        ))
      )}
    </>
  );
}

/* ---------- Bulk job grouping ---------- */

export interface BulkGroup {
  jobId: string;
  reports: ReportProgress[];
}

export function groupReportsByBulkJob(reports: ReportProgress[]): {
  groups: BulkGroup[];
  loose: ReportProgress[];
} {
  const map = new Map<string, ReportProgress[]>();
  const loose: ReportProgress[] = [];
  for (const r of reports) {
    if (r.bulkJobId) {
      const arr = map.get(r.bulkJobId) ?? [];
      arr.push(r);
      map.set(r.bulkJobId, arr);
    } else {
      loose.push(r);
    }
  }
  const groups: BulkGroup[] = Array.from(map.entries())
    .filter(([, list]) => list.length > 1) // only group if 2+ from same job
    .map(([jobId, list]) => ({ jobId, reports: list }));
  // Reports that were in a singleton group should fall back to loose
  for (const [jobId, list] of map.entries()) {
    if (list.length <= 1) loose.push(...list);
  }
  return { groups, loose };
}

export function BulkJobGroup({
  group,
  children,
  defaultOpen = true,
  etaForReport,
  onRetryAllFailed,
  onKillAll,
}: {
  group: BulkGroup;
  children: React.ReactNode;
  defaultOpen?: boolean;
  etaForReport?: (r: ReportProgress) => number | null;
  onRetryAllFailed?: (reportIds: string[]) => void;
  onKillAll?: (reportIds: string[]) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [killAllOpen, setKillAllOpen] = useState(false);

  // A finished report counts as all of its sections. Without this the group
  // aggregate fell every time one of its members succeeded — and the "n of m
  // done" label counted only reports still in the list, so a 10-report batch
  // with 8 finished proudly announced "0/2 done".
  const completedSections = group.reports.reduce(
    (s, r) => s + (r.status === 'completed' ? r.totalSections : r.sectionsCompleted),
    0,
  );
  const totalSections = group.reports.reduce((s, r) => s + r.totalSections, 0);
  const pct = totalSections > 0 ? Math.round((completedSections / totalSections) * 100) : 0;
  const completed = group.reports.filter(
    (r) => r.status === 'completed' || r.sectionsCompleted >= r.totalSections,
  ).length;

  const failedReports = group.reports.filter((r) => r.status === 'failed');
  const failed = failedReports.length;

  const groupEta = (() => {
    if (!etaForReport) return null;
    const etas = group.reports.map(etaForReport).filter((v): v is number => v !== null);
    if (etas.length === 0) return null;
    return Math.max(...etas); // reports run in parallel — wall time is max
  })();

  // Build a chronological transition log derived from per-report timestamps.
  const transitions = (() => {
    type T = { ts: number; address: string; kind: 'queued' | 'processing' | 'failed' };
    const out: T[] = [];
    for (const r of group.reports) {
      out.push({ ts: r.createdAt.getTime(), address: r.property_address, kind: 'queued' });
      if (r.status === 'processing' || r.sectionsCompleted > 0) {
        out.push({
          ts: r.lastUpdated.getTime(),
          address: r.property_address,
          kind: 'processing',
        });
      }
      if (r.status === 'failed') {
        out.push({ ts: r.lastUpdated.getTime(), address: r.property_address, kind: 'failed' });
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  })();

  return (
    <div className="border-b border-border last:border-b-0 bg-muted/20">
      <div className="px-3 py-1.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-0"
            aria-expanded={open}
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 transition-transform',
                !open && '-rotate-90',
              )}
            />
            <Layers className="h-3 w-3 shrink-0" />
            <span className="font-medium text-foreground">Bulk job</span>
            <span className="font-mono text-xs opacity-70">
              {group.jobId.slice(0, 8)}
            </span>
            <span className="opacity-50">•</span>
            <span className="truncate">
              {completed}/{group.reports.length} done
              {failed > 0 ? `, ${failed} failed` : ''}
            </span>
          </button>

          <div className="flex items-center gap-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  onClick={() => setTimelineOpen((o) => !o)}
                  aria-pressed={timelineOpen}
                  aria-label="Toggle timeline"
                >
                  <Clock className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Timeline</TooltipContent>
            </Tooltip>
            {failed > 0 && onRetryAllFailed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    onClick={() => onRetryAllFailed(failedReports.map((r) => r.id))}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Retry {failed}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Retry all failed in this job</TooltipContent>
              </Tooltip>
            )}
            {onKillAll && (() => {
              const active = group.reports.filter(
                (r) => r.status === 'pending' || r.status === 'processing',
              );
              if (active.length === 0) return null;
              return (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setKillAllOpen(true)}
                      >
                        <Square className="h-3 w-3 fill-current mr-1" />
                        Stop {active.length}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Kill all active jobs in this bulk job</TooltipContent>
                  </Tooltip>
                  <AlertDialog open={killAllOpen} onOpenChange={setKillAllOpen}>
                    <AlertDialogContent className="max-w-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Stop {active.length} active report
                          {active.length === 1 ? '' : 's'}?
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-2 text-sm text-muted-foreground">
                            <p>
                              The following report{active.length === 1 ? '' : 's'} in bulk job{' '}
                              <span className="font-mono text-xs">
                                {group.jobId.slice(0, 8)}
                              </span>{' '}
                              will be marked as{' '}
                              <span className="text-destructive font-medium">failed</span>:
                            </p>
                            <ScrollArea className="glass-inset max-h-40 rounded p-2">
                              <ul className="space-y-1">
                                {active.map((r) => (
                                  <li
                                    key={r.id}
                                    className="text-xs text-foreground flex items-center justify-between gap-2"
                                  >
                                    <span className="truncate">{r.property_address}</span>
                                    <span className="text-xs text-muted-foreground shrink-0">
                                      {r.sectionsCompleted}/{r.totalSections}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </ScrollArea>
                            <p className="text-xs">
                              Already-completed reports in this job are unaffected.
                            </p>
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep running</AlertDialogCancel>
                        <AlertDialogAction
                          className={buttonVariants({ variant: "destructive" })}
                          onClick={() => {
                            onKillAll(active.map((r) => r.id));
                            setKillAllOpen(false);
                          }}
                        >
                          Stop {active.length} report{active.length === 1 ? '' : 's'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              );
            })()}
          </div>
        </div>

        {/* Aggregate progress + ETA */}
        <div className="space-y-0.5">
          <Progress value={pct} className="h-1" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {completedSections}/{totalSections} sections
            </span>
            <span>
              {pct}%
              {groupEta !== null && (
                <span className="opacity-80"> • ~{formatEta(groupEta)} left</span>
              )}
            </span>
          </div>
        </div>

        {/* Inline transition timeline */}
        {timelineOpen && transitions.length > 0 && (
          <div className="glass-inset rounded p-2 mt-1 max-h-32 overflow-y-auto">
            <ol className="space-y-1 text-xs">
              {transitions.map((t, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'inline-block h-1.5 w-1.5 rounded-full shrink-0',
                      t.kind === 'queued' && 'bg-muted-foreground',
                      t.kind === 'processing' && 'bg-primary',
                      t.kind === 'failed' && 'bg-destructive',
                    )}
                  />
                  <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                    {formatClock(t.ts)}
                  </span>
                  <span className="capitalize text-muted-foreground shrink-0">{t.kind}</span>
                  <span className="opacity-50">·</span>
                  <span className="truncate text-foreground">{t.address}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

function formatClock(epoch: number): string {
  const d = new Date(epoch);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}


/* ---------- helpers ---------- */



function timeAgo(epoch: number): string {
  const diff = Date.now() - epoch;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
