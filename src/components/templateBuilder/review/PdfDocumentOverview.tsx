/**
 * PDF Extraction V3 · E11 — document overview panel.
 *
 * Presents the FIVE separate axes as distinct cards — Final output, Fidelity,
 * Editability, Review required, Routing/cache, Runtime/cost — and never collapses
 * them into one headline number. Hard defects are visually dominant over scores.
 * Presentational only: every value comes from the pure document review model.
 */
import { AlertTriangle, FileWarning } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { PdfDocumentReviewModelV1 } from '@/lib/reportTemplate/pdfImport/review';
import {
  documentDecisionLabel,
  metricStateLabel,
} from '@/lib/reportTemplate/pdfImport/review/statusLanguage';
import { toneToBadgeVariant } from './reviewTone';

function pct(v: number | null): string {
  return metricStateLabel(v).text;
}

interface OverviewCardProps {
  label: string;
  value: string;
  explanation: string;
  testId: string;
  emphasis?: 'danger' | 'review' | 'normal';
}

function OverviewCard({ label, value, explanation, testId, emphasis = 'normal' }: OverviewCardProps) {
  return (
    <Card className="flex flex-col gap-1 p-3" data-testid={testId}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={
          emphasis === 'danger'
            ? 'text-base font-semibold text-destructive'
            : emphasis === 'review'
              ? 'text-base font-semibold text-[hsl(var(--warning))]'
              : 'text-base font-semibold text-foreground'
        }
      >
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{explanation}</span>
    </Card>
  );
}

export function PdfDocumentOverview({ model }: { model: PdfDocumentReviewModelV1 }) {
  const decision = documentDecisionLabel(model.output.finalDecision, model.quality.hardDefectCount, model.output.blockedPageCount);
  const hasHardDefects = model.quality.hardDefectCount > 0;

  return (
    <section aria-label="Document overview" data-testid="pdf-review-document-status" className="space-y-3">
      {/* Primary status row — decision + hard-defect prominence. */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={toneToBadgeVariant(decision.tone)} className="text-xs" data-testid="pdf-review-final-decision">
          {decision.label}
        </Badge>
        {hasHardDefects && (
          <Badge variant="destructive" className="gap-1 text-xs" data-testid="pdf-review-hard-defect-count">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {model.quality.hardDefectCount} hard defect{model.quality.hardDefectCount === 1 ? '' : 's'} on {model.quality.pagesWithHardDefects} page{model.quality.pagesWithHardDefects === 1 ? '' : 's'}
          </Badge>
        )}
        {model.extraction.artifactCompleteness === false && (
          <Badge variant="warning" className="gap-1 text-xs" data-testid="pdf-review-artifact-completeness">
            <FileWarning className="h-3 w-3" aria-hidden />
            Artifacts incomplete
          </Badge>
        )}
        {model.legacyState !== 'v3-complete' && (
          <Badge variant="outline" className="text-xs">{legacyLabel(model.legacyState)}</Badge>
        )}
      </div>

      {/* Five separate axes — never one merged score. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <OverviewCard
          testId="pdf-review-card-final-output"
          label="Final output"
          value={decision.label}
          explanation={`${model.output.nativePageCount} native · ${model.output.mixedPageCount} mixed · ${model.output.rasterPageCount} raster · ${model.output.blockedPageCount} blocked`}
          emphasis={model.output.blockedPageCount > 0 ? 'danger' : hasHardDefects ? 'review' : 'normal'}
        />
        <OverviewCard
          testId="pdf-review-card-fidelity"
          label="Source fidelity"
          value={pct(model.quality.documentScore)}
          explanation={`Min page ${pct(model.quality.minimumPageScore)} · parity ${pct(model.quality.browserExportParity)}`}
        />
        <OverviewCard
          testId="pdf-review-card-editability"
          label="Editability"
          value={pct(model.editability.editablePageRatio)}
          explanation={`Regions ${pct(model.editability.editableRegionRatio)} editable`}
        />
        <OverviewCard
          testId="pdf-review-card-review"
          label="Review required"
          value={model.review.manualReviewRequired ? `${model.review.unresolvedActionCount} page(s)` : 'None'}
          explanation={`${model.review.activeOverrideCount} active override(s) · ${model.review.reviewedPageCount} reviewed`}
          emphasis={model.review.manualReviewRequired ? 'review' : 'normal'}
        />
        <OverviewCard
          testId="pdf-review-card-routing-cache"
          label="Routing / cache"
          value={model.routing.serviceClasses.join(', ') || 'Not recorded'}
          explanation={`Cache ${model.cache.lookupState ?? 'not recorded'} · ${model.routing.remotePageCount} remote page(s)`}
        />
        <OverviewCard
          testId="pdf-review-card-runtime-cost"
          label="Runtime / cost"
          value={model.lifecycle.durationMs != null ? `${Math.round(model.lifecycle.durationMs / 1000)}s` : 'Not recorded'}
          explanation={
            model.costPerformance.estimateState === 'known' && model.costPerformance.estimatedCostAmount != null
              ? `Est. ${model.costPerformance.estimatedCostAmount} ${model.costPerformance.estimatedCostCurrency ?? ''}`
              : 'Estimated cost unknown'
          }
        />
      </div>
    </section>
  );
}

function legacyLabel(state: PdfDocumentReviewModelV1['legacyState']): string {
  switch (state) {
    case 'legacy-v1': return 'Legacy V1 import';
    case 'legacy-v2': return 'Legacy V2 import';
    case 'v3-partial': return 'Partial V3 import';
    case 'unknown': return 'State unknown';
    default: return 'V3';
  }
}
