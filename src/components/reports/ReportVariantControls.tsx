/**
 * The report-type buttons: each one OPENS its document.
 *
 * They used to generate on every click, so looking at a Strategic report that
 * already existed re-forked it and looking at a Briefing spent a model run.
 * What a button does now comes from `variantAction`: an existing report opens,
 * the report on screen is marked current, and only a report this Compass does
 * not have yet is created, with the button saying so before the click.
 * Refreshing an existing report is done on its own page
 * (`InvestmentReportFamilyNotice`), where the reader can see what they are
 * replacing.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Calculator, Compass, FileText, Plus, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getReportVariantLabel } from '@/lib/reports/reportVariants';
import { fetchReportFamily, generateSubReport, type ReportFamily, type SubReportVariant } from '@/lib/reports/subReports';
import { variantAction, type VariantTarget } from '@/lib/reports/variantNavigation.pure';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  /** The report on screen. */
  currentReportId: string;
  /** The Compass this family hangs from, as the page resolved it. */
  compositeReportId: string;
  /** The family, as the page read it; null while unread or unreadable. */
  family: ReportFamily | null;
  onNavigate: (reportId: string) => void;
}

type ButtonSpec = [VariantTarget, string, string, typeof Calculator, string];

// Accents match REPORT_TYPE_CONFIG in @/lib/reports/reportVariants so a report
// type keeps one identity across the app; `text-foreground` reads on both themes.
const BUTTONS: ButtonSpec[] = [
  ['compass', 'Compass', 'the location and property report every other report is drawn from', Compass, 'border-chart-5/45 bg-chart-5/10 text-foreground hover:border-chart-5 hover:bg-chart-5/20 hover:shadow-chart-5/25'],
  ['financial', 'Financial', 'financial modelling, costs, yields and cash flow', Calculator, 'border-chart-3/45 bg-chart-3/10 text-foreground hover:border-chart-3 hover:bg-chart-3/20 hover:shadow-chart-3/25'],
  ['strategic', 'Strategic', 'property due diligence, risks and the strategic assessment', Compass, 'border-chart-1/45 bg-chart-1/10 text-foreground hover:border-chart-1 hover:bg-chart-1/20 hover:shadow-chart-1/25'],
  ['briefing', 'Briefing', 'a concise client briefing and the key findings', FileText, 'border-chart-7/45 bg-chart-7/10 text-foreground hover:border-chart-7 hover:bg-chart-7/20 hover:shadow-chart-7/25'],
  ['snapshot', 'Snapshot', 'a one-page overview and the main decision indicators', Zap, 'border-chart-8/45 bg-chart-8/10 text-foreground hover:border-chart-8 hover:bg-chart-8/20 hover:shadow-chart-8/25'],
];

/** The server's own reason where it gave one — "please retry" names no cause. */
function reasonOf(err: unknown): string | null {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : null;
  if (!message || /^HTTP \d+$/.test(message)) return null;
  return message;
}

export function ReportVariantControls({ currentReportId, compositeReportId, family, onNavigate }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<VariantTarget | null>(null);

  const create = async (variant: SubReportVariant) => {
    const label = getReportVariantLabel(variant);
    try {
      const { reportId } = await generateSubReport(compositeReportId, variant);
      toast({ title: `${label} report created`, description: 'Opening it now.' });
      onNavigate(reportId);
    } catch (err: unknown) {
      console.error(`Failed to create ${variant} report`, err);
      const reason = reasonOf(err);
      toast({
        title: `${label} report could not be created`,
        description: `${reason ? `${reason} ` : ''}Your existing reports were not changed.`,
        variant: 'destructive',
      });
    }
  };

  const handleClick = async (target: VariantTarget) => {
    if (busy) return;
    setBusy(target);
    try {
      let action = variantAction(family, currentReportId, target);
      // The page reads the family once and never blocks on it; a button pressed
      // before that read landed, or after it failed, asks again rather than
      // guessing, because guessing wrong either spends a generation or opens
      // nothing.
      if (action.kind === 'unknown') {
        action = variantAction(await fetchReportFamily(currentReportId).catch(() => null), currentReportId, target);
      }
      if (action.kind === 'here') return;
      if (action.kind === 'open') {
        onNavigate(action.reportId);
        return;
      }
      if (action.kind === 'generate' && target !== 'compass') {
        await create(target);
        return;
      }
      toast({
        title: 'This report family could not be read',
        description: 'Nothing was opened or created. Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Reports for this property">
      {BUTTONS.map(([target, title, description, Icon, accentClass]) => {
        const action = variantAction(family, currentReportId, target);
        const processing = busy === target;
        const here = action.kind === 'here';
        const missing = action.kind === 'generate';
        const hint = here
          ? `${title} — the report on screen (${description}).`
          : missing
            ? `${title} has not been created for this Compass yet. Click to create it (${description}).`
            : `Open the ${title} report — ${description}.`;
        return <Tooltip key={target}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={processing}
              aria-busy={processing}
              aria-label={processing ? (missing ? `Creating ${title}` : `Opening ${title}`) : hint}
              aria-current={here ? 'page' : undefined}
              onClick={() => handleClick(target)}
              className={`h-10 min-w-[104px] shrink-0 border px-3 font-medium shadow-sm transition-[transform,border-color,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none ${here ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''} ${missing ? 'border-dashed' : ''} ${accentClass}`}
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-md border border-current/25 bg-background/20">
                {processing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : missing
                    ? <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    : <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
              </span>
              {processing && missing ? `Creating ${title}` : title}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">{hint}</TooltipContent>
        </Tooltip>;
      })}
      <span className="sr-only" aria-live="polite">{busy ? `Working on ${getReportVariantLabel(busy)}` : ''}</span>
    </div>
  );
}
