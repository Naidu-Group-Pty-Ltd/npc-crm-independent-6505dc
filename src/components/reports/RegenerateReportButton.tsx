import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useChunkedRegeneration } from '@/hooks/useChunkedRegeneration';
import {
  ENGINE_LABEL,
  engineIsFixedByTier,
  resolveGenerationEngine,
  type GenerationEngine,
} from '@/lib/reports/generationEngine.pure';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface RegenerateReportButtonProps {
  reportId: string;
  propertyAddress: string;
  onRegenerated?: () => void;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

/** What the dialog knows about which engine will run. `null` while it is still reading, or when the read failed. */
type ResolvedEngine = { engine: GenerationEngine; fixedByTier: boolean } | null;

export function RegenerateReportButton({
  reportId,
  propertyAddress,
  onRegenerated,
  variant = 'outline',
  size = 'sm',
  className = ''
}: RegenerateReportButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  // The engine is STATED, never chosen. This dialog carried a two-option radio
  // group defaulting to whatever the row said, and neither option was a real
  // decision: on a Compass report the server resolves the engine from the tier
  // whatever is sent, and on a Financial Analysis report choosing Compass would
  // strip the financials the report exists for. So the dialog reports what will
  // run and the hook resolves it from the record — one rule, one place.
  const [resolved, setResolved] = useState<ResolvedEngine>(null);
  const { logActivity } = useActivityLogger();
  const { addNotification } = useNotifications();

  const {
    isRegenerating,
    currentSection,
    totalSections,
    regenerate
  } = useChunkedRegeneration();

  // Read the report's tier when the dialog opens. `generationProgress` is the
  // cheap projection that carries `report_tier` and `generation_engine`; the
  // detail projection this used to take also ships ~95KB of report prose and
  // every JSON blob on the row, to read one string.
  useEffect(() => {
    if (!showConfirm) return;
    let cancelled = false;
    (async () => {
      const { data } = await invokeSecureFunction('get-investment-reports', {
        reportId,
        projection: 'generationProgress',
      });
      if (cancelled) return;
      const row = data?.report;
      if (!row) return;
      setResolved({
        engine: resolveGenerationEngine({
          reportTier: row.report_tier,
          storedEngine: row.generation_engine,
        }),
        fixedByTier: engineIsFixedByTier(row.report_tier),
      });
    })();
    return () => { cancelled = true; };
  }, [showConfirm, reportId]);

  const handleRegenerate = async () => {
    setShowConfirm(false);

    addNotification({
      type: 'report_regeneration_started',
      title: 'Report Regeneration Started',
      message: resolved
        ? `Regenerating report for ${propertyAddress} using the ${resolved.engine === 'compass-40' ? 'Compass primary' : 'legacy'} engine...`
        : `Regenerating report for ${propertyAddress}...`,
      entityId: reportId
    });

    // Deliberately no `generationEngine`: the hook resolves it from the report's
    // own tier and recorded engine, through the same rule the server applies.
    await regenerate({
      reportId,
      propertyAddress,
      onProgress: (section, total) => {
        console.log(`[RegenerateReportButton] Progress: ${section}/${total}`);
      },
      onComplete: () => {
        logActivity({
          actionType: 'report_regenerated',
          entityType: 'investment_report',
          entityId: reportId,
          entityName: propertyAddress,
          metadata: { regenerationType: 'chunked', generationEngine: resolved?.engine ?? null }
        });
        onRegenerated?.();
      },
      onError: (error) => {
        console.error('[RegenerateReportButton] Error:', error);
      }
    });
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => { setResolved(null); setShowConfirm(true); }}
        disabled={isRegenerating}
      >
        {isRegenerating ? (
          <>
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            {currentSection}/{totalSections}
          </>
        ) : (
          <>
            <RefreshCw className="mr-1 h-3 w-3" />
            Regenerate
          </>
        )}
      </Button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate Report</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-sm">
                <p className="text-muted-foreground">
                  Your manual overrides and financial calculations are always injected as context.
                </p>

                <div className="rounded-lg border p-3">
                  {resolved === null ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="font-medium text-foreground">Generation engine</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Resolved from this report&rsquo;s tier when the regeneration starts.
                      </p>
                    </>
                  ) : resolved.engine === 'compass-40' ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span className="font-medium text-foreground">{ENGINE_LABEL['compass-40']}</span>
                        <Badge className="text-[10px]">Primary</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        ~38&ndash;42 pages: location, demand, risk and recommendation in full, education /
                        transport / amenity compressed, and the editorial, page-budget and QA gates enforced
                        on the finished document. Purchase price, yield, LVR, loan and ten-year cash flow are
                        deliberately absent &mdash; the separate Financial Analysis Report covers them.
                        {resolved.fixedByTier && ' This is a Compass report, so this is the engine it is regenerated by.'}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">{ENGINE_LABEL.legacy}</span>
                        <Badge variant="secondary" className="text-[10px]">Superseded</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        The original database-template engine. This report&rsquo;s tier is not Compass, so the
                        content it carries is the tier&rsquo;s rather than the primary engine&rsquo;s, and it is
                        regenerated the way it was produced.
                      </p>
                    </>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  The previous version will be archived for comparison.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRegenerate}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
