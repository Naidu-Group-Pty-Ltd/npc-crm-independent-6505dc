import { useEffect, useMemo, useState } from "react";
import { invokeAmlFunction } from "@/lib/aml/invokeAmlFunction";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, statusLabel, statusTone } from "@/components/ui/status-badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AmlMetricCard, AmlPageHeader } from "@/components/aml/primitives";
import { toast } from "sonner";
import { Rocket, ClipboardCheck, ShieldAlert, RefreshCw, ArrowRight, ArrowLeft, Plus, CheckCircle2, XCircle, Award, Ban } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

const STAGES = ["internal_dev_only", "admin_limited", "controlled_team_rollout", "broad_production"] as const;
type Stage = typeof STAGES[number];

const stageLabel: Record<Stage, string> = {
  internal_dev_only: "Internal (dev only)",
  admin_limited: "Admin-limited",
  controlled_team_rollout: "Controlled team rollout",
  broad_production: "Broad production",
};

type Scenario = {
  id: string; code: string; title: string; description: string | null; phase: string | null; category: string | null;
  requirement_refs: string[]; steps: any[]; last_status: string; last_run_at: string | null;
  last_run_by_label: string | null; last_run_notes: string | null; is_active: boolean;
};
type Risk = {
  id: string; code: string; title: string; description: string | null; category: string | null;
  likelihood: string; impact: string; status: string; owner_label: string | null;
  mitigation: string | null; next_review_at: string | null;
};
type HistoryRow = { id: string; from_stage: string | null; to_stage: string; changed_by_label: string | null; reason: string | null; created_at: string };
type Readiness = {
  gate_pass: boolean;
  gate_status: string;
  gate_ran_at: string | null;
  failing_scenarios: string[];
  open_critical_risks: string[];
  broad_production_ready: boolean;
};
type Summary = {
  rollout: { rollout_stage: Stage; rollout_stage_since?: string; rollout_notes?: string | null };
  scenarios: { total: number; by_status: Record<string, number> };
  risks: { total: number; by_status: Record<string, number> };
  recent_history: HistoryRow[];
  readiness?: Readiness;
  my_role_is_mlro: boolean;
};

const badgeFor = (s: string) => (
  <StatusBadge tone={statusTone(s)} dot>{statusLabel(s)}</StatusBadge>
);

async function callOp(op: string, extra: Record<string, unknown> = {}) {
  return invokeAmlFunction<any>("aml-launch-ops", { op, ...extra });
}

