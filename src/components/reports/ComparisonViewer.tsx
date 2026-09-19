import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Target, FileWarning } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { readStoredAnalysis, section } from '@/lib/reports/propertyComparison/storedAnalysis.pure';
import { normaliseComparisonAnalysis } from './comparisonRecovery.pure';
import { ComparisonResultsPanel } from './ComparisonResultsPanel';
import { describeComparisonType } from './library/comparisonTypeDescriptor.pure';
import { ComparisonPDFGenerator } from './ComparisonPDFGenerator';
import { ComparisonDownloadButton } from './ComparisonDownloadButton';
import { logActivityDirect } from '@/hooks/useActivityLogger';

interface ComparisonViewerProps {
  isOpen: boolean;
  onClose: () => void;
  comparison: {
    id: string;
    property_count: number;
    property_addresses?: string[];
    property_states?: string[];
    report_title?: string;
    executive_summary: string | null;
    rankings: any;
    investor_matches?: any;
    financial_comparison: any;
    location_comparison: any;
    risk_comparison: any;
    recommendations: any;
    red_flags: any;
    report_ids: string[];
    created_at: string;
    /** Which report family was compared; null on untyped legacy rows. */
    comparison_type?: string | null;
  } | null;
}

export function ComparisonViewer({ isOpen, onClose, comparison }: ComparisonViewerProps) {
  // Log comparison viewed when opened
  useEffect(() => {
    if (isOpen && comparison) {
      logActivityDirect({
        actionType: 'comparison_viewed',
        entityType: 'property_comparison',
        entityId: comparison.id,
        entityName: comparison.report_title || `${comparison.property_count} Property Comparison`,
        metadata: { 
          property_count: comparison.property_count,
          property_addresses: comparison.property_addresses 
        }
      });
    }
  }, [isOpen, comparison]);

  if (!comparison) return null;

  // ── What this row actually holds ──────────────────────────────────────────
  //
  // 30 of the 53 stored comparisons have all seven structured columns NULL and
  // the model's whole raw response sitting in `executive_summary`. This screen
  // used to try `JSON.parse` on that and **return the cleaned string on
  // failure**, so those rows rendered as 16 KB of raw JSON under the heading
  // "Executive Summary", with every tab reading "No … data available" — while
  // the typeset PDF beside them read the same rows correctly.
  //
  // `readStoredAnalysis` is the decision the render route makes, shared rather
  // than re-implemented, so the two can no longer disagree about what the model
  // said. It never repairs, so a section is shown whole or reported absent.
  const stored = readStoredAnalysis(comparison as unknown as Record<string, unknown>);
  const { provenance } = stored;

  // The stored row's reading — columns or salvage — restated in the one shape
  // the shared results panel renders. `section()` has already decided what each
  // part holds; the shaping only defaults and folds the recommendations alias.
  const shaped = normaliseComparisonAnalysis({
    executiveSummary: section(stored, 'executiveSummary'),
    rankings: section(stored, 'rankings'),
    financialComparison: section(stored, 'financialComparison'),
    locationComparison: section(stored, 'locationComparison'),
    riskComparison: section(stored, 'riskComparison'),
    investorMatches: section(stored, 'investorMatches'),
    redFlags: section(stored, 'redFlags'),
    recommendations: section(stored, 'recommendations'),
  });

  // Only worth saying on the salvaged path. On the columns path a section the
  // analysis had nothing to say about is ordinary absence, and announcing it
  // would turn every complete comparison into a warning.
  const recordIncomplete = provenance.shape === 'salvaged' && provenance.missing.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      {/*
        The shared dialog shell declares `sm:max-w-lg`, and a responsive variant
        beats an unprefixed `max-w-*` in the emitted CSS — which is why this
        report rendered in a ~512px column with its tables and tab strip
        squeezed. Width and height are therefore both declared at `sm:` too.
      */}
      <DialogContent className="flex w-[96vw] max-w-none flex-col overflow-hidden sm:w-[94vw] sm:max-w-[1500px] sm:max-h-[92dvh] h-[92dvh] sm:h-[92dvh]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Target className="h-5 w-5" />
                {comparison.report_title || `Property Comparison Analysis - ${comparison.property_count} Properties`}
                {(() => {
                  // Which report family this row compares, named beside the
                  // title the way the library card names it.
                  const type = describeComparisonType(comparison.comparison_type);
                  return type.key
                    ? <Badge variant="secondary" title={type.blurb} className={`text-xs font-normal ${type.badgeClassName}`}>{type.label}</Badge>
                    : null;
                })()}
              </div>
              {comparison.property_states && comparison.property_states.length > 0 && (
                <p className="text-sm font-normal text-muted-foreground mt-1">
                  States: {comparison.property_states.join(', ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/*
                Beside the AI-written report, never instead of it. The typeset
                path reads the saved row and costs nothing; the one to its right
                re-writes the document with a model on every press.
              */}
              <ComparisonDownloadButton comparisonId={comparison.id} />
              <ComparisonPDFGenerator comparison={comparison} />
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 pr-4">
          <div className="space-y-6 pb-4">
            {/*
              What the record does not hold, said first. On a cut-off analysis a
              reader who is not told simply reads a shorter report — and the one
              section truncation eats first is the one that answers "which should
              I buy".
            */}
            {stored.error ? (
              <Alert variant="destructive">
                <FileWarning className="h-4 w-4" />
                <AlertTitle>This comparison could not be read</AlertTitle>
                <AlertDescription>
                  The saved analysis holds no readable sections — {stored.error}. Re-run the
                  comparison to produce it again.
                </AlertDescription>
              </Alert>
            ) : recordIncomplete ? (
              <Alert>
                <FileWarning className="h-4 w-4" />
                <AlertTitle>Part of this analysis was not saved</AlertTitle>
                <AlertDescription>
                  The model's response was cut off before it finished, so{' '}
                  {provenance.missing.length} of {provenance.missing.length + provenance.recovered.length}{' '}
                  sections were never stored: {provenance.missing.join(', ')}. Everything shown below
                  was recovered from the saved response and is what the model wrote. Re-run the
                  comparison to produce the missing sections.
                </AlertDescription>
              </Alert>
            ) : null}

            {/*
              The SAME results content the analysis modal shows — one panel, two
              surfaces, so opening a saved comparison from Generated Reports
              reads identically to watching it finish. The salvaged path's own
              alert above already names what was never stored, so the panel's
              banner stays quiet there.
            */}
            {!stored.error && (
              <ComparisonResultsPanel
                analysis={shaped}
                showAbsentBanner={provenance.shape !== 'salvaged'}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
