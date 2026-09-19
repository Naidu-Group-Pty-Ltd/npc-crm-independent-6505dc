/**
 * VisualQualityReviewDialog — Phase 6 review surface for the Visual Import
 * Quality contract.
 *
 * Loads the persisted `VisualImportQualityReport` + signed raster URLs via
 * `loadVisualQuality`, renders per-page thumbnails with Source / Generated /
 * Diff tabs, per-page scores, warnings, and three action buttons:
 *
 *   - Accept           → caller marks the import as accepted
 *   - Repair           → caller runs the AI repair loop (Phase 6 logic)
 *   - Fallback         → caller switches to hybrid / pixel-perfect render
 *
 * This component owns presentation only. All decision side-effects are
 * delegated to the parent via callbacks so it can be embedded in either
 * the template-builder or the admin diagnostics page.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ImageOff, Loader2, RotateCw,
  ShieldAlert, Sparkles, Wand2,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  loadVisualQuality,
  type PersistedVisualQuality,
  type VisualImportQualityReport,
  type VisualPageQualityReport,
  type VisualRecommendedAction,
} from '@/lib/reportTemplate/ingestion/visualQuality';

type RasterKind = 'source' | 'generated' | 'diff';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Import id used by `loadVisualQuality` — required when `payload` is not provided. */
  importId?: string | null;
  /** Pre-loaded payload (used by tests / admin views that already have the data). */
  payload?: PersistedVisualQuality | null;
  /** Optional initial report to render before the persisted payload resolves. */
  initialReport?: VisualImportQualityReport | null;
  onAccept?: () => void | Promise<void>;
  onRepair?: () => void | Promise<void>;
  onFallback?: (mode: 'hybrid' | 'pixel-perfect') => void | Promise<void>;
  repairBusy?: boolean;
  fallbackBusy?: boolean;
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function actionTone(action: VisualRecommendedAction): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  switch (action) {
    case 'accept': return { label: 'Accept', variant: 'default' };
    case 'accept_with_warnings': return { label: 'Accept with warnings', variant: 'secondary' };
    case 'repair': return { label: 'Repair', variant: 'secondary' };
    case 'fallback_to_hybrid': return { label: 'Fallback → hybrid', variant: 'outline' };
    case 'fallback_to_pixel': return { label: 'Fallback → pixel', variant: 'outline' };
    case 'manual_review':
    default: return { label: 'Manual review', variant: 'destructive' };
  }
}

function scoreBadgeVariant(score: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (score >= 0.92) return 'default';
  if (score >= 0.8) return 'secondary';
  if (score >= 0.65) return 'outline';
  return 'destructive';
}

