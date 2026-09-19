/**
 * VisualQualityPageReviewGrid — responsive per-page review grid (C7).
 *
 * Lays out one `VisualQualityPageReviewCard` per page. Presentational: the grid
 * receives a pure `PageReviewCollection` view-model and forwards per-page action
 * intents. Stays responsive up to the model's page limit; beyond it, it warns
 * that the document is large rather than rendering an unbounded wall of cards.
 */
import { LayoutGrid } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { VisualQualityPageReviewCard } from './VisualQualityPageReviewCard';
import type { PageReviewCollection, PageReviewAction } from '@/lib/reportTemplate/ingestion/visualQuality';
import type { CorroboratedFinding, CritiqueSummary } from '@/lib/reportTemplate/pdfImport/visualCritique';

interface Props {
  collection: PageReviewCollection;
  aiRepairEnabled?: boolean;
  aiCritiqueEnabled?: boolean;
  /** Stage 3 — critique results by page id, for pages where one has run. */
  pageCritiques?: Record<string, { findings: CorroboratedFinding[]; summary: CritiqueSummary }> | null;
  /** The page currently running an action (disables its card's controls). */
  busyPageId?: string | null;
  onAction?: (pageId: string, action: PageReviewAction) => void;
}

export function VisualQualityPageReviewGrid({ collection, aiRepairEnabled, aiCritiqueEnabled, pageCritiques, busyPageId, onAction }: Props) {
  if (collection.totalPages === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        No per-page review data is available yet. Run visual QA to populate source/generated/diff imagery.
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <LayoutGrid className="h-4 w-4 text-primary" /> Per-page review
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="secondary">{collection.scoredPages} scored</Badge>
          {collection.unscoredPages > 0 && <Badge variant="warning">{collection.unscoredPages} unscored</Badge>}
          {collection.pagesNeedingReview > 0 && <Badge variant="destructive">{collection.pagesNeedingReview} need review</Badge>}
        </div>
      </div>

      {!collection.responsive && (
        <p className="mt-2 rounded border border-warning/30 bg-warning/5 px-2 py-1 text-[11px] text-muted-foreground">
          Large document ({collection.totalPages} pages). Cards below load imagery lazily; scroll to review each page.
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {collection.pages.map((model) => (
          <VisualQualityPageReviewCard
            key={model.pageId}
            model={model}
            aiRepairEnabled={aiRepairEnabled}
            aiCritiqueEnabled={aiCritiqueEnabled}
            critique={pageCritiques?.[model.pageId] ?? null}
            busy={busyPageId === model.pageId}
            onAction={onAction}
          />
        ))}
      </div>
    </Card>
  );
}
