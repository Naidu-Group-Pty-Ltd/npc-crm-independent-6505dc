import { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { BadgeCheck, RefreshCw, ShieldQuestion } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePermissions } from '@/hooks/usePermissions';
import { useWorkspaceEntitlements } from '@/hooks/useWorkspaceEntitlements';
import {
  CAPABILITY_DEFINITIONS,
  resolveCapability,
  type CapabilityDecision,
} from '@/lib/entitlements';

const STATUS_TONE: Record<string, string> = {
  enabled: 'border-success/40 bg-success/10 text-success',
  plan_excluded: 'border-border bg-muted/40 text-muted-foreground',
  product_unavailable: 'border-border bg-muted/40 text-muted-foreground',
  unknown: 'border-warning/40 bg-warning/10 text-warning',
  loading: 'border-border bg-muted/40 text-muted-foreground',
};

/**
 * Entitlement diagnostics — superadministrator only.
 *
 * Shows exactly what the entitlement system believes: the snapshot Mission
 * Control last provided (plan, add-ons, source, age, staleness), and the
 * resolved decision for every registered capability including WHICH source
 * grants it. This is the screen that answers "why can't this workspace see
 * Market News Feed" without reading code.
 */
export function EntitlementDiagnosticsCard() {
  const { isSuperadmin } = usePermissions();
  const {
    workspaceId,
    snapshot,
    snapshotState,
    isRefreshing,
    error,
    refreshEntitlements,
  } = useWorkspaceEntitlements();
  const [showAll, setShowAll] = useState(false);

  const decisions = useMemo<CapabilityDecision[]>(
    () =>
      CAPABILITY_DEFINITIONS
        // Module-level rows tell the commercial story; client.* rows appear
        // under "show all".
        .filter((def) => showAll || !def.key.startsWith('client.'))
        .map((def) => resolveCapability(def.key, { snapshot, snapshotState })),
    [snapshot, snapshotState, showAll],
  );

  if (!isSuperadmin) return null;

  const snapshotAge = snapshot
    ? formatDistanceToNow(new Date(snapshot.fetchedAt), { addSuffix: true })
    : null;

  return (
    <Card className="glass-card">
      <CardHeader className="space-y-2">
        <CardTitle className="flex min-w-0 items-center justify-between gap-2 text-lg md:text-xl">
          <span className="flex items-center gap-2">
            <ShieldQuestion className="h-5 w-5 shrink-0 text-primary" />
            Entitlement Diagnostics
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={isRefreshing}
            onClick={() => void refreshEntitlements()}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardTitle>
        <CardDescription>
          What the workspace is entitled to, and why — plan, add-ons, snapshot freshness and the
          resolved decision per capability. Superadministrators only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <DiagRow label="Workspace" value={workspaceId} />
          <DiagRow label="Base tier" value={snapshot?.planSlug || '—'} />
          <DiagRow label="Subscription status" value={snapshot?.subscriptionStatus ?? 'unknown'} />
          <DiagRow
            label="Snapshot state"
            value={snapshotState}
            tone={snapshotState === 'stale' || snapshotState === 'unavailable' ? 'warn' : undefined}
          />
          <DiagRow label="Snapshot source" value={snapshot?.source ?? '—'} />
          <DiagRow label="Fetched" value={snapshotAge ?? 'never'} />
          <DiagRow
            label="Active add-ons"
            value={snapshot?.addonSlugs.length ? snapshot.addonSlugs.join(', ') : 'none'}
            className="sm:col-span-2"
          />
          <DiagRow
            label="AML entitlement"
            value={
              snapshot?.addonSlugs.includes('aml-ctf')
                ? snapshot.amlAssumed
                  ? 'entitled (assumed from headline SKU)'
                  : 'entitled (stated by Mission Control)'
                : 'not entitled'
            }
          />
          {snapshot?.billingExempt && (
            <DiagRow label="Workspace override" value="billing exempt" tone="warn" />
          )}
          {error && <DiagRow label="Last fetch error" value={error} tone="warn" className="sm:col-span-3" />}
        </div>

        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border/60 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Capability</th>
                <th className="px-3 py-2 font-medium">Decision</th>
                <th className="px-3 py-2 font-medium">Sources</th>
                <th className="px-3 py-2 font-medium">Unlocks via</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((decision) => (
                <tr key={decision.capability} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 font-mono text-[11px]">{decision.capability}</td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${STATUS_TONE[decision.status] ?? 'border-border'}`}
                    >
                      {decision.enabled ? (
                        <span className="flex items-center gap-1">
                          <BadgeCheck className="h-3 w-3" /> enabled
                        </span>
                      ) : (
                        decision.status
                      )}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {decision.entitlementSources.length > 0
                      ? decision.entitlementSources.join(', ')
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {decision.enabled
                      ? '—'
                      : [
                          decision.requiredPlan ? `${decision.requiredPlan} tier` : null,
                          decision.availableAddons?.length
                            ? `add-on: ${decision.availableAddons.join(', ')}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide client workspace capabilities' : 'Show all capabilities'}
        </Button>
      </CardContent>
    </Card>
  );
}

function DiagRow({
  label,
  value,
  tone,
  className = '',
}: {
  label: string;
  value: string;
  tone?: 'warn';
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-border/50 bg-background/50 px-3 py-2 ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 break-words text-sm ${tone === 'warn' ? 'text-warning' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}
