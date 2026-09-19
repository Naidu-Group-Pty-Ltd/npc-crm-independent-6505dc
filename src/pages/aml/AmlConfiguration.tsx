import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ProviderReadinessCard } from "@/components/aml/ProviderReadinessCard";
import { SanctionsListHealth } from "@/components/aml/SanctionsListHealth";

/**
 * The tabs a `?tab=` link may open.
 *
 * An allow-list rather than a pass-through: the value reaches a Radix
 * `defaultValue`, and a tab name that matches nothing renders a page with a
 * tab strip and no panel under it.
 */
const TAB_VALUES = new Set(["branding", "activation", "plan", "providers", "metrics"]);
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Settings2, ShieldCheck, Palette, Package, Plug, Activity, Trash2, Plus, HeartPulse,
  AlertTriangle, Info, DollarSign, Lock, Loader2,
} from "lucide-react";
import {
  AmlErrorState,
  AmlLoadingState,
  AmlMetricCard,
  AmlPageHeader,
} from "@/components/aml/primitives";
import {
  amlTenantApi, AML_PROVIDER_CAPABILITIES,
  type AmlTenantSummary, type AmlPlanTier, type AmlProviderConfig,
  type AmlProviderCapability, type AmlProviderHealth, type AmlEntitlementOverride,
} from "@/lib/aml/amlTenantApi";
import { refreshAmlTerminology } from "@/lib/aml/useAmlTerminology";
import { parseTerminologyOverrides } from "@/lib/aml/parseTerminologyOverrides";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format((cents ?? 0) / 100);
}
function healthColor(status: AmlProviderHealth | null): string {
  switch (status) {
    case "ok": return "border-success/40 text-success";
    case "degraded": return "border-warning/40 text-warning";
    case "failing": return "border-destructive/40 text-destructive";
    default: return "border-border text-muted-foreground";
  }
}

