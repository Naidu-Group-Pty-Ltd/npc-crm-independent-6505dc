import { useEffect, useMemo, useState } from "react";
import { Archive, ShieldAlert, Search, PlusCircle, PlayCircle, CheckCircle2, XCircle, Ban, Download, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import {
  AmlAccessGate,
  AmlPageHeader,
  AmlRefreshButton,
  AmlTableEmptyRow,
  AmlTableLoadingRow,
} from "@/components/aml/primitives";
import {
  amlRecordsApi,
  type AmlLegalHold, type AmlPrivacyKind, type AmlPrivacyRequest, type AmlPrivacyStatus,
  type AmlRecordsAuditEvent, type AmlRecordsSummary, type AmlRetentionSchedule, type AmlRetentionScan,
  type AmlSuppressionMode, type AmlTippingOffRule, type AmlTippingSurface,
} from "@/lib/aml/amlRecordsApi";

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('en-AU') : "—");

const SCAN_STATUS_TONE: Record<string, string> = {
  dry_run: "bg-muted text-muted-foreground",
  awaiting_approval: "bg-warning/15 text-warning",
  approved: "bg-primary/15 text-primary",
  executing: "bg-primary/20 text-primary",
  completed: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
};
const PRIVACY_STATUS_TONE: Record<string, string> = {
  received: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/15 text-primary",
  awaiting_verification: "bg-warning/15 text-warning",
  fulfilled: "bg-success/15 text-success",
  partially_fulfilled: "bg-warning/15 text-warning",
  rejected: "bg-destructive/15 text-destructive",
  withdrawn: "bg-muted text-muted-foreground",
};

