import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Loader2, ChevronDown, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { TIER_INFO, type ReportTier } from './TierBadge';
import { REPORT_VARIANT_ORDER } from '@/lib/reports/reportVariants';
import { fetchReportFamily, generateSubReport, type ReportFamily, type SubReportVariant } from '@/lib/reports/subReports';

interface TierSwitcherProps {
  reportId: string;
  currentTier: ReportTier;
  parentReportId?: string | null;
  onTierSwitch?: (newReportId: string, newTier: ReportTier) => void;
  disabled?: boolean;
}

/**
 * Switch between the reports of one Compass family, generating the missing
 * ones through the engine that owns each variant.
 *
 * Two defects lived here (audit F9). The sibling lookup read
 * `investment_reports` from the BROWSER, where the service-role-only
 * policies filter every row — so siblings always read as absent, switching
 * to an existing child was impossible, and every click regenerated one. And
 * every missing tier was generated via condense-investment-report — a model
 * — including "Financial", which the page header produces deterministically
 * by forking; two engines answered to one name and could not see each
 * other's children. The family reads through the server now, and the engine
 * per variant is the one shared mapping (`generateSubReport`).
 */
export function TierSwitcher({
  reportId,
  currentTier,
  parentReportId: _parentReportId,
  onTierSwitch,
  disabled = false,
}: TierSwitcherProps) {
  const [loadingTier, setLoadingTier] = useState<ReportTier | null>(null);
  const [family, setFamily] = useState<ReportFamily | null>(null);
  const { toast } = useToast();

  const loadFamily = async () => {
    const loaded = await fetchReportFamily(reportId);
    if (loaded) setFamily(loaded);
  };

  const rowFor = (tier: ReportTier) => {
    if (!family) return null;
    if (tier === 'compass') {
      return family.parentId ? { id: family.parentId, stale: false } : null;
    }
    const child = family.children.find((c) => c.variant === tier && c.status === 'completed');
    return child ? { id: child.id, stale: child.stale } : null;
  };

  const handleTierSelect = async (targetTier: ReportTier) => {
    if (targetTier === currentTier || loadingTier) return;

    const existing = rowFor(targetTier);
    if (existing) {
      onTierSwitch?.(existing.id, targetTier);
      toast({ title: 'Report Switched', description: `Viewing ${TIER_INFO[targetTier].name}` });
      return;
    }

    if (targetTier === 'compass') {
      toast({
        title: 'Cannot Open',
        description: 'No parent Compass report found for this report.',
        variant: 'destructive',
      });
      return;
    }

    const parentId = family?.parentId;
    if (!parentId) {
      toast({
        title: 'Cannot Generate',
        description: 'No parent Compass report found',
        variant: 'destructive',
      });
      return;
    }

    setLoadingTier(targetTier);
    try {
      const generated = await generateSubReport(parentId, targetTier as SubReportVariant);
      toast({ title: 'Report Generated', description: `${TIER_INFO[targetTier].name} is ready` });
      onTierSwitch?.(generated.reportId, targetTier);
      void loadFamily();
    } catch (error) {
      console.error('Error generating tier:', error);
      toast({
        title: 'Generation Failed',
        description: error instanceof Error ? error.message : 'Failed to generate report tier',
        variant: 'destructive',
      });
    } finally {
      setLoadingTier(null);
    }
  };

  const CurrentIcon = TIER_INFO[currentTier]?.icon ?? TIER_INFO.compass.icon;
  const isLoading = loadingTier !== null;

  return (
    <DropdownMenu onOpenChange={(open) => open && void loadFamily()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || isLoading}
          className="gap-2"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CurrentIcon className="h-4 w-4" />
          )}
          {TIER_INFO[currentTier].shortName}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Report Versions</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {REPORT_VARIANT_ORDER.map((tier) => {
          const info = TIER_INFO[tier];
          const Icon = info.icon;
          const isCurrentTier = tier === currentTier;
          const existing = rowFor(tier);
          const isGenerating = loadingTier === tier;

          return (
            <DropdownMenuItem
              key={tier}
              onClick={() => handleTierSelect(tier)}
              disabled={isGenerating}
              className="flex items-start gap-3 py-3 cursor-pointer"
            >
              <div className={`p-1.5 rounded ${info.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{info.name}</span>
                  {isCurrentTier && <Check className="h-3 w-3 text-success" />}
                </div>
                <p className="text-xs text-muted-foreground">
                  {info.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isGenerating
                    ? 'Generating...'
                    : existing?.stale
                      ? 'Available — parent has changed since'
                      : existing
                        ? '✓ Available'
                        : tier === 'compass'
                          ? 'Base report'
                          : 'Click to generate'}
                </p>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
