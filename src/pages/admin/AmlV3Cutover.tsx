/**
 * AmlV3Cutover — superadmin V3 flag console (Phase 10).
 *
 * Closes the outstanding Phase 8 follow-up: "Superadmin per-tenant flag
 * console — currently flipped via public.feature_flags directly; no UI
 * phase authorised." Phase 10 authorises the read/write UI for the eight
 * V3 flags reserved in Phases 0–9, using the existing
 * `feature-flags-admin` edge function (no schema change, no new
 * function, no user-facing AML change).
 *
 * Guardrails preserved:
 *   - Superadmin gate client-side + server-side (feature-flags-admin re-checks).
 *   - Hard exclusions (Launch Ops, Provider Configuration) untouched — this
 *     console never edits those surfaces, only the eight `aml_v3_*` flags.
 *   - Rollback is symmetric: setting any flag back to `false` restores V2.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, CheckCircle2, Trash2, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { useAuth } from "@/hooks/useAuth";
import { refreshAmlV3Flags, type AmlV3FlagKey } from "@/lib/aml/useAmlV3Flags";
import {
  readLegacyAliasSummary,
  clearLegacyAliasHits,
  totalLegacyAliasHits,
  type LegacyHitSummary,
} from "@/lib/aml/legacyAliasTelemetry";


interface FlagRow {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

interface FlagSpec {
  key: AmlV3FlagKey;
  label: string;
  directive: string;
  phase: number;
  sequence: number; // recommended flip order from phase-8 brief
  summary: string;
}

const SPECS: FlagSpec[] = [
  {
    key: "aml_v3_terminology_editor",
    label: "Terminology Editor",
    directive: "Directive 11",
    phase: 7,
    sequence: 1,
    summary: "Structured label editor in Organisation Settings. Pure config UI.",
  },
  {
    key: "aml_v3_metrics_relocation",
    label: "Provider Metrics Relocation",
    directive: "Directive 13",
    phase: 7,
    sequence: 1,
    summary: "Moves 30-day provider metrics out of the daily header into Configuration.",
  },
  {
    key: "aml_v3_start_client_compliance",
    label: "Start Client Compliance CTA",
    directive: "Directive 1",
    phase: 2,
    sequence: 2,
    summary: "Adds Command Centre master-record activation entry point.",
  },
  {
    key: "aml_v3_compliance_home",
    label: "Compliance Home",
    directive: "Directives 5 & 6",
    phase: 3,
    sequence: 3,
    summary: "Role-adaptive Home + neutral continuation banner.",
  },
  {
    key: "aml_v3_regulatory_hub",
    label: "Regulatory & Assurance Header",
    directive: "Directive 15 (assurance)",
    phase: 5,
    sequence: 4,
    summary: "Submission-readiness header on Regulatory workspaces.",
  },
  {
    key: "aml_v3_case_workspace",
    label: "Case Workspace Timeline",
    directive: "Directives 2, 3, 4, 15",
    phase: 6,
    sequence: 5,
    summary: "Case-centred workspace + chronological Timeline tab.",
  },
  {
    key: "aml_v3_org_settings",
    label: "Organisation Settings & Contacts",
    directive: "Directives 7, 8, 10, 14",
    phase: 9,
    sequence: 5,
    summary: "Renames Platform Admin, hides Plan tab, links branding, adds Governance Contacts.",
  },
  {
    key: "aml_v3_nav",
    label: "V3 Four-Workspace Shell",
    directive: "Directive 2",
    phase: 1,
    sequence: 6,
    summary: "LAST — activates the V3 nav shell. Legacy /admin/aml/* routes remain aliased.",
  },
];

function coerceBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  if (value && typeof value === "object") {
    const enabled = (value as { enabled?: unknown }).enabled;
    if (typeof enabled === "boolean") return enabled;
  }
  return false;
}

export default function AmlV3Cutover() {
  const { isSuperadmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Record<string, FlagRow | null>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [legacyHits, setLegacyHits] = useState<LegacyHitSummary[]>([]);
  const [legacyTotal, setLegacyTotal] = useState(0);

  const refreshLegacy = useCallback(() => {
    setLegacyHits(readLegacyAliasSummary());
    setLegacyTotal(totalLegacyAliasHits());
  }, []);

  useEffect(() => {
    if (isSuperadmin) refreshLegacy();
  }, [isSuperadmin, refreshLegacy]);


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeSecureFunction<{ rows: FlagRow[] }>("feature-flags-admin", {
        operation: "list",
        prefix: "aml_v3_",
      });
      if (error) throw new Error(error.message);
      const map: Record<string, FlagRow | null> = {};
      for (const spec of SPECS) map[spec.key] = null;
      for (const row of data?.rows ?? []) map[row.key] = row;
      setRows(map);
    } catch (e) {
      toast.error(`Failed to load V3 flags: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperadmin) void load();
  }, [isSuperadmin, load]);

  const toggle = useCallback(
    async (spec: FlagSpec, nextEnabled: boolean) => {
      setSavingKey(spec.key);
      try {
        const { data, error } = await invokeSecureFunction<{ row: FlagRow }>("feature-flags-admin", {
          operation: "upsert",
          key: spec.key,
          value: nextEnabled,
          description: `${spec.directive} · Phase ${spec.phase} · ${spec.label}`,
        });
        if (error) throw new Error(error.message);
        setRows((prev) => ({ ...prev, [spec.key]: data?.row ?? prev[spec.key] }));
        // Refresh the in-app hook cache so any open AML tab picks up the change on next mount.
        await refreshAmlV3Flags();
        toast.success(`${spec.label} · ${nextEnabled ? "enabled" : "disabled"}`);
      } catch (e) {
        toast.error(`Save failed: ${(e as Error).message}`);
      } finally {
        setSavingKey(null);
      }
    },
    [],
  );

  const enabledCount = useMemo(
    () => SPECS.filter((s) => coerceBool(rows[s.key]?.value)).length,
    [rows],
  );

  const grouped = useMemo(() => {
    const g = new Map<number, FlagSpec[]>();
    for (const s of SPECS) {
      const arr = g.get(s.sequence) ?? [];
      arr.push(s);
      g.set(s.sequence, arr);
    }
    return Array.from(g.entries()).sort(([a], [b]) => a - b);
  }, []);

  if (!isSuperadmin) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Superadmin only
            </CardTitle>
            <CardDescription>
              This console flips AML V3 rollout flags. Only superadmins may view it.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">AML V3 · Cutover Console</h1>
          <p className="text-sm text-muted-foreground max-w-2xl mt-1">
            Recommended flip order from <code className="text-xs">archives/aml-v3/phase-8-brief.md</code>.
            Toggling any flag back to off returns the surface to V2 behaviour with no data migration.
            Launch Operations and Provider Configuration remain hard-excluded.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="h-3 w-3 text-success" />
            {enabledCount} / {SPECS.length} enabled
          </Badge>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>
      </div>

      {grouped.map(([sequence, specs]) => (
        <Card key={sequence}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold">
                {sequence}
              </span>
              Cutover step {sequence}
            </CardTitle>
            <CardDescription>
              {sequence === 1 && "Safest — pure configuration UI. Flip first."}
              {sequence === 2 && "Adds Command Centre CTA only."}
              {sequence === 3 && "Compliance Home refresh."}
              {sequence === 4 && "Adds submission-readiness header."}
              {sequence === 5 && "Case workspace + Organisation Settings."}
              {sequence === 6 && "LAST — activates the V3 nav shell."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {specs.map((spec, idx) => {
              const row = rows[spec.key];
              const enabled = coerceBool(row?.value);
              return (
                <div key={spec.key}>
                  {idx > 0 && <Separator className="my-3" />}
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{spec.label}</span>
                        <Badge variant="secondary" className="text-xs">{spec.directive}</Badge>
                        <Badge variant="outline" className="text-xs">Phase {spec.phase}</Badge>
                        <code className="text-xs text-muted-foreground">{spec.key}</code>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{spec.summary}</p>
                      {row?.updated_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Last change: {new Date(row.updated_at).toLocaleString('en-AU')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {savingKey === spec.key && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      <Switch
                        checked={enabled}
                        disabled={savingKey === spec.key || loading}
                        onCheckedChange={(next) => toggle(spec, next)}
                        aria-label={`Toggle ${spec.label}`}
                      />
                      <Badge variant={enabled ? "default" : "outline"} className="text-xs">
                        {enabled ? "ON" : "OFF"}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Acceptance checklist</CardTitle>
          <CardDescription>Verify before advancing to the next cutover step.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>· Legacy <code>/admin/aml/*</code> routes still resolve.</p>
          <p>· Launch Operations and Provider Configuration surfaces unchanged.</p>
          <p>· Client Portal and Finance Portal show no restricted case fields.</p>
          <p>· Step-up sessions still enforced for <code>aml.report</code> and <code>aml.configure</code>.</p>
          <p>· Superadmin bypass preserved; MLRO-only writes on Governance Contacts.</p>
        </CardContent>
      </Card>

      {/* Phase 12 · Legacy alias local usage panel (this browser only). */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Legacy alias usage · this browser
          </CardTitle>
          <CardDescription>
            Local-only signal captured by the alias banners on legacy
            /admin/aml/verification, /screening, /risk and /finance routes.
            Use it to sanity-check whether operators have adopted the case
            workspace before flipping <code>aml_v3_nav</code>. Not a tenant-wide
            rollup — a future phase can promote this to server-side telemetry.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="gap-1">
              <Activity className="h-3 w-3 text-muted-foreground" />
              {legacyTotal} total hit{legacyTotal === 1 ? "" : "s"}
            </Badge>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={refreshLegacy}>
                <RefreshCw className="h-3 w-3 mr-1.5" />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { clearLegacyAliasHits(); refreshLegacy(); toast.success("Local hits cleared"); }}
                disabled={legacyTotal === 0}
              >
                <Trash2 className="h-3 w-3 mr-1.5" />
                Clear
              </Button>
            </div>
          </div>
          {legacyHits.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No legacy alias visits recorded in this browser yet.
            </p>
          ) : (
            <div className="rounded-md border border-border divide-y divide-border">
              {legacyHits.map((h) => (
                <div key={h.path} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{h.label}</div>
                    <code className="text-muted-foreground">{h.path}</code>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-muted-foreground">
                      last {new Date(h.lastSeen).toLocaleString('en-AU')}
                    </span>
                    <Badge variant="secondary">{h.count}</Badge>
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
