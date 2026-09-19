import { useEffect, useState } from "react";
import { invokeAmlFunction } from "@/lib/aml/invokeAmlFunction";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, statusLabel, statusTone } from "@/components/ui/status-badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AmlEmptyState,
  AmlLoadingState,
  AmlMetricCard,
  AmlPageHeader,
} from "@/components/aml/primitives";
import { toast } from "sonner";
import {
  ShieldCheck, PlayCircle, ClipboardList, BookOpen, Bot, KeyRound, LifeBuoy, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Users,
} from "lucide-react";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { GovernanceContactsPanel } from "@/components/aml/GovernanceContactsPanel";

type CheckResult = { name: string; status: "pass" | "fail" | "warn"; detail?: string; metric?: number };
type GateRun = {
  id: string; gate_name: string; version_tag: string | null; status: "pass" | "fail" | "warn" | "running";
  summary: string | null; checks: CheckResult[]; ran_at: string; duration_ms: number | null;
  triggered_by_label: string | null;
};
type Approval = {
  id: string; tool_name: string; action_summary: string; arguments: any; status: string;
  proposer: string; decided_by_label: string | null; decided_at: string | null;
  decision_reason: string | null; created_at: string; expires_at: string;
};
type Drill = {
  id: string; kind: string; title: string; status: string;
  executed_at: string | null; executed_by_label: string | null;
  findings: string | null; action_items: any[]; next_review_at: string | null; created_at: string;
};
type StepUpSession = { id: string; capability: string; expires_at: string; revoked_at: string | null; created_at: string; ip?: string | null };
type Runbook = { id: string; title: string; body_md: string };

const statusBadge = (s: string) => (
  <StatusBadge tone={statusTone(s)} dot>{statusLabel(s)}</StatusBadge>
);

function CheckIcon({ status }: { status: string }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <XCircle className="h-4 w-4 text-destructive" />;
}

