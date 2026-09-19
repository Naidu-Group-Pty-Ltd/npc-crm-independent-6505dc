import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ClipboardList, Gauge, PlusCircle, ShieldAlert, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { RegulatoryAssuranceHeader } from "@/components/aml/RegulatoryAssuranceHeader";
import {
  AmlPageHeader,
  AmlRefreshButton,
  AmlTableEmptyRow,
  AmlTableLoadingRow,
} from "@/components/aml/primitives";
import {
  amlMonitoringApi, type AmlAlert, type AmlAlertSeverity, type AmlAlertStatus,
  type AmlEddCase, type AmlMonitoringRule, type AmlMonitoringSummary, type AmlReview,
} from "@/lib/aml/amlMonitoringApi";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";

const SEV_TONE: Record<string, string> = {
  info: "bg-muted text-muted-foreground",
  low: "bg-primary/15 text-primary",
  medium: "bg-warning/15 text-warning",
  high: "bg-destructive/15 text-destructive",
  critical: "bg-destructive text-destructive-foreground",
};
const ALERT_STATUS_TONE: Record<string, string> = {
  open: "bg-warning/15 text-warning",
  investigating: "bg-primary/15 text-primary",
  escalated: "bg-destructive/15 text-destructive",
  closed: "bg-success/15 text-success",
  false_positive: "bg-muted text-muted-foreground",
};

function fmt(d: string | null) { return d ? new Date(d).toLocaleString('en-AU') : "—"; }

