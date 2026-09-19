import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Loader2, Image, DollarSign, MousePointerClick, Eye, Target, Trophy, Play, Maximize2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface CreativeGalleryProps {
  datePreset: string;
  /** Custom analytics range; when set it wins over the preset server-side. */
  timeRange?: { since: string; until: string };
}

function formatCurrency(val: number) {
  return `$${val.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNum(val: number) {
  return val.toLocaleString('en-AU');
}

interface Creative {
  ad_id: string;
  ad_name: string;
  status: string;
  thumbnail_url: string | null;
  image_url: string | null;
  title: string | null;
  body: string | null;
  is_video: boolean;
  video_url: string | null;
  preview_url: string | null;
  width: number | null;
  height: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  reach: number;
  leads: number;
  cpl: number;
}

/** Returns inline aspect-ratio style based on creative dimensions */
function getAspectStyle(creative: Creative): React.CSSProperties {
  if (creative.width && creative.height) {
    return { aspectRatio: `${creative.width} / ${creative.height}` };
  }
  // If Meta does not return dimensions, avoid forcing portrait/square crops.
  return {};
}

export function CreativeGalleryPanel({ datePreset, timeRange }: CreativeGalleryProps) {
  const [previewCreative, setPreviewCreative] = useState<Creative | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['meta-ads-creatives', datePreset, timeRange],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('analyze-meta-ads-phase5', {
        action: 'creatives',
        datePreset,
        ...(timeRange ? { timeRange } : {}),
        limit: 20,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const creatives: Creative[] = data?.creatives || [];

  const bestCTR = creatives.length > 0 ? creatives.reduce((best, c) => c.ctr > (best?.ctr || 0) ? c : best, creatives[0]) : null;
  const bestCPL = creatives.filter(c => c.leads > 0).sort((a, b) => a.cpl - b.cpl)[0] || null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Image className="h-5 w-5 text-primary" />
            Creative Performance Gallery
          </CardTitle>
          <CardDescription>Ad creatives ranked by spend with performance metrics</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading creatives...</span>
            </div>
          ) : creatives.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Image className="h-10 w-10 mx-auto mb-2 opacity-30" />
              No ad creatives with spend found for this period
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {creatives.map((creative) => {
                const isBestCTR = bestCTR?.ad_id === creative.ad_id;
                const isBestCPL = bestCPL?.ad_id === creative.ad_id;
                // Use full image_url for display, fall back to thumbnail
                const displayUrl = creative.image_url || creative.thumbnail_url;

                return (
                  <div
                    key={creative.ad_id}
                    className={cn(
                      'rounded-lg border border-border overflow-hidden transition-shadow hover:shadow-md group',
                      (isBestCTR || isBestCPL) && 'ring-1 ring-primary/30'
                    )}
                  >
                    {/* Media */}
                    <div
                      className="bg-muted relative overflow-hidden cursor-pointer"
                      style={getAspectStyle(creative)}
                      onClick={() => setPreviewCreative(creative)}
                    >
                      {displayUrl ? (
                        <img
                          src={displayUrl}
                          alt={creative.ad_name}
                          className="w-full h-auto object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full min-h-40 flex items-center justify-center">
                          <Image className="h-8 w-8 text-muted-foreground/30" />
                        </div>
                      )}

                      {/* Video indicator */}
                      {creative.is_video && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center shadow-lg transition-transform group-hover:scale-110">
                            <Play className="h-5 w-5 text-foreground ml-0.5" />
                          </div>
                        </div>
                      )}

                      {/* Expand hint */}
                      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="h-6 w-6 rounded bg-background/80 backdrop-blur-sm flex items-center justify-center">
                          <Maximize2 className="h-3 w-3 text-foreground" />
                        </div>
                      </div>

                      {/* Status badge */}
                      <Badge
                        variant={creative.status === 'ACTIVE' ? 'default' : 'secondary'}
                        className="absolute top-2 right-2 text-[9px] px-1.5 py-0"
                      >
                        {creative.status}
                      </Badge>

                      {/* Winner badges */}
                      {(isBestCTR || isBestCPL) && (
                        <div className="absolute top-2 left-2 flex gap-1">
                          {isBestCTR && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge className="bg-primary text-primary-foreground text-[9px] px-1.5 py-0 gap-0.5">
                                  <Trophy className="h-2.5 w-2.5" /> CTR
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Best click-through rate</TooltipContent>
                            </Tooltip>
                          )}
                          {isBestCPL && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge className="bg-success text-foreground dark:text-white text-[9px] px-1.5 py-0 gap-0.5">
                                  <Trophy className="h-2.5 w-2.5" /> CPL
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Lowest cost per lead</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-3 space-y-2">
                      <p className="text-sm font-medium text-foreground truncate" title={creative.ad_name}>
                        {creative.ad_name}
                      </p>
                      {creative.title && (
                        <p className="text-xs text-muted-foreground truncate">{creative.title}</p>
                      )}

                      {/* Metrics grid */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1">
                        <MetricItem icon={<DollarSign className="h-3 w-3" />} label="Spend" value={formatCurrency(creative.spend)} />
                        <MetricItem icon={<Eye className="h-3 w-3" />} label="Impr" value={formatNum(creative.impressions)} />
                        <MetricItem icon={<MousePointerClick className="h-3 w-3" />} label="CTR" value={`${creative.ctr.toFixed(2)}%`} highlight={isBestCTR} />
                        <MetricItem icon={<Target className="h-3 w-3" />} label="Leads" value={formatNum(creative.leads)} />
                        {creative.leads > 0 && (
                          <MetricItem icon={<DollarSign className="h-3 w-3" />} label="CPL" value={formatCurrency(creative.cpl)} highlight={isBestCPL} />
                        )}
                        <MetricItem icon={<MousePointerClick className="h-3 w-3" />} label="CPC" value={formatCurrency(creative.cpc)} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Modal */}
      <CreativePreviewModal
        creative={previewCreative}
        onClose={() => setPreviewCreative(null)}
      />
    </>
  );
}

/* ── Preview Modal ── */

function CreativePreviewModal({ creative, onClose }: { creative: Creative | null; onClose: () => void }) {
  // Prefer image_url (hi-res) over thumbnail_url (low-res 64x64)
  const mediaUrl = creative?.image_url || creative?.thumbnail_url;

  // Only set explicit aspect ratio if we have real dimensions; otherwise let media render naturally
  const hasRealDimensions = creative?.width && creative?.height;
  const aspectStyle: React.CSSProperties = hasRealDimensions
    ? { aspectRatio: `${creative!.width} / ${creative!.height}` }
    : {};

  return (
    <Dialog open={!!creative} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl w-[calc(100vw-32px)] p-0 overflow-hidden bg-background border-border">
        {creative && (
          <div className="flex flex-col">
            {/* Media area - dynamic sizing based on actual dimensions */}
            <div className="relative bg-background dark:bg-black flex items-center justify-center">
              {creative.is_video && creative.video_url ? (
                <video
                  src={creative.video_url}
                  poster={mediaUrl || undefined}
                  controls
                  playsInline
                  autoPlay
                  className="w-full max-h-[80vh] object-contain"
                  style={aspectStyle}
                />
              ) : creative.is_video && creative.preview_url ? (
                <iframe
                  src={creative.preview_url}
                  className="w-full border-0"
                  style={{ minHeight: '500px', maxHeight: '80vh', aspectRatio: '9 / 16' }}
                  allow="autoplay; fullscreen"
                  sandbox="allow-scripts allow-same-origin allow-popups"
                />
              ) : mediaUrl ? (
                <img
                  src={mediaUrl}
                  alt={creative.ad_name}
                  className="w-full max-h-[80vh] object-contain"
                  style={aspectStyle}
                />
              ) : (
                <div className="py-24 flex items-center justify-center">
                  <Image className="h-16 w-16 text-muted-foreground/20" />
                </div>
              )}
            </div>

            {/* Info bar */}
            <div className="p-4 border-t border-border space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground truncate">{creative.ad_name}</h3>
                  {creative.title && (
                    <p className="text-sm text-muted-foreground truncate">{creative.title}</p>
                  )}
                </div>
                <Badge variant={creative.status === 'ACTIVE' ? 'default' : 'secondary'} className="shrink-0">
                  {creative.status}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="text-muted-foreground">Spend: <span className="text-foreground font-medium">{formatCurrency(creative.spend)}</span></span>
                <span className="text-muted-foreground">Impr: <span className="text-foreground font-medium">{formatNum(creative.impressions)}</span></span>
                <span className="text-muted-foreground">CTR: <span className="text-foreground font-medium">{creative.ctr.toFixed(2)}%</span></span>
                <span className="text-muted-foreground">CPC: <span className="text-foreground font-medium">{formatCurrency(creative.cpc)}</span></span>
                {creative.leads > 0 && (
                  <>
                    <span className="text-muted-foreground">Leads: <span className="text-foreground font-medium">{creative.leads}</span></span>
                    <span className="text-muted-foreground">CPL: <span className="text-foreground font-medium">{formatCurrency(creative.cpl)}</span></span>
                  </>
                )}
                {creative.width && creative.height && (
                  <span className="text-muted-foreground">Size: <span className="text-foreground font-medium">{creative.width}×{creative.height}</span></span>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}




/* ── Metric Item ── */

function MetricItem({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={highlight ? 'text-primary' : 'text-muted-foreground'}>{icon}</span>
      <div>
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground leading-none">{label}</p>
        <p className={cn('text-xs font-mono font-medium leading-tight', highlight ? 'text-primary' : 'text-foreground')}>{value}</p>
      </div>
    </div>
  );
}
