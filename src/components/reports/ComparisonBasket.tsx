import { useState } from 'react';
import { format } from 'date-fns';
import { BarChart3, ChevronUp, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useComparison } from '@/contexts/ComparisonContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { REPORT_TYPE_CONFIG } from '@/lib/reports/reportVariants';

interface ComparisonBasketProps {
  onCompare: () => void;
}

const MAX_COMPARISON_REPORTS = 5;

export function ComparisonBasket({ onCompare }: ComparisonBasketProps) {
  const { selectedReports, removeReport, clearSelection, activeComparisonType } = useComparison();
  const [isExpanded, setIsExpanded] = useState(false);
  const isMobile = useIsMobile();

  if (selectedReports.length === 0) {
    return null;
  }

  const canCompare = selectedReports.length >= 2;
  const typeLabel = activeComparisonType ? REPORT_TYPE_CONFIG[activeComparisonType].label : 'Report';
  const progressPercent = (selectedReports.length / MAX_COMPARISON_REPORTS) * 100;

  const handleClearAll = () => {
    clearSelection();
    setIsExpanded(false);
  };

  const collapsedInteractionClass = canCompare
    ? 'border-primary/55 bg-[linear-gradient(135deg,hsl(var(--primary)/0.18),hsl(var(--card)/0.98)_52%,hsl(var(--primary)/0.12))] shadow-[0_14px_38px_rgba(0,0,0,0.46),0_0_0_1px_hsl(var(--primary)/0.22),0_0_26px_hsl(var(--primary)/0.26),inset_0_1px_0_rgba(255,255,255,0.06)] hover:-translate-y-0.5 hover:border-primary/80 hover:bg-primary/15 hover:shadow-[0_18px_48px_rgba(0,0,0,0.52),0_0_0_2px_hsl(var(--primary)/0.32),0_0_36px_hsl(var(--primary)/0.36),inset_0_1px_0_rgba(255,255,255,0.08)] active:translate-y-0 active:scale-[0.99] hover:[&_.comparison-basket-icon]:border-primary/60 hover:[&_.comparison-basket-icon]:bg-primary/28 hover:[&_.comparison-basket-icon]:text-primary-foreground hover:[&_.comparison-basket-title]:text-white hover:[&_.comparison-basket-count]:border-primary/75 hover:[&_.comparison-basket-count]:bg-primary/28 hover:[&_.comparison-basket-count]:text-white hover:[&_.comparison-basket-progress>div]:brightness-125'
    : 'border-primary/45 bg-[linear-gradient(135deg,hsl(var(--primary)/0.13),hsl(var(--card)/0.97)_55%,hsl(var(--primary)/0.08))] shadow-[0_12px_34px_rgba(0,0,0,0.42),0_0_0_1px_hsl(var(--primary)/0.16),0_0_22px_hsl(var(--primary)/0.20),inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-primary/65 hover:bg-primary/10 hover:shadow-[0_16px_42px_rgba(0,0,0,0.48),0_0_0_2px_hsl(var(--primary)/0.24),0_0_30px_hsl(var(--primary)/0.28),inset_0_1px_0_rgba(255,255,255,0.07)] active:scale-[0.99]';

  if (isMobile) {
    return (
      <div className="w-full max-w-sm pointer-events-auto md:hidden">
        <Sheet>
          <div className={`rounded-2xl border p-3 backdrop-blur transition-all duration-200 motion-reduce:transform-none motion-reduce:transition-colors ${collapsedInteractionClass}`}>
            <div className="flex items-center gap-3">
              <SheetTrigger asChild>
                <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                  <div className="flex items-center gap-3">
                    <div className="comparison-basket-icon flex h-10 w-10 items-center justify-center rounded-xl border border-primary/35 bg-primary/18 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_16px_hsl(var(--primary)/0.16)] transition-colors dark:text-primary-foreground">
                      <BarChart3 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="comparison-basket-title text-sm font-semibold text-foreground transition-colors">Compare {typeLabel} Reports</div>
                      <div className="text-xs text-muted-foreground">{selectedReports.length} of {MAX_COMPARISON_REPORTS} {typeLabel.toLowerCase()} reports selected</div>
                    </div>
                  </div>
                </button>
              </SheetTrigger>
              <button type="button" onClick={handleClearAll} className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80" aria-label="Clear all selected comparison properties">Clear all</button>
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
            <ProgressBar value={progressPercent} className="comparison-basket-progress mt-3" />
          </div>
          <SheetContent side="bottom" className="flex max-h-[82vh] flex-col rounded-t-3xl p-0">
            <SheetHeader className="shrink-0 border-b p-4 text-left">
              <SheetTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-brand-600" />
                Comparison Tray
              </SheetTitle>
            </SheetHeader>
            {/* Gives the tray a definite height to fill, so its list scrolls
                rather than running off the bottom of the sheet. */}
            <div className="min-h-0 flex-1">
              <CompareTrayContent
                selectedReports={selectedReports}
                canCompare={canCompare}
                progressPercent={progressPercent}
                onCompare={onCompare}
                removeReport={removeReport}
                clearSelection={handleClearAll}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="hidden pointer-events-auto md:block">
      {!isExpanded ? (
        <div
          className={`rounded-full border px-4 py-3 backdrop-blur transition-all duration-200 motion-reduce:transform-none motion-reduce:transition-colors dark:bg-background/95 ${collapsedInteractionClass}`}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              aria-label={`Compare ${selectedReports.length} of ${MAX_COMPARISON_REPORTS} selected properties. ${canCompare ? 'Ready to compare.' : 'Select one more to compare.'}`}
              className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="comparison-basket-icon flex h-10 w-10 items-center justify-center rounded-full border border-primary/35 bg-primary/18 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_16px_hsl(var(--primary)/0.16)] transition-colors dark:text-primary-foreground">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div className="min-w-[12rem]">
                <div className="flex items-center justify-between gap-3">
                  <span className="comparison-basket-title text-sm font-semibold text-foreground transition-colors">Compare {typeLabel} Reports</span>
                  <Badge variant="secondary" className="comparison-basket-count rounded-full border-primary/45 bg-primary/18 text-foreground shadow-sm shadow-primary/15 transition-colors">{selectedReports.length}/{MAX_COMPARISON_REPORTS}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {canCompare ? 'Ready to compare' : `Select one more ${typeLabel} report to compare`}
                </div>
                <ProgressBar value={progressPercent} className="comparison-basket-progress mt-2" />
              </div>
            </button>
            <button type="button" onClick={handleClearAll} className="shrink-0 rounded-full border border-primary/35 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80" aria-label="Clear all selected comparison properties">Clear all</button>
          </div>
        </div>
      ) : (
        // A flex column, so the list below can be given a DEFINITE height to
        // scroll inside. `max-h` alone left the tray's height driven by its
        // content, which is what silently clipped the 4th and 5th properties.
        //
        // The unit matters as much as the structure: `100vh` counts browser
        // chrome that is not part of the visible area, so on a zoomed window
        // the panel was taller than the space it had and the Compare button
        // fell past the fold with five reports selected. `dvh` measures what
        // is actually on screen. The 8rem clears the 88px top offset this
        // overlay is anchored at, with room to breathe.
        <Card className="flex max-h-[calc(100dvh-8rem)] w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl border-brand-400/25 bg-card/95 shadow-2xl shadow-sm dark:shadow-black/20 backdrop-blur dark:bg-background/95">
          <CardHeader className="shrink-0 border-b border-border/60 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BarChart3 className="h-5 w-5 text-brand-600" />
                  Compare {typeLabel} Reports
                </CardTitle>
                <CardDescription>{selectedReports.length} of {MAX_COMPARISON_REPORTS} {typeLabel.toLowerCase()} reports selected</CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsExpanded(false)} className="rounded-full">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <ProgressBar value={progressPercent} />
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            <CompareTrayContent
              selectedReports={selectedReports}
              canCompare={canCompare}
              progressPercent={progressPercent}
              onCompare={onCompare}
              removeReport={removeReport}
              clearSelection={handleClearAll}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CompareTrayContent({
  selectedReports,
  canCompare,
  onCompare,
  removeReport,
  clearSelection,
}: {
  selectedReports: Array<{ id: string; property_address: string; created_at: string }>;
  canCompare: boolean;
  progressPercent: number;
  onCompare: () => void;
  removeReport: (reportId: string) => void;
  clearSelection: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="shrink-0 rounded-2xl border border-border/60 bg-muted/25 p-3 text-xs text-muted-foreground">
        {canCompare ? 'You can generate a comparison now, or add up to 5 reports for a deeper analysis.' : 'Select at least 2 properties to unlock comparison analysis.'}
      </div>

      {/*
        `min-h-0 flex-1`, never `max-h`. ScrollArea's viewport is `h-full`, so a
        parent with only a max-height gives it no height to resolve against: the
        viewport grew to its content, the root's `overflow-hidden` cut it off,
        and no scrollbar was ever offered. At five properties that hid the fifth
        entirely and sliced the fourth through its address.
      */}
      <ScrollArea className="min-h-0 flex-1 pr-3">
        <div className="space-y-2">
          {selectedReports.slice(0, MAX_COMPARISON_REPORTS).map((report, index) => (
            <div key={report.id} className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/70 p-3 transition-colors hover:bg-muted/40">
              <Badge variant="outline" className="mt-0.5 rounded-full">{index + 1}</Badge>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">{report.property_address}</p>
                <p className="mt-1 text-xs text-muted-foreground">Generated {format(new Date(report.created_at), 'MMM d, yyyy')}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-full" onClick={() => removeReport(report.id)} title="Remove from comparison">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="shrink-0 space-y-2 border-t border-border/60 pt-4">
        <Button onClick={onCompare} disabled={!canCompare} className="w-full gap-2 rounded-xl" size="lg">
          <BarChart3 className="h-4 w-4" />
          Compare {selectedReports.length} Properties
        </Button>
        <Button variant="outline" onClick={clearSelection} className="w-full gap-2 rounded-xl" size="sm">
          <Trash2 className="h-3.5 w-3.5" />
          Clear All
        </Button>
      </div>
    </div>
  );
}

function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-background/70 ring-1 ring-primary/20 ${className}`}>
      <div className="h-full rounded-full bg-gradient-to-r from-primary via-primary/80 to-primary transition-all shadow-[0_0_12px_hsl(var(--primary)/0.45)]" style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}