export default function AmlGovernance() {
  const [tab, setTab] = useState("gate");
  const { orgSettings: orgSettingsFlag } = useAmlV3Flags();

  // Release gate
  const [gates, setGates] = useState<GateRun[]>([]);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateLoading, setGateLoading] = useState(true);

  // AI approvals
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(true);

  // Drills
  const [drills, setDrills] = useState<Drill[]>([]);
  const [drillsLoading, setDrillsLoading] = useState(true);
  const [newDrill, setNewDrill] = useState({ kind: "backup_restore", title: "", findings: "", status: "completed" });

  // Step-up sessions
  const [sessions, setSessions] = useState<StepUpSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  // Runbooks
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [runbooksLoading, setRunbooksLoading] = useState(true);

  const loadGates = async () => {
    setGateLoading(true);
    try {
      const data = await invokeAmlFunction<any>("aml-release-gate", { op: "list", limit: 25 });
      setGates((data.runs ?? []) as GateRun[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Unable to load release gates");
    }
    setGateLoading(false);
  };
  const runGate = async () => {
    setGateBusy(true);
    try {
      const data = await invokeAmlFunction<any>("aml-release-gate", { op: "run" });
      toast.success(`Gate ${data.status.toUpperCase()} — ${data.summary}`);
      void loadGates();
    } catch (e: any) {
      toast.error(`Gate failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setGateBusy(false);
    }
  };

  const loadApprovals = async () => {
    setApprovalsLoading(true);
    try {
      const data = await invokeAmlFunction<any>("aml-ai-guardrail", { op: "list" });
      setApprovals((data.approvals ?? []) as Approval[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Unable to load approvals");
    }
    setApprovalsLoading(false);
  };
  const decide = async (id: string, decision: "approved" | "rejected", reason?: string) => {
    try {
      await invokeAmlFunction<any>("aml-ai-guardrail", { op: "decide", id, decision, reason });
    } catch (e: any) {
      return toast.error(e?.message ?? "Failed");
    }
    toast.success(`Marked ${decision}`);
    void loadApprovals();
  };

  const loadDrills = async () => {
    setDrillsLoading(true);
    try {
      const data = await invokeAmlFunction<any>("aml-resilience", { op: "list" });
      setDrills((data.drills ?? []) as Drill[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Unable to load drills");
    }
    setDrillsLoading(false);
  };
  const logDrill = async () => {
    if (!newDrill.title.trim()) return toast.error("Title required");
    try {
      await invokeAmlFunction<any>("aml-resilience", { op: "log", ...newDrill });
    } catch (e: any) {
      return toast.error(e?.message ?? "Failed");
    }
    toast.success("Drill logged");
    setNewDrill({ kind: "backup_restore", title: "", findings: "", status: "completed" });
    void loadDrills();
  };

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const data = await invokeAmlFunction<any>("aml-step-up", { op: "list" });
      setSessions((data.sessions ?? []) as StepUpSession[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Unable to load step-up sessions");
    }
    setSessionsLoading(false);
  };
  const revokeSession = async (id: string) => {
    try {
      await invokeAmlFunction<any>("aml-step-up", { op: "revoke", session_id: id });
    } catch (e: any) {
      return toast.error(e?.message ?? "Failed");
    }
    toast.success("Session revoked");
    void loadSessions();
  };

  const loadRunbooks = async () => {
    setRunbooksLoading(true);
    try {
      const data = await invokeAmlFunction<any>("aml-resilience", { op: "runbooks" });
      setRunbooks((data.runbooks ?? []) as Runbook[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Unable to load runbooks");
    }
    setRunbooksLoading(false);
  };

  useEffect(() => {
    void loadGates(); void loadApprovals(); void loadDrills(); void loadSessions(); void loadRunbooks();
  }, []);

  const latest = gates[0];
  const pendingCount = approvals.filter(a => a.status === "pending").length;
  const activeSessionCount = sessions.filter(
    s => !s.revoked_at && new Date(s.expires_at).getTime() > Date.now(),
  ).length;

  return (
    <div className="space-y-6">
      <AmlPageHeader
        icon={ClipboardList}
        title="AML Governance"
        description="Release gates, AI guardrails, step-up sessions, resilience drills and operational runbooks. Configured to implement your approved AML/CTF program — not a substitute for legal advice."
      />

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <AmlMetricCard
          title="Latest gate"
          state={gateLoading ? "loading" : "ready"}
          value={latest ? statusLabel(latest.status) : "Not run yet"}
        />
        <AmlMetricCard
          title="Pending AI approvals"
          state={approvalsLoading ? "loading" : "ready"}
          value={pendingCount}
        />
        <AmlMetricCard
          title="Active step-up sessions"
          state={sessionsLoading ? "loading" : "ready"}
          value={activeSessionCount}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="gate"><ShieldCheck className="h-4 w-4 mr-1" /> Release Gate</TabsTrigger>
          <TabsTrigger value="ai"><Bot className="h-4 w-4 mr-1" /> AI Approvals {pendingCount > 0 && <Badge variant="secondary" className="ml-2">{pendingCount}</Badge>}</TabsTrigger>
          <TabsTrigger value="stepup"><KeyRound className="h-4 w-4 mr-1" /> Step-Up Sessions</TabsTrigger>
          <TabsTrigger value="drills"><LifeBuoy className="h-4 w-4 mr-1" /> Resilience Drills</TabsTrigger>
          <TabsTrigger value="runbooks"><BookOpen className="h-4 w-4 mr-1" /> Runbooks</TabsTrigger>
          {orgSettingsFlag && (
            <TabsTrigger value="contacts"><Users className="h-4 w-4 mr-1" /> Contacts</TabsTrigger>
          )}
        </TabsList>

        {orgSettingsFlag && (
          <TabsContent value="contacts" className="space-y-4">
            <GovernanceContactsPanel />
          </TabsContent>
        )}


        {/* Release Gate */}
        <TabsContent value="gate" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Release Gate</CardTitle>
                <CardDescription>Runs schema, provider health, audit-chain and tenant configuration checks. MLRO-only.</CardDescription>
              </div>
              <Button onClick={runGate} disabled={gateBusy}>
                <PlayCircle className="h-4 w-4 mr-2" />
                {gateBusy ? "Running…" : "Run gate now"}
              </Button>
            </CardHeader>
            <CardContent>
              {latest ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-sm">
                    {statusBadge(latest.status)}
                    <span className="text-muted-foreground">{new Date(latest.ran_at).toLocaleString('en-AU')}</span>
                    {latest.duration_ms != null && <span className="text-muted-foreground">· {latest.duration_ms} ms</span>}
                    {latest.triggered_by_label && <span className="text-muted-foreground">· {latest.triggered_by_label}</span>}
                  </div>
                  <div className="text-sm">{latest.summary}</div>
                  <div className="grid md:grid-cols-2 gap-2 pt-2">
                    {(latest.checks ?? []).map((c) => (
                      <div key={c.name} className="flex items-start gap-2 border rounded-md p-2 text-sm">
                        <CheckIcon status={c.status} />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-xs">{c.name}</div>
                          {c.detail ? <div className="text-xs text-muted-foreground truncate">{c.detail}</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : gateLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <Alert>
                  <AlertTitle>No gates run yet</AlertTitle>
                  <AlertDescription>Click "Run gate now" to record the first baseline.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent runs</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[360px]">
                <div className="space-y-2">
                  {gates.slice(1).map((g) => (
                    <div key={g.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
                      <div className="flex items-center gap-3">
                        {statusBadge(g.status)}
                        <span className="text-muted-foreground">{new Date(g.ran_at).toLocaleString('en-AU')}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{g.summary}</div>
                    </div>
                  ))}
                  {gates.length <= 1 && <div className="text-sm text-muted-foreground">No prior runs.</div>}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Approvals */}
        <TabsContent value="ai" className="space-y-4">
          <Alert>
            <Bot className="h-4 w-4" />
            <AlertTitle>Aurixa Agent guardrail</AlertTitle>
            <AlertDescription>
              The agent may summarise or suggest inside AML surfaces, but any write proposal lands here for MLRO
              approval before a human executes it. The AI never advances case status, submits reports, or resolves matches.
            </AlertDescription>
          </Alert>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div><CardTitle>Proposals</CardTitle><CardDescription>Newest first · auto-expires 24h from creation.</CardDescription></div>
              <Button variant="outline" size="sm" onClick={loadApprovals}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
            </CardHeader>
            <CardContent>
              {approvalsLoading ? <Skeleton className="h-24 w-full" /> : approvals.length === 0 ? (
                <div className="text-sm text-muted-foreground">No AI proposals recorded yet.</div>
              ) : (
                <div className="space-y-3">
                  {approvals.map((a) => (
                    <div key={a.id} className="border rounded-md p-3 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          {statusBadge(a.status)}
                          <span className="font-mono text-xs">{a.tool_name}</span>
                          <span className="text-xs text-muted-foreground">· by {a.proposer}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString('en-AU')}</span>
                      </div>
                      <div className="text-sm">{a.action_summary}</div>
                      {a.arguments && Object.keys(a.arguments).length > 0 && (
                        <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto">{JSON.stringify(a.arguments, null, 2)}</pre>
                      )}
                      {a.decision_reason && <div className="text-xs text-muted-foreground">Reason: {a.decision_reason}</div>}
                      {a.status === "pending" && (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => decide(a.id, "approved")}>Approve</Button>
                          <Button size="sm" variant="destructive" onClick={() => {
                            const reason = window.prompt("Rejection reason (optional):") ?? "";
                            void decide(a.id, "rejected", reason);
                          }}>Reject</Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Step-up sessions */}
        <TabsContent value="stepup" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>My step-up sessions</CardTitle>
                <CardDescription>Short-lived grants (15 min) issued after 6-digit verification. Revoke any that look suspicious.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={loadSessions}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
            </CardHeader>
            <CardContent>
              {sessionsLoading ? <Skeleton className="h-24 w-full" /> : sessions.length === 0 ? (
                <div className="text-sm text-muted-foreground">No sessions yet. Visit AUSTRAC Reporting or Configuration to trigger a step-up.</div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((s) => {
                    const live = !s.revoked_at && new Date(s.expires_at).getTime() > Date.now();
                    return (
                      <div key={s.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
                        <div className="flex items-center gap-3">
                          {statusBadge(live ? "approved" : s.revoked_at ? "rejected" : "expired")}
                          <span className="font-mono text-xs">{s.capability}</span>
                          <span className="text-xs text-muted-foreground">
                            {live ? `expires ${new Date(s.expires_at).toLocaleTimeString('en-AU')}` : new Date(s.expires_at).toLocaleString('en-AU')}
                          </span>
                          {s.ip && <span className="text-xs text-muted-foreground">· {s.ip}</span>}
                        </div>
                        {live && <Button size="sm" variant="outline" onClick={() => revokeSession(s.id)}>Revoke</Button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Drills */}
        <TabsContent value="drills" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Log a resilience drill</CardTitle>
              <CardDescription>MLRO-only. Record backup/restore, provider-outage, secret-rotation or tabletop exercises.</CardDescription>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Kind</Label>
                <Select
                  value={newDrill.kind}
                  onValueChange={(v) => setNewDrill(d => ({ ...d, kind: v }))}
                >
                  <SelectTrigger aria-label="Drill kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="backup_restore">Backup &amp; restore</SelectItem>
                    <SelectItem value="provider_outage">Provider outage</SelectItem>
                    <SelectItem value="secret_rotation">Secret rotation</SelectItem>
                    <SelectItem value="tabletop">Tabletop exercise</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Title</Label>
                <Input value={newDrill.title} onChange={(e) => setNewDrill(d => ({ ...d, title: e.target.value }))} placeholder="Q3 backup restore drill" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Findings</Label>
                <Textarea rows={3} value={newDrill.findings} onChange={(e) => setNewDrill(d => ({ ...d, findings: e.target.value }))} />
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button onClick={logDrill}>Log drill</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent drills</CardTitle></CardHeader>
            <CardContent>
              {drillsLoading ? <Skeleton className="h-24 w-full" /> : drills.length === 0 ? (
                <div className="text-sm text-muted-foreground">No drills logged yet.</div>
              ) : (
                <div className="space-y-2">
                  {drills.map((d) => (
                    <div key={d.id} className="border rounded-md p-3 text-sm space-y-1">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          {statusBadge(d.status)}
                          <Badge variant="secondary" className="text-xs">{d.kind.replace(/_/g, " ")}</Badge>
                          <span className="font-medium">{d.title}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {(d.executed_at ?? d.created_at) ? new Date(d.executed_at ?? d.created_at).toLocaleString('en-AU') : ""}
                          {d.executed_by_label ? ` · ${d.executed_by_label}` : ""}
                        </span>
                      </div>
                      {d.findings && <div className="text-xs text-muted-foreground whitespace-pre-wrap">{d.findings}</div>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Runbooks */}
        <TabsContent value="runbooks" className="space-y-4">
          {runbooksLoading ? (
            <AmlLoadingState variant="block" label="Loading runbooks…" />
          ) : runbooks.length === 0 ? (
            <AmlEmptyState
              icon={BookOpen}
              title="No runbooks published yet"
              body="Operational runbooks appear here once they are recorded in the resilience programme — log a drill from the Resilience Drills tab, or check back after the next review cycle."
            />
          ) : (
            runbooks.map((rb) => (
              <Card key={rb.id}>
                <CardHeader><CardTitle>{rb.title}</CardTitle></CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{rb.body_md}</pre>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
