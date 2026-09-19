import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BarChart3, ChevronRight, Home, Loader2, ArrowUpRight, ArrowDownRight, Minus, GitCompareArrows } from 'lucide-react';

interface DrillDownBreadcrumb {
  level: 'account' | 'campaign' | 'adset' | 'ad';
  label: string;
  id?: string;
}

interface DrillDownExplorerProps {
  level: 'account' | 'campaign' | 'adset' | 'ad';
  insights: any[];
  campaigns: any[];
  healthScores: any[];
  loading: boolean;
  error: Error | null;
  breadcrumbs: DrillDownBreadcrumb[];
  dateLabel: string;
  comparisonMode: boolean;
  selectedForComparison: string[];
  onDrillDown: (level: 'campaign' | 'adset' | 'ad', id: string, label: string) => void;
  onBreadcrumbClick: (index: number) => void;
  onRefetch: () => void;
  onToggleComparison: (id: string) => void;
  formatCurrency: (val: string | number | undefined) => string;
  formatNumber: (val: string | number | undefined) => string;
  formatPercent: (val: string | number | undefined) => string;
  extractAction: (actions: any[] | undefined, type: string) => number;
}

export function DrillDownExplorer({
  level,
  insights,
  campaigns,
  healthScores,
  loading,
  error,
  breadcrumbs,
  dateLabel,
  comparisonMode,
  selectedForComparison,
  onDrillDown,
  onBreadcrumbClick,
  onRefetch,
  onToggleComparison,
  formatCurrency,
  formatNumber,
  formatPercent,
  extractAction,
}: DrillDownExplorerProps) {
  const getHealthForCampaign = (campaignId: string) => {
    return healthScores.find((h: any) => h.campaign_id === campaignId);
  };

  const getRowId = (row: any) => {
    if (level === 'campaign') return row.campaign_id;
    if (level === 'adset') return row.adset_id;
    if (level === 'ad') return row.ad_id;
    return null;
  };

  const getRowName = (row: any) => {
    if (level === 'campaign') return row.campaign_name || 'Unknown Campaign';
    if (level === 'adset') return row.adset_name || 'Unknown Ad Set';
    if (level === 'ad') return row.ad_name || 'Unknown Ad';
    return 'Account';
  };

  const canDrillDown = level === 'campaign' || level === 'adset';
  const nextLevel = level === 'campaign' ? 'adset' : level === 'adset' ? 'ad' : null;

  // Compute per-row metrics and sort by spend desc
  const enrichedRows = insights.map((row: any) => {
    const leads = extractAction(row.actions, 'lead');
    const cpl = leads > 0 ? Number(row.spend || 0) / leads : 0;
    const spend = Number(row.spend || 0);
    return { ...row, _leads: leads, _cpl: cpl, _spend: spend };
  }).sort((a: any, b: any) => b._spend - a._spend);

  // Find best/worst performers
  const bestCPL = enrichedRows.filter(r => r._leads > 0).sort((a, b) => a._cpl - b._cpl)[0];
  const bestCTR = enrichedRows.sort((a, b) => Number(b.ctr || 0) - Number(a.ctr || 0))[0];

  return (
    <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-lg flex items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                  <BarChart3 className="h-5 w-5 text-primary" />
                </span>
                <span className="truncate">Performance Explorer</span>
              </CardTitle>
              <CardDescription className="mt-1">
                {insights.length} {level === 'campaign' ? 'campaigns' : level === 'adset' ? 'ad sets' : level === 'ad' ? 'ads' : 'results'} · {dateLabel}
              </CardDescription>
            </div>
          </div>

          {/* Breadcrumb navigation */}
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto rounded-2xl border border-border/60 bg-background/45 p-1.5">
            {breadcrumbs.map((crumb, idx) => (
              <div key={idx} className="flex min-w-0 shrink-0 items-center gap-1.5">
                {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                <Button
                  variant={idx === breadcrumbs.length - 1 ? 'secondary' : 'ghost'}
                  size="sm"
                  className={`h-7 max-w-[220px] rounded-xl px-2.5 text-xs font-medium ${
                    idx === breadcrumbs.length - 1
                      ? 'bg-primary/10 text-primary pointer-events-none shadow-sm'
                      : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
                  }`}
                  onClick={() => idx < breadcrumbs.length - 1 && onBreadcrumbClick(idx)}
                  title={crumb.label}
                >
                  {idx === 0 && <Home className="h-3 w-3 mr-1" />}
                  <span className="truncate">{crumb.label}</span>
                </Button>
              </div>
            ))}
          </div>

          {/* Quick stats for current level */}
          {!loading && enrichedRows.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap text-xs">
              {bestCTR && level !== 'account' && (
                <Badge variant="outline" className="max-w-full gap-1 truncate rounded-full border-success/30 bg-success/5 text-[10px] font-normal text-success dark:text-success" title={`Best CTR: ${getRowName(bestCTR)} (${formatPercent(bestCTR.ctr)})`}>
                  <ArrowUpRight className="h-3 w-3" />
                  <span className="truncate">Best CTR: {getRowName(bestCTR)} ({formatPercent(bestCTR.ctr)})</span>
                </Badge>
              )}
              {bestCPL && level !== 'account' && (
                <Badge variant="outline" className="max-w-full gap-1 truncate rounded-full border-info/30 bg-info/5 text-[10px] font-normal text-info dark:text-info" title={`Best CPL: ${getRowName(bestCPL)} (${formatCurrency(bestCPL._cpl)})`}>
                  <ArrowDownRight className="h-3 w-3" />
                  <span className="truncate">Best CPL: {getRowName(bestCPL)} ({formatCurrency(bestCPL._cpl)})</span>
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground mt-3">Fetching data...</p>
            </div>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-destructive/10 mb-3">
              <BarChart3 className="h-6 w-6 text-destructive" />
            </div>
            <p className="font-medium text-foreground">Failed to load data</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{error.message}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={onRefetch}>Try Again</Button>
          </div>
        ) : insights.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No data found</p>
            <p className="text-sm mt-1">Try a different date range or go back up</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/35">
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  {comparisonMode && <TableHead className="w-[40px]" />}
                  {level !== 'account' && (
                    <TableHead className="min-w-[200px]">
                      {level === 'campaign' ? 'Campaign' : level === 'adset' ? 'Ad Set' : 'Ad'}
                    </TableHead>
                  )}
                  {level === 'campaign' && <TableHead className="text-center w-[80px]">Health</TableHead>}
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">CPC</TableHead>
                  <TableHead className="text-right">Reach</TableHead>
                  <TableHead className="text-right">Freq</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  {canDrillDown && <TableHead className="w-[40px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrichedRows.map((row: any, i: number) => {
                  const rowId = getRowId(row) || String(i);
                  const rowName = getRowName(row);
                  const campaign = campaigns?.find((c: any) => c.id === row.campaign_id);
                  const health = getHealthForCampaign(row.campaign_id);
                  const isSelected = selectedForComparison.includes(rowId);

                  return (
                    <TableRow
                      key={rowId}
                      className={`group transition-colors ${canDrillDown ? 'cursor-pointer hover:bg-primary/5' : ''} ${isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
                      onClick={() => {
                        if (canDrillDown && nextLevel && !comparisonMode) {
                          onDrillDown(nextLevel as 'adset' | 'ad', rowId, rowName);
                        }
                      }}
                    >
                      {comparisonMode && (
                        <TableCell className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <input
                            aria-label={`Select ${rowName} for comparison`}
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onToggleComparison(rowId)}
                            className="h-4 w-4 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          />
                        </TableCell>
                      )}
                      {level !== 'account' && (
                        <TableCell className="font-medium max-w-[280px]">
                          <div className="flex min-w-0 items-center gap-2" title={rowName}>
                            <span className="truncate">{rowName}</span>
                            {level === 'campaign' && campaign?.status && (
                              <Badge
                                variant={campaign.status === 'ACTIVE' ? 'default' : 'secondary'}
                                className="text-[10px] px-1.5 py-0 shrink-0"
                              >
                                {campaign.status}
                              </Badge>
                            )}
                            {canDrillDown && (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                            )}
                          </div>
                        </TableCell>
                      )}
                      {level === 'campaign' && (
                        <TableCell className="text-center">
                          {health ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className={`font-mono text-[10px] cursor-default ${
                                    health.status === 'healthy' ? 'border-success/30 text-success dark:text-success bg-success/5' :
                                    health.status === 'watch' ? 'border-brand-500/30 text-brand-600 dark:text-brand-400 bg-brand-500/5' :
                                    'border-destructive/30 text-destructive dark:text-destructive bg-destructive/5'
                                  }`}
                                >
                                  {health.score}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-xs">
                                <p className="font-semibold text-xs mb-1">
                                  {health.status === 'healthy' ? '🟢 Healthy' : health.status === 'watch' ? '🟡 Watch' : '🔴 Action Needed'}
                                </p>
                                {health.recommendations?.slice(0, 2).map((r: string, ri: number) => (
                                  <p key={ri} className="text-xs text-muted-foreground">→ {r}</p>
                                ))}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(row.spend)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatNumber(row.impressions)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatNumber(row.clicks)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatPercent(row.ctr)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(row.cpc)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatNumber(row.reach)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{Number(row.frequency || 0).toFixed(1)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">{formatNumber(row._leads)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{row._cpl > 0 ? formatCurrency(row._cpl) : '—'}</TableCell>
                      {canDrillDown && (
                        <TableCell className="text-center">
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
