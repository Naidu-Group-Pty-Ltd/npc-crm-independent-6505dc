/**
 * API-key billing: what this workspace's vendor calls are costing, and who pays.
 *
 * This deployment may be running on API keys it does not own. A workspace
 * provisioned by Aurixa Mission Control boots with the prime's OpenAI, Resend,
 * Domain and Cotality keys forwarded into its Supabase project, and Mission
 * Control recharges what it spends on them. A key this workspace supplies
 * itself costs the prime nothing and is charged at nothing.
 *
 * Every other tab on this page answers "what did we call". This one answers
 * "what will we be invoiced for, and what is escaping the meter entirely" —
 * which is a different question with a different failure mode. The numbers that
 * matter here are the ones on the right-hand side: calls that were made,
 * genuinely cost money, and cannot be attributed to anybody.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

type QueueStatus = {
  pending?: number;
  stuck?: number;
  reported?: number;
  billed?: number;
  own_key?: number;
  unbillable?: number;
  oldest_pending?: string | null;
};

type ServiceRow = {
  service_name: string;
  secret_name: string | null;
  calls: number;
  tokens: number;
  errors: number;
  estimated_usd: number;
  billed: number;
  own_key: number;
  unbillable: number;
  not_reported: number;
};

type Breakdown = {
  ok: boolean;
  error?: string;
  since?: string;
  queue?: QueueStatus;
  by_service?: ServiceRow[];
  by_reason?: Record<string, number>;
  unmapped_services?: Array<{ service_name: string; calls: number }>;
};

/**
 * Plain-English gloss for each rating outcome. A tab that showed raw enum
 * values would be read as noise; "why was this free" is the whole question.
 */
const REASON_LABEL: Record<string, { label: string; hint: string; tone: string }> = {
  inherited: {
    label: 'Billed to us',
    hint: "Ran on the prime's forwarded key — recharged by Mission Control",
    tone: 'bg-primary/10 text-primary',
  },
  byok: {
    label: 'Our own key',
    hint: 'This workspace supplied the credential — never charged',
    tone: 'bg-success/10 text-success',
  },
  no_key: {
    label: 'No forwarded key',
    hint: 'Nothing was lent for this secret, so nothing is recharged',
    tone: 'bg-muted text-muted-foreground',
  },
  not_billable: {
    label: 'Platform overhead',
    hint: 'Forwarded but never recharged (shared infrastructure)',
    tone: 'bg-muted text-muted-foreground',
  },
  error_call: {
    label: 'Failed call',
    hint: 'The vendor rejected it — metered, never charged',
    tone: 'bg-warning/10 text-warning',
  },
  unknown_secret: {
    label: 'Unattributable',
    hint: 'Mission Control has no record of lending this key — spend nobody can recover',
    tone: 'bg-destructive/10 text-destructive',
  },
  rate_missing: {
    label: 'Not priced',
    hint: 'No rate in the catalog yet — metered at zero',
    tone: 'bg-destructive/10 text-destructive',
  },
  not_reported: {
    label: 'Still queued',
    hint: 'Not yet drained to Mission Control',
    tone: 'bg-muted text-muted-foreground',
  },
};

function num(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString('en-AU');
}

