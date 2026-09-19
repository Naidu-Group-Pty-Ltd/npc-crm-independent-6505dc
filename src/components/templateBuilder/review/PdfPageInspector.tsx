/**
 * PDF Extraction V3 · E11 — page/region inspector (tabbed).
 *
 * Surfaces the authoritative decision detail for the active page: quality (E7,
 * hard defects dominant over score), table integrity (E4), chart/picture (E3),
 * typography (E5), composition/ownership (E6), repair audit (E8), provider audit
 * (E9), and routing/cache/recovery (E10). Presentational only — nothing here
 * recomputes a decision; every value comes from the pure page/region models.
 */
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { PdfPageReviewModelV1, PdfRegionReviewSummaryV1 } from '@/lib/reportTemplate/pdfImport/review';
import { metricStateLabel, pageStrategyLabel, cacheStateLabel, providerAttemptLabel } from '@/lib/reportTemplate/pdfImport/review/statusLanguage';
import { toneToBadgeVariant } from './reviewTone';

function m(v: number | null): string { return metricStateLabel(v).text; }

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/50 py-1 text-[11px] last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

export function PdfPageInspector({ page, onSelectRegion }: { page: PdfPageReviewModelV1; onSelectRegion?: (regionId: string) => void }) {
  const strat = pageStrategyLabel(page.output.pageStrategy);
  const cache = cacheStateLabel(page.cache.replayed, page.cache.artifactComplete, null);

  return (
    <div className="flex h-full flex-col" data-testid={`pdf-review-inspector-page-${page.pageNumber}`}>
      <div className="flex items-center gap-2 border-b p-2">
        <span className="text-xs font-semibold">Page {page.pageNumber}</span>
        <Badge variant={toneToBadgeVariant(strat.tone)} className="text-[10px]" data-testid="pdf-review-output-strategy">{strat.label}</Badge>
      </div>
      <Tabs defaultValue="quality" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-none bg-transparent p-1">
          {['quality', 'regions', 'composition', 'repair', 'provider', 'routing', 'cache'].map((t) => (
            <TabsTrigger key={t} value={t} className="h-6 px-2 text-[11px] capitalize">{t}</TabsTrigger>
          ))}
        </TabsList>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            <TabsContent value="quality" className="mt-0 space-y-2">
              {/* Hard defects are visually DOMINANT over the score. */}
              {page.quality.hardDefectCount > 0 ? (
                <div className="rounded border border-destructive/40 bg-destructive/5 p-2" data-testid="pdf-review-hard-defects">
                  <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    {page.quality.hardDefectCount} unresolved hard defect{page.quality.hardDefectCount === 1 ? '' : 's'}
                  </div>
                  <ul className="space-y-1">
                    {page.quality.defects.filter((d) => d.severity === 'hard').map((d, i) => (
                      <li key={`${d.code}-${i}`} data-testid={`pdf-review-hard-defect-${d.code}`} className="text-[11px]">
                        <button
                          type="button"
                          className="text-left font-mono text-destructive underline-offset-2 hover:underline"
                          onClick={() => d.regionId && onSelectRegion?.(d.regionId)}
                        >
                          {d.code}
                        </button>
                        <span className="text-muted-foreground"> — {d.explanation}</span>
                        {d.measuredValue != null && d.threshold != null && (
                          <span className="text-muted-foreground"> ({m(d.measuredValue)} vs {m(d.threshold)})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded border bg-muted/20 p-2 text-[11px] text-muted-foreground">No unresolved hard defects on this page.</div>
              )}
              <div className="rounded border p-2">
                <Row label="Source fidelity" value={m(page.quality.sourceFidelityScore)} />
                <Row label="Final-output score" value={m(page.quality.finalOutputScore)} />
                <Row label="Export score" value={m(page.quality.exportScore)} />
                <Row label="Metric coverage" value={m(page.quality.metricCoverage)} />
                <Row label="Recommended action" value={page.quality.recommendedAction ?? 'Not recorded'} />
              </div>
              <div className="rounded border p-2">
                <Row label="Editability" value={m(page.editability.percentage)} />
                <Row label="Native overlays" value={page.editability.nativeOverlayCount} />
                <Row label="Locked crops" value={page.editability.lockedCropCount} />
              </div>
            </TabsContent>

            <TabsContent value="regions" className="mt-0 space-y-1" data-testid="pdf-review-region-list">
              {page.regions.length === 0 ? (
                <div className="rounded border bg-muted/20 p-2 text-[11px] text-muted-foreground">No critical regions recorded for this page.</div>
              ) : page.regions.map((r) => <RegionRow key={r.regionId} region={r} onSelect={onSelectRegion} />)}
            </TabsContent>

            <TabsContent value="composition" className="mt-0">
              <div className="rounded border p-2">
                <Row label="Render plan" value={page.output.renderPlanHashPrefix ?? 'Not recorded'} />
                <Row label="Native regions" value={page.output.nativeRegionCount} />
                <Row label="Source crops" value={page.output.sourceCropRegionCount} />
                <Row label="Hidden semantic" value={page.output.hiddenSemanticRegionCount} />
                <Row label="Page raster" value={page.output.pageRaster ? 'Yes' : 'No'} />
              </div>
            </TabsContent>

            <TabsContent value="repair" className="mt-0" data-testid="pdf-review-repair-candidate">
              <div className="rounded border p-2">
                <Row label="Repair passes" value={page.repair.passes} />
                <Row label="Candidates" value={page.repair.candidateCount} />
                <Row label="Selected candidate" value={page.repair.selectedCandidateIdPrefix ?? 'None'} />
                <Row label="Resolved defects" value={page.repair.resolvedDefectCount} />
                <Row label="Introduced hard defects" value={page.repair.introducedHardDefectCount} />
              </div>
            </TabsContent>

            <TabsContent value="provider" className="mt-0 space-y-1" data-testid="pdf-review-provider-attempt">
              {page.providerAttempts.length === 0 ? (
                <div className="rounded border bg-muted/20 p-2 text-[11px] text-muted-foreground">No provider attempts (local extraction only).</div>
              ) : page.providerAttempts.map((a, i) => {
                const label = providerAttemptLabel(a.remote, a.policyBlocked, a.status);
                return (
                  <div key={`${a.providerId}-${i}`} className="rounded border p-2">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-[11px]">{a.providerId}</span>
                      <Badge variant={toneToBadgeVariant(label.tone)} className="text-[9px]">{label.label}</Badge>
                    </div>
                    <Row label="Purpose" value={a.purpose ?? '—'} />
                    <Row label="Pages" value={a.pageNumbers.join(', ') || '—'} />
                    <Row label="Regions" value={a.regionCount} />
                    <Row label="Privacy / residency" value={`${a.privacyClass ?? '—'} / ${a.residencyClass ?? '—'}`} />
                    <Row label="Source agreement" value={a.sourceAgreement ?? 'unknown'} />
                    <Row label="Elapsed" value={a.elapsedMs != null ? `${a.elapsedMs} ms` : 'Not recorded'} />
                    <Row label="Est. cost" value={a.estimatedCostState === 'known' ? String(a.estimatedCostAmount) : a.estimatedCostState} />
                  </div>
                );
              })}
            </TabsContent>

            <TabsContent value="routing" className="mt-0">
              <div className="rounded border p-2">
                <Row label="Complexity class" value={page.complexity.class ?? 'Not recorded'} />
                <Row label="Service class" value={page.routing.serviceClass ?? 'Not recorded'} />
                <Row label="Target state" value={page.routing.targetState ?? 'Not recorded'} />
                <Row label="Route reason" value={page.routing.routeReason ?? 'Not recorded'} />
                <Row label="Remote" value={page.routing.remote ? 'Yes' : 'No'} />
                <Row label="Providers" value={page.routing.providerIds.join(', ') || 'None'} />
              </div>
            </TabsContent>

            <TabsContent value="cache" className="mt-0" data-testid="pdf-review-cache-status">
              <div className="rounded border p-2">
                <Row label="Cache state" value={<Badge variant={toneToBadgeVariant(cache.tone)} className="text-[9px]">{cache.label}</Badge>} />
                <Row label="Replayed" value={page.cache.replayed === null ? 'Not recorded' : page.cache.replayed ? 'Yes' : 'No'} />
                <Row label="Artifact complete" value={page.cache.artifactComplete === null ? 'Not recorded' : page.cache.artifactComplete ? 'Yes' : 'No'} />
              </div>
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

function RegionRow({ region, onSelect }: { region: PdfRegionReviewSummaryV1; onSelect?: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(region.regionId)}
      data-testid={`pdf-review-region-${region.regionId}`}
      className="flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-[11px] hover:bg-muted/50"
    >
      <Badge variant="outline" className="px-1 py-0 text-[9px]">{region.regionType}</Badge>
      <span className="text-muted-foreground">{region.strategy}</span>
      <span className="ml-auto flex items-center gap-1">
        {region.hardDefectCount > 0 && <Badge variant="destructive" className="px-1 py-0 text-[9px]">{region.hardDefectCount}</Badge>}
        <span className="font-mono text-muted-foreground">{region.score === null ? '—' : `${Math.round(region.score * 100)}%`}</span>
        {region.editable ? <span className="text-[hsl(var(--success))]">editable</span> : <span className="text-muted-foreground">locked</span>}
      </span>
    </button>
  );
}