export default function AmlConfiguration() {
  const { isMlro } = useAmlAccess();
  const { metricsRelocation, orgSettings } = useAmlV3Flags();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<AmlTenantSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const s = await amlTenantApi.summary();
      setSummary(s);
    } catch (e: any) {
      setLoadError(e.message ?? "Failed to load configuration");
      toast.error(e.message ?? "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, []);

  /*
    ── Landing on the tab you were sent for ──────────────────────────────
    Configuration is a tabbed page, and a link into it is worthless if it
    opens on Branding. Stage 5 sends an administrator here to check whether
    the sanctions register loaded (`ADMIN_AML_LIST_HEALTH_PATH`), so the tab
    is read from the URL. An unrecognised or absent value falls back to the
    default: a bad link must land somewhere sensible rather than nowhere.

    ── These hooks are ABOVE the early returns, and must stay there ───────
    This component returns early while it is loading and again when the
    summary cannot be read. Hooks placed after those returns are not called
    on the first render and ARE called on the second, which is a different
    hook count between renders — React throws, the error boundary catches
    it, and the page reads "Something went wrong" with no clue why. That is
    exactly what shipped here: the tab-from-URL support was appended at the
    point it was used rather than at the top, and Configuration crashed on
    every visit the moment its data arrived. Nothing about the feature was
    wrong; the placement was.
  */
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") ?? "";
  const initialTab = TAB_VALUES.has(requestedTab) ? requestedTab : "branding";

  /*
    The anchored panel is scrolled to once the page HAS one. The browser's
    own hash handling runs before React renders anything, and this component
    renders a skeleton first — so the effect waits for the content rather
    than firing on mount and finding nothing.
  */
  useEffect(() => {
    if (loading || !summary || !window.location.hash) return;
    const id = window.location.hash.slice(1);
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [loading, summary]);


  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" aria-hidden="true" />
        <AmlLoadingState variant="block" label="Loading configuration…" />
        <Skeleton className="h-64 w-full" aria-hidden="true" />
      </div>
    );
  }

  if (!summary) {
    return (
      <AmlErrorState
        title="Configuration failed to load"
        message={loadError ?? "The configuration summary could not be loaded."}
        onRetry={reload}
      />
    );
  }

  return (
    <div className="space-y-6">
      <AmlPageHeader
        title={orgSettings ? "Organisation Settings" : "AML Configuration"}
        description={
          orgSettings
            ? "Tenant-wide organisation settings for AML/CTF: branding link, activation program, providers, and (when relocated) metrics. Plan sales moved to the Aurixa billing portal."
            : metricsRelocation
              ? "White-label branding, plan entitlements, and provider selection. Provider cost & failure metrics have moved to the Integration Health workspace."
              : "White-label branding, plan entitlements, provider selection, and 30-day cost & failure metrics."
        }
        icon={Settings2}
      />

      {!isMlro && (
        <Alert className="max-w-md">
          <Lock className="h-4 w-4" />
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>Only the MLRO can change configuration.</AlertDescription>
        </Alert>
      )}

      <SummaryTiles summary={summary} hideMetrics={metricsRelocation} />

      <Tabs defaultValue={initialTab} className="w-full">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="branding"><Palette className="h-4 w-4 mr-1.5" />Branding</TabsTrigger>
          <TabsTrigger value="activation"><ShieldCheck className="h-4 w-4 mr-1.5" />Activation</TabsTrigger>
          {!orgSettings && (
            <TabsTrigger value="plan"><Package className="h-4 w-4 mr-1.5" />Plan & Entitlements</TabsTrigger>
          )}
          <TabsTrigger value="providers"><Plug className="h-4 w-4 mr-1.5" />Providers</TabsTrigger>
          <TabsTrigger value="metrics"><Activity className="h-4 w-4 mr-1.5" />Metrics</TabsTrigger>
        </TabsList>

        <TabsContent value="branding" className="mt-4">
          {orgSettings && (
            <Alert className="mb-4 border-primary/30">
              <Palette className="h-4 w-4" />
              <AlertTitle>Branding is managed centrally</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>
                  Logos, colours and cover artwork now live in the tenant’s
                  central White Label workspace. AML surfaces inherit those
                  values automatically — no per-module upload required.
                </span>
                <Button asChild size="sm" variant="outline">
                  <a href="/white-label">Open White Label</a>
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <BrandingPanel summary={summary} canWrite={isMlro} onSaved={reload} />
        </TabsContent>
        <TabsContent value="activation" className="mt-4">
          <ActivationProgramPanel canWrite={isMlro} />
        </TabsContent>
        {!orgSettings && (
          <TabsContent value="plan" className="mt-4">
            <PlanPanel summary={summary} canWrite={isMlro} onSaved={reload} />
          </TabsContent>
        )}
        <TabsContent value="providers" className="mt-4">
          <div className="space-y-4">
            <ProviderReadinessCard />
            {/*
              ── Why the sanctions register is HERE ──────────────────────
              It used to be mounted on the standalone Verification page and
              nowhere else, while Stage 5's "open list health" action was the
              only thing that navigated to it — so whether the register had
              loaded at all could only be discovered from a case that was
              already blocked by it.

              The health of the register is an organisation-level fact, not a
              per-case detail: `sanctions_entries` was empty from the day this
              platform was built, for three independent reasons, each of which
              reported as normal operation. It belongs beside the provider
              credentials it is loaded with, on a page an administrator opens
              deliberately.
            */}
            <div id="sanctions-list-health" className="scroll-mt-24">
              <SanctionsListHealth />
            </div>
            <ProvidersPanel summary={summary} canWrite={isMlro} onSaved={reload} />
          </div>
        </TabsContent>
        <TabsContent value="metrics" className="mt-4">
          <MetricsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* -------------------- summary tiles -------------------- */

function SummaryTiles({ summary, hideMetrics = false }: { summary: AmlTenantSummary | null; hideMetrics?: boolean }) {
  const state = summary ? ("ready" as const) : ("loading" as const);
  const activeProviders = summary?.providers.filter((p) => p.active).length ?? 0;
  const calls = summary?.metrics_30d.calls ?? 0;
  const failures = summary?.metrics_30d.failures ?? 0;
  const failureRate = calls > 0 ? (failures / calls) * 100 : 0;
  const plan = summary?.plans.find((p) => p.key === summary?.settings?.plan_tier_key);

  const tiles = [
    { label: "Plan", value: plan?.label ?? "—", icon: Package, sub: plan?.description || undefined },
    { label: "Active providers", value: String(activeProviders), icon: Plug, sub: `${summary?.providers.length ?? 0} total` },
    ...(hideMetrics ? [] : [
      { label: "30-day calls", value: calls.toLocaleString('en-AU'), icon: Activity, sub: `${failureRate.toFixed(1)}% failure` },
      { label: "30-day cost", value: fmtMoney(summary?.metrics_30d.cost_cents ?? 0), icon: DollarSign, sub: "across all providers" },
    ]),
  ];
  const cols = tiles.length >= 4 ? "md:grid-cols-4" : tiles.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return (
    <div className={`grid gap-3 ${cols}`}>
      {tiles.map((t) => (
        <AmlMetricCard
          key={t.label}
          title={t.label}
          icon={t.icon}
          state={state}
          value={t.value}
          hint={t.sub}
        />
      ))}
    </div>
  );
}

/* -------------------- branding tab -------------------- */

function BrandingPanel({ summary, canWrite, onSaved }: { summary: AmlTenantSummary; canWrite: boolean; onSaved: () => void }) {
  const { terminologyEditor } = useAmlV3Flags();
  const s = summary.settings;
  const [displayName, setDisplayName] = useState(s?.display_name ?? "");
  const [contactEmail, setContactEmail] = useState(s?.contact_email ?? "");
  const [mlroName, setMlroName] = useState(s?.mlro_contact_name ?? "");
  const [mlroEmail, setMlroEmail] = useState(s?.mlro_contact_email ?? "");
  const [supportUrl, setSupportUrl] = useState(s?.support_url ?? "");
  const [timezone, setTimezone] = useState(s?.timezone ?? "Australia/Sydney");
  const [locale, setLocale] = useState(s?.locale ?? "en-AU");
  const [disposalGrace, setDisposalGrace] = useState(s?.disposal_grace_days ?? 7);
  const [terminologyText, setTerminologyText] = useState(
    JSON.stringify(s?.terminology_overrides ?? {}, null, 2)
  );
  const [saving, setSaving] = useState(false);

  const locked = summary.locked_terminology_keys ?? [];

  const save = async () => {
    setSaving(true);
    try {
      let termino: Record<string, string> = {};
      try { termino = terminologyText.trim() ? JSON.parse(terminologyText) : {}; }
      catch { toast.error("Terminology overrides must be valid JSON"); setSaving(false); return; }
      const result = await amlTenantApi.updateSettings({
        display_name: displayName, contact_email: contactEmail || null,
        mlro_contact_name: mlroName || null, mlro_contact_email: mlroEmail || null,
        support_url: supportUrl || null, timezone, locale,
        disposal_grace_days: Number(disposalGrace) || 0,
        terminology_overrides: termino,
      });
      const rejected = result?.rejected_terminology_keys ?? [];
      if (rejected.length > 0) {
        toast.warning(
          `Locked regulatory terms were refused: ${rejected.join(", ")}`,
          { description: "These control names cannot be renamed and were dropped from your overrides." },
        );
      } else {
        toast.success("Branding & terminology saved");
      }
      await refreshAmlTerminology();
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="border-border/60">
        <CardHeader><CardTitle className="text-base">Tenant identity</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <FormRow label="Display name">
            <Input value={displayName} disabled={!canWrite} onChange={(e) => setDisplayName(e.target.value)} />
          </FormRow>
          <FormRow label="Contact email">
            <Input type="email" value={contactEmail} disabled={!canWrite} onChange={(e) => setContactEmail(e.target.value)} />
          </FormRow>
          <FormRow label="Support URL">
            <Input value={supportUrl} disabled={!canWrite} onChange={(e) => setSupportUrl(e.target.value)} />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Locale">
              <Input value={locale} disabled={!canWrite} onChange={(e) => setLocale(e.target.value)} />
            </FormRow>
            <FormRow label="Timezone">
              <Input value={timezone} disabled={!canWrite} onChange={(e) => setTimezone(e.target.value)} />
            </FormRow>
          </div>
          <FormRow label="Disposal grace (days)">
            <Input type="number" min={0} value={disposalGrace} disabled={!canWrite}
              onChange={(e) => setDisposalGrace(Number(e.target.value))} />
          </FormRow>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader><CardTitle className="text-base">MLRO contact</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <FormRow label="Name">
            <Input value={mlroName} disabled={!canWrite} onChange={(e) => setMlroName(e.target.value)} />
          </FormRow>
          <FormRow label="Email">
            <Input type="email" value={mlroEmail} disabled={!canWrite} onChange={(e) => setMlroEmail(e.target.value)} />
          </FormRow>
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
            The MLRO contact appears on internal escalation banners and AUSTRAC signoff blocks.
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2 border-border/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Terminology overrides
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Locked control names</AlertTitle>
            <AlertDescription>
              These regulatory terms cannot be renamed and will be dropped from any override:
              <div className="mt-2 flex flex-wrap gap-1">
                {locked.map((k) => (
                  <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>
                ))}
              </div>
            </AlertDescription>
          </Alert>
          {terminologyEditor ? (
            <StructuredTerminologyEditor
              value={terminologyText}
              onChange={setTerminologyText}
              lockedKeys={locked}
              disabled={!canWrite}
            />
          ) : (
            <>
              <Label className="text-xs uppercase text-muted-foreground">JSON map (label → replacement text)</Label>
              <Textarea
                className="font-mono text-xs min-h-[160px]"
                disabled={!canWrite}
                value={terminologyText}
                onChange={(e) => setTerminologyText(e.target.value)}
                placeholder={'{\n  "Customer Case": "Client Matter"\n}'}
              />
              <TerminologyPreview jsonText={terminologyText} lockedKeys={locked} />
            </>
          )}
        </CardContent>
      </Card>

      <div className="md:col-span-2 flex justify-end">
        <Button disabled={!canWrite || saving} onClick={save}>{saving ? "Saving…" : "Save branding"}</Button>
      </div>
    </div>
  );
}

/* -------------------- terminology live preview -------------------- */

const PREVIEW_SAMPLES = [
  "Compliance Home", "Customer Compliance", "Transaction Compliance",
  "Regulatory & Assurance", "Platform Administration",
  "Register", "Intake Queue", "Verification", "Screening", "Risk",
  "AUSTRAC Hub", "Records & Privacy", "Governance", "Configuration",
];

function TerminologyPreview({ jsonText, lockedKeys }: { jsonText: string; lockedKeys: string[] }) {
  const parsed = useMemo(() => parseTerminologyOverrides(jsonText), [jsonText]);
  const lockedSet = useMemo(() => new Set(lockedKeys), [lockedKeys]);
  if (parsed === null) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        Invalid JSON — preview unavailable.
      </div>
    );
  }
  const refused = Object.keys(parsed).filter((k) => lockedSet.has(k));
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">Live preview</span>
        {refused.length > 0 && (
          <Badge variant="outline" className="border-destructive/50 text-destructive text-[10px]">
            {refused.length} locked key{refused.length === 1 ? "" : "s"} will be refused
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PREVIEW_SAMPLES.map((label) => {
          const override = parsed[label];
          return (
            <Badge
              key={label}
              variant="outline"
              className={override ? "border-primary/40 text-primary" : "border-border/60 text-muted-foreground"}
            >
              {override ?? label}
            </Badge>
          );
        })}
      </div>
      {refused.length > 0 && (
        <div className="text-[11px] text-destructive">
          Refused: <span className="font-mono">{refused.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

/* -------------------- structured terminology editor (V3 · Directive 11) -------------------- */

/**
 * Row-based label editor replacing the raw JSON textarea. Keeps `value`
 * as a JSON string so the surrounding save flow (which already parses
 * and posts JSON) works unchanged. Locked regulatory terms are shown but
 * disabled and cannot be added.
 */
export function StructuredTerminologyEditor({
  value, onChange, lockedKeys, disabled,
}: {
  value: string;
  onChange: (json: string) => void;
  lockedKeys: string[];
  disabled: boolean;
}) {
  const parsed = useMemo(() => {
    try { return value.trim() ? (JSON.parse(value) as Record<string, string>) : {}; }
    catch { return null; }
  }, [value]);
  const lockedSet = useMemo(() => new Set(lockedKeys), [lockedKeys]);

  const parsedRows = useMemo(() => {
    if (parsed === null) return [] as { key: string; replacement: string }[];
    return Object.entries(parsed).map(([key, replacement]) => ({ key, replacement }));
  }, [parsed]);
  const [rows, setRows] = useState(parsedRows);
  const lastWrittenValue = useRef<string | null>(null);

  useEffect(() => {
    if (lastWrittenValue.current === value) {
      lastWrittenValue.current = null;
      return;
    }
    setRows(parsedRows);
  }, [parsedRows, value]);

  const writeRows = (next: { key: string; replacement: string }[]) => {
    setRows(next);
    const map: Record<string, string> = {};
    for (const r of next) {
      const k = r.key.trim();
      if (!k || lockedSet.has(k)) continue;
      map[k] = r.replacement;
    }
    const nextValue = JSON.stringify(map, null, 2);
    lastWrittenValue.current = nextValue;
    onChange(nextValue);
  };

  const updateRow = (idx: number, patch: Partial<{ key: string; replacement: string }>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    writeRows(next);
  };
  const removeRow = (idx: number) => writeRows(rows.filter((_, i) => i !== idx));
  const addRow = () => writeRows([...rows, { key: "", replacement: "" }]);

  if (parsed === null) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        Existing overrides are not valid JSON. Fix them in the JSON editor before switching to the structured view.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border/60 divide-y divide-border/60">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-3 py-2 text-[11px] uppercase text-muted-foreground">
          <span>Original label</span>
          <span>Your replacement</span>
          <span className="sr-only">Actions</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            No overrides yet. Add one to relabel a workspace or nav item.
          </div>
        ) : rows.map((row, idx) => {
          const isLocked = lockedSet.has(row.key.trim());
          return (
            <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 px-3 py-2 items-center">
              <Input
                value={row.key}
                disabled={disabled}
                placeholder="e.g. Customer Compliance"
                onChange={(e) => updateRow(idx, { key: e.target.value })}
                className={isLocked ? "border-destructive/50" : ""}
              />
              <Input
                value={row.replacement}
                disabled={disabled || isLocked}
                placeholder="e.g. Client KYC"
                onChange={(e) => updateRow(idx, { replacement: e.target.value })}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled}
                onClick={() => removeRow(idx)}
                aria-label="Remove override"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={addRow}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add override
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Locked regulatory terms are refused on save.
        </span>
      </div>
      <TerminologyPreview jsonText={value} lockedKeys={lockedKeys} />
    </div>
  );
}


/* -------------------- plan tab -------------------- */

function PlanPanel({ summary, canWrite, onSaved }: { summary: AmlTenantSummary; canWrite: boolean; onSaved: () => void }) {
  const [selected, setSelected] = useState(summary.settings?.plan_tier_key ?? "starter");
  const [overrides, setOverrides] = useState<AmlEntitlementOverride[]>(summary.overrides ?? []);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  useEffect(() => { setOverrides(summary.overrides); }, [summary.overrides]);

  const activePlan = summary.plans.find((p) => p.key === selected);
  const effectiveEntries = useMemo(() => {
    const base = (activePlan?.entitlements ?? {}) as Record<string, any>;
    const merged: Record<string, any> = { ...base };
    for (const o of overrides) merged[o.entitlement_key] = o.value;
    return Object.entries(merged);
  }, [activePlan, overrides]);

  const changePlan = async (key: string) => {
    setSelected(key);
    if (!canWrite) return;
    try {
      await amlTenantApi.updateSettings({ plan_tier_key: key });
      toast.success(`Plan switched to ${key}`);
      onSaved();
    } catch (e: any) { toast.error(e.message ?? "Plan switch failed"); }
  };

  const addOverride = async () => {
    if (!newKey.trim()) return;
    let parsed: any = newValue;
    try { parsed = JSON.parse(newValue); } catch { /* string ok */ }
    try {
      const o = await amlTenantApi.upsertEntitlementOverride({ entitlement_key: newKey.trim(), value: parsed });
      setOverrides((prev) => {
        const others = prev.filter((x) => x.entitlement_key !== o.entitlement_key);
        return [...others, o];
      });
      setNewKey(""); setNewValue("");
      toast.success("Override saved");
    } catch (e: any) { toast.error(e.message); }
  };

  const removeOverride = async (id: string) => {
    try {
      await amlTenantApi.deleteEntitlementOverride(id);
      setOverrides((prev) => prev.filter((o) => o.id !== id));
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {summary.plans.map((p) => (
        <PlanCard key={p.id} plan={p} active={p.key === selected} canWrite={canWrite} onChoose={() => changePlan(p.key)} />
      ))}

      <Card className="md:col-span-3 border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Effective entitlements</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Key</TableHead><TableHead>Value</TableHead><TableHead>Source</TableHead><TableHead className="w-16"></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {effectiveEntries.map(([k, v]) => {
                const override = overrides.find((o) => o.entitlement_key === k);
                return (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-xs">{k}</TableCell>
                    <TableCell className="font-mono text-xs">{typeof v === "string" ? v : JSON.stringify(v)}</TableCell>
                    <TableCell>
                      {override
                        ? <Badge variant="outline" className="border-primary/40 text-primary">Override</Badge>
                        : <Badge variant="outline">Plan default</Badge>}
                    </TableCell>
                    <TableCell>
                      {override && canWrite && (
                        <Button size="icon" variant="ghost" onClick={() => removeOverride(override.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {canWrite && (
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs">Entitlement key</Label>
                <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="max_active_cases" />
              </div>
              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs">Value (JSON or string)</Label>
                <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="500" />
              </div>
              <Button onClick={addOverride}><Plus className="h-3.5 w-3.5 mr-1" />Add override</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PlanCard({ plan, active, canWrite, onChoose }: {
  plan: AmlPlanTier; active: boolean; canWrite: boolean; onChoose: () => void;
}) {
  const features: string[] = (plan.entitlements?.features as string[]) ?? [];
  return (
    <Card className={`border-border/60 ${active ? "ring-1 ring-primary" : ""}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{plan.label}</CardTitle>
          {active && <Badge className="bg-primary/20 text-primary border border-primary/40">Current</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">{plan.description}</div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-2xl font-semibold">{fmtMoney(plan.monthly_price_cents)}<span className="text-xs text-muted-foreground"> /mo</span></div>
        <div className="flex flex-wrap gap-1">
          {features.slice(0, 8).map((f) => (
            <Badge key={f} variant="secondary" className="text-[10px]">{f}</Badge>
          ))}
        </div>
        <Button size="sm" variant={active ? "outline" : "default"} disabled={!canWrite || active} onClick={onChoose} className="w-full">
          {active ? "Selected" : "Choose plan"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* -------------------- providers tab -------------------- */

function ProvidersPanel({ summary, canWrite, onSaved }: { summary: AmlTenantSummary; canWrite: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState<Partial<AmlProviderConfig> | null>(null);

  const groups = useMemo(() => {
    const by: Record<string, AmlProviderConfig[]> = {};
    for (const p of summary.providers) (by[p.capability] ??= []).push(p);
    return by;
  }, [summary.providers]);

  const remove = async (id: string) => {
    if (!confirm("Delete this provider configuration?")) return;
    await amlTenantApi.deleteProvider(id); toast.success("Provider deleted"); onSaved();
  };
  const setHealth = async (id: string, status: AmlProviderHealth) => {
    await amlTenantApi.setProviderHealth(id, status); toast.success(`Marked ${status}`); onSaved();
  };

  const orchestration = summary.orchestration;
  const anyLive = (orchestration?.live_active ?? 0) > 0;
  return (
    <div className="space-y-4">
      <Card className={`border ${anyLive ? "border-warning/50 bg-warning/5" : "border-primary/40 bg-primary/5"}`}>
        <CardContent className="p-3 flex items-start gap-3">
          <div className={`h-8 w-8 rounded-md flex items-center justify-center ${anyLive ? "bg-warning/20 text-warning" : "bg-primary/20 text-primary"}`}>
            <Plug className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">Provider orchestration</span>
              <Badge variant="outline" className={anyLive ? "border-warning/50 text-warning" : "border-primary/40 text-primary"}>
                {anyLive ? "Live providers active" : "Simulator only"}
              </Badge>
              {orchestration && (
                <span className="text-[11px] text-muted-foreground">
                  {orchestration.live_active} live · {orchestration.simulator_active} simulator · env {orchestration.env_mode}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Live-mode providers must have their adapter wired in <code className="font-mono">supabase/functions/_shared/aml/providers</code>.
              Simulator mode is safe by default; a live provider without an adapter will hard-fail rather than silently fall back.
            </p>
          </div>
        </CardContent>
      </Card>

      {canWrite && (
        <div className="flex justify-end">
          {/* A new IDV provider defaults to live: an active simulator IDV row
              is not a usable configuration, it is an incomplete one. */}
          <Button onClick={() => setEditing({ capability: "idv", provider_key: "", priority: 1, cost_per_unit_cents: 0, currency: "AUD", active: true, config: {}, mode: "live" })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add provider
          </Button>
        </div>
      )}

      {AML_PROVIDER_CAPABILITIES.map((cap) => (
        <Card key={cap.key} className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plug className="h-4 w-4" /> {cap.label}
              <Badge variant="outline" className="text-[10px]">{cap.key}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(groups[cap.key] ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No providers configured. Suggested: {cap.suggested.join(", ")}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead><TableHead>Mode</TableHead><TableHead>Priority</TableHead>
                    <TableHead>Cost/unit</TableHead><TableHead>Health</TableHead>
                    <TableHead>Active</TableHead><TableHead className="w-32">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups[cap.key].map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium">{p.display_label ?? p.provider_key}</div>
                        <div className="text-[11px] text-muted-foreground">{p.provider_key}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={p.mode === "live" ? "border-warning/50 text-warning" : "border-primary/40 text-primary"}>
                          {p.mode ?? "simulator"}
                        </Badge>
                      </TableCell>
                      <TableCell>{p.priority}</TableCell>
                      <TableCell>{fmtMoney(p.cost_per_unit_cents, p.currency)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={healthColor(p.last_health_status)}>
                          {p.last_health_status ?? "unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.active ? "default" : "secondary"}>{p.active ? "Yes" : "No"}</Badge>
                      </TableCell>
                      <TableCell>
                        {canWrite && (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => setEditing(p)} title="Edit">
                              <Settings2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => setHealth(p.id, "ok")} title="Mark healthy">
                              <HeartPulse className="h-3.5 w-3.5 text-success" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => setHealth(p.id, "failing")} title="Mark failing">
                              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => remove(p.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}

      <ProviderEditor editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onSaved(); }} />
    </div>
  );
}

function ProviderEditor({ editing, onClose, onSaved }: {
  editing: Partial<AmlProviderConfig> | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<AmlProviderConfig>>({});
  useEffect(() => { if (editing) setForm(editing); }, [editing]);
  const setF = (patch: Partial<AmlProviderConfig>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    try {
      if (!form.capability || !form.provider_key?.trim()) {
        toast.error("Capability and provider key are required"); return;
      }
      await amlTenantApi.upsertProvider(form);
      toast.success("Provider saved");
      onSaved();
    } catch (e: any) { toast.error(e.message ?? "Save failed"); }
  };

  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit provider" : "Add provider"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormRow label="Capability">
            <Select value={form.capability ?? "idv"} onValueChange={(v) => setF({ capability: v as AmlProviderCapability })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AML_PROVIDER_CAPABILITIES.map((c) => (
                  <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Provider key">
            <Input value={form.provider_key ?? ""} onChange={(e) => setF({ provider_key: e.target.value })} placeholder="frankieone" />
          </FormRow>
          <FormRow label="Display label">
            <Input value={form.display_label ?? ""} onChange={(e) => setF({ display_label: e.target.value })} />
          </FormRow>
          <div className="grid grid-cols-2 gap-2">
            <FormRow label="Priority"><Input type="number" value={form.priority ?? 1} onChange={(e) => setF({ priority: Number(e.target.value) })} /></FormRow>
            <FormRow label="Cost / unit (cents)">
              <Input type="number" value={form.cost_per_unit_cents ?? 0} onChange={(e) => setF({ cost_per_unit_cents: Number(e.target.value) })} />
            </FormRow>
          </div>
          <FormRow label="Secret reference (name of stored secret)">
            <Input value={form.secret_ref ?? ""} onChange={(e) => setF({ secret_ref: e.target.value })} placeholder="FRANKIEONE_API_KEY" />
          </FormRow>
          <FormRow label="Mode">
            <Select
              value={(form.mode as string) ?? (form.capability === "idv" ? "live" : "simulator")}
              onValueChange={(v) => setF({ mode: v as any })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* Identity verification has no simulator option. Production
                    refuses to execute one, so offering it here only produces a
                    row that looks configured and can never verify anybody —
                    which is exactly the state production sat in. */}
                {form.capability !== "idv" && (
                  <SelectItem value="simulator">Simulator (deterministic, no external calls)</SelectItem>
                )}
                <SelectItem value="live">Live (requires wired adapter + secret)</SelectItem>
              </SelectContent>
            </Select>
            {form.capability === "idv" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Identity verification runs live or not at all. Until the verification
                service is reachable, clients are routed to document verification by
                an adviser — never to a simulated result.
              </p>
            )}
          </FormRow>
          <div className="flex items-center justify-between rounded-md border border-border/60 p-2">
            <Label htmlFor="active" className="text-sm">Active</Label>
            <Switch id="active" checked={!!form.active} onCheckedChange={(v) => setF({ active: v })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------- metrics tab -------------------- */

function MetricsPanel() {
  const [rollup, setRollup] = useState<{ providers: any[]; timeline: any[]; days: number } | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { setRollup(await amlTenantApi.metricsRollup(days)); }
      finally { setLoading(false); }
    })();
  }, [days]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label className="text-xs">Window:</Label>
        {[7, 30, 90].map((d) => (
          <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
            {d}d
          </Button>
        ))}
      </div>

      {loading || !rollup ? (
        <Skeleton className="h-40 w-full" />
      ) : rollup.providers.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="p-6 text-sm text-muted-foreground">
            No provider metrics recorded yet. Metrics are captured automatically when integrated verification/screening functions run.
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60">
          <CardHeader><CardTitle className="text-base">Provider health over last {rollup.days} days</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Capability</TableHead><TableHead>Provider</TableHead>
                  <TableHead>Calls</TableHead><TableHead>Failures</TableHead>
                  <TableHead>Failure rate</TableHead><TableHead>Avg latency</TableHead>
                  <TableHead>Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rollup.providers.map((p, i) => (
                  <TableRow key={`${p.capability}-${p.provider_key}-${i}`}>
                    <TableCell><Badge variant="outline">{p.capability}</Badge></TableCell>
                    <TableCell>{p.provider_key}</TableCell>
                    <TableCell>{p.calls.toLocaleString('en-AU')}</TableCell>
                    <TableCell>{p.failures.toLocaleString('en-AU')}</TableCell>
                    <TableCell>
                      <span className={p.failure_rate > 0.1 ? "text-destructive" : p.failure_rate > 0.03 ? "text-warning" : "text-success"}>
                        {(p.failure_rate * 100).toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell>{p.avg_latency_ms} ms</TableCell>
                    <TableCell>{fmtMoney(p.cost_cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* -------------------- form row helper -------------------- */

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/* -------------------- activation program panel -------------------- */

function ActivationProgramPanel({ canWrite }: { canWrite: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [legalApproval, setLegalApproval] = useState(false);
  const [programVersion, setProgramVersion] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const p = await amlTenantApi.getActivationProgram();
        setLegalApproval(Boolean(p?.legal_approval));
        setProgramVersion(p?.program_version ?? "");
        setNotes(p?.notes ?? "");
      } catch (e: any) { toast.error(e?.message ?? "Failed to load activation program"); }
      finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    if (legalApproval && !programVersion.trim()) {
      toast.error("Program version is required when legal approval is enabled"); return;
    }
    setSaving(true);
    try {
      await amlTenantApi.updateActivationProgram({
        legal_approval: legalApproval,
        program_version: programVersion.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success("Activation program updated");
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
    finally { setSaving(false); }
  };

  if (loading) return <Skeleton className="h-40 w-full" />;

  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" /> Hybrid Activation Program (Model A / B)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Model B requires legal sign-off</AlertTitle>
          <AlertDescription>
            Model A (designated-service activation) is always available. Model B (pre-service /
            earlier activation) is disabled until the MLRO records legal approval and a program
            version reference here.
          </AlertDescription>
        </Alert>

        <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
          <div>
            <div className="text-sm font-medium">Model B legal approval</div>
            <div className="text-xs text-muted-foreground">
              Confirms the tenant's legal team has approved the earlier-activation program.
            </div>
          </div>
          <Switch checked={legalApproval} onCheckedChange={setLegalApproval} disabled={!canWrite} />
        </div>

        <FormRow label="Program version">
          <Input
            value={programVersion}
            onChange={(e) => setProgramVersion(e.target.value)}
            placeholder="e.g. 2026-Q1-v1"
            disabled={!canWrite}
          />
        </FormRow>

        <FormRow label="Notes (optional)">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Reference the approval document, scope, or effective date."
            disabled={!canWrite}
          />
        </FormRow>

        <div className="flex justify-end">
          <Button onClick={save} disabled={!canWrite || saving}>
            {saving ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : null} Save activation program
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
