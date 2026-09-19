import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Calculator, Compass, FileText, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  CLIENT_REPORT_VARIANTS,
  getReportVariantLabel,
  normalizeReportVariant,
  type ClientReportVariant,
} from '@/lib/reports/reportVariants';
import { generateSubReport } from '@/lib/reports/subReports';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  compositeReportId: string;
  reportVariant?: string | null;
  derivedFromReportId?: string | null;
  onNavigate: (reportId: string) => void;
}

export function ReportVariantControls({ compositeReportId, reportVariant, onNavigate }: Props) {
  const { toast } = useToast();
  const [forking, setForking] = useState<string | null>(null);

  const activeVariant = normalizeReportVariant(reportVariant);

  const handleFork = async (pathway: ClientReportVariant) => {
    setForking(pathway);
    try {
      // Which engine answers to each variant name is the ONE shared mapping
      // (engineForVariant, via generateSubReport) — an inline choice here is
      // how two switchers came to produce different "Financial" documents.
      const { reportId } = await generateSubReport(compositeReportId, pathway);
      toast({
        title: `${getReportVariantLabel(pathway)} report generated`,
        description: 'The report is saved to this property package and is ready to view.',
      });
      onNavigate(reportId);
    } catch (err: unknown) {
      console.error(`Failed to generate ${pathway} report`, err);
      toast({
        title: `${getReportVariantLabel(pathway)} report generation failed`,
        description: `We couldn't generate the ${getReportVariantLabel(pathway)} report. Your existing reports were not changed. Please retry.`,
        variant: 'destructive',
      });
    } finally {
      setForking(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Client report generation controls">
      {([
        // Accents match REPORT_VARIANT_META in @/lib/reports/reportVariants so a
        // pathway keeps one identity across the app. The previous styling paired a
        // light tint with -100 shade text, which was near-invisible on the light
        // theme; `text-foreground` reads correctly on both.
        ['financial', 'Financial', 'Generate detailed financial modelling, costs, yields and cash-flow analysis.', Calculator, 'border-chart-3/45 bg-chart-3/10 text-foreground hover:border-chart-3 hover:bg-chart-3/20 hover:shadow-chart-3/25'],
        ['strategic', 'Strategic', 'Generate property due diligence, risks, opportunities and strategic assessment.', Compass, 'border-chart-1/45 bg-chart-1/10 text-foreground hover:border-chart-1 hover:bg-chart-1/20 hover:shadow-chart-1/25'],
        ['briefing', 'Briefing', 'Generate a concise client-facing property briefing and key findings.', FileText, 'border-chart-7/45 bg-chart-7/10 text-foreground hover:border-chart-7 hover:bg-chart-7/20 hover:shadow-chart-7/25'],
        ['snapshot', 'Snapshot', 'Generate a rapid high-level overview and major decision indicators.', Zap, 'border-chart-8/45 bg-chart-8/10 text-foreground hover:border-chart-8 hover:bg-chart-8/20 hover:shadow-chart-8/25'],
      ] as Array<[ClientReportVariant, string, string, typeof Calculator, string]>).filter(([id]) => CLIENT_REPORT_VARIANTS.includes(id)).map(([pathway, title, description, Icon, accentClass]) => {
        const processing = forking === pathway;
        const active = activeVariant === pathway;
        return <Tooltip key={pathway}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={processing}
              aria-busy={processing}
              aria-label={processing ? `Generating ${title}` : `${title}: ${description}`}
              onClick={() => handleFork(pathway)}
              aria-pressed={active}
              className={`h-10 min-w-[112px] shrink-0 border px-3 font-medium shadow-sm transition-[transform,border-color,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none ${active ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''} ${accentClass}`}
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-md border border-current/25 bg-background/20">
                {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
              </span>
              {processing ? `Generating ${title}` : title}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">{description}</TooltipContent>
        </Tooltip>;
      })}
      <span className="sr-only" aria-live="polite">{forking ? `Generating ${getReportVariantLabel(forking)}` : ''}</span>
    </div>
  );
}