export function BillingRecoveryTab({ days = 30 }: { days?: number }) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // `as any`: this RPC post-dates the generated Supabase types, which are
      // regenerated from the live schema. Matches the convention used for other
      // newly-added RPCs in this codebase.
      const { data: result, error: rpcError } = await supabase.rpc(
        'api_usage_billing_breakdown' as any,
        { _days: days } as any,
      );
      if (rpcError) {
        // The migration not being applied is by far the likeliest cause, and
        // it is worth naming: until it is, nothing here is being metered.
        setError(
          /does not exist|schema cache/i.test(rpcError.message)
            ? 'API-key billing is not installed on this database yet. Apply the migration `20260901000300_api_usage_mission_control_forwarding.sql`.'
            : rpcError.message,
        );
        setData(null);
        return;
      }
      const parsed = result as unknown as Breakdown;
      if (!parsed?.ok) {
        setError(
          parsed?.error === 'forbidden'
            ? 'Vendor spend is admin-only. Ask an administrator if you need this view.'
            : (parsed?.error ?? 'Could not read API-key billing.'),
        );
        setData(null);
        return;
      }
      setData(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read API-key billing.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="h-4 w-4" />
            API-key billing unavailable
          </CardTitle>
          <CardDescription>
            These figures are unknown, not zero. Do not read this tab as evidence that nothing was
            spent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="font-mono text-xs text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const queue = data?.queue ?? {};
  const services = data?.by_service ?? [];
  const unmapped = data?.unmapped_services ?? [];
  const reasons = data?.by_reason ?? {};
  const unrecoverable = (queue.unbillable ?? 0) + unmapped.reduce((s, u) => s + u.calls, 0);

  return (
    <div className="min-w-0 space-y-4">
      <DashboardThemeFrame
        variant="sectionAccent"
        className="flex min-w-0 flex-col gap-4 border-primary/20 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-inner">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              Whose key paid for this
            </p>
            <h2 className="mt-1 break-words text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              API key billing &amp; recovery
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              This workspace may be running on vendor keys forwarded from the prime. Calls made on
              those are recharged per tenant by Mission Control; calls made on a key this workspace
              supplied itself are metered here and never billed. Swapping in your own key for a
              provider stops the recharge for that provider from the next call onward.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </DashboardThemeFrame>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={<KeyRound className="h-4 w-4" />}
          label="Recharged to us"
          value={num(queue.billed)}
          detail="Calls that ran on a forwarded key"
        />
        <Tile
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Covered by our own keys"
          value={num(queue.own_key)}
          detail="Metered, never billed"
          tone="ok"
        />
        <Tile
          icon={<Clock className="h-4 w-4" />}
          label="Queued to report"
          value={num(queue.pending)}
          detail={
            queue.oldest_pending
              ? `Oldest ${new Date(queue.oldest_pending).toLocaleString('en-AU')}`
              : 'Nothing waiting'
          }
          tone={(queue.stuck ?? 0) > 0 ? 'warn' : 'default'}
        />
        <Tile
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Unrecoverable"
          value={num(unrecoverable)}
          detail="Real spend nobody can be billed for"
          tone={unrecoverable > 0 ? 'bad' : 'ok'}
        />
      </div>

      {(queue.stuck ?? 0) > 0 && (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {num(queue.stuck)} call{queue.stuck === 1 ? '' : 's'} stuck after 5 delivery attempts
            </CardTitle>
            <CardDescription>
              These were made, cost money, and will never reach an invoice without intervention. The
              usual cause is a Mission Control key missing the <code>usage:report</code> scope.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {unmapped.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Services with no known credential
            </CardTitle>
            <CardDescription>
              These calls were logged but could not be attributed to a secret, so they are metered
              here and never billed. Add them to{' '}
              <code className="text-xs">_shared/apiUsageBilling.pure.ts</code>, or name the
              credential at the call site with{' '}
              <code className="text-xs">metadata.secret_name</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {unmapped.map((u) => (
              <Badge key={u.service_name} variant="outline" className="font-mono text-xs">
                {u.service_name} · {num(u.calls)}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {Object.keys(reasons).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Why each call was, or was not, charged</CardTitle>
            <CardDescription>
              Every metered call carries a reason. &ldquo;We didn&rsquo;t charge you&rdquo; is only
              credible if it says why.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(reasons)
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => {
                const meta = REASON_LABEL[reason] ?? {
                  label: reason,
                  hint: '',
                  tone: 'bg-muted text-muted-foreground',
                };
                return (
                  <div
                    key={reason}
                    className="rounded-lg border border-border/60 bg-card/50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge className={meta.tone} variant="secondary">
                        {meta.label}
                      </Badge>
                      <span className="font-mono text-sm tabular-nums">{num(count)}</span>
                    </div>
                    {meta.hint && (
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{meta.hint}</p>
                    )}
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By service</CardTitle>
          <CardDescription>
            Estimated cost is our own figure for a sanity check — the invoice comes from Mission
            Control&rsquo;s rate catalog, not from here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No metered vendor calls in this window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Service</th>
                    <th className="pb-2 pr-4 text-right font-medium">Calls</th>
                    <th className="pb-2 pr-4 text-right font-medium">Tokens</th>
                    <th className="pb-2 pr-4 text-right font-medium">Errors</th>
                    <th className="pb-2 pr-4 text-right font-medium">Est. cost</th>
                    <th className="pb-2 pr-4 text-right font-medium">Recharged</th>
                    <th className="pb-2 pr-4 text-right font-medium">Our key</th>
                    <th className="pb-2 text-right font-medium">Unbillable</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((s) => (
                    <tr key={s.service_name} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{s.service_name}</div>
                        {s.secret_name && (
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {s.secret_name}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{num(s.calls)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        {s.tokens > 0 ? num(s.tokens) : '—'}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {s.errors > 0 ? (
                          <span className="text-warning">{num(s.errors)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        ${Number(s.estimated_usd ?? 0).toFixed(4)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{num(s.billed)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-success">
                        {s.own_key > 0 ? num(s.own_key) : '—'}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {s.unbillable > 0 ? (
                          <span className="text-destructive">{num(s.unbillable)}</span>
                        ) : (
                          <CheckCircle2 className="ml-auto h-4 w-4 text-success" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'ok' | 'warn' | 'bad';
}) {
  const border =
    tone === 'bad'
      ? 'border-destructive/40'
      : tone === 'warn'
        ? 'border-warning/40'
        : tone === 'ok'
          ? 'border-success/30'
          : 'border-border/60';
  return (
    <DashboardThemeFrame variant="section" className={`min-w-0 p-4 ${border}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </DashboardThemeFrame>
  );
}