export default function AmlMonitoring() {
  const { canWrite, isMlro } = useAmlAccess();
  const { regulatoryHub } = useAmlV3Flags();
  const [summary, setSummary] = useState<AmlMonitoringSummary | null>(null);
  const [tab, setTab] = useState("alerts");
  const [alerts, setAlerts] = useState<AmlAlert[]>([]);
  const [rules, setRules] = useState<AmlMonitoringRule[]>([]);
  const [edd, setEdd] = useState<AmlEddCase[]>([]);
  const [reviews, setReviews] = useState<AmlReview[]>([]);
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [alertStatus, setAlertStatus] = useState<AmlAlertStatus | "all">("open");
  const [busy, setBusy] = useState(false);

  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState<Partial<AmlMonitoringRule>>({ severity: "medium", trigger_kind: "transaction_amount", is_enabled: true, criteria: {} });
  const [criteriaText, setCriteriaText] = useState("{}");

  const [eddOpen, setEddOpen] = useState(false);
  const [eddForm, setEddForm] = useState<Partial<AmlEddCase>>({ reason: "high_risk", status: "open" });

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewForm, setReviewForm] = useState<Partial<AmlReview>>({ classification: "periodic", status: "queued", priority: "normal" });

  const load = async () => {
    setBusy(true);
    try {
      const [s, r, cs] = await Promise.all([
        amlMonitoringApi.summary(),
        amlMonitoringApi.listRules(),
        amlCasesApi.list({ limit: 200 }),
      ]);
      setSummary(s);
      setRules(r.rules);
      setCases(cs.cases);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load monitoring"); }
    finally { setBusy(false); }
  };

  const loadAlerts = async () => {
    const p: any = {}; if (alertStatus !== "all") p.status = alertStatus;
    const { alerts } = await amlMonitoringApi.listAlerts(p);
    setAlerts(alerts);
  };
  const loadEdd = async () => { const { edd_cases } = await amlMonitoringApi.listEdd({ limit: 200 }); setEdd(edd_cases); };
  const loadReviews = async () => { const { reviews } = await amlMonitoringApi.listReviews({ limit: 200 }); setReviews(reviews); };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (tab === "alerts") void loadAlerts();
    if (tab === "edd") void loadEdd();
    if (tab === "reviews") void loadReviews();
  }, [tab, alertStatus]);

  const openRule = (r?: AmlMonitoringRule) => {
    setRuleForm(r ?? { severity: "medium", trigger_kind: "transaction_amount", is_enabled: true, criteria: {} });
    setCriteriaText(JSON.stringify(r?.criteria ?? {}, null, 2));
    setRuleOpen(true);
  };
  const saveRule = async () => {
    try {
      let criteria: Record<string, any> = {};
      try { criteria = JSON.parse(criteriaText || "{}"); } catch { toast.error("Criteria must be valid JSON"); return; }
      await amlMonitoringApi.upsertRule({ ...ruleForm, criteria });
      toast.success("Rule saved"); setRuleOpen(false); void load();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
  };
  const toggleRule = async (r: AmlMonitoringRule) => {
    try { await amlMonitoringApi.toggleRule(r.id, !r.is_enabled); void load(); }
    catch (e: any) { toast.error(e?.message ?? "Toggle failed"); }
  };
  const deleteRule = async (id: string) => {
    if (!confirm("Delete this rule?")) return;
    try { await amlMonitoringApi.deleteRule(id); void load(); }
    catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
  };

  const resolveAlert = async (a: AmlAlert, status: AmlAlertStatus) => {
    const note = prompt(`Resolution note (${status}):`) ?? undefined;
    try { await amlMonitoringApi.resolveAlert(a.id, status, note); void loadAlerts(); void load(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const investigateAlert = async (a: AmlAlert) => {
    try { await amlMonitoringApi.assignAlert(a.id, { status: "investigating" }); toast.success("Assigned to you"); void loadAlerts(); void load(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const runScansNow = async () => {
    if (!isMlro) { toast.error("MLRO role required"); return; }
    if (!confirm("Run rescreen + stale-IDV scans and escalate overdue reviews now?")) return;
    setBusy(true);
    try {
      const r = await amlMonitoringApi.runScansAdmin();
      toast.success(`Scans complete — ${r.alerts_created} alert(s), ${r.reviews_escalated} review(s) escalated`);
      void load(); if (tab === "alerts") void loadAlerts(); if (tab === "reviews") void loadReviews();
    } catch (e: any) { toast.error(e?.message ?? "Scan failed"); }
    finally { setBusy(false); }
  };

  const saveEdd = async () => {
    try {
      if (!eddForm.case_id || !eddForm.reason) { toast.error("Case and reason required"); return; }
      await amlMonitoringApi.upsertEdd(eddForm);
      toast.success("EDD saved"); setEddOpen(false); setEddForm({ reason: "high_risk", status: "open" }); void loadEdd(); void load();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
  };
  const decideEdd = async (e: AmlEddCase, decision: "approved" | "reject" | "exit") => {
    if (!isMlro) { toast.error("MLRO role required"); return; }
    if (!confirm(`Record MLRO decision: ${decision}?`)) return;
    try { await amlMonitoringApi.mlroDecisionEdd(e.id, decision); void loadEdd(); void load(); }
    catch (err: any) { toast.error(err?.message ?? "Failed"); }
  };

  const saveReview = async () => {
    try {
      await amlMonitoringApi.upsertReview(reviewForm);
      toast.success("Review queued"); setReviewOpen(false);
      setReviewForm({ classification: "periodic", status: "queued", priority: "normal" });
      void loadReviews(); void load();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
  };
  const completeReview = async (r: AmlReview) => {
    const outcome = prompt("Outcome (no_change | refresh_required | edd_opened | exited | reported):", "no_change") ?? undefined;
    if (!outcome) return;
    try { await amlMonitoringApi.completeReview(r.id, outcome, "complete"); void loadReviews(); void load(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const seedPre = async () => {
    if (!confirm("Seed pre-commencement review queue for all cases without one?")) return;
    try { const r = await amlMonitoringApi.seedPreCommencement(); toast.success(`Seeded ${r.inserted} reviews`); void loadReviews(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const stats = summary ?? { open_alerts: 0, critical_alerts: 0, unprocessed_events: 0, open_edd: 0, pending_reviews: 0, overdue_reviews: 0 };

  return (
    <div className="space-y-6">
      {regulatoryHub && <RegulatoryAssuranceHeader />}
      <AmlPageHeader
        title="Ongoing Monitoring"
        description="Alerts, EDD, source of funds/wealth, and existing-customer remediation."
        icon={Activity}
        actions={
          <>
            {isMlro && (
              <Button variant="outline" size="sm" onClick={runScansNow} disabled={busy}>
                <Sparkles aria-hidden="true" className="mr-2 h-4 w-4" /> Run scans now
              </Button>
            )}
            <AmlRefreshButton onClick={load} loading={busy} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Open alerts", value: stats.open_alerts, icon: AlertTriangle, tone: "text-warning" },
          { label: "Critical", value: stats.critical_alerts, icon: ShieldAlert, tone: "text-destructive" },
          { label: "Unprocessed events", value: stats.unprocessed_events, icon: Sparkles, tone: "text-primary" },
          { label: "Open EDD", value: stats.open_edd, icon: Gauge, tone: "text-primary" },
          { label: "Pending reviews", value: stats.pending_reviews, icon: ClipboardList, tone: "text-muted-foreground" },
          { label: "Overdue reviews", value: stats.overdue_reviews, icon: ClipboardList, tone: "text-destructive" },
        ].map((s) => (
          <Card key={s.label}><CardContent className="flex items-center gap-3 p-4">
            <s.icon aria-hidden="true" className={`h-6 w-6 ${s.tone}`} />
            <div><div className="text-2xl font-semibold tabular-nums">{s.value}</div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div></div>
          </CardContent></Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="edd">EDD</TabsTrigger>
          <TabsTrigger value="reviews">Existing customers</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>

        {/* ── ALERTS ── */}
        <TabsContent value="alerts" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div><CardTitle>Alert queue</CardTitle><CardDescription>Signals from rules, transactions, screening and scheduled scans.</CardDescription></div>
              <div className="flex items-center gap-2">
                <Select value={alertStatus} onValueChange={(v) => setAlertStatus(v as any)}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="investigating">Investigating</SelectItem>
                    <SelectItem value="escalated">Escalated</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="false_positive">False positive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table aria-label="Alert queue">
                <TableHeader><TableRow>
                  <TableHead scope="col">Opened</TableHead><TableHead scope="col">Severity</TableHead><TableHead scope="col">Title</TableHead>
                  <TableHead scope="col">Summary</TableHead><TableHead scope="col">Status</TableHead><TableHead scope="col" className="text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {alerts.length === 0 && (busy
                    ? <AmlTableLoadingRow colSpan={6} label="Loading alerts…" />
                    : <AmlTableEmptyRow colSpan={6}>No alerts in this view. New alerts from rules, screening and scheduled scans appear here.</AmlTableEmptyRow>)}
                  {alerts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs whitespace-nowrap">{fmt(a.created_at)}</TableCell>
                      <TableCell><Badge className={SEV_TONE[a.severity]} variant="secondary">{a.severity}</Badge></TableCell>
                      <TableCell className="font-medium">{a.title}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.summary ?? "—"}</TableCell>
                      <TableCell><Badge className={ALERT_STATUS_TONE[a.status]} variant="secondary">{a.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {canWrite && a.status !== "closed" && a.status !== "false_positive" && (
                          <div className="flex justify-end gap-1">
                            {a.status === "open" && (
                              <Button size="sm" variant="secondary" onClick={() => investigateAlert(a)}>Investigate</Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => resolveAlert(a, "closed")}>Close</Button>
                            <Button size="sm" variant="ghost" onClick={() => resolveAlert(a, "false_positive")}>FP</Button>
                            <Button size="sm" variant="ghost" onClick={() => resolveAlert(a, "escalated")}>Escalate</Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── EDD ── */}
        <TabsContent value="edd" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div><CardTitle>Enhanced Due Diligence</CardTitle><CardDescription>Deep-dive investigations with SoF/SoW and MLRO sign-off.</CardDescription></div>
              {canWrite && <Button size="sm" onClick={() => setEddOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Open EDD</Button>}
            </CardHeader>
            <CardContent>
              <Table aria-label="Enhanced Due Diligence cases">
                <TableHeader><TableRow>
                  <TableHead scope="col">Opened</TableHead><TableHead scope="col">Case</TableHead><TableHead scope="col">Reason</TableHead>
                  <TableHead scope="col">Status</TableHead><TableHead scope="col">MLRO</TableHead><TableHead scope="col" className="text-right">Decision</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {edd.length === 0 && (busy
                    ? <AmlTableLoadingRow colSpan={6} label="Loading EDD cases…" />
                    : <AmlTableEmptyRow colSpan={6}>No EDD cases. Deep-dive investigations opened from alerts or cases appear here for MLRO sign-off.</AmlTableEmptyRow>)}
                  {edd.map((e) => {
                    const c = cases.find((x) => x.id === e.case_id);
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs whitespace-nowrap">{fmt(e.opened_at)}</TableCell>
                        <TableCell className="font-medium">{c?.case_reference ?? e.case_id.slice(0, 8)}</TableCell>
                        <TableCell><Badge variant="outline">{e.reason}</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{e.status}</Badge></TableCell>
                        <TableCell className="text-xs">{e.mlro_decision ? `${e.mlro_decision} · ${fmt(e.mlro_decision_at)}` : "—"}</TableCell>
                        <TableCell className="text-right">
                          {isMlro && !e.mlro_decision && (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" onClick={() => decideEdd(e, "approved")}>Approve</Button>
                              <Button size="sm" variant="ghost" onClick={() => decideEdd(e, "reject")}>Reject</Button>
                              <Button size="sm" variant="ghost" onClick={() => decideEdd(e, "exit")}>Exit</Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── REVIEWS ── */}
        <TabsContent value="reviews" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div><CardTitle>Existing customer reviews</CardTitle><CardDescription>Pre-commencement remediation + periodic reviews.</CardDescription></div>
              {canWrite && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={seedPre}>Seed pre-commencement</Button>
                  <Button size="sm" onClick={() => setReviewOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Queue review</Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <Table aria-label="Existing customer reviews">
                <TableHeader><TableRow>
                  <TableHead scope="col">Case</TableHead><TableHead scope="col">Class</TableHead><TableHead scope="col">Priority</TableHead>
                  <TableHead scope="col">Due</TableHead><TableHead scope="col">Status</TableHead><TableHead scope="col">Outcome</TableHead>
                  <TableHead scope="col" className="text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {reviews.length === 0 && (busy
                    ? <AmlTableLoadingRow colSpan={7} label="Loading reviews…" />
                    : <AmlTableEmptyRow colSpan={7}>No reviews queued. Queue a review, or seed the pre-commencement backlog to get started.</AmlTableEmptyRow>)}
                  {reviews.map((r) => {
                    const c = cases.find((x) => x.id === r.case_id);
                    const overdue = r.due_at && new Date(r.due_at).getTime() < Date.now() && !["complete", "exited"].includes(r.status);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{c?.case_reference ?? (r.case_id ?? "").slice(0, 8)}</TableCell>
                        <TableCell><Badge variant="outline">{r.classification}</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{r.priority}</Badge></TableCell>
                        <TableCell className={`text-xs whitespace-nowrap ${overdue ? "text-destructive" : ""}`}>{fmt(r.due_at)}</TableCell>
                        <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                        <TableCell className="text-xs">{r.outcome ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {canWrite && !["complete", "exited"].includes(r.status) && (
                            <Button size="sm" variant="outline" onClick={() => completeReview(r)}>Complete</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── RULES ── */}
        <TabsContent value="rules" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div><CardTitle>Monitoring rules</CardTitle><CardDescription>Detection logic evaluated against events + scheduled scans.</CardDescription></div>
              {canWrite && <Button size="sm" onClick={() => openRule()}><PlusCircle className="mr-2 h-4 w-4" /> New rule</Button>}
            </CardHeader>
            <CardContent>
              <Table aria-label="Monitoring rules">
                <TableHeader><TableRow>
                  <TableHead scope="col">Name</TableHead><TableHead scope="col">Trigger</TableHead><TableHead scope="col">Severity</TableHead>
                  <TableHead scope="col">Enabled</TableHead><TableHead scope="col" className="text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rules.length === 0 && (busy
                    ? <AmlTableLoadingRow colSpan={5} label="Loading rules…" />
                    : <AmlTableEmptyRow colSpan={5}>No monitoring rules yet. Create a rule to start raising alerts from events and scheduled scans.</AmlTableEmptyRow>)}
                  {rules.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                      </TableCell>
                      <TableCell><Badge variant="outline">{r.trigger_kind}</Badge></TableCell>
                      <TableCell><Badge className={SEV_TONE[r.severity]} variant="secondary">{r.severity}</Badge></TableCell>
                      <TableCell><Switch aria-label={`Enable rule ${r.name}`} checked={r.is_enabled} onCheckedChange={() => canWrite && toggleRule(r)} disabled={!canWrite} /></TableCell>
                      <TableCell className="text-right">
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => openRule(r)}>Edit</Button>
                            <Button size="sm" variant="ghost" onClick={() => deleteRule(r.id)}>Delete</Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Rule dialog ── */}
      <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{ruleForm.id ? "Edit rule" : "New rule"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={ruleForm.name ?? ""} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={ruleForm.description ?? ""} onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Trigger kind</Label>
                <Select value={ruleForm.trigger_kind ?? "transaction_amount"} onValueChange={(v) => setRuleForm({ ...ruleForm, trigger_kind: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transaction_amount">transaction_amount</SelectItem>
                    <SelectItem value="velocity">velocity</SelectItem>
                    <SelectItem value="stale_verification">stale_verification</SelectItem>
                    <SelectItem value="rescreen_due">rescreen_due</SelectItem>
                    <SelectItem value="high_risk_geo">high_risk_geo</SelectItem>
                    <SelectItem value="sanctions_delta">sanctions_delta</SelectItem>
                    <SelectItem value="custom">custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Severity</Label>
                <Select value={ruleForm.severity ?? "medium"} onValueChange={(v) => setRuleForm({ ...ruleForm, severity: v as AmlAlertSeverity })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["info", "low", "medium", "high", "critical"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Criteria (JSON)</Label>
              <Textarea rows={5} value={criteriaText} onChange={(e) => setCriteriaText(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="flex items-center gap-2"><Switch checked={ruleForm.is_enabled ?? true} onCheckedChange={(v) => setRuleForm({ ...ruleForm, is_enabled: v })} /><Label>Enabled</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setRuleOpen(false)}>Cancel</Button><Button onClick={saveRule}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── EDD dialog ── */}
      <Dialog open={eddOpen} onOpenChange={setEddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Open EDD case</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Case</Label>
              <Select value={eddForm.case_id ?? ""} onValueChange={(v) => setEddForm({ ...eddForm, case_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select case" /></SelectTrigger>
                <SelectContent>{cases.map((c) => <SelectItem key={c.id} value={c.id}>{c.case_reference} · {c.subject_display_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Reason</Label>
              <Select value={eddForm.reason ?? "high_risk"} onValueChange={(v) => setEddForm({ ...eddForm, reason: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["high_risk", "pep_hit", "adverse_media", "sanctions_hit", "transaction_alert", "periodic_review", "other"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Narrative</Label><Textarea value={eddForm.narrative ?? ""} onChange={(e) => setEddForm({ ...eddForm, narrative: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEddOpen(false)}>Cancel</Button><Button onClick={saveEdd}>Open</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Review dialog ── */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Queue customer review</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Case</Label>
              <Select value={reviewForm.case_id ?? ""} onValueChange={(v) => setReviewForm({ ...reviewForm, case_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select case" /></SelectTrigger>
                <SelectContent>{cases.map((c) => <SelectItem key={c.id} value={c.id}>{c.case_reference}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Classification</Label>
                <Select value={reviewForm.classification ?? "periodic"} onValueChange={(v) => setReviewForm({ ...reviewForm, classification: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["pre_commencement", "periodic", "trigger_based"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Priority</Label>
                <Select value={reviewForm.priority ?? "normal"} onValueChange={(v) => setReviewForm({ ...reviewForm, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["low", "normal", "high", "urgent"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Due</Label><Input type="datetime-local" value={reviewForm.due_at?.slice(0, 16) ?? ""} onChange={(e) => setReviewForm({ ...reviewForm, due_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button><Button onClick={saveReview}>Queue</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
