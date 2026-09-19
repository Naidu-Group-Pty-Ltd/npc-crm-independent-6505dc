/**
 * BcSegmentEngineAdmin — superadmin console for the hybrid BC engine rollout.
 *
 * Phase 4 of the BC segment plan. Lets a superadmin:
 *   1. Read and edit `feature_flags.bcSegmentEngine`
 *        - enabled (master switch)
 *        - allowlist (client_ids opted in early — empty = all clients)
 *        - dragFactorOverride (number, optional)
 *   2. Inspect recent health-log entries for the `bc-segment-engine` service.
 *   3. Dry-run the calculator for a client with `forceSegmentEngine=true`
 *      and view the resulting segmentBreakdown / portfolioCapacity.
 *
 * Mediates via `feature-flags-admin` edge function (same as PDF import admin).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Save, Zap, AlertCircle, CheckCircle2, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

const FLAG_KEY = 'bcSegmentEngine';

interface FlagValue {
  enabled: boolean;
  allowlist: string[];
  dragFactorOverride?: number | null;
}

interface FlagRow {
  key: string;
  value: FlagValue;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

interface HealthRow {
  id: string;
  status: string;
  response_time_ms: number | null;
  endpoint: string | null;
  error_message: string | null;
  created_at: string;
}

function normalizeValue(raw: any): FlagValue {
  return {
    enabled: !!raw?.enabled,
    allowlist: Array.isArray(raw?.allowlist) ? raw.allowlist.filter((x: any) => typeof x === 'string') : [],
    dragFactorOverride: typeof raw?.dragFactorOverride === 'number' ? raw.dragFactorOverride : null,
  };
}

export default function BcSegmentEngineAdmin() {
  const { isSuperadmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [row, setRow] = useState<FlagRow | null>(null);
  const [draft, setDraft] = useState<FlagValue>({ enabled: false, allowlist: [], dragFactorOverride: null });
  const [allowlistText, setAllowlistText] = useState('');
  const [description, setDescription] = useState('');

  const [health, setHealth] = useState<HealthRow[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);

  const [dryClientId, setDryClientId] = useState('');
  const [dryRunning, setDryRunning] = useState(false);
  const [dryResult, setDryResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await invokeSecureFunction<{ row: FlagRow | null }>(
      'feature-flags-admin',
      { operation: 'get', key: FLAG_KEY },
    );
    if (error) {
      toast.error(`Failed to load flag: ${error.message}`);
    } else if (data?.row) {
      const v = normalizeValue(data.row.value);
      setRow({ ...data.row, value: v });
      setDraft(v);
      setAllowlistText(v.allowlist.join('\n'));
      setDescription(data.row.description ?? '');
    } else {
      setRow(null);
      setDraft({ enabled: false, allowlist: [], dragFactorOverride: null });
      setAllowlistText('');
      setDescription('');
    }
    setLoading(false);
  }, []);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    const { data, error } = await supabase
      .from('api_health_log')
      .select('id,status,response_time_ms,endpoint,error_message,created_at')
      .eq('service_name', 'bc-segment-engine')
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) toast.error(`Health log: ${error.message}`);
    else setHealth((data as HealthRow[]) || []);
    setHealthLoading(false);
  }, []);

  useEffect(() => {
    if (!isSuperadmin) return;
    load();
    loadHealth();
  }, [isSuperadmin, load, loadHealth]);

  const isDirty = useMemo(() => {
    if (!row) return draft.enabled || draft.allowlist.length > 0 || draft.dragFactorOverride != null;
    const a = row.value;
    return a.enabled !== draft.enabled
      || a.allowlist.join('\n') !== draft.allowlist.join('\n')
      || (a.dragFactorOverride ?? null) !== (draft.dragFactorOverride ?? null)
      || (row.description ?? '') !== description;
  }, [row, draft, description]);

  const save = useCallback(async () => {
    setSaving(true);
    const parsedAllowlist = allowlistText
      .split(/[\n,\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const value: FlagValue = {
      enabled: draft.enabled,
      allowlist: parsedAllowlist,
      dragFactorOverride: draft.dragFactorOverride ?? null,
    };
    const { error } = await invokeSecureFunction<{ row: FlagRow }>(
      'feature-flags-admin',
      { operation: 'upsert', key: FLAG_KEY, value, description },
    );
    setSaving(false);
    if (error) toast.error(`Save failed: ${error.message}`);
    else {
      toast.success('Flag saved');
      load();
    }
  }, [draft, allowlistText, description, load]);

  const runDry = useCallback(async () => {
    if (!dryClientId.trim()) {
      toast.error('Enter a client ID first');
      return;
    }
    setDryRunning(true);
    setDryResult(null);
    const { data, error } = await invokeSecureFunction<any>('calculate-borrowing-capacity', {
      clientId: dryClientId.trim(),
      overrides: { forceSegmentEngine: true },
      dryRun: true,
      saveResult: false,
    });
    setDryRunning(false);
    if (error) {
      toast.error(`Dry run failed: ${error.message}`);
      return;
    }
    setDryResult(data);
    loadHealth();
  }, [dryClientId, loadHealth]);

  if (!isSuperadmin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 flex items-center gap-3 text-muted-foreground">
            <AlertCircle className="h-5 w-5" />
            Superadmin role required.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" /> BC Segment Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hybrid borrowing capacity (commercial + industrial). Additive overlays; residential math unchanged when disabled.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { load(); loadHealth(); }}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Flag config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feature Flag — <code>bcSegmentEngine</code></CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="enabled" className="text-sm">Master switch</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    When OFF, the engine returns zero overlays for every client.
                  </p>
                </div>
                <Switch
                  id="enabled"
                  checked={draft.enabled}
                  onCheckedChange={v => setDraft(d => ({ ...d, enabled: v }))}
                />
              </div>

              <Separator />

              <div>
                <Label htmlFor="allowlist" className="text-sm">Client allowlist</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-2">
                  One client_id per line. <strong>Empty = all clients</strong> once the master switch is ON.
                </p>
                <Textarea
                  id="allowlist"
                  value={allowlistText}
                  onChange={e => {
                    const txt = e.target.value;
                    setAllowlistText(txt);
                    setDraft(d => ({ ...d, allowlist: txt.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean) }));
                  }}
                  rows={4}
                  placeholder="e.g. 9f8b...&#10;1a2c..."
                  className="font-mono text-xs"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  {draft.allowlist.length} client(s) listed.
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="drag" className="text-sm">Commercial drag factor override</Label>
                  <p className="text-xs text-muted-foreground mt-1 mb-2">
                    Multiplier applied to negative segment headroom. Leave empty for default.
                  </p>
                  <Input
                    id="drag"
                    type="number"
                    step="0.05"
                    min="0"
                    max="2"
                    value={draft.dragFactorOverride ?? ''}
                    onChange={e => {
                      const v = e.target.value;
                      setDraft(d => ({ ...d, dragFactorOverride: v === '' ? null : Number(v) }));
                    }}
                    placeholder="default"
                  />
                </div>
                <div>
                  <Label htmlFor="desc" className="text-sm">Description / change note</Label>
                  <Input
                    id="desc"
                    className="mt-7"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="e.g. Pilot rollout to 5 clients"
                  />
                </div>
              </div>

              {row && (
                <div className="text-xs text-muted-foreground">
                  Last updated {new Date(row.updated_at).toLocaleString('en-AU')} by {row.updated_by ?? 'system'}
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={save} disabled={!isDirty || saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save flag
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dry run */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4" /> Dry-run for a client
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Forces <code>forceSegmentEngine=true</code> for one client without touching the flag, so you can
            validate commercial / industrial overlays before allow-listing them.
          </p>
          <div className="flex gap-2">
            <Input
              value={dryClientId}
              onChange={e => setDryClientId(e.target.value)}
              placeholder="client_id (uuid)"
              className="font-mono text-xs"
            />
            <Button onClick={runDry} disabled={dryRunning}>
              {dryRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              Run
            </Button>
          </div>
          {dryResult && (
            <div className="border rounded-md p-3 bg-muted/30 text-xs space-y-2">
              <div className="flex flex-wrap gap-3">
                <Badge variant="outline">Residential cap: ${Number(dryResult.borrowingCapacity ?? dryResult.maxBorrowingAmount ?? 0).toLocaleString('en-AU')}</Badge>
                {dryResult.portfolioCapacity != null && (
                  <Badge variant="outline">Portfolio cap: ${Number(dryResult.portfolioCapacity).toLocaleString('en-AU')}</Badge>
                )}
                {dryResult.segmentReconciliation?.triggered ? (
                  <Badge className="bg-success/20 text-success border-success/30">Segments triggered</Badge>
                ) : (
                  <Badge variant="secondary">No segments</Badge>
                )}
              </div>
              {Array.isArray(dryResult.segmentBreakdown) && dryResult.segmentBreakdown.length > 0 && (
                <pre className="overflow-x-auto text-[11px] leading-snug">
                  {JSON.stringify(dryResult.segmentBreakdown, null, 2)}
                </pre>
              )}
              {dryResult.segmentReconciliation?.overlays && (
                <pre className="overflow-x-auto text-[11px] leading-snug">
                  overlays = {JSON.stringify(dryResult.segmentReconciliation.overlays, null, 2)}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Health log */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Recent invocations
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={loadHealth} disabled={healthLoading}>
            <RefreshCw className={`h-4 w-4 ${healthLoading ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {health.length === 0 ? (
            <div className="text-xs text-muted-foreground">No invocations logged yet.</div>
          ) : (
            <div className="space-y-1">
              {health.map(h => (
                <div key={h.id} className="flex items-center justify-between text-xs border-b last:border-0 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {h.status === 'success' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                    ) : h.status === 'error' ? (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full bg-muted-foreground/30 shrink-0" />
                    )}
                    <span className="font-mono truncate">{h.endpoint}</span>
                    {h.error_message && (
                      <span className="text-muted-foreground truncate">— {h.error_message}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                    <span>{h.response_time_ms != null ? `${h.response_time_ms}ms` : '—'}</span>
                    <span>{new Date(h.created_at).toLocaleTimeString('en-AU')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