export function VisualQualityReviewDialog({
  open, onOpenChange, importId, payload: payloadProp, initialReport,
  onAccept, onRepair, onFallback, repairBusy, fallbackBusy,
}: Props) {
  const [payload, setPayload] = useState<PersistedVisualQuality | null>(payloadProp ?? null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [rasterKind, setRasterKind] = useState<RasterKind>('diff');

  useEffect(() => { setPayload(payloadProp ?? null); }, [payloadProp]);

  useEffect(() => {
    if (!open || payloadProp || !importId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadVisualQuality(importId).then((res) => {
      if (cancelled) return;
      if (res.kind === 'ok') setPayload(res.payload);
      else if (res.kind === 'missing') setPayload(null);
      else setLoadError(res.message);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, importId, payloadProp]);

  const report = payload?.report ?? initialReport ?? null;
  const pages = report?.pages ?? [];

  useEffect(() => {
    if (pages.length === 0) { setSelectedPageId(null); return; }
    if (!selectedPageId || !pages.find((p) => p.pageId === selectedPageId)) {
      setSelectedPageId(pages[0].pageId);
    }
  }, [pages, selectedPageId]);

  const selectedPage = useMemo(
    () => pages.find((p) => p.pageId === selectedPageId) ?? null,
    [pages, selectedPageId],
  );

  const signedUrl = (page: VisualPageQualityReport, kind: RasterKind): string | null => {
    if (!payload?.signedUrls) return null;
    return payload.signedUrls[`${page.pageNumber}:${kind}`] ?? null;
  };

  const overallTone = report ? actionTone(
    report.manualReviewRequired ? 'manual_review' :
    report.overallScore >= 0.92 ? 'accept' :
    report.overallScore >= 0.8 ? 'accept_with_warnings' : 'repair',
  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Visual import quality
          </DialogTitle>
          <DialogDescription>
            Per-page fidelity scores comparing the rendered template against the source PDF.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading quality report…
          </div>
        )}

        {!loading && loadError && (
          <Card className="p-4 border-destructive/40 bg-destructive/5 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <ShieldAlert className="h-4 w-4" /> Failed to load quality report
            </div>
            <p className="mt-1 text-muted-foreground">{loadError}</p>
          </Card>
        )}

        {!loading && !loadError && !report && (
          <Card className="p-4 text-sm text-muted-foreground">
            No visual quality data has been produced for this import yet.
          </Card>
        )}

        {!loading && report && (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            {/* Header strip */}
            <div className="grid gap-3 md:grid-cols-5">
              <Metric label="Overall" value={pct(report.overallScore)} />
              <Metric label="Pages" value={String(report.pages.length)} />
              <Metric label="Mode" value={report.finalMode} />
              <Metric label="Repair passes" value={String(report.repairPassesApplied)} />
              <Card className={`p-3 ${report.manualReviewRequired ? 'border-destructive/40 bg-destructive/5' : ''}`}>
                <div className="text-xs text-muted-foreground">Recommendation</div>
                <Badge variant={overallTone?.variant ?? 'outline'} className="mt-1">
                  {overallTone?.label ?? '—'}
                </Badge>
              </Card>
            </div>

            <div className="flex-1 min-h-0 grid gap-3 md:grid-cols-[260px_1fr]">
              {/* Page list */}
              <Card className="p-2 overflow-hidden flex flex-col">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Pages</div>
                <ScrollArea className="flex-1">
                  <div className="space-y-1 p-1">
                    {pages.map((page) => {
                      const action = actionTone(page.recommendedAction);
                      const active = page.pageId === selectedPageId;
                      return (
                        <button
                          key={page.pageId}
                          type="button"
                          onClick={() => setSelectedPageId(page.pageId)}
                          className={`w-full text-left rounded-md border p-2 text-xs transition ${
                            active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">Page {page.pageNumber}</span>
                            <Badge variant={scoreBadgeVariant(page.overallScore)} className="tabular-nums">
                              {pct(page.overallScore)}
                            </Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                            <Badge variant={action.variant} className="text-[10px] px-1.5 py-0">
                              {action.label}
                            </Badge>
                            {page.warnings.length > 0 && (
                              <span className="inline-flex items-center gap-0.5">
                                <AlertTriangle className="h-3 w-3" /> {page.warnings.length}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </Card>

              {/* Detail */}
              <Card className="p-3 overflow-hidden flex flex-col">
                {selectedPage ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">Page {selectedPage.pageNumber}</div>
                        <div className="text-xs text-muted-foreground">{selectedPage.pageId}</div>
                      </div>
                      <Badge variant={scoreBadgeVariant(selectedPage.overallScore)} className="tabular-nums">
                        Overall {pct(selectedPage.overallScore)}
                      </Badge>
                    </div>

                    <div className="mt-2 grid grid-cols-5 gap-2 text-[11px] text-muted-foreground">
                      <MiniScore label="Pixel" value={selectedPage.pixelDifferenceScore} />
                      <MiniScore label="Text" value={selectedPage.textCoverageScore} />
                      <MiniScore label="Layout" value={selectedPage.layoutDriftScore} />
                      <MiniScore label="Missing" value={selectedPage.missingElementScore} />
                      <MiniScore label="Colour" value={selectedPage.colorSimilarityScore} />
                    </div>

                    <Tabs
                      value={rasterKind}
                      onValueChange={(v) => setRasterKind(v as RasterKind)}
                      className="mt-3 flex-1 min-h-0 flex flex-col"
                    >
                      <TabsList className="self-start">
                        <TabsTrigger value="source">Source</TabsTrigger>
                        <TabsTrigger value="generated">Generated</TabsTrigger>
                        <TabsTrigger value="diff">Diff</TabsTrigger>
                      </TabsList>
                      {(['source', 'generated', 'diff'] as RasterKind[]).map((kind) => {
                        const url = signedUrl(selectedPage, kind);
                        return (
                          <TabsContent
                            key={kind}
                            value={kind}
                            className="flex-1 min-h-0 mt-2 rounded-md border bg-muted/30 overflow-auto flex items-center justify-center"
                          >
                            {url ? (
                              <img
                                src={url}
                                alt={`Page ${selectedPage.pageNumber} ${kind} raster`}
                                className="max-w-full max-h-full object-contain"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex flex-col items-center gap-1 p-6 text-xs text-muted-foreground">
                                <ImageOff className="h-5 w-5" />
                                No {kind} raster persisted for this page.
                              </div>
                            )}
                          </TabsContent>
                        );
                      })}
                    </Tabs>

                    {selectedPage.warnings.length > 0 && (
                      <div className="mt-3 max-h-32 overflow-auto rounded-md border p-2">
                        <div className="text-xs font-medium mb-1">Warnings</div>
                        <div className="space-y-1">
                          {selectedPage.warnings.map((w, i) => (
                            <div key={`${w.code}-${i}`} className="flex items-start justify-between gap-2 text-xs">
                              <div>
                                <div className="font-medium">{w.code.replace(/_/g, ' ')}</div>
                                <div className="text-muted-foreground">{w.message}</div>
                              </div>
                              <Badge variant={w.severity === 'error' ? 'destructive' : 'secondary'} className="text-[10px]">
                                {w.severity}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                    Select a page to inspect rasters.
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-wrap gap-2">
          {onRepair && (
            <Button variant="secondary" onClick={() => onRepair()} disabled={!!repairBusy}>
              {repairBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
              Run repair loop
            </Button>
          )}
          {onFallback && (
            <>
              <Button variant="outline" onClick={() => onFallback('hybrid')} disabled={!!fallbackBusy}>
                <RotateCw className="h-4 w-4 mr-1" /> Fallback to hybrid
              </Button>
              <Button variant="outline" onClick={() => onFallback('pixel-perfect')} disabled={!!fallbackBusy}>
                <RotateCw className="h-4 w-4 mr-1" /> Fallback to pixel
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {onAccept && (
            <Button onClick={() => onAccept()} disabled={!report}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Accept import
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

function MiniScore({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded border bg-background px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold tabular-nums">{pct(value)}</div>
    </div>
  );
}