export default function AmlRecords() {
  const { canWrite, isMlro, hasAnyRole } = useAmlAccess();

  const [summary, setSummary] = useState<AmlRecordsSummary | null>(null);
  const [schedules, setSchedules] = useState<AmlRetentionSchedule[]>([]);
  const [holds, setHolds] = useState<AmlLegalHold[]>([]);
  const [privacy, setPrivacy] = useState<AmlPrivacyRequest[]>([]);
  const [rules, setRules] = useState<AmlTippingOffRule[]>([]);
  const [scans, setScans] = useState<AmlRetentionScan[]>([]);
  const [audit, setAudit] = useState<AmlRecordsAuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("retention");

  // schedule editor
  const [schedEdit, setSchedEdit] = useState<Partial<AmlRetentionSchedule> | null>(null);
  // hold dialog
  const [holdDraft, setHoldDraft] = useState<Partial<AmlLegalHold> | null>(null);
  // privacy dialog
  const [privDraft, setPrivDraft] = useState<Partial<AmlPrivacyRequest> | null>(null);
  const [privView, setPrivView] = useState<AmlPrivacyRequest | null>(null);
  // tipping-off editor
  const [ruleEdit, setRuleEdit] = useState<Partial<AmlTippingOffRule> | null>(null);
  // tipping-off tester
  const [testSurface, setTestSurface] = useState<AmlTippingSurface>("client_portal");
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<{ blocked: boolean; hits: any[] } | null>(null);
  // scan detail
  const [scanDetail, setScanDetail] = useState<{ scan: AmlRetentionScan | null; items: any[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [s, sch, h, p, r, sc, a] = await Promise.all([
        amlRecordsApi.summary(),
        amlRecordsApi.listSchedules(),
        amlRecordsApi.listHolds(),
        amlRecordsApi.listPrivacyRequests(),
        amlRecordsApi.listTippingOffRules(),
        amlRecordsApi.listScans(),
        amlRecordsApi.auditTimeline(60),
      ]);
      setSummary(s); setSchedules(sch); setHolds(h); setPrivacy(p); setRules(r); setScans(sc); setAudit(a);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load records module"); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (hasAnyRole) load(); }, [hasAnyRole]);

  const privacyStats = useMemo(() => {
    const total = privacy.length;
    const overdue = privacy.filter((p) => p.due_at && new Date(p.due_at) < new Date() && !["fulfilled","partially_fulfilled","rejected","withdrawn"].includes(p.status)).length;
    return { total, overdue };
  }, [privacy]);

  const saveSchedule = async () => {
    if (!schedEdit) return;
    try {
      await amlRecordsApi.upsertSchedule(schedEdit);
      toast.success("Retention schedule saved"); setSchedEdit(null); await load();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
  };

  const createHold = async () => {
    if (!holdDraft?.entity_type || !holdDraft?.reason) { toast.error("entity_type and reason required"); return; }
    try {
      await amlRecordsApi.createHold(holdDraft);
      toast.success("Legal hold applied"); setHoldDraft(null); await load();
    } catch (e: any) { toast.error(e?.message ?? "Failed to create hold"); }
  };

  const releaseHold = async (h: AmlLegalHold) => {
    const note = prompt(`Release reason for hold on ${h.entity_type}?`);
    if (note == null) return;
    try { await amlRecordsApi.releaseHold(h.id, note); toast.success("Hold released"); await load(); }
    catch (e: any) { toast.error(e?.message ?? "Release failed"); }
  };

  const savePrivacy = async () => {
    if (!privDraft?.kind) { toast.error("Kind required"); return; }
    try {
      await amlRecordsApi.createPrivacyRequest(privDraft);
      toast.success("Privacy request logged"); setPrivDraft(null); await load();
    } catch (e: any) { toast.error(e?.message ?? "Failed to log request"); }
  };

  const advancePrivacy = async (p: AmlPrivacyRequest, next: AmlPrivacyStatus) => {
    try {
      const patch: any = { status: next };
      if (next === "rejected") {
        const reason = prompt("Rejection reason?"); if (!reason) return;
        patch.rejection_reason = reason;
      }
      await amlRecordsApi.updatePrivacyRequest(p.id, patch);
      toast.success(`Request marked ${next}`); await load();
      if (privView?.id === p.id) setPrivView({ ...p, ...patch });
    } catch (e: any) { toast.error(e?.message ?? "Update failed"); }
  };

  const exportPrivacy = async (p: AmlPrivacyRequest) => {
    try {
      const { bundle, content_hash } = await amlRecordsApi.exportPrivacyBundle(p.id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `privacy-${p.id}.json`; a.click();
      URL.revokeObjectURL(url);
      toast.success(`Bundle exported — hash ${content_hash.slice(0, 12)}…`);
    } catch (e: any) { toast.error(e?.message ?? "Export failed"); }
  };

  const saveRule = async () => {
    if (!ruleEdit?.surface || !ruleEdit?.pattern) { toast.error("Surface + pattern required"); return; }
    try { await amlRecordsApi.upsertTippingOffRule(ruleEdit); toast.success("Rule saved"); setRuleEdit(null); await load(); }
    catch (e: any) { toast.error(e?.message ?? "Save failed"); }
  };

  const deleteRule = async (r: AmlTippingOffRule) => {
    if (!confirm(`Delete tipping-off rule "${r.pattern}"?`)) return;
    try { await amlRecordsApi.deleteTippingOffRule(r.id); toast.success("Rule deleted"); await load(); }
    catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
  };

  const runTest = async () => {
    try {
      const res = await amlRecordsApi.evaluateTippingOff(testSurface, testText);
      setTestResult(res);
    } catch (e: any) { toast.error(e?.message ?? "Evaluation failed"); }
  };

  const dryRun = async () => {
    try {
      const res = await amlRecordsApi.dryRunScan("all");
      toast.success(`Scan ${res.scan_id.slice(0, 8)} — ${res.candidates} candidates (${res.held} held)`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Dry run failed"); }
  };

  const openScan = async (id: string) => {
    try { const r = await amlRecordsApi.getScan(id); setScanDetail(r); }
    catch (e: any) { toast.error(e?.message ?? "Load failed"); }
  };
  const submitApproval = async (id: string) => { try { await amlRecordsApi.requestApproval(id); toast.success("Submitted for MLRO"); await load(); if (scanDetail?.scan?.id === id) await openScan(id); } catch (e: any) { toast.error(e?.message ?? "Submit failed"); } };
  const approve = async (id: string) => { try { await amlRecordsApi.approveScan(id); toast.success("Scan approved"); await load(); if (scanDetail?.scan?.id === id) await openScan(id); } catch (e: any) { toast.error(e?.message ?? "Approve failed"); } };
  const cancel = async (id: string) => { if (!confirm("Cancel this scan?")) return; try { await amlRecordsApi.cancelScan(id); await load(); if (scanDetail?.scan?.id === id) await openScan(id); } catch (e: any) { toast.error(e?.message ?? "Cancel failed"); } };
  const execute = async (id: string, dry: boolean) => {
    if (!dry && !confirm("Execute disposal? Records without legal holds will be marked disposed.")) return;
    try {
      const r = await amlRecordsApi.executeScan(id, dry);
      toast.success(`${dry ? "Dry-executed" : "Executed"} — ${r.disposed} disposed, ${r.skipped} skipped`);
      await load(); if (scanDetail?.scan?.id === id) await openScan(id);
    } catch (e: any) { toast.error(e?.message ?? "Execute failed"); }
  };

  if (!hasAnyRole) {
    return (
      <AmlAccessGate
        title="You don't have access to Records, Privacy & Retention yet"
        body="Ask your compliance administrator to grant you AML access to this module."
      />
    );
  }

  return (
    <div className="space-y-6">
      <AmlPageHeader
        title="Records, Privacy & Retention"
        description="Retention schedules, legal holds, privacy requests, tipping-off controls and the hash-chained records audit."
        icon={Archive}
        actions={<AmlRefreshButton onClick={load} loading={loading} />}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Active schedules" value={summary?.schedules_active ?? 0} />
        <Tile label="Active legal holds" value={summary?.holds_active ?? 0} tone="warning" />
        <Tile label="Privacy — open" value={(privacy.length - (summary?.privacy?.fulfilled ?? 0) - (summary?.privacy?.rejected ?? 0) - (summary?.privacy?.withdrawn ?? 0)) || 0} />
        <Tile label="Privacy — overdue" value={privacyStats.overdue} tone={privacyStats.overdue > 0 ? "destructive" : "muted"} />
        <Tile label="Scans awaiting MLRO" value={summary?.scans_awaiting_approval ?? 0} tone="warning" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="retention">Retention</TabsTrigger>
          <TabsTrigger value="holds">Legal Holds</TabsTrigger>
          <TabsTrigger value="scans">Disposal Scans</TabsTrigger>
          <TabsTrigger value="privacy">Privacy Requests</TabsTrigger>
          <TabsTrigger value="tipping">Tipping-Off</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        {/* ============== RETENTION ============== */}
        <TabsContent value="retention" className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>Retention schedules</CardTitle>
                <CardDescription>MLRO-only. Defaults seeded at 7 years per AML/CTF Act s107.</CardDescription>
              </div>
              {isMlro && (
                <Button size="sm" onClick={() => setSchedEdit({ entity_type: "", retention_years: 7, legal_basis: "AML/CTF Act 2006 s107", disposal_method: "soft_delete", active: true })}>
                  <PlusCircle className="w-4 h-4 mr-2" /> New schedule
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <Table aria-label="Retention schedules">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Entity</TableHead><TableHead scope="col">Years</TableHead><TableHead scope="col">Method</TableHead>
                    <TableHead scope="col">Legal basis</TableHead><TableHead scope="col">Status</TableHead><TableHead scope="col" className="w-24"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.entity_type}</TableCell>
                      <TableCell>{s.retention_years}</TableCell>
                      <TableCell><Badge variant="outline">{s.disposal_method}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-md truncate">{s.legal_basis}</TableCell>
                      <TableCell>{s.active ? <Badge className="bg-success/15 text-success">active</Badge> : <Badge variant="outline">disabled</Badge>}</TableCell>
                      <TableCell className="text-right">
                        {isMlro && <Button variant="ghost" size="sm" onClick={() => setSchedEdit(s)}>Edit</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {schedules.length === 0 && (loading
                    ? <AmlTableLoadingRow colSpan={6} label="Loading retention schedules…" />
                    : <AmlTableEmptyRow colSpan={6}>No retention schedules yet. Schedules created here govern when records become eligible for disposal.</AmlTableEmptyRow>)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============== HOLDS ============== */}
        <TabsContent value="holds" className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div><CardTitle>Legal holds</CardTitle><CardDescription>Prevents disposal until released by MLRO.</CardDescription></div>
              {canWrite && (
                <Button size="sm" onClick={() => setHoldDraft({ entity_type: "case", reason: "" })}>
                  <Lock className="w-4 h-4 mr-2" /> Apply hold
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <Table aria-label="Legal holds">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Entity</TableHead><TableHead scope="col">Reason</TableHead>
                    <TableHead scope="col">Imposed by</TableHead><TableHead scope="col">Imposed at</TableHead>
                    <TableHead scope="col">Status</TableHead><TableHead scope="col" className="w-32"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holds.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs">
                        <div className="font-medium">{h.entity_type}</div>
                        <div className="text-muted-foreground truncate max-w-[180px]">{h.entity_id ?? h.case_id ?? "—"}</div>
                      </TableCell>
                      <TableCell className="max-w-md text-sm">{h.reason}</TableCell>
                      <TableCell className="text-xs">{h.imposed_by_label ?? h.imposed_by.slice(0, 8)}</TableCell>
                      <TableCell className="text-xs">{fmt(h.imposed_at)}</TableCell>
                      <TableCell>
                        {h.active ? <Badge className="bg-warning/15 text-warning">held</Badge> :
                          <Badge variant="outline">released {fmt(h.released_at)}</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        {h.active && isMlro && (
                          <Button size="sm" variant="ghost" onClick={() => releaseHold(h)}>
                            <LockOpen className="w-4 h-4 mr-1" /> Release
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {holds.length === 0 && (loading
                    ? <AmlTableLoadingRow colSpan={6} label="Loading legal holds…" />
                    : <AmlTableEmptyRow colSpan={6}>No holds recorded. Apply a hold to protect records from disposal during litigation or an investigation.</AmlTableEmptyRow>)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============== SCANS ============== */}
        <TabsContent value="scans" className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div><CardTitle>Retention disposal scans</CardTitle><CardDescription>Dry-run first, then MLRO approval before any disposal executes.</CardDescription></div>
              {canWrite && <Button size="sm" onClick={dryRun}><Search className="w-4 h-4 mr-2" /> New dry-run</Button>}
            </CardHeader>
            <CardContent>
              <Table aria-label="Retention disposal scans">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Created</TableHead><TableHead scope="col">Scope</TableHead><TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Candidates</TableHead><TableHead scope="col">Held</TableHead><TableHead scope="col">Disposed</TableHead>
                    <TableHead scope="col" className="w-32"><span className="sr-only">Approved by</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scans.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openScan(s.id)}>
                      <TableCell className="text-xs">{fmt(s.created_at)}</TableCell>
                      <TableCell><Badge variant="outline">{s.scope}</Badge></TableCell>
                      <TableCell><Badge className={SCAN_STATUS_TONE[s.status] ?? "bg-muted"}>{s.status.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell>{s.candidates_count}</TableCell>
                      <TableCell>{s.held_count}</TableCell>
                      <TableCell>{s.disposed_count}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{s.approved_by_label ? `by ${s.approved_by_label}` : ""}</TableCell>
                    </TableRow>
                  ))}
                  {scans.length === 0 && (loading
                    ? <AmlTableLoadingRow colSpan={7} label="Loading disposal scans…" />
                    : <AmlTableEmptyRow colSpan={7}>No disposal scans yet. Start a dry-run to see which records are eligible for disposal.</AmlTableEmptyRow>)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============== PRIVACY ============== */}
        <TabsContent value="privacy" className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div><CardTitle>Privacy requests</CardTitle><CardDescription>Access, correction, deletion, portability & objection — 30-day SLA.</CardDescription></div>
              {canWrite && <Button size="sm" onClick={() => setPrivDraft({ kind: "access", status: "received", received_via: "email" })}><PlusCircle className="w-4 h-4 mr-2" /> Log request</Button>}
            </CardHeader>
            <CardContent>
              <Table aria-label="Privacy requests">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Received</TableHead><TableHead scope="col">Kind</TableHead><TableHead scope="col">Subject</TableHead>
                    <TableHead scope="col">Status</TableHead><TableHead scope="col">Due</TableHead><TableHead scope="col" className="w-40"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {privacy.map((p) => {
                    const overdue = p.due_at && new Date(p.due_at) < new Date() && !["fulfilled","partially_fulfilled","rejected","withdrawn"].includes(p.status);
                    return (
                      <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setPrivView(p)}>
                        <TableCell className="text-xs">{fmt(p.received_at)}</TableCell>
                        <TableCell><Badge variant="outline">{p.kind}</Badge></TableCell>
                        <TableCell className="text-xs">{p.subject_full_name ?? p.subject_email ?? p.subject_client_id ?? "—"}</TableCell>
                        <TableCell><Badge className={PRIVACY_STATUS_TONE[p.status] ?? "bg-muted"}>{p.status.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className={`text-xs ${overdue ? "text-destructive font-medium" : ""}`}>{fmt(p.due_at)}</TableCell>
                        <TableCell className="text-right">
                          {canWrite && (
                            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); exportPrivacy(p); }}>
                              <Download className="w-4 h-4 mr-1" /> Bundle
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {privacy.length === 0 && (loading
                    ? <AmlTableLoadingRow colSpan={6} label="Loading privacy requests…" />
                    : <AmlTableEmptyRow colSpan={6}>No privacy requests yet. Log requests as they arrive to track them against the 30-day SLA.</AmlTableEmptyRow>)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============== TIPPING-OFF ============== */}
        <TabsContent value="tipping" className="space-y-3">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div><CardTitle>Suppression rules</CardTitle><CardDescription>MLRO-only. Block / redact / warn per surface.</CardDescription></div>
                {isMlro && <Button size="sm" onClick={() => setRuleEdit({ surface: "client_portal", pattern: "", suppression_mode: "block", active: true })}><PlusCircle className="w-4 h-4 mr-2" /> New rule</Button>}
              </CardHeader>
              <CardContent>
                <Table aria-label="Tipping-off suppression rules">
                  <TableHeader><TableRow><TableHead scope="col">Surface</TableHead><TableHead scope="col">Pattern</TableHead><TableHead scope="col">Mode</TableHead><TableHead scope="col" className="w-32"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {rules.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{r.surface}</TableCell>
                        <TableCell className="text-xs font-mono">{r.pattern}{r.is_regex ? " /re/" : ""}</TableCell>
                        <TableCell><Badge variant={r.suppression_mode === "block" ? "destructive" : "outline"}>{r.suppression_mode}</Badge></TableCell>
                        <TableCell className="text-right">
                          {isMlro && <>
                            <Button size="sm" variant="ghost" onClick={() => setRuleEdit(r)}>Edit</Button>
                            <Button size="sm" variant="ghost" aria-label="Delete rule" onClick={() => deleteRule(r)}><XCircle aria-hidden="true" className="w-4 h-4" /></Button>
                          </>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {rules.length === 0 && (loading
                      ? <AmlTableLoadingRow colSpan={4} label="Loading suppression rules…" />
                      : <AmlTableEmptyRow colSpan={4}>No suppression rules yet. Rules added here block, redact or warn on customer-facing copy.</AmlTableEmptyRow>)}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Test copy against rules</CardTitle><CardDescription>Verify draft language before it reaches a customer surface.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Surface</Label>
                    <Select value={testSurface} onValueChange={(v) => setTestSurface(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["client_portal","email","notification","sms","agent_response"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end"><Button className="w-full" onClick={runTest}><ShieldAlert className="w-4 h-4 mr-2" /> Evaluate</Button></div>
                </div>
                <Textarea rows={5} value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="Paste draft copy here…" />
                {testResult && (
                  <div className={`p-3 rounded border ${testResult.blocked ? "border-destructive bg-destructive/10 text-destructive" : testResult.hits.length ? "border-warning bg-warning/10 text-warning" : "border-success bg-success/10 text-success"}`}>
                    <div className="text-sm font-medium">{testResult.blocked ? "Blocked — do not send" : testResult.hits.length ? `Warnings — ${testResult.hits.length} match(es)` : "Safe — no matches"}</div>
                    {testResult.hits.length > 0 && (
                      <ul className="mt-2 text-xs space-y-1">
                        {testResult.hits.map((h, i) => <li key={i} className="font-mono">{h.mode} · {h.pattern}{h.replacement_copy ? ` → ${h.replacement_copy}` : ""}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============== AUDIT ============== */}
        <TabsContent value="audit" className="space-y-3">
          <Card>
            <CardHeader><CardTitle>Records audit trail</CardTitle><CardDescription>Hash-chained — every schedule change, hold, scan, privacy action and tipping-off edit is preserved.</CardDescription></CardHeader>
            <CardContent>
              <Table aria-label="Records audit trail">
                <TableHeader><TableRow><TableHead scope="col">When</TableHead><TableHead scope="col">Category</TableHead><TableHead scope="col">Summary</TableHead><TableHead scope="col">Actor</TableHead><TableHead scope="col" className="w-24">Hash</TableHead></TableRow></TableHeader>
                <TableBody>
                  {audit.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{fmt(e.created_at)}</TableCell>
                      <TableCell><Badge variant="outline">{e.category}</Badge></TableCell>
                      <TableCell className="text-sm">{e.summary}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.actor_label ?? "system"}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{e.row_hash.slice(0, 8)}…</TableCell>
                    </TableRow>
                  ))}
                  {audit.length === 0 && (loading
                    ? <AmlTableLoadingRow colSpan={5} label="Loading audit trail…" />
                    : <AmlTableEmptyRow colSpan={5}>No audit events yet. Every schedule change, hold, scan, privacy action and tipping-off edit is recorded here.</AmlTableEmptyRow>)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ================= DIALOGS ================= */}

      {/* Schedule editor */}
      <Dialog open={!!schedEdit} onOpenChange={(v) => !v && setSchedEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Retention schedule</DialogTitle></DialogHeader>
          {schedEdit && (
            <div className="space-y-3">
              <div><Label>Entity type</Label><Input value={schedEdit.entity_type ?? ""} onChange={(e) => setSchedEdit({ ...schedEdit, entity_type: e.target.value })} placeholder="case, verification, transaction…" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Retention years</Label><Input type="number" step="0.5" value={schedEdit.retention_years ?? 7} onChange={(e) => setSchedEdit({ ...schedEdit, retention_years: Number(e.target.value) })} /></div>
                <div><Label>Disposal method</Label>
                  <Select value={schedEdit.disposal_method ?? "soft_delete"} onValueChange={(v) => setSchedEdit({ ...schedEdit, disposal_method: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="soft_delete">soft_delete</SelectItem>
                      <SelectItem value="redact">redact</SelectItem>
                      <SelectItem value="hard_delete">hard_delete</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Legal basis</Label><Input value={schedEdit.legal_basis ?? ""} onChange={(e) => setSchedEdit({ ...schedEdit, legal_basis: e.target.value })} /></div>
              <div><Label>Notes</Label><Textarea rows={3} value={schedEdit.notes ?? ""} onChange={(e) => setSchedEdit({ ...schedEdit, notes: e.target.value })} /></div>
              <div className="flex items-center gap-2"><Switch checked={schedEdit.active ?? true} onCheckedChange={(v) => setSchedEdit({ ...schedEdit, active: v })} /><span className="text-sm">Active</span></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSchedEdit(null)}>Cancel</Button>
            <Button onClick={saveSchedule}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hold dialog */}
      <Dialog open={!!holdDraft} onOpenChange={(v) => !v && setHoldDraft(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply legal hold</DialogTitle></DialogHeader>
          {holdDraft && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Entity type</Label>
                  <Select value={holdDraft.entity_type ?? "case"} onValueChange={(v) => setHoldDraft({ ...holdDraft, entity_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["case","verification","screening","transaction","report","alert","edd"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Entity ID (optional)</Label><Input value={holdDraft.entity_id ?? ""} onChange={(e) => setHoldDraft({ ...holdDraft, entity_id: e.target.value })} placeholder="UUID" /></div>
              </div>
              <div><Label>Case ID (optional)</Label><Input value={holdDraft.case_id ?? ""} onChange={(e) => setHoldDraft({ ...holdDraft, case_id: e.target.value })} placeholder="UUID" /></div>
              <div><Label>Reason</Label><Textarea rows={3} value={holdDraft.reason ?? ""} onChange={(e) => setHoldDraft({ ...holdDraft, reason: e.target.value })} placeholder="Regulator request, litigation, ongoing investigation…" /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setHoldDraft(null)}>Cancel</Button>
            <Button onClick={createHold}><Lock className="w-4 h-4 mr-2" /> Apply hold</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Privacy new */}
      <Dialog open={!!privDraft} onOpenChange={(v) => !v && setPrivDraft(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log privacy request</DialogTitle></DialogHeader>
          {privDraft && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Kind</Label>
                  <Select value={privDraft.kind ?? "access"} onValueChange={(v) => setPrivDraft({ ...privDraft, kind: v as AmlPrivacyKind })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["access","correction","deletion","portability","objection"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Received via</Label>
                  <Select value={privDraft.received_via ?? "email"} onValueChange={(v) => setPrivDraft({ ...privDraft, received_via: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["client_portal","email","phone","post","other"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Subject name</Label><Input value={privDraft.subject_full_name ?? ""} onChange={(e) => setPrivDraft({ ...privDraft, subject_full_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Subject email</Label><Input value={privDraft.subject_email ?? ""} onChange={(e) => setPrivDraft({ ...privDraft, subject_email: e.target.value })} /></div>
                <div><Label>Client ID (optional)</Label><Input value={privDraft.subject_client_id ?? ""} onChange={(e) => setPrivDraft({ ...privDraft, subject_client_id: e.target.value })} /></div>
              </div>
              <div><Label>Details</Label><Textarea rows={4} value={privDraft.request_details ?? ""} onChange={(e) => setPrivDraft({ ...privDraft, request_details: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPrivDraft(null)}>Cancel</Button>
            <Button onClick={savePrivacy}>Log</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Privacy view */}
      <Dialog open={!!privView} onOpenChange={(v) => !v && setPrivView(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Privacy request</DialogTitle></DialogHeader>
          {privView && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">Kind</span><div className="font-medium">{privView.kind}</div></div>
                <div><span className="text-muted-foreground">Status</span><div><Badge className={PRIVACY_STATUS_TONE[privView.status] ?? "bg-muted"}>{privView.status.replace(/_/g, " ")}</Badge></div></div>
                <div><span className="text-muted-foreground">Received</span><div>{fmt(privView.received_at)}</div></div>
                <div><span className="text-muted-foreground">Due</span><div>{fmt(privView.due_at)}</div></div>
                <div><span className="text-muted-foreground">Subject</span><div>{privView.subject_full_name ?? privView.subject_email ?? "—"}</div></div>
                <div><span className="text-muted-foreground">Received via</span><div>{privView.received_via ?? "—"}</div></div>
              </div>
              {privView.request_details && (<div><div className="text-muted-foreground text-xs mb-1">Details</div><div className="p-2 border rounded bg-muted/30 text-sm whitespace-pre-wrap">{privView.request_details}</div></div>)}
              {privView.rejection_reason && (<div><div className="text-muted-foreground text-xs mb-1">Rejection reason</div><div className="p-2 border rounded bg-destructive/10 text-destructive text-sm">{privView.rejection_reason}</div></div>)}
              {canWrite && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => advancePrivacy(privView, "in_progress")}>Mark in progress</Button>
                  <Button size="sm" variant="outline" onClick={() => advancePrivacy(privView, "awaiting_verification")}>Awaiting verification</Button>
                  <Button size="sm" onClick={() => advancePrivacy(privView, "fulfilled")}><CheckCircle2 className="w-4 h-4 mr-1" /> Fulfilled</Button>
                  <Button size="sm" variant="destructive" onClick={() => advancePrivacy(privView, "rejected")}><XCircle className="w-4 h-4 mr-1" /> Reject</Button>
                  <Button size="sm" variant="outline" onClick={() => exportPrivacy(privView)}><Download className="w-4 h-4 mr-1" /> Export bundle</Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Tipping-off rule editor */}
      <Dialog open={!!ruleEdit} onOpenChange={(v) => !v && setRuleEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tipping-off rule</DialogTitle></DialogHeader>
          {ruleEdit && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Surface</Label>
                  <Select value={ruleEdit.surface ?? "client_portal"} onValueChange={(v) => setRuleEdit({ ...ruleEdit, surface: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["client_portal","email","notification","sms","agent_response"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Mode</Label>
                  <Select value={ruleEdit.suppression_mode ?? "block"} onValueChange={(v) => setRuleEdit({ ...ruleEdit, suppression_mode: v as AmlSuppressionMode })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="block">block</SelectItem>
                      <SelectItem value="redact">redact</SelectItem>
                      <SelectItem value="warn">warn</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Pattern</Label><Input value={ruleEdit.pattern ?? ""} onChange={(e) => setRuleEdit({ ...ruleEdit, pattern: e.target.value })} /></div>
              <div className="flex items-center gap-2"><Switch checked={ruleEdit.is_regex ?? false} onCheckedChange={(v) => setRuleEdit({ ...ruleEdit, is_regex: v })} /><span className="text-sm">Regex</span></div>
              {ruleEdit.suppression_mode !== "block" && (
                <div><Label>Replacement copy</Label><Input value={ruleEdit.replacement_copy ?? ""} onChange={(e) => setRuleEdit({ ...ruleEdit, replacement_copy: e.target.value })} placeholder="Safe wording" /></div>
              )}
              <div><Label>Note</Label><Input value={ruleEdit.note ?? ""} onChange={(e) => setRuleEdit({ ...ruleEdit, note: e.target.value })} /></div>
              <div className="flex items-center gap-2"><Switch checked={ruleEdit.active ?? true} onCheckedChange={(v) => setRuleEdit({ ...ruleEdit, active: v })} /><span className="text-sm">Active</span></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRuleEdit(null)}>Cancel</Button>
            <Button onClick={saveRule}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scan detail */}
      <Dialog open={!!scanDetail} onOpenChange={(v) => !v && setScanDetail(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Retention scan</DialogTitle></DialogHeader>
          {scanDetail?.scan && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div><span className="text-muted-foreground">Status</span><div><Badge className={SCAN_STATUS_TONE[scanDetail.scan.status] ?? "bg-muted"}>{scanDetail.scan.status.replace(/_/g, " ")}</Badge></div></div>
                <div><span className="text-muted-foreground">Candidates</span><div>{scanDetail.scan.candidates_count}</div></div>
                <div><span className="text-muted-foreground">Held</span><div>{scanDetail.scan.held_count}</div></div>
                <div><span className="text-muted-foreground">Disposed</span><div>{scanDetail.scan.disposed_count}</div></div>
              </div>
              <div className="flex flex-wrap gap-2">
                {scanDetail.scan.status === "dry_run" && canWrite && <Button size="sm" onClick={() => submitApproval(scanDetail.scan!.id)}>Submit for MLRO</Button>}
                {scanDetail.scan.status === "awaiting_approval" && isMlro && <Button size="sm" onClick={() => approve(scanDetail.scan!.id)}><CheckCircle2 className="w-4 h-4 mr-1" /> Approve</Button>}
                {scanDetail.scan.status === "approved" && isMlro && <>
                  <Button size="sm" variant="outline" onClick={() => execute(scanDetail.scan!.id, true)}>Dry execute</Button>
                  <Button size="sm" variant="destructive" onClick={() => execute(scanDetail.scan!.id, false)}><PlayCircle className="w-4 h-4 mr-1" /> Execute disposal</Button>
                </>}
                {!["completed","cancelled","failed","executing"].includes(scanDetail.scan.status) && canWrite && <Button size="sm" variant="ghost" onClick={() => cancel(scanDetail.scan!.id)}><Ban className="w-4 h-4 mr-1" /> Cancel</Button>}
              </div>
              <div className="max-h-[50vh] overflow-y-auto border rounded">
                <Table aria-label="Retention scan candidates">
                  <TableHeader className="sticky top-0 bg-background"><TableRow><TableHead scope="col">Entity</TableHead><TableHead scope="col">Reference</TableHead><TableHead scope="col">Eligible since</TableHead><TableHead scope="col">Disposition</TableHead><TableHead scope="col">Method</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {scanDetail.items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="text-xs"><div className="font-medium">{it.entity_type}</div><div className="text-muted-foreground truncate max-w-[140px]">{it.entity_id}</div></TableCell>
                        <TableCell className="text-xs">{it.reference_label ?? "—"}</TableCell>
                        <TableCell className="text-xs">{fmt(it.eligible_since)}</TableCell>
                        <TableCell><Badge variant={it.disposition === "held" ? "outline" : it.disposition === "disposed" ? "default" : "outline"}>{it.disposition}</Badge></TableCell>
                        <TableCell className="text-xs">{it.disposal_method ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                    {scanDetail.items.length === 0 && <AmlTableEmptyRow colSpan={5}>No candidates. Records eligible for disposal under the active schedules appear here.</AmlTableEmptyRow>}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tile({ label, value, tone = "primary" }: { label: string; value: number | string; tone?: "primary" | "warning" | "destructive" | "muted" }) {
  const toneClass = tone === "warning" ? "text-warning" : tone === "destructive" ? "text-destructive" : tone === "muted" ? "text-muted-foreground" : "text-primary";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