export default function AmlLaunchOps() {
  const [tab, setTab] = useState("rollout");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [certifications, setCertifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, sc, rk, hi, ce] = await Promise.all([
        callOp("summary"), callOp("list_scenarios"), callOp("list_risks"), callOp("rollout_history"), callOp("list_certifications"),
      ]);
      setSummary(s);
      setScenarios(sc.scenarios ?? []);
      setRisks(rk.risks ?? []);
      setHistory(hi.history ?? []);
      setCertifications(ce.certifications ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadAll(); }, []);

  const stageIdx = summary ? STAGES.indexOf(summary.rollout.rollout_stage) : 0;
  const nextStage = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;
  const prevStage = stageIdx > 0 ? STAGES[stageIdx - 1] : null;
  const isMlro = summary?.my_role_is_mlro;

  const changeStage = async (to: Stage, reason: string, direction: "advance" | "rollback") => {
    try {
      await callOp(direction === "advance" ? "advance_rollout" : "rollback_rollout", { to_stage: to, reason });
      toast.success(`Moved to ${stageLabel[to]}`);
      await loadAll();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-6">
      <AmlPageHeader
        icon={Rocket}
        title="AML Launch Operations"
        description="Progressive rollout gates, acceptance-scenario traceability, and the operational risk register. Read-only for analysts and reporters. MLRO signs off every stage transition."
      />

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <AmlMetricCard
          title="Current stage"
          state={summary ? "ready" : "loading"}
          value={summary ? stageLabel[summary.rollout.rollout_stage] : undefined}
        />
        <AmlMetricCard
          title="Scenarios passing"
          state={summary ? "ready" : "loading"}
          value={summary ? `${summary.scenarios.by_status.passed ?? 0}/${summary.scenarios.total}` : undefined}
        />
        <AmlMetricCard
          title="Open risks"
          state={summary ? "ready" : "loading"}
          value={summary ? summary.risks.by_status.open ?? 0 : undefined}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rollout"><Rocket className="h-4 w-4 mr-1" /> Rollout</TabsTrigger>
          <TabsTrigger value="scenarios"><ClipboardCheck className="h-4 w-4 mr-1" /> Acceptance</TabsTrigger>
          <TabsTrigger value="risks"><ShieldAlert className="h-4 w-4 mr-1" /> Risks</TabsTrigger>
          <TabsTrigger value="launch"><Award className="h-4 w-4 mr-1" /> Launch</TabsTrigger>
        </TabsList>

        {/* Rollout */}
        <TabsContent value="rollout" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Rollout stage</CardTitle>
                <CardDescription>Gate the AML programme through four stages. Broad production requires a passing release gate.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={loadAll}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-4 gap-2">
                {STAGES.map((s, i) => (
                  <div key={s} className={`border rounded-md p-3 text-sm ${i === stageIdx ? "border-primary bg-primary/5" : "border-border"}`}>
                    <div className="text-xs text-muted-foreground">Stage {i + 1}</div>
                    <div className="font-medium">{stageLabel[s]}</div>
                    {i === stageIdx && summary?.rollout.rollout_stage_since && (
                      <div className="text-xs text-muted-foreground mt-1">since {new Date(summary.rollout.rollout_stage_since).toLocaleString('en-AU')}</div>
                    )}
                  </div>
                ))}
              </div>
              {!isMlro && (
                <Alert><AlertTitle>Read-only</AlertTitle>
                  <AlertDescription>Only MLROs can change the rollout stage.</AlertDescription></Alert>
              )}
              {isMlro && (
                <div className="flex flex-wrap gap-2">
                  {prevStage && (
                    <StageChangeButton direction="rollback" from={summary!.rollout.rollout_stage} to={prevStage} onConfirm={(reason) => changeStage(prevStage, reason, "rollback")} />
                  )}
                  {nextStage && (
                    <StageChangeButton direction="advance" from={summary!.rollout.rollout_stage} to={nextStage} onConfirm={(reason) => changeStage(nextStage, reason, "advance")} />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {summary?.readiness && (
            <Card>
              <CardHeader>
                <CardTitle>Broad-production readiness</CardTitle>
                <CardDescription>All three gates must clear before advancing to broad production.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <ReadinessRow
                  ok={summary.readiness.gate_pass}
                  label="Latest release gate PASS"
                  detail={`Status: ${summary.readiness.gate_status}${summary.readiness.gate_ran_at ? ` · ran ${new Date(summary.readiness.gate_ran_at).toLocaleString('en-AU')}` : ""}`}
                />
                <ReadinessRow
                  ok={summary.readiness.failing_scenarios.length === 0}
                  label="No failing / blocked acceptance scenarios"
                  detail={summary.readiness.failing_scenarios.length === 0 ? "All scenarios passing, waived or not run." : `Failing: ${summary.readiness.failing_scenarios.join(", ")}`}
                />
                <ReadinessRow
                  ok={summary.readiness.open_critical_risks.length === 0}
                  label="Zero open critical risks"
                  detail={summary.readiness.open_critical_risks.length === 0 ? "Risk register clear of critical items." : `Open: ${summary.readiness.open_critical_risks.join(", ")}`}
                />
                {!summary.readiness.broad_production_ready && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertTitle>Advance to broad_production is blocked</AlertTitle>
                    <AlertDescription>Clear every gate above before requesting the final rollout advance.</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Stage history</CardTitle></CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-24 w-full" /> : history.length === 0 ? (
                <div className="text-sm text-muted-foreground">No stage transitions recorded yet.</div>
              ) : (
                <div className="space-y-2">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between flex-wrap gap-2 text-sm border rounded-md p-2">
                      <div className="flex items-center gap-2">
                        {badgeFor(h.to_stage)}
                        <span className="text-xs text-muted-foreground">from {h.from_stage ?? "—"} · {h.changed_by_label ?? "system"}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString('en-AU')}</div>
                      {h.reason && <div className="w-full text-xs text-muted-foreground italic">{h.reason}</div>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Acceptance */}
        <TabsContent value="scenarios" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Acceptance scenarios</CardTitle>
                <CardDescription>End-to-end scenarios traceable back to the report requirements (§22).</CardDescription>
              </div>
              {isMlro && <ScenarioDialog onSaved={loadAll} />}
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-32 w-full" /> : scenarios.length === 0 ? (
                <EmptyScenarioNotice />
              ) : (
                <div className="space-y-2">
                  {scenarios.map((s) => (
                    <ScenarioRow key={s.id} s={s} isMlro={!!isMlro} onChanged={loadAll} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Risks */}
        <TabsContent value="risks" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Risk register</CardTitle>
                <CardDescription>Governance risks tracked to owner, mitigation and review cycle (§23).</CardDescription>
              </div>
              {isMlro && <RiskDialog onSaved={loadAll} />}
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-32 w-full" /> : risks.length === 0 ? (
                <div className="text-sm text-muted-foreground">No risks captured yet.</div>
              ) : (
                <div className="space-y-2">
                  {risks.map((r) => (
                    <RiskRow key={r.id} r={r} isMlro={!!isMlro} onChanged={loadAll} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Launch certification */}
        <TabsContent value="launch" className="space-y-4">
          <LaunchCertificationPanel
            summary={summary}
            isMlro={!!isMlro}
            certifications={certifications}
            onChanged={loadAll}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReadinessRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2 border rounded-md p-2">
      {ok ? <CheckCircle2 className="h-4 w-4 text-success mt-0.5" /> : <XCircle className="h-4 w-4 text-destructive mt-0.5" />}
      <div className="flex-1">
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function EmptyScenarioNotice() {
  return (
    <Alert>
      <AlertTitle>No scenarios yet</AlertTitle>
      <AlertDescription>
        MLRO can add tenant-specific acceptance scenarios here. Baseline scenarios also live in
        <code className="mx-1">docs/aml/acceptance-scenarios.md</code>.
      </AlertDescription>
    </Alert>
  );
}

function StageChangeButton({ direction, from, to, onConfirm }: {
  direction: "advance" | "rollback"; from: Stage; to: Stage; onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const Icon = direction === "advance" ? ArrowRight : ArrowLeft;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={direction === "advance" ? "default" : "outline"}>
          <Icon className="h-4 w-4 mr-2" />
          {direction === "advance" ? "Advance to" : "Roll back to"} {stageLabel[to]}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{direction === "advance" ? "Advance" : "Roll back"} rollout stage</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <div>From <strong>{stageLabel[from]}</strong> to <strong>{stageLabel[to]}</strong>.</div>
          <Label>Reason / evidence</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Link UAT evidence, gate ID, or incident reference…" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => { onConfirm(reason); setOpen(false); }}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScenarioRow({ s, isMlro, onChanged }: { s: Scenario; isMlro: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const record = async (status: string) => {
    setBusy(true);
    try {
      await callOp("record_scenario_result", { id: s.id, status, notes: null });
      toast.success(`Marked ${status}`);
      onChanged();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            {badgeFor(s.last_status)}
            <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
            {s.phase && <Badge variant="secondary" className="text-xs">{s.phase}</Badge>}
            <span className="font-medium">{s.title}</span>
          </div>
          {s.description && <div className="text-xs text-muted-foreground mt-1">{s.description}</div>}
          {s.requirement_refs.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {s.requirement_refs.map(r => <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>)}
            </div>
          )}
        </div>
        <div className="text-xs text-muted-foreground text-right">
          {s.last_run_at ? <>Last run {new Date(s.last_run_at).toLocaleString('en-AU')}{s.last_run_by_label ? ` · ${s.last_run_by_label}` : ""}</> : "Never run"}
        </div>
      </div>
      {isMlro && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => record("passed")}>Mark passed</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => record("failed")}>Failed</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => record("blocked")}>Blocked</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => record("waived")}>Waive</Button>
        </div>
      )}
    </div>
  );
}

function ScenarioDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", title: "", phase: "", category: "", description: "", requirement_refs: "" });
  const save = async () => {
    try {
      await callOp("upsert_scenario", {
        code: form.code, title: form.title, phase: form.phase || null, category: form.category || null,
        description: form.description || null,
        requirement_refs: form.requirement_refs.split(",").map(s => s.trim()).filter(Boolean),
      });
      toast.success("Scenario saved"); setOpen(false); onSaved();
      setForm({ code: "", title: "", phase: "", category: "", description: "", requirement_refs: "" });
    } catch (e: any) { toast.error(e.message); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> New scenario</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New acceptance scenario</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))} placeholder="AS-01" /></div>
            <div><Label>Phase</Label><Input value={form.phase} onChange={(e) => setForm(f => ({ ...f, phase: e.target.value }))} placeholder="Phase 3" /></div>
          </div>
          <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Onboarding, Screening, Reporting…" /></div>
          <div><Label>Requirement refs (comma-separated)</Label>
            <Input value={form.requirement_refs} onChange={(e) => setForm(f => ({ ...f, requirement_refs: e.target.value }))} placeholder="AUSTRAC-CDD-1, AML-POL-4.2" />
          </div>
          <div><Label>Description</Label><Textarea rows={3} value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RiskRow({ r, isMlro, onChanged }: { r: Risk; isMlro: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const update = async (status: string) => {
    setBusy(true);
    try {
      await callOp("upsert_risk", { ...r, status });
      toast.success(`Risk marked ${status}`); onChanged();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            {badgeFor(r.status)}
            <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
            {r.category && <Badge variant="secondary" className="text-xs">{r.category}</Badge>}
            <span className="font-medium">{r.title}</span>
          </div>
          {r.description && <div className="text-xs text-muted-foreground mt-1">{r.description}</div>}
          {r.mitigation && <div className="text-xs mt-1"><strong>Mitigation:</strong> {r.mitigation}</div>}
        </div>
        <div className="text-xs text-right space-y-1">
          <div>Likelihood {badgeFor(r.likelihood)}</div>
          <div>Impact {badgeFor(r.impact)}</div>
          {r.owner_label && <div className="text-muted-foreground">Owner: {r.owner_label}</div>}
          {r.next_review_at && <div className="text-muted-foreground">Review {new Date(r.next_review_at).toLocaleDateString('en-AU')}</div>}
        </div>
      </div>
      {isMlro && r.status !== "retired" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => update("mitigated")}>Mark mitigated</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => update("accepted")}>Accept</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => update("retired")}>Retire</Button>
        </div>
      )}
    </div>
  );
}

function RiskDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    code: "", title: "", category: "", likelihood: "medium", impact: "medium",
    owner_label: "", mitigation: "", description: "",
  });
  const save = async () => {
    try {
      await callOp("upsert_risk", form);
      toast.success("Risk saved"); setOpen(false); onSaved();
      setForm({ code: "", title: "", category: "", likelihood: "medium", impact: "medium", owner_label: "", mitigation: "", description: "" });
    } catch (e: any) { toast.error(e.message); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> New risk</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New risk</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))} placeholder="R-01" /></div>
            <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Provider, Data, People…" /></div>
          </div>
          <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          <div className="grid md:grid-cols-3 gap-3">
            <div><Label>Likelihood</Label>
              <Select value={form.likelihood} onValueChange={(v) => setForm(f => ({ ...f, likelihood: v }))}>
                <SelectTrigger aria-label="Risk likelihood"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Impact</Label>
              <Select value={form.impact} onValueChange={(v) => setForm(f => ({ ...f, impact: v }))}>
                <SelectTrigger aria-label="Risk impact"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                  <SelectItem value="critical">critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Owner</Label><Input value={form.owner_label} onChange={(e) => setForm(f => ({ ...f, owner_label: e.target.value }))} /></div>
          </div>
          <div><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div><Label>Mitigation</Label><Textarea rows={2} value={form.mitigation} onChange={(e) => setForm(f => ({ ...f, mitigation: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LaunchCertificationPanel({
  summary, isMlro, certifications, onChanged,
}: {
  summary: Summary | null;
  isMlro: boolean;
  certifications: any[];
  onChanged: () => Promise<void> | void;
}) {
  const [attestation, setAttestation] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revokeFor, setRevokeFor] = useState<any | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const readiness = summary?.readiness;
  const activeCert = certifications.find((c) => c.status === "issued") ?? null;
  const ready =
    !!readiness?.broad_production_ready &&
    (summary?.scenarios.by_status?.not_run ?? 0) === 0 &&
    (summary?.scenarios.total ?? 0) > 0;

  const certify = async () => {
    if (!ack || attestation.trim().length < 20) {
      toast.error("Attestation (≥20 chars) and acknowledgement are required");
      return;
    }
    setBusy(true);
    try {
      await callOp("certify_launch", { attestation: attestation.trim() });
      toast.success("Launch certification issued");
      setAttestation(""); setAck(false);
      await onChanged();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!revokeFor || revokeReason.trim().length < 5) return;
    setBusy(true);
    try {
      await callOp("revoke_certification", { id: revokeFor.id, reason: revokeReason.trim() });
      toast.success("Certification revoked");
      setRevokeFor(null); setRevokeReason("");
      await onChanged();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Award className="h-5 w-5 text-primary" /> Launch certification (AS-13)</CardTitle>
          <CardDescription>
            Final MLRO sign-off attesting that AS-01…AS-13 pass, the release gate is green,
            and the risk register is clear of open critical items. Requires a step-up session.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {activeCert ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-success" />
              <AlertTitle>Active launch certification</AlertTitle>
              <AlertDescription className="space-y-1">
                <div>Issued by <span className="font-medium">{activeCert.attested_by_label ?? "—"}</span> on {new Date(activeCert.created_at).toLocaleString('en-AU')}.</div>
                <div className="text-xs text-muted-foreground">Stage at certification: {activeCert.rollout_stage ?? "—"} · release gate {activeCert.release_gate_status ?? "—"}.</div>
                <div className="italic text-xs">"{activeCert.attestation}"</div>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant={ready ? "default" : "destructive"}>
              <AlertTitle>{ready ? "Ready to certify" : "Not ready to certify"}</AlertTitle>
              <AlertDescription>
                {ready
                  ? "All acceptance scenarios have run and passed, the release gate is PASS, and no open critical risks remain."
                  : "Clear every readiness gate on the Rollout tab (release gate PASS, every scenario run and passing, no open critical risks) before certifying."}
              </AlertDescription>
            </Alert>
          )}

          {isMlro && !activeCert && (
            <div className="space-y-3 border rounded-md p-3">
              <div>
                <Label>MLRO attestation</Label>
                <Textarea
                  rows={3}
                  placeholder="I, [name], as MLRO, confirm the AML/CTF programme is fit to enter broad production…"
                  value={attestation}
                  onChange={(e) => setAttestation(e.target.value)}
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} className="mt-0.5" />
                <span>
                  I acknowledge this certification writes an immutable snapshot of the current release gate,
                  acceptance scenarios, and risk register to the AML audit chain.
                </span>
              </label>
              <div className="flex justify-end">
                <Button onClick={certify} disabled={!ready || !ack || busy || attestation.trim().length < 20}>
                  <Award className="h-4 w-4 mr-1" /> Issue launch certification
                </Button>
              </div>
            </div>
          )}
          {!isMlro && (
            <Alert><AlertTitle>Read-only</AlertTitle>
              <AlertDescription>Only the MLRO can issue or revoke a launch certification.</AlertDescription></Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Certification history</CardTitle></CardHeader>
        <CardContent>
          {certifications.length === 0 ? (
            <div className="text-sm text-muted-foreground">No launch certifications have been issued yet.</div>
          ) : (
            <div className="space-y-2">
              {certifications.map((c) => (
                <div key={c.id} className="border rounded-md p-3 space-y-1 text-sm">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      {c.status === "issued"
                        ? <StatusBadge tone="success" dot>issued</StatusBadge>
                        : <StatusBadge tone="neutral" dot>revoked</StatusBadge>}
                      <span className="font-medium">{c.attested_by_label ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString('en-AU')}</span>
                    </div>
                    {isMlro && c.status === "issued" && (
                      <Button size="sm" variant="outline" onClick={() => setRevokeFor(c)}>
                        <Ban className="h-4 w-4 mr-1" /> Revoke
                      </Button>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Stage: {c.rollout_stage ?? "—"} · release gate: {c.release_gate_status ?? "—"} ·
                    scenarios: {Array.isArray(c.scenario_snapshot) ? c.scenario_snapshot.length : 0} ·
                    risks: {Array.isArray(c.risk_snapshot) ? c.risk_snapshot.length : 0}
                  </div>
                  <div className="italic text-xs">"{c.attestation}"</div>
                  {c.status === "revoked" && (
                    <div className="text-xs text-destructive">
                      Revoked {c.revoked_at ? new Date(c.revoked_at).toLocaleString('en-AU') : ""} by {c.revoked_by_label ?? "—"} — {c.revoked_reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!revokeFor} onOpenChange={(v) => { if (!v) { setRevokeFor(null); setRevokeReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revoke launch certification</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Reason (required, ≥5 chars)</Label>
            <Textarea rows={3} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeFor(null)}>Cancel</Button>
            <Button variant="destructive" onClick={revoke} disabled={busy || revokeReason.trim().length < 5}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
